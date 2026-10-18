import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ChatImageAttachment } from "./chatAttachment.ts";

/**
 * A card's progress: screenshots of the running app taken as the agent works,
 * each with what it shows, plus a short summary of the thread. The latest image
 * is the card's cover; older ones stay viewable in the thread.
 */

export const THREAD_PROGRESS_MAX_UPDATES = 20;
export const THREAD_PROGRESS_NOTE_MAX_LENGTH = 1_000;
export const THREAD_PROGRESS_QUESTION_MAX_LENGTH = 300;
export const THREAD_PROGRESS_MAX_QUESTIONS = 5;
export const THREAD_SUMMARY_MAX_LENGTH = 280;
/** Agents publish at most this often per thread, so updates stay worth looking at. */
export const THREAD_PROGRESS_AGENT_INTERVAL_MS = 30_000;

export const ThreadProgressUpdateId = TrimmedNonEmptyString.pipe(
  Schema.brand("ThreadProgressUpdateId"),
);
export type ThreadProgressUpdateId = typeof ThreadProgressUpdateId.Type;

/**
 * Who asked for the capture: the agent publishing its work, the designer
 * asking for it, or Supadesign itself after a turn on a live card.
 */
export const ThreadProgressSource = Schema.Literals(["agent", "designer", "auto"]);
export type ThreadProgressSource = typeof ThreadProgressSource.Type;

export const ThreadProgressUpdate = Schema.Struct({
  id: ThreadProgressUpdateId,
  image: ChatImageAttachment,
  width: Schema.Number,
  height: Schema.Number,
  /** What the image shows, in the agent's words. Null for plain captures. */
  note: Schema.NullOr(Schema.String.check(Schema.isMaxLength(THREAD_PROGRESS_NOTE_MAX_LENGTH))),
  /** Decisions the agent wants the designer's judgment on. */
  questions: Schema.Array(
    Schema.String.check(Schema.isMaxLength(THREAD_PROGRESS_QUESTION_MAX_LENGTH)),
  ),
  source: ThreadProgressSource,
  /** The page that was captured. */
  url: Schema.String,
  createdAt: Schema.String,
});
export type ThreadProgressUpdate = typeof ThreadProgressUpdate.Type;

/**
 * A thread's one-glance summary. The designer's own words win over the
 * agent's, and the agent's over the brief taken from the thread's first message.
 */
export const ThreadSummarySource = Schema.Literals(["designer", "agent", "brief"]);
export type ThreadSummarySource = typeof ThreadSummarySource.Type;

export const ThreadSummary = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(THREAD_SUMMARY_MAX_LENGTH)),
  source: ThreadSummarySource,
  updatedAt: Schema.String,
});
export type ThreadSummary = typeof ThreadSummary.Type;

/** A capture in flight, or the last one that failed, so a card never shows a stale image as current. */
export const ThreadProgressCaptureState = Schema.Union([
  Schema.TaggedStruct("capturing", { startedAt: Schema.String }),
  Schema.TaggedStruct("failed", { reason: Schema.String, failedAt: Schema.String }),
]);
export type ThreadProgressCaptureState = typeof ThreadProgressCaptureState.Type;

export const ThreadProgress = Schema.Struct({
  threadId: ThreadId,
  /** Oldest first; the last one is the card's cover. */
  updates: Schema.Array(ThreadProgressUpdate),
  summary: Schema.NullOr(ThreadSummary),
  capture: Schema.NullOr(ThreadProgressCaptureState),
});
export type ThreadProgress = typeof ThreadProgress.Type;

/** Progress for every thread in a project that has any. */
export const ThreadProgressList = Schema.Array(ThreadProgress);
export type ThreadProgressList = typeof ThreadProgressList.Type;

export const ThreadProgressProjectInput = Schema.Struct({ projectId: ProjectId });
export type ThreadProgressProjectInput = typeof ThreadProgressProjectInput.Type;

export const ThreadProgressCaptureInput = Schema.Struct({ threadId: ThreadId });
export type ThreadProgressCaptureInput = typeof ThreadProgressCaptureInput.Type;

export const ThreadProgressRemoveInput = Schema.Struct({
  threadId: ThreadId,
  updateId: ThreadProgressUpdateId,
});
export type ThreadProgressRemoveInput = typeof ThreadProgressRemoveInput.Type;

/** An empty text clears the designer's summary, handing it back to the agent. */
export const ThreadSummarySetInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String.check(Schema.isMaxLength(THREAD_SUMMARY_MAX_LENGTH)),
});
export type ThreadSummarySetInput = typeof ThreadSummarySetInput.Type;

export class ThreadProgressError extends Schema.TaggedError<ThreadProgressError>()(
  "ThreadProgressError",
  { message: Schema.String },
) {}
