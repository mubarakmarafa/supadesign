import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A card's brief: the direction the designer set for the work, in their own
 * words, plus the decisions made along the way. Agents read both and may
 * suggest decisions; only the designer writes the brief and settles a
 * suggestion. It sits beside the provider's goal and never replaces it.
 */

export const THREAD_BRIEF_MAX_LENGTH = 4_000;
export const THREAD_DECISION_MAX_LENGTH = 500;
/** Open decisions a card keeps, so the list stays short enough to read. */
export const THREAD_DECISIONS_MAX = 30;
/** Suggestions waiting on the designer at once, so an agent can't bury the list. */
export const THREAD_DECISION_SUGGESTIONS_MAX = 5;

export const ThreadDecisionId = TrimmedNonEmptyString.pipe(Schema.brand("ThreadDecisionId"));
export type ThreadDecisionId = typeof ThreadDecisionId.Type;

/**
 * `accepted` as written, `edited` when the designer accepted it in their own
 * words, `suggested` while an agent's suggestion waits for the designer.
 */
export const ThreadDecisionStatus = Schema.Literals(["accepted", "edited", "suggested"]);
export type ThreadDecisionStatus = typeof ThreadDecisionStatus.Type;

/** Who wrote a decision first: the designer, or an agent suggesting it. */
export const ThreadDecisionSource = Schema.Literals(["designer", "agent"]);
export type ThreadDecisionSource = typeof ThreadDecisionSource.Type;

export const ThreadDecision = Schema.Struct({
  id: ThreadDecisionId,
  text: Schema.String.check(Schema.isMaxLength(THREAD_DECISION_MAX_LENGTH)),
  status: ThreadDecisionStatus,
  source: ThreadDecisionSource,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ThreadDecision = typeof ThreadDecision.Type;

export const ThreadBriefText = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(THREAD_BRIEF_MAX_LENGTH)),
  updatedAt: Schema.String,
  /** How many times the brief has been written, this one included. Earlier ones are kept. */
  version: NonNegativeInt,
});
export type ThreadBriefText = typeof ThreadBriefText.Type;

export const ThreadBrief = Schema.Struct({
  threadId: ThreadId,
  /** Null until the designer writes one. */
  brief: Schema.NullOr(ThreadBriefText),
  /** Oldest first. Rejected suggestions and removed decisions are left out. */
  decisions: Schema.Array(ThreadDecision),
});
export type ThreadBrief = typeof ThreadBrief.Type;

/** One brief the designer wrote; an empty text is the brief being cleared. */
export const ThreadBriefVersion = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(THREAD_BRIEF_MAX_LENGTH)),
  editedAt: Schema.String,
});
export type ThreadBriefVersion = typeof ThreadBriefVersion.Type;

/** Every brief a card has had, oldest first, cleared ones included. */
export const ThreadBriefVersionList = Schema.Array(ThreadBriefVersion);
export type ThreadBriefVersionList = typeof ThreadBriefVersionList.Type;

/** Every card in a project with a brief or decisions. */
export const ThreadBriefList = Schema.Array(ThreadBrief);
export type ThreadBriefList = typeof ThreadBriefList.Type;

export const ThreadBriefProjectInput = Schema.Struct({ projectId: ProjectId });
export type ThreadBriefProjectInput = typeof ThreadBriefProjectInput.Type;

export const ThreadBriefThreadInput = Schema.Struct({ threadId: ThreadId });
export type ThreadBriefThreadInput = typeof ThreadBriefThreadInput.Type;

/** An empty text clears the brief; the cleared one is kept with the others. */
export const ThreadBriefSetInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String.check(Schema.isMaxLength(THREAD_BRIEF_MAX_LENGTH)),
});
export type ThreadBriefSetInput = typeof ThreadBriefSetInput.Type;

export const ThreadDecisionAddInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String.check(Schema.isMaxLength(THREAD_DECISION_MAX_LENGTH)),
});
export type ThreadDecisionAddInput = typeof ThreadDecisionAddInput.Type;

/**
 * Accepts a suggestion as written, or, with `text`, in the designer's words.
 * With `text` it also rewords a decision already accepted.
 */
export const ThreadDecisionAcceptInput = Schema.Struct({
  threadId: ThreadId,
  decisionId: ThreadDecisionId,
  text: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(THREAD_DECISION_MAX_LENGTH))),
});
export type ThreadDecisionAcceptInput = typeof ThreadDecisionAcceptInput.Type;

export const ThreadDecisionEntryInput = Schema.Struct({
  threadId: ThreadId,
  decisionId: ThreadDecisionId,
});
export type ThreadDecisionEntryInput = typeof ThreadDecisionEntryInput.Type;

export class ThreadBriefError extends Schema.TaggedError<ThreadBriefError>()("ThreadBriefError", {
  message: Schema.String,
}) {}
