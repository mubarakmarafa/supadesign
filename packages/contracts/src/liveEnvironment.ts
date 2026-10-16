import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A live environment runs one board card's work locally: a worktree at the
 * card's pull request (or its own checkout), the project's setup script, and
 * the project's dev server. The server owns the processes; clients only say
 * which card each project wants live.
 */

/** Project script id the live environment starts as the project's dev server. */
export const LIVE_ENVIRONMENT_DEV_SCRIPT_ID = "dev-server";
/** How long a card stays warm after it stops being the live card. */
export const LIVE_ENVIRONMENT_GRACE_MS = 10 * 60 * 1000;
export const LIVE_ENVIRONMENT_LOG_TAIL_LINES = 40;

export const LiveEnvironmentStatus = Schema.Literals([
  /** The project has no dev server script yet; `suggestion` holds a guess. */
  "needs-dev-script",
  "preparing",
  "ready",
  "failed",
  "stopping",
]);
export type LiveEnvironmentStatus = typeof LiveEnvironmentStatus.Type;

/** `detecting` is the model working out the dev server command. */
export const LiveEnvironmentPhase = Schema.Literals(["worktree", "detecting", "setup", "starting"]);
export type LiveEnvironmentPhase = typeof LiveEnvironmentPhase.Type;

export const LiveEnvironmentDevScriptSuggestion = Schema.Struct({
  command: Schema.NullOr(TrimmedNonEmptyString),
  previewUrl: Schema.NullOr(TrimmedNonEmptyString),
  /** Where the guess came from, for example "package.json". */
  source: Schema.NullOr(Schema.String),
});
export type LiveEnvironmentDevScriptSuggestion = typeof LiveEnvironmentDevScriptSuggestion.Type;

export const LiveEnvironmentSnapshot = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  status: LiveEnvironmentStatus,
  phase: Schema.NullOr(LiveEnvironmentPhase),
  /** The project's live card. False while the card is warm. */
  active: Schema.Boolean,
  /** Epoch ms when a warm card stops; null while active. */
  warmUntil: Schema.NullOr(Schema.Number),
  url: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  /** Thread terminal that runs the dev server; its full output lives there. */
  terminalId: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  /** Last output lines, filled only when the environment failed. */
  logTail: Schema.Array(Schema.String),
  suggestion: Schema.NullOr(LiveEnvironmentDevScriptSuggestion),
  updatedAt: Schema.Number,
});
export type LiveEnvironmentSnapshot = typeof LiveEnvironmentSnapshot.Type;

export const LiveEnvironmentList = Schema.Struct({
  projectId: ProjectId,
  environments: Schema.Array(LiveEnvironmentSnapshot),
});
export type LiveEnvironmentList = typeof LiveEnvironmentList.Type;

export const LiveEnvironmentActivateInput = Schema.Struct({
  projectId: ProjectId,
  /** The card that should be live, or null for none. The previous card goes warm. */
  threadId: Schema.NullOr(ThreadId),
});
export type LiveEnvironmentActivateInput = typeof LiveEnvironmentActivateInput.Type;

export const LiveEnvironmentThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type LiveEnvironmentThreadInput = typeof LiveEnvironmentThreadInput.Type;

export const LiveEnvironmentProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type LiveEnvironmentProjectInput = typeof LiveEnvironmentProjectInput.Type;

export const LiveEnvironmentSaveDevScriptInput = Schema.Struct({
  projectId: ProjectId,
  command: TrimmedNonEmptyString,
  previewUrl: Schema.optional(TrimmedNonEmptyString),
});
export type LiveEnvironmentSaveDevScriptInput = typeof LiveEnvironmentSaveDevScriptInput.Type;

export class LiveEnvironmentError extends Schema.TaggedError<LiveEnvironmentError>()(
  "LiveEnvironmentError",
  {
    message: Schema.String,
  },
) {}
