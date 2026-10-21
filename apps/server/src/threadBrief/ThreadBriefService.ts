import {
  THREAD_BRIEF_MAX_LENGTH,
  THREAD_DECISION_MAX_LENGTH,
  THREAD_DECISION_SUGGESTIONS_MAX,
  THREAD_DECISIONS_MAX,
  ThreadBriefError,
  ThreadDecisionId,
  type ProjectId,
  type ThreadBrief,
  type ThreadBriefList,
  type ThreadDecision,
  type ThreadDecisionSource,
  type ThreadId,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import type { TurnContextEntry } from "../orchestration-v2/TurnContext.ts";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

/**
 * Who is asking. The designer sets the direction; an agent only reads it and
 * suggests decisions, so it can never settle its own suggestion.
 */
export type ThreadBriefActor = ThreadDecisionSource;

export interface StoredDecision extends ThreadDecision {
  /** Set once the designer rejects or removes it. It leaves the list but is kept. */
  readonly rejectedAt: string | null;
}

export interface StoredBriefVersion {
  /** Empty when the designer cleared the brief. */
  readonly text: string;
  readonly editedAt: string;
}

export interface StoredBrief {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  /** Every brief the designer wrote, oldest first; the last one is current. */
  readonly versions: ReadonlyArray<StoredBriefVersion>;
  /** Oldest first, rejected ones included. */
  readonly decisions: ReadonlyArray<StoredDecision>;
}

/** Where briefs are kept and where a card's starting brief comes from. */
export interface ThreadBriefOps {
  readonly projectOf: (threadId: ThreadId) => Effect.Effect<ProjectId, ThreadBriefError>;
  /** The card's note while it waits unstarted, else its first message. Null when it has neither. */
  readonly seedText: (threadId: ThreadId) => Effect.Effect<string | null, ThreadBriefError>;
  readonly newId: Effect.Effect<string>;
  readonly now: Effect.Effect<string>;
  readonly load: Effect.Effect<ReadonlyArray<StoredBrief>>;
  readonly save: (briefs: ReadonlyArray<StoredBrief>) => Effect.Effect<void>;
}

export class ThreadBriefService extends Context.Service<
  ThreadBriefService,
  {
    /**
     * Writes the brief, keeping every earlier one. An empty text clears it.
     * Only the designer may. Returns whether the brief changed.
     */
    readonly setBrief: (input: {
      readonly threadId: ThreadId;
      readonly text: string;
      readonly by: ThreadBriefActor;
    }) => Effect.Effect<boolean, ThreadBriefError>;
    /** Starts an empty brief from the card's note or first message. */
    readonly seedBrief: (threadId: ThreadId) => Effect.Effect<void, ThreadBriefError>;
    /** The designer's own decisions are accepted; an agent's wait as suggestions. */
    readonly addDecision: (input: {
      readonly threadId: ThreadId;
      readonly text: string;
      readonly by: ThreadBriefActor;
    }) => Effect.Effect<ThreadDecision, ThreadBriefError>;
    /** Accepts a suggestion, in the designer's words when `text` differs, or rewords a decision. */
    readonly acceptDecision: (input: {
      readonly threadId: ThreadId;
      readonly decisionId: string;
      readonly text?: string | undefined;
      readonly by: ThreadBriefActor;
    }) => Effect.Effect<ThreadDecision, ThreadBriefError>;
    /** Rejects a suggestion or removes a decision. It drops out of the list. */
    readonly rejectDecision: (input: {
      readonly threadId: ThreadId;
      readonly decisionId: string;
      readonly by: ThreadBriefActor;
    }) => Effect.Effect<void, ThreadBriefError>;
    /** Brings back a decision the designer rejected or removed. */
    readonly restoreDecision: (input: {
      readonly threadId: ThreadId;
      readonly decisionId: string;
      readonly by: ThreadBriefActor;
    }) => Effect.Effect<void, ThreadBriefError>;
    readonly get: (threadId: ThreadId) => Effect.Effect<ThreadBrief | null>;
    /**
     * The brief and settled decisions as the card's agent is told them with
     * its next turn. Null for a card that never had either.
     */
    readonly turnContext: (threadId: ThreadId) => Effect.Effect<TurnContextEntry | null>;
    /** Every brief the card has had, oldest first, cleared ones included. */
    readonly versions: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<StoredBriefVersion>>;
    /** Calls `listener` with the project's briefs now and after every change. */
    readonly subscribe: (
      projectId: ProjectId,
      listener: (list: ThreadBriefList) => Effect.Effect<void>,
    ) => Effect.Effect<() => void>;
  }
>()("supaterm/threadBrief/ThreadBriefService") {}

const fail = (message: string) => new ThreadBriefError({ message });

const designerOnly = (by: ThreadBriefActor, refusal: string) =>
  by === "designer" ? Effect.void : Effect.fail(fail(refusal));

/** A decision is one line; the brief keeps its paragraphs. */
const decisionText = (text: string) => text.trim().replace(/\s+/g, " ");
const briefText = (text: string) => text.trim();

const sameText = (a: string, b: string) =>
  decisionText(a).toLowerCase() === decisionText(b).toLowerCase();

const isOpen = (decision: StoredDecision) => decision.rejectedAt === null;

/** What clients and agents see: the current brief and the open decisions. */
export const toThreadBrief = (record: StoredBrief): ThreadBrief => {
  const current = record.versions.at(-1);
  return {
    threadId: record.threadId,
    brief:
      current === undefined || current.text.length === 0
        ? null
        : { text: current.text, updatedAt: current.editedAt, version: record.versions.length },
    decisions: record.decisions
      .filter(isOpen)
      .map(({ rejectedAt: _rejectedAt, ...decision }) => decision),
  };
};

const isVisible = (brief: ThreadBrief) => brief.brief !== null || brief.decisions.length > 0;

/**
 * What the agent reads ahead of the designer's next message. Suggestions
 * still waiting aren't decided, so only settled decisions go in; a cleared
 * brief is said outright so the agent drops the one it saw before. Null
 * until the designer has written a brief or settled a decision.
 */
export const briefTurnContext = (record: StoredBrief): TurnContextEntry | null => {
  const { brief, decisions } = toThreadBrief(record);
  const settled = decisions.filter((decision) => decision.status !== "suggested");
  // Waiting suggestions alone give the agent nothing to follow or drop.
  const everSet =
    record.versions.length > 0 ||
    record.decisions.some((decision) => decision.status !== "suggested");
  if (!everSet) return null;
  const version = [
    record.versions.length,
    ...settled.map((decision) => `${decision.id}:${decision.updatedAt}`),
  ].join("|");
  if (brief === null && settled.length === 0) {
    return {
      version,
      text: [
        "<card_brief>",
        "The designer cleared this card's brief and decisions in Supadesign. Drop the earlier ones; follow their messages from here.",
        "</card_brief>",
      ].join("\n"),
    };
  }
  return {
    version,
    text: [
      "<card_brief>",
      "The designer's brief and settled decisions for this card, from Supadesign. They changed since you last saw them. Follow them, and don't reopen settled decisions; propose a change with supaterm_decision_suggest instead.",
      ...(brief === null ? [] : ["", "Brief:", brief.text]),
      ...(settled.length === 0
        ? []
        : ["", "Decided:", ...settled.map((decision) => `- ${decision.text}`)]),
      "</card_brief>",
    ].join("\n"),
  };
};

export const make = (ops: ThreadBriefOps) =>
  Effect.gen(function* () {
    const records = new Map<ThreadId, StoredBrief>();
    for (const record of yield* ops.load) {
      if (record.versions.length > 0 || record.decisions.length > 0) {
        records.set(record.threadId, record);
      }
    }
    const listeners = new Set<{
      readonly projectId: ProjectId;
      readonly listener: (list: ThreadBriefList) => Effect.Effect<void>;
    }>();
    const lock = yield* Semaphore.make(1);
    const locked = <A, E>(effect: Effect.Effect<A, E>) => lock.withPermits(1)(effect);

    const listFor = (projectId: ProjectId): ThreadBriefList =>
      records
        .values()
        .filter((record) => record.projectId === projectId)
        .map(toThreadBrief)
        .filter(isVisible)
        .toArray();

    const commit = (projectId: ProjectId) =>
      Effect.gen(function* () {
        yield* ops.save(records.values().toArray());
        yield* Effect.forEach(
          listeners,
          (subscription) =>
            subscription.projectId === projectId
              ? subscription.listener(listFor(projectId))
              : Effect.void,
          { discard: true },
        );
      });

    /**
     * Applies `change` to the thread's record under the lock and publishes it.
     * Returning the record unchanged publishes nothing.
     */
    const modify = <A>(
      threadId: ThreadId,
      change: (current: StoredBrief) => Effect.Effect<readonly [StoredBrief, A], ThreadBriefError>,
    ) =>
      Effect.gen(function* () {
        const projectId = yield* ops.projectOf(threadId);
        return yield* locked(
          Effect.gen(function* () {
            const current = records.get(threadId) ?? {
              threadId,
              projectId,
              versions: [],
              decisions: [],
            };
            const [next, result] = yield* change(current);
            if (next === current) return result;
            records.set(threadId, next);
            yield* commit(projectId);
            return result;
          }),
        );
      });

    const findDecision = (record: StoredBrief, decisionId: string) => {
      const decision = record.decisions.find((candidate) => candidate.id === decisionId);
      return decision === undefined
        ? Effect.fail(fail("That decision no longer exists."))
        : Effect.succeed(decision);
    };

    const replaceDecision = (record: StoredBrief, decision: StoredDecision): StoredBrief => ({
      ...record,
      decisions: record.decisions.map((candidate) =>
        candidate.id === decision.id ? decision : candidate,
      ),
    });

    const writeBrief = (threadId: ThreadId, text: string) =>
      modify(threadId, (current) =>
        Effect.gen(function* () {
          const latest = current.versions.at(-1)?.text ?? "";
          if (text === latest) return [current, false] as const;
          const editedAt = yield* ops.now;
          return [
            { ...current, versions: [...current.versions, { text, editedAt }] },
            true,
          ] as const;
        }),
      );

    const setBrief: ThreadBriefService["Service"]["setBrief"] = (input) =>
      Effect.gen(function* () {
        yield* designerOnly(input.by, "Only the designer can change the brief.");
        const text = briefText(input.text);
        if (text.length > THREAD_BRIEF_MAX_LENGTH) {
          return yield* fail(`A brief is at most ${THREAD_BRIEF_MAX_LENGTH} characters.`);
        }
        return yield* writeBrief(input.threadId, text);
      });

    const seedBrief: ThreadBriefService["Service"]["seedBrief"] = (threadId) =>
      Effect.gen(function* () {
        const seed = yield* ops.seedText(threadId);
        const text = seed === null ? "" : briefText(seed).slice(0, THREAD_BRIEF_MAX_LENGTH).trim();
        if (text.length === 0) {
          return yield* fail("This card has no note or first message to start the brief from.");
        }
        yield* modify(threadId, (current) =>
          Effect.gen(function* () {
            // Never overwrite a brief written meanwhile, on this client or another.
            if ((current.versions.at(-1)?.text ?? "").length > 0) {
              return yield* fail("This card already has a brief.");
            }
            const editedAt = yield* ops.now;
            return [
              { ...current, versions: [...current.versions, { text, editedAt }] },
              undefined,
            ] as const;
          }),
        );
      });

    const addDecision: ThreadBriefService["Service"]["addDecision"] = (input) =>
      Effect.gen(function* () {
        const text = decisionText(input.text);
        if (text.length === 0) return yield* fail("A decision needs some words.");
        if (text.length > THREAD_DECISION_MAX_LENGTH) {
          return yield* fail(`A decision is at most ${THREAD_DECISION_MAX_LENGTH} characters.`);
        }
        return yield* modify(input.threadId, (current) =>
          Effect.gen(function* () {
            const open = current.decisions.filter(isOpen);
            const existing = open.find((decision) => sameText(decision.text, text));
            if (existing !== undefined) {
              const { rejectedAt: _rejectedAt, ...decision } = existing;
              if (input.by === "agent" || existing.status !== "suggested") {
                return [current, decision] as const;
              }
              // The designer writing down a waiting suggestion accepts it.
              const accepted: ThreadDecision = {
                ...decision,
                status: "accepted",
                updatedAt: yield* ops.now,
              };
              return [
                replaceDecision(current, { ...accepted, rejectedAt: null }),
                accepted,
              ] as const;
            }
            if (input.by === "agent") {
              if (
                current.decisions.some(
                  (decision) => !isOpen(decision) && sameText(decision.text, text),
                )
              ) {
                return yield* fail(
                  "The designer already turned this decision down. Don't suggest it again.",
                );
              }
              const waiting = open.filter((decision) => decision.status === "suggested").length;
              if (waiting >= THREAD_DECISION_SUGGESTIONS_MAX) {
                return yield* fail(
                  `${waiting} suggestions are already waiting on the designer. Suggest more once they've been settled.`,
                );
              }
            }
            if (open.length >= THREAD_DECISIONS_MAX) {
              return yield* fail(
                `This card already has ${THREAD_DECISIONS_MAX} decisions. Remove one before adding another.`,
              );
            }
            const now = yield* ops.now;
            const decision: ThreadDecision = {
              id: ThreadDecisionId.make(yield* ops.newId),
              text,
              status: input.by === "designer" ? "accepted" : "suggested",
              source: input.by,
              createdAt: now,
              updatedAt: now,
            };
            return [
              { ...current, decisions: [...current.decisions, { ...decision, rejectedAt: null }] },
              decision,
            ] as const;
          }),
        );
      });

    const acceptDecision: ThreadBriefService["Service"]["acceptDecision"] = (input) =>
      Effect.gen(function* () {
        yield* designerOnly(
          input.by,
          "Only the designer can accept a decision. Suggest it and let them decide.",
        );
        const reworded = input.text === undefined ? undefined : decisionText(input.text);
        if (reworded !== undefined && reworded.length === 0) {
          return yield* fail("A decision needs some words.");
        }
        if (reworded !== undefined && reworded.length > THREAD_DECISION_MAX_LENGTH) {
          return yield* fail(`A decision is at most ${THREAD_DECISION_MAX_LENGTH} characters.`);
        }
        return yield* modify(input.threadId, (current) =>
          Effect.gen(function* () {
            const found = yield* findDecision(current, input.decisionId);
            if (!isOpen(found)) return yield* fail("That decision was turned down.");
            const changesText = reworded !== undefined && reworded !== found.text;
            const { rejectedAt: _rejectedAt, ...unchanged } = found;
            if (found.status !== "suggested" && !changesText) return [current, unchanged] as const;
            const decision: StoredDecision = {
              ...found,
              text: changesText ? reworded : found.text,
              // An agent's suggestion in the designer's words is marked as theirs.
              status:
                found.source === "agent" && (changesText || found.status === "edited")
                  ? "edited"
                  : "accepted",
              updatedAt: yield* ops.now,
            };
            const { rejectedAt: _, ...result } = decision;
            return [replaceDecision(current, decision), result] as const;
          }),
        );
      });

    const rejectDecision: ThreadBriefService["Service"]["rejectDecision"] = (input) =>
      Effect.gen(function* () {
        yield* designerOnly(input.by, "Only the designer can turn a decision down.");
        yield* modify(input.threadId, (current) =>
          Effect.gen(function* () {
            const found = yield* findDecision(current, input.decisionId);
            if (!isOpen(found)) return [current, undefined] as const;
            const rejectedAt = yield* ops.now;
            return [replaceDecision(current, { ...found, rejectedAt }), undefined] as const;
          }),
        );
      });

    const restoreDecision: ThreadBriefService["Service"]["restoreDecision"] = (input) =>
      Effect.gen(function* () {
        yield* designerOnly(input.by, "Only the designer can bring a decision back.");
        yield* modify(input.threadId, (current) =>
          Effect.gen(function* () {
            const found = yield* findDecision(current, input.decisionId);
            if (isOpen(found)) return [current, undefined] as const;
            return [replaceDecision(current, { ...found, rejectedAt: null }), undefined] as const;
          }),
        );
      });

    const get: ThreadBriefService["Service"]["get"] = (threadId) =>
      Effect.sync(() => {
        const record = records.get(threadId);
        return record === undefined ? null : toThreadBrief(record);
      });

    const turnContext: ThreadBriefService["Service"]["turnContext"] = (threadId) =>
      Effect.sync(() => {
        const record = records.get(threadId);
        return record === undefined ? null : briefTurnContext(record);
      });

    const versions: ThreadBriefService["Service"]["versions"] = (threadId) =>
      Effect.sync(() => records.get(threadId)?.versions ?? []);

    const subscribe: ThreadBriefService["Service"]["subscribe"] = (projectId, listener) =>
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

    return ThreadBriefService.of({
      setBrief,
      seedBrief,
      addDecision,
      acceptDecision,
      rejectDecision,
      restoreDecision,
      get,
      turnContext,
      versions,
      subscribe,
    });
  });
