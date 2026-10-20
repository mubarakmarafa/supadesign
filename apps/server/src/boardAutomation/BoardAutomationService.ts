import {
  BOARD_AUTOMATION_DELAY_MS,
  BoardAutomationError,
  type BoardAutomationRun,
  type BoardAutomationRunList,
  type BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  type ModelSelection,
  type ProjectBoard,
  type ProjectId,
  type ThreadId,
} from "@supaterm/contracts";
import {
  BOARD_AUTOMATION_BANKED,
  boardAutomationSteps,
  renderBoardAutomationPrompt,
} from "@supaterm/shared/projectBoard";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

/** What a prompt can say about the card it is sent to. */
export interface BoardAutomationCard {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly branch: string | null;
  readonly archived: boolean;
}

/** Where boards and cards are read and how a step's prompt reaches the card's agent. */
export interface BoardAutomationOps {
  readonly boardOf: (projectId: ProjectId) => Effect.Effect<ProjectBoard | null>;
  /** Null once the card's thread is gone. */
  readonly cardOf: (threadId: ThreadId) => Effect.Effect<BoardAutomationCard | null>;
  /** Queues one message behind the card's running turn. */
  readonly send: (input: {
    readonly threadId: ThreadId;
    readonly text: string;
    readonly modelSelection: ModelSelection | undefined;
  }) => Effect.Effect<void, BoardAutomationError>;
  /** Sends the card's banked messages folded into `render`; false when nothing was banked. */
  readonly sendBanked: (input: {
    readonly threadId: ThreadId;
    readonly render: (banked: string) => string;
    readonly modelSelection: ModelSelection | undefined;
  }) => Effect.Effect<boolean, BoardAutomationError>;
}

export class BoardAutomationService extends Context.Service<
  BoardAutomationService,
  {
    /**
     * A card changed column. Its steps wait `BOARD_AUTOMATION_DELAY_MS`, and a
     * move made meanwhile replaces them, measured from where the card started.
     */
    readonly cardMoved: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly fromColumnId: BoardColumnId;
      readonly toColumnId: BoardColumnId;
    }) => Effect.Effect<void>;
    /** Drops whatever the card had waiting or showing, such as when its thread is deleted. */
    readonly forget: (threadId: ThreadId) => Effect.Effect<void>;
    /** The card's agent went idle, so a sent run has nothing left to show. */
    readonly settled: (threadId: ThreadId) => Effect.Effect<void>;
    /** Stops a waiting run, or dismisses a sent or failed one. */
    readonly cancel: (threadId: ThreadId) => Effect.Effect<void, BoardAutomationError>;
    /** Sends a waiting run without waiting out the delay. */
    readonly runNow: (threadId: ThreadId) => Effect.Effect<void, BoardAutomationError>;
    /** Calls `listener` with the project's runs now and after every change. */
    readonly subscribe: (
      projectId: ProjectId,
      listener: (list: BoardAutomationRunList) => Effect.Effect<void>,
    ) => Effect.Effect<() => void>;
  }
>()("supaterm/boardAutomation/BoardAutomationService") {}

const fail = (message: string) => new BoardAutomationError({ message });

interface Entry {
  readonly token: number;
  readonly projectId: ProjectId;
  /** Set while its prompts are going out, so nothing else claims it. */
  sending: boolean;
  run: BoardAutomationRun;
}

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

export const make = (ops: BoardAutomationOps) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const entries = new Map<ThreadId, Entry>();
    const listeners = new Set<{
      readonly projectId: ProjectId;
      readonly listener: (list: BoardAutomationRunList) => Effect.Effect<void>;
    }>();
    const lock = yield* Semaphore.make(1);
    const locked = <A, E>(effect: Effect.Effect<A, E>) => lock.withPermits(1)(effect);
    let nextToken = 0;

    const listFor = (projectId: ProjectId): BoardAutomationRunList =>
      entries
        .values()
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => entry.run)
        .toArray();

    const publish = (projectId: ProjectId) =>
      Effect.forEach(
        listeners,
        (subscription) =>
          subscription.projectId === projectId
            ? subscription.listener(listFor(projectId))
            : Effect.void,
        { discard: true },
      );

    const drop = (threadId: ThreadId, entry: Entry) => {
      entries.delete(threadId);
      return publish(entry.projectId);
    };

    /** Sends each step's prompt in order; a step needing banked messages skips without them. */
    const deliver = (entry: Entry) =>
      Effect.gen(function* () {
        const { threadId, fromColumnId, toColumnId } = entry.run;
        const card = yield* ops.cardOf(threadId);
        if (card === null || card.archived) return { sent: [], skipped: [] };
        const board = yield* ops.boardOf(entry.projectId);
        const layout = board ?? DEFAULT_PROJECT_BOARD;
        const titleOf = (columnId: BoardColumnId) =>
          layout.columns.find((column) => column.id === columnId)?.title ?? "another column";
        const values = {
          card: card.title,
          branch: card.branch,
          column: titleOf(toColumnId),
          from: titleOf(fromColumnId),
        };
        const sent: string[] = [];
        const skipped: string[] = [];
        for (const step of boardAutomationSteps(board, fromColumnId, toColumnId)) {
          const sendStep = step.prompt.includes(BOARD_AUTOMATION_BANKED)
            ? ops.sendBanked({
                threadId,
                render: (banked) => renderBoardAutomationPrompt(step.prompt, values, banked),
                modelSelection: step.modelSelection,
              })
            : ops
                .send({
                  threadId,
                  text: renderBoardAutomationPrompt(step.prompt, values),
                  modelSelection: step.modelSelection,
                })
                .pipe(Effect.as(true));
          const delivered = yield* sendStep.pipe(
            Effect.mapError((error) =>
              fail(
                sent.length === 0
                  ? error.message
                  : `Sent ${sent.join(", ")}, then ${step.name} failed: ${error.message}`,
              ),
            ),
          );
          (delivered ? sent : skipped).push(step.name);
        }
        return { sent, skipped };
      });

    const fire = (threadId: ThreadId, token: number) =>
      Effect.gen(function* () {
        const claimed = yield* locked(
          Effect.sync(() => {
            const entry = entries.get(threadId);
            if (entry?.token !== token || entry.run.status !== "scheduled" || entry.sending) {
              return null;
            }
            entry.sending = true;
            return entry;
          }),
        );
        if (claimed === null) return;
        // Once a prompt is out, the rest of the run must not be cut short.
        const outcome = yield* Effect.uninterruptible(Effect.result(deliver(claimed)));
        const now = yield* Clock.currentTimeMillis;
        yield* locked(
          Effect.gen(function* () {
            // A move made while sending already replaced this run.
            if (entries.get(threadId) !== claimed) return;
            claimed.sending = false;
            if (outcome._tag === "Failure") {
              claimed.run = {
                ...claimed.run,
                status: "failed",
                at: iso(now),
                note: outcome.failure.message,
              };
              return yield* publish(claimed.projectId);
            }
            const { sent, skipped } = outcome.success;
            if (sent.length === 0) return yield* drop(threadId, claimed);
            const note =
              skipped.length === 0
                ? undefined
                : `Skipped ${skipped.join(", ")}: nothing was banked.`;
            claimed.run = {
              threadId: claimed.run.threadId,
              fromColumnId: claimed.run.fromColumnId,
              toColumnId: claimed.run.toColumnId,
              stepNames: sent,
              status: "sent",
              at: iso(now),
              ...(note === undefined ? {} : { note }),
            };
            yield* publish(claimed.projectId);
          }),
        );
      });

    const cardMoved: BoardAutomationService["Service"]["cardMoved"] = (input) =>
      locked(
        Effect.gen(function* () {
          const existing = entries.get(input.threadId);
          const waiting =
            existing !== undefined && existing.run.status === "scheduled" && !existing.sending
              ? existing
              : undefined;
          const fromColumnId = waiting?.run.fromColumnId ?? input.fromColumnId;
          const board = yield* ops.boardOf(input.projectId);
          const steps = boardAutomationSteps(board, fromColumnId, input.toColumnId);
          if (steps.length === 0) {
            if (existing !== undefined && !existing.sending) {
              yield* drop(input.threadId, existing);
            }
            return;
          }
          const token = ++nextToken;
          const now = yield* Clock.currentTimeMillis;
          entries.set(input.threadId, {
            token,
            projectId: input.projectId,
            sending: false,
            run: {
              threadId: input.threadId,
              fromColumnId,
              toColumnId: input.toColumnId,
              stepNames: steps.map((step) => step.name),
              status: "scheduled",
              at: iso(now + BOARD_AUTOMATION_DELAY_MS),
            },
          });
          yield* publish(input.projectId);
          // A replaced run's timer still wakes; its stale token makes it do nothing.
          yield* Effect.sleep(BOARD_AUTOMATION_DELAY_MS).pipe(
            Effect.andThen(fire(input.threadId, token)),
            Effect.forkIn(scope),
          );
        }),
      );

    const forget: BoardAutomationService["Service"]["forget"] = (threadId) =>
      locked(
        Effect.gen(function* () {
          const entry = entries.get(threadId);
          if (entry !== undefined && !entry.sending) yield* drop(threadId, entry);
        }),
      );

    const settled: BoardAutomationService["Service"]["settled"] = (threadId) =>
      locked(
        Effect.gen(function* () {
          const entry = entries.get(threadId);
          if (entry?.run.status === "sent") yield* drop(threadId, entry);
        }),
      );

    const cancel: BoardAutomationService["Service"]["cancel"] = (threadId) =>
      locked(
        Effect.gen(function* () {
          const entry = entries.get(threadId);
          if (entry === undefined) return yield* fail("Nothing is waiting on this card.");
          if (entry.sending) return yield* fail("Its prompts are already on their way.");
          yield* drop(threadId, entry);
        }),
      );

    const runNow: BoardAutomationService["Service"]["runNow"] = (threadId) =>
      Effect.gen(function* () {
        const entry = yield* locked(Effect.sync(() => entries.get(threadId)));
        if (entry === undefined || entry.run.status !== "scheduled" || entry.sending) {
          return yield* fail("Nothing is waiting on this card.");
        }
        yield* fire(threadId, entry.token);
        const after = yield* locked(Effect.sync(() => entries.get(threadId)));
        if (after?.run.status === "failed") return yield* fail(after.run.note ?? "It failed.");
      });

    const subscribe: BoardAutomationService["Service"]["subscribe"] = (projectId, listener) =>
      locked(
        Effect.gen(function* () {
          const subscription = { projectId, listener };
          listeners.add(subscription);
          yield* listener(listFor(projectId));
          return () => {
            listeners.delete(subscription);
          };
        }),
      );

    return BoardAutomationService.of({
      cardMoved,
      forget,
      settled,
      cancel,
      runNow,
      subscribe,
    });
  });
