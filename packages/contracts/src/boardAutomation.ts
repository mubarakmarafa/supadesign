import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BoardColumnId } from "./projectBoard.ts";

export const BOARD_AUTOMATION_REPORT_NOTE_MAX_LENGTH = 280;
/** Automatic moves in a row, without a designer's move, before the board stops chaining. */
export const BOARD_AUTOMATION_MAX_CHAINED_MOVES = 3;

/**
 * `scheduled` can still be cancelled or run now; `sent` is with the card's agent; `done` and
 * `needs-you` are what the agent reported (or chaining stopped); `finished` went idle without a
 * report; `failed` could not send a prompt.
 */
export const BoardAutomationStatus = Schema.Literals([
  "scheduled",
  "sent",
  "done",
  "needs-you",
  "finished",
  "failed",
]);
export type BoardAutomationStatus = typeof BoardAutomationStatus.Type;

/**
 * A card move whose column automations are waiting, running, or reported. The
 * server keeps one per card: a move made while one waits replaces it, so a
 * card dragged on before its prompts went out only runs the last move's.
 */
export const BoardAutomationRun = Schema.Struct({
  threadId: ThreadId,
  fromColumnId: BoardColumnId,
  toColumnId: BoardColumnId,
  /** Names of the steps, in the order they are sent. */
  stepNames: Schema.Array(TrimmedNonEmptyString),
  status: BoardAutomationStatus,
  /** When a scheduled run sends; otherwise when it last changed. */
  at: Schema.String,
  /** The agent's report, why it failed, or which steps were skipped. */
  note: Schema.optional(Schema.String),
  /** The column the card moves to once its steps are done, when its column sets one. */
  moveTo: Schema.optional(BoardColumnId),
});
export type BoardAutomationRun = typeof BoardAutomationRun.Type;

/** Every card in a project with a waiting, sent, or failed run. */
export const BoardAutomationRunList = Schema.Array(BoardAutomationRun);
export type BoardAutomationRunList = typeof BoardAutomationRunList.Type;

export const BoardAutomationProjectInput = Schema.Struct({ projectId: ProjectId });
export type BoardAutomationProjectInput = typeof BoardAutomationProjectInput.Type;

export const BoardAutomationThreadInput = Schema.Struct({ threadId: ThreadId });
export type BoardAutomationThreadInput = typeof BoardAutomationThreadInput.Type;

/**
 * Sends a waiting run now. With `columnId`, sends that column's arrival steps
 * to the card again right away, even when nothing is waiting.
 */
export const BoardAutomationRunNowInput = Schema.Struct({
  threadId: ThreadId,
  columnId: Schema.optional(BoardColumnId),
});
export type BoardAutomationRunNowInput = typeof BoardAutomationRunNowInput.Type;

export class BoardAutomationError extends Schema.TaggedError<BoardAutomationError>()(
  "BoardAutomationError",
  { message: Schema.String },
) {}
