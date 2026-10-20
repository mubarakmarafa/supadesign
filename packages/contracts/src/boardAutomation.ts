import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BoardColumnId } from "./projectBoard.ts";

/**
 * A card move whose column automations are waiting, sent, or failed. The
 * server keeps one per card: a move made while one waits replaces it, so a
 * card dragged on before its prompts went out only runs the last move's.
 */
export const BoardAutomationRun = Schema.Struct({
  threadId: ThreadId,
  fromColumnId: BoardColumnId,
  toColumnId: BoardColumnId,
  /** Names of the steps, in the order they are sent. */
  stepNames: Schema.Array(TrimmedNonEmptyString),
  status: Schema.Literals(["scheduled", "sent", "failed"]),
  /** When a scheduled run sends; when a sent or failed one went out. */
  at: Schema.String,
  /** Why it failed, or which steps were skipped. */
  note: Schema.optional(Schema.String),
});
export type BoardAutomationRun = typeof BoardAutomationRun.Type;

/** Every card in a project with a waiting, sent, or failed run. */
export const BoardAutomationRunList = Schema.Array(BoardAutomationRun);
export type BoardAutomationRunList = typeof BoardAutomationRunList.Type;

export const BoardAutomationProjectInput = Schema.Struct({ projectId: ProjectId });
export type BoardAutomationProjectInput = typeof BoardAutomationProjectInput.Type;

export const BoardAutomationThreadInput = Schema.Struct({ threadId: ThreadId });
export type BoardAutomationThreadInput = typeof BoardAutomationThreadInput.Type;

export class BoardAutomationError extends Schema.TaggedError<BoardAutomationError>()(
  "BoardAutomationError",
  { message: Schema.String },
) {}
