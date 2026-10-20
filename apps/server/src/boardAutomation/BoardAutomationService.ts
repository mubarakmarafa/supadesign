import {
  BOARD_AUTOMATION_DELAY_MS,
  BOARD_AUTOMATION_MAX_CHAINED_MOVES,
  BoardAutomationError,
  type BoardAutomationRun,
  type BoardAutomationRunList,
  type BoardColumnId,
  type ModelSelection,
  type ProjectBoard,
  type ProjectId,
  type ThreadId,
} from "@supaterm/contracts";
import {
  BOARD_AUTOMATION_BANKED,
  boardArrivalSteps,
  boardAutomationSteps,
  boardMoveWhenDone,
  type PlannedBoardAutomationStep,
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
  /** Moves the card as a drag would, which archives it when the column is Done. */
  readonly moveCard: (input: {
    readonly threadId: ThreadId;
    readonly columnId: BoardColumnId;
  }) => Effect.Effect<void, BoardAutomationError>;
}

export type BoardAutomationOutcome = "done" | "needs_you";

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
    /**
     * The card's agent went idle. A sent run settles on what the agent
     * reported: done moves the card on when its column says where, needs-you
     * waits for the designer, and no report at all is shown as finished.
     */
    readonly settled: (threadId: ThreadId) => Effect.Effect<void>;
    /** The card's agent says how the steps it was sent went. */
    readonly report: (input: {
      readonly threadId: ThreadId;
      readonly outcome: BoardAutomationOutcome;
      readonly note: string | undefined;
    }) => Effect.Effect<void, BoardAutomationError>;
    /** Stops a waiting run, or dismisses a finished one. Moving a finished card on is a plain move. */
    readonly cancel: (threadId: ThreadId) => Effect.Effect<void, BoardAutomationError>;
    /** Sends a waiting run without waiting out the delay. */
    readonly runNow: (threadId: ThreadId) => Effect.Effect<void, BoardAutomationError>;
    /** Sends a column's arrival steps to a card already in it, right away. */
    readonly rerun: (input: {
      readonly threadId: ThreadId;
      readonly columnId: BoardColumnId;
    }) => Effect.Effect<void, BoardAutomationError>;
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
  /** A rerun sends its column's arrival steps again to a card that didn't move. */
  readonly kind: "move" | "rerun";
  /** Automatic moves in a row that brought the card here. */
  readonly chain: number;
  /** Set while its prompts are going out, so nothing else claims it. */
  sending: boolean;
  /** What the agent reported so far, oldest first. */
  readonly reports: Array<{ readonly outcome: BoardAutomationOutcome; readonly note?: string }>;
  run: BoardAutomationRun;
}

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

/** Appended to every step's prompt: where it came from and how to report back. */
export function boardAutomationFooter(planned: PlannedBoardAutomationStep): string {
  return `\n\n---\nSent by the ${planned.column.title} column's “${planned.step.name}” step. When you're finished, call supaterm_board_step_report with outcome "done" and a short note, or "needs_you" with what is blocking you.`;
}

const plannedSteps = (board: ProjectBoard | null, entry: Entry) =>
  entry.kind === "rerun"
    ? boardArrivalSteps(board, entry.run.toColumnId)
    : boardAutomationSteps(board, entry.run.fromColumnId, entry.run.toColumnId);

/** Where a run that arrived in `columnId` sends the card once it's done, if anywhere. */
const moveTargetOf = (board: ProjectBoard | null, columnId: BoardColumnId) =>
  boardMoveWhenDone(board, columnId) ?? undefined;

export const make = (ops: BoardAutomationOps) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const entries = new Map<ThreadId, Entry>();
    /** Set just before the board moves a card itself, read by the move that follows. */
    const pendingChains = new Map<ThreadId, number>();
    const listeners = new Set<{
      readonly projectId: ProjectId;
      readonly listener: (list: BoardAutomationRunList) => Effect.Effect<void>;
    }>();
    const lock = yield* Semaphore.make(1);
    const locked = <A, E>(effect: Effect.Effect<A, E>) => lock.withPermits(1)(effect);
    let nextToken = 0;
    const now = Effect.map(Clock.currentTimeMillis, iso);

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

    const update = (entry: Entry, change: Partial<BoardAutomationRun>) =>
      Effect.gen(function* () {
        entry.run = { ...entry.run, ...change, at: change.at ?? (yield* now) };
        yield* publish(entry.projectId);
      });

    /** Sends each step's prompt in order; a step needing banked messages skips without them. */
    const deliver = (entry: Entry) =>
      Effect.gen(function* () {
        const { threadId, fromColumnId, toColumnId } = entry.run;
        const card = yield* ops.cardOf(threadId);
        if (card === null || card.archived) return { sent: [], skipped: [] };
        const board = yield* ops.boardOf(entry.projectId);
        const titleOf = (columnId: BoardColumnId) =>
          (board?.columns ?? []).find((column) => column.id === columnId)?.title ??
          "another column";
        const values = {
          card: card.title,
          branch: card.branch,
          column: titleOf(toColumnId),
          from: titleOf(fromColumnId),
        };
        const sent: string[] = [];
        const skipped: string[] = [];
        for (const planned of plannedSteps(board, entry)) {
          const { step } = planned;
          const footer = boardAutomationFooter(planned);
          const sendStep = step.prompt.includes(BOARD_AUTOMATION_BANKED)
            ? ops.sendBanked({
                threadId,
                render: (banked) =>
                  renderBoardAutomationPrompt(step.prompt, values, banked) + footer,
                modelSelection: step.modelSelection,
              })
            : ops
                .send({
                  threadId,
                  text: renderBoardAutomationPrompt(step.prompt, values) + footer,
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
        yield* locked(
          Effect.gen(function* () {
            // A move made while sending already replaced this run.
            if (entries.get(threadId) !== claimed) return;
            claimed.sending = false;
            if (outcome._tag === "Failure") {
              return yield* update(claimed, { status: "failed", note: outcome.failure.message });
            }
            const { sent, skipped } = outcome.success;
            if (sent.length === 0) return yield* drop(threadId, claimed);
            // The agent may already have reported on a step that went out first.
            const blocked = claimed.reports.find((report) => report.outcome === "needs_you");
            const skippedNote =
              skipped.length === 0
                ? undefined
                : `Skipped ${skipped.join(", ")}: nothing was banked.`;
            const note = blocked?.note ?? skippedNote;
            claimed.run = {
              threadId: claimed.run.threadId,
              fromColumnId: claimed.run.fromColumnId,
              toColumnId: claimed.run.toColumnId,
              stepNames: sent,
              status: blocked === undefined ? "sent" : "needs-you",
              at: yield* now,
              ...(note === undefined ? {} : { note }),
              ...(claimed.run.moveTo === undefined ? {} : { moveTo: claimed.run.moveTo }),
            };
            yield* publish(claimed.projectId);
          }),
        );
      });

    /** Schedules or starts an entry's steps; a rerun skips the wait. */
    const schedule = (
      input: { readonly threadId: ThreadId; readonly projectId: ProjectId },
      fields: Pick<Entry, "kind" | "chain"> & {
        readonly fromColumnId: BoardColumnId;
        readonly toColumnId: BoardColumnId;
        readonly stepNames: ReadonlyArray<string>;
        readonly moveTo: BoardColumnId | undefined;
      },
    ) =>
      Effect.gen(function* () {
        const token = ++nextToken;
        const millis = yield* Clock.currentTimeMillis;
        const delay = fields.kind === "rerun" ? 0 : BOARD_AUTOMATION_DELAY_MS;
        entries.set(input.threadId, {
          token,
          projectId: input.projectId,
          kind: fields.kind,
          chain: fields.chain,
          sending: false,
          reports: [],
          run: {
            threadId: input.threadId,
            fromColumnId: fields.fromColumnId,
            toColumnId: fields.toColumnId,
            stepNames: [...fields.stepNames],
            status: "scheduled",
            at: iso(millis + delay),
            ...(fields.moveTo === undefined ? {} : { moveTo: fields.moveTo }),
          },
        });
        yield* publish(input.projectId);
        return token;
      });

    const cardMoved: BoardAutomationService["Service"]["cardMoved"] = (input) =>
      locked(
        Effect.gen(function* () {
          const chain = pendingChains.get(input.threadId) ?? 0;
          pendingChains.delete(input.threadId);
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
          const fields = {
            kind: "move" as const,
            chain,
            fromColumnId,
            toColumnId: input.toColumnId,
            stepNames: steps.map((planned) => planned.step.name),
          };
          const token = yield* schedule(input, {
            ...fields,
            moveTo: moveTargetOf(board, input.toColumnId),
          });
          // A board whose columns pass cards along could loop forever; it stops
          // after a few moves the designer didn't make.
          if (chain > BOARD_AUTOMATION_MAX_CHAINED_MOVES) {
            const entry = entries.get(input.threadId)!;
            return yield* update(entry, {
              status: "needs-you",
              note: `Stopped after ${BOARD_AUTOMATION_MAX_CHAINED_MOVES} automatic moves in a row. Move the card yourself to carry on.`,
            });
          }
          // A replaced run's timer still wakes; its stale token makes it do nothing.
          yield* Effect.sleep(BOARD_AUTOMATION_DELAY_MS).pipe(
            Effect.andThen(fire(input.threadId, token)),
            Effect.forkIn(scope),
          );
        }),
      );

    /** Moves the card on for a finished run, counting it as an automatic move. */
    const moveOnward = (threadId: ThreadId, entry: Entry, target: BoardColumnId) =>
      Effect.gen(function* () {
        pendingChains.set(threadId, entry.chain + 1);
        const moved = yield* Effect.result(ops.moveCard({ threadId, columnId: target }));
        if (moved._tag === "Failure") {
          pendingChains.delete(threadId);
          yield* locked(
            Effect.gen(function* () {
              if (entries.get(threadId) !== entry) return;
              yield* update(entry, {
                status: "needs-you",
                note: `It couldn't move on: ${moved.failure.message}`,
              });
            }),
          );
          return yield* moved.failure;
        }
      });

    const settled: BoardAutomationService["Service"]["settled"] = (threadId) =>
      Effect.gen(function* () {
        const decision = yield* locked(
          Effect.gen(function* () {
            const entry = entries.get(threadId);
            if (entry?.run.status !== "sent" || entry.sending) return null;
            const done = entry.reports.findLast((report) => report.outcome === "done");
            if (done === undefined) {
              yield* update(entry, { status: "finished" });
              return null;
            }
            if (entry.run.moveTo === undefined) {
              yield* update(entry, {
                status: "done",
                ...(done.note === undefined ? {} : { note: done.note }),
              });
              return null;
            }
            return { entry, target: entry.run.moveTo };
          }),
        );
        if (decision === null) return;
        yield* moveOnward(threadId, decision.entry, decision.target).pipe(Effect.ignore);
      });

    const report: BoardAutomationService["Service"]["report"] = (input) =>
      locked(
        Effect.gen(function* () {
          const entry = entries.get(input.threadId);
          const reportable =
            entry !== undefined &&
            (entry.sending || entry.run.status === "sent" || entry.run.status === "needs-you");
          if (!reportable) {
            return yield* fail("No column step on this card is waiting for a report.");
          }
          const note = input.note?.trim() || undefined;
          entry.reports.push({ outcome: input.outcome, ...(note === undefined ? {} : { note }) });
          if (entry.sending) return;
          if (input.outcome === "needs_you") {
            return yield* update(entry, {
              status: "needs-you",
              ...(note === undefined ? {} : { note }),
            });
          }
          if (note !== undefined) yield* update(entry, { note });
        }),
      );

    const forget: BoardAutomationService["Service"]["forget"] = (threadId) =>
      locked(
        Effect.gen(function* () {
          pendingChains.delete(threadId);
          const entry = entries.get(threadId);
          if (entry !== undefined && !entry.sending) yield* drop(threadId, entry);
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

    /** Fires a run now and surfaces its failure to the caller. */
    const fireAndReport = (threadId: ThreadId, token: number) =>
      Effect.gen(function* () {
        yield* fire(threadId, token);
        const after = yield* locked(Effect.sync(() => entries.get(threadId)));
        if (after?.run.status === "failed") return yield* fail(after.run.note ?? "It failed.");
      });

    const runNow: BoardAutomationService["Service"]["runNow"] = (threadId) =>
      Effect.gen(function* () {
        const entry = yield* locked(Effect.sync(() => entries.get(threadId)));
        if (entry === undefined || entry.run.status !== "scheduled" || entry.sending) {
          return yield* fail("Nothing is waiting on this card.");
        }
        yield* fireAndReport(threadId, entry.token);
      });

    const rerun: BoardAutomationService["Service"]["rerun"] = (input) =>
      Effect.gen(function* () {
        const card = yield* ops.cardOf(input.threadId);
        if (card === null || card.archived) return yield* fail("The card's thread is gone.");
        const target = { threadId: input.threadId, projectId: card.projectId };
        const token = yield* locked(
          Effect.gen(function* () {
            const existing = entries.get(input.threadId);
            if (existing?.sending === true) {
              return yield* fail("Its prompts are already on their way.");
            }
            const board = yield* ops.boardOf(card.projectId);
            const steps = boardArrivalSteps(board, input.columnId);
            if (steps.length === 0) return yield* fail("This column has no arrival steps.");
            return yield* schedule(target, {
              kind: "rerun",
              chain: 0,
              fromColumnId: input.columnId,
              toColumnId: input.columnId,
              stepNames: steps.map((planned) => planned.step.name),
              moveTo: moveTargetOf(board, input.columnId),
            });
          }),
        );
        yield* fireAndReport(input.threadId, token);
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
      report,
      cancel,
      runNow,
      rerun,
      subscribe,
    });
  });
