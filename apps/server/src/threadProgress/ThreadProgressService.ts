import {
  THREAD_PROGRESS_AGENT_INTERVAL_MS,
  THREAD_PROGRESS_MAX_QUESTIONS,
  THREAD_PROGRESS_MAX_UPDATES,
  THREAD_PROGRESS_NOTE_MAX_LENGTH,
  THREAD_PROGRESS_QUESTION_MAX_LENGTH,
  THREAD_SUMMARY_MAX_LENGTH,
  ThreadProgressError,
  ThreadProgressUpdateId,
  type ChatImageAttachment,
  type ProjectId,
  type ThreadId,
  type ThreadProgress,
  type ThreadProgressList,
  type ThreadProgressSource,
  type ThreadProgressUpdate,
  type ThreadSummary,
  type ThreadSummarySource,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

/** A screenshot of a running page. */
export interface ProgressScreenshot {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

/** Where progress comes from and where its images and records are kept. */
export interface ThreadProgressOps {
  readonly projectOf: (threadId: ThreadId) => Effect.Effect<ProjectId, ThreadProgressError>;
  /** The page to capture for a thread: its card's running dev server. */
  readonly pageOf: (threadId: ThreadId) => Effect.Effect<string, ThreadProgressError>;
  readonly screenshot: (url: string) => Effect.Effect<ProgressScreenshot, ThreadProgressError>;
  /** Saves a screenshot as one of the thread's attachments, so it can be shown and sent. */
  readonly storeImage: (input: {
    readonly threadId: ThreadId;
    readonly screenshot: ProgressScreenshot;
  }) => Effect.Effect<ChatImageAttachment, ThreadProgressError>;
  readonly deleteImage: (image: ChatImageAttachment) => Effect.Effect<void>;
  readonly newId: Effect.Effect<string>;
  readonly nowMs: Effect.Effect<number>;
  readonly load: Effect.Effect<ReadonlyArray<StoredProgress>>;
  readonly save: (progress: ReadonlyArray<StoredProgress>) => Effect.Effect<void>;
}

export interface StoredProgress extends ThreadProgress {
  readonly projectId: ProjectId;
}

export interface ThreadProgressCaptureRequest {
  readonly threadId: ThreadId;
  readonly source: ThreadProgressSource;
  readonly note?: string | undefined;
  readonly questions?: ReadonlyArray<string> | undefined;
  /** A page to capture instead of the card's live dev server. */
  readonly url?: string | undefined;
}

export class ThreadProgressService extends Context.Service<
  ThreadProgressService,
  {
    /** Screenshots the thread's page and makes it the card's cover. */
    readonly capture: (
      request: ThreadProgressCaptureRequest,
    ) => Effect.Effect<ThreadProgressUpdate, ThreadProgressError>;
    /**
     * Sets the card's summary from `source`. A designer's summary is never
     * replaced by anyone else's; an empty one from the designer clears it.
     * Returns whether the summary changed.
     */
    readonly setSummary: (input: {
      readonly threadId: ThreadId;
      readonly text: string;
      readonly source: ThreadSummarySource;
    }) => Effect.Effect<boolean, ThreadProgressError>;
    readonly remove: (input: {
      readonly threadId: ThreadId;
      readonly updateId: string;
    }) => Effect.Effect<void, ThreadProgressError>;
    readonly get: (threadId: ThreadId) => Effect.Effect<ThreadProgress | null>;
    /** Calls `listener` with the project's progress now and after every change. */
    readonly subscribe: (
      projectId: ProjectId,
      listener: (list: ThreadProgressList) => Effect.Effect<void>,
    ) => Effect.Effect<() => void>;
  }
>()("supaterm/threadProgress/ThreadProgressService") {}

const fail = (message: string) => new ThreadProgressError({ message });

/** Which sources may replace a summary written by `current`. */
const SUMMARY_RANK: Record<ThreadSummarySource, number> = {
  brief: 0,
  agent: 1,
  designer: 2,
};

const clip = (text: string, max: number) => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
};

const isEmpty = (progress: StoredProgress) =>
  progress.updates.length === 0 && progress.summary === null && progress.capture === null;

export const make = (ops: ThreadProgressOps) =>
  Effect.gen(function* () {
    const records = new Map<ThreadId, StoredProgress>();
    for (const progress of yield* ops.load) {
      // A capture can't still be running after a restart.
      const restored: StoredProgress =
        progress.capture?._tag === "capturing" ? { ...progress, capture: null } : progress;
      if (!isEmpty(restored)) records.set(restored.threadId, restored);
    }
    const listeners = new Set<{
      readonly projectId: ProjectId;
      readonly listener: (list: ThreadProgressList) => Effect.Effect<void>;
    }>();
    const lock = yield* Semaphore.make(1);
    const locked = <A, E>(effect: Effect.Effect<A, E>) => lock.withPermits(1)(effect);

    const listFor = (projectId: ProjectId): ThreadProgressList =>
      records
        .values()
        .filter((progress) => progress.projectId === projectId)
        .map(({ threadId, updates, summary, capture }) => ({ threadId, updates, summary, capture }))
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

    /** Applies `change` to the thread's record under the lock and publishes it. */
    const modify = <A>(
      threadId: ThreadId,
      projectId: ProjectId,
      change: (current: StoredProgress) => readonly [StoredProgress, A],
    ) =>
      locked(
        Effect.gen(function* () {
          const current = records.get(threadId) ?? {
            threadId,
            projectId,
            updates: [],
            summary: null,
            capture: null,
          };
          const [next, result] = change(current);
          if (next === current) return result;
          if (isEmpty(next)) records.delete(threadId);
          else records.set(threadId, next);
          yield* commit(projectId);
          return result;
        }),
      );

    const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

    const capture: ThreadProgressService["Service"]["capture"] = (request) =>
      Effect.gen(function* () {
        const projectId = yield* ops.projectOf(request.threadId);
        const startedMs = yield* ops.nowMs;
        // Claims the thread's capture slot, so two captures never race for the cover.
        const refusal = yield* modify(request.threadId, projectId, (current) => {
          if (current.capture?._tag === "capturing") {
            return [current, "A capture of this card is already running."] as const;
          }
          if (request.source === "agent") {
            const lastAgent = current.updates.findLast((update) => update.source === "agent");
            const waitMs =
              lastAgent === undefined
                ? 0
                : Date.parse(lastAgent.createdAt) + THREAD_PROGRESS_AGENT_INTERVAL_MS - startedMs;
            if (waitMs > 0) {
              return [
                current,
                `You published progress moments ago. Keep working and publish again in ${Math.ceil(waitMs / 1000)} seconds or later.`,
              ] as const;
            }
          }
          return [
            { ...current, capture: { _tag: "capturing", startedAt: iso(startedMs) } },
            null,
          ] as const;
        });
        if (refusal !== null) return yield* fail(refusal);

        const captured = Effect.gen(function* () {
          const url = request.url ?? (yield* ops.pageOf(request.threadId));
          const screenshot = yield* ops.screenshot(url);
          const image = yield* ops.storeImage({ threadId: request.threadId, screenshot });
          const update: ThreadProgressUpdate = {
            id: ThreadProgressUpdateId.make(yield* ops.newId),
            image,
            width: screenshot.width,
            height: screenshot.height,
            note:
              request.note === undefined || request.note.trim().length === 0
                ? null
                : clip(request.note, THREAD_PROGRESS_NOTE_MAX_LENGTH),
            questions: (request.questions ?? [])
              .map((question) => clip(question, THREAD_PROGRESS_QUESTION_MAX_LENGTH))
              .filter((question) => question.length > 0)
              .slice(0, THREAD_PROGRESS_MAX_QUESTIONS),
            source: request.source,
            url,
            createdAt: iso(yield* ops.nowMs),
          };
          return update;
        });

        return yield* captured.pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.gen(function* () {
                const failedAt = iso(yield* ops.nowMs);
                yield* modify(request.threadId, projectId, (current) => [
                  { ...current, capture: { _tag: "failed", reason: error.message, failedAt } },
                  undefined,
                ]);
                return yield* error;
              }),
            onSuccess: (update) =>
              Effect.gen(function* () {
                const dropped = yield* modify(request.threadId, projectId, (current) => {
                  const updates = [...current.updates, update];
                  const overflow = Math.max(0, updates.length - THREAD_PROGRESS_MAX_UPDATES);
                  return [
                    { ...current, updates: updates.slice(overflow), capture: null },
                    updates.slice(0, overflow),
                  ] as const;
                });
                yield* Effect.forEach(dropped, (old) => ops.deleteImage(old.image), {
                  discard: true,
                });
                return update;
              }),
          }),
          // An interrupted capture must not leave the card capturing forever.
          Effect.onInterrupt(() =>
            modify(request.threadId, projectId, (current) =>
              current.capture?._tag === "capturing"
                ? [{ ...current, capture: null }, undefined]
                : [current, undefined],
            ),
          ),
        );
      });

    const setSummary: ThreadProgressService["Service"]["setSummary"] = (input) =>
      Effect.gen(function* () {
        const projectId = yield* ops.projectOf(input.threadId);
        const updatedAt = iso(yield* ops.nowMs);
        const text = clip(input.text, THREAD_SUMMARY_MAX_LENGTH);
        return yield* modify(input.threadId, projectId, (current) => {
          const existing = current.summary;
          if (text.length === 0) {
            // Only the designer clears a summary, and only their own.
            if (input.source !== "designer" || existing === null) return [current, false] as const;
            return [{ ...current, summary: null }, true] as const;
          }
          if (existing !== null && SUMMARY_RANK[existing.source] > SUMMARY_RANK[input.source]) {
            return [current, false] as const;
          }
          if (existing?.text === text && existing.source === input.source) {
            return [current, false] as const;
          }
          const summary: ThreadSummary = { text, source: input.source, updatedAt };
          return [{ ...current, summary }, true] as const;
        });
      });

    const remove: ThreadProgressService["Service"]["remove"] = (input) =>
      Effect.gen(function* () {
        const existing = records.get(input.threadId);
        if (existing === undefined) return yield* fail("This card has no progress images.");
        const removed = yield* modify(input.threadId, existing.projectId, (current) => {
          const update = current.updates.find((candidate) => candidate.id === input.updateId);
          if (update === undefined) return [current, null] as const;
          return [
            {
              ...current,
              updates: current.updates.filter((candidate) => candidate.id !== input.updateId),
            },
            update,
          ] as const;
        });
        if (removed === null) return yield* fail("That progress image no longer exists.");
        yield* ops.deleteImage(removed.image);
      });

    const get: ThreadProgressService["Service"]["get"] = (threadId) =>
      Effect.sync(() => {
        const progress = records.get(threadId);
        if (progress === undefined) return null;
        const { projectId: _projectId, ...rest } = progress;
        return rest;
      });

    const subscribe: ThreadProgressService["Service"]["subscribe"] = (projectId, listener) =>
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

    return ThreadProgressService.of({ capture, setSummary, remove, get, subscribe });
  });
