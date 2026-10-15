import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Stable id of one board column; titles can change, ids never do. */
export const BoardColumnId = TrimmedNonEmptyString.pipe(Schema.brand("BoardColumnId"));
export type BoardColumnId = typeof BoardColumnId.Type;

export const PROJECT_BOARD_MIN_COLUMNS = 2;
export const PROJECT_BOARD_MAX_COLUMNS = 20;
export const PROJECT_BOARD_COLUMN_TITLE_MAX_LENGTH = 60;

export const ProjectBoardColumn = Schema.Struct({
  id: BoardColumnId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_BOARD_COLUMN_TITLE_MAX_LENGTH)),
});
export type ProjectBoardColumn = typeof ProjectBoardColumn.Type;

/**
 * A deleted column. Cards still placed in it render in `movedTo` (after that
 * column's own cards) until they are moved again, so deleting a column never
 * has to rewrite every thread it held.
 */
export const ProjectBoardRetiredColumn = Schema.Struct({
  id: BoardColumnId,
  movedTo: BoardColumnId,
});
export type ProjectBoardRetiredColumn = typeof ProjectBoardRetiredColumn.Type;

/**
 * A project's kanban layout. Structural limits are enforced by the schema;
 * cross-field rules live in `validateProjectBoard` so stored boards always
 * decode even if a rule tightens later.
 */
export const ProjectBoard = Schema.Struct({
  columns: Schema.Array(ProjectBoardColumn).check(
    Schema.isMinLength(PROJECT_BOARD_MIN_COLUMNS),
    Schema.isMaxLength(PROJECT_BOARD_MAX_COLUMNS),
  ),
  /** New and unplaced threads land here. */
  inboxColumnId: BoardColumnId,
  /** Column whose top card is the project's live thread; null turns the flag off. */
  liveColumnId: Schema.NullOr(BoardColumnId),
  /** Moving a card here archives its thread; archived threads always show here. */
  doneColumnId: BoardColumnId,
  retiredColumns: Schema.optional(Schema.Array(ProjectBoardRetiredColumn)),
});
export type ProjectBoard = typeof ProjectBoard.Type;

/** One thread's slot on its project's board. */
export const ThreadBoardPlacement = Schema.Struct({
  columnId: BoardColumnId,
  /** Fractional-index key; cards sort by plain string comparison within a column. */
  orderKey: TrimmedNonEmptyString,
  /** Column a card placed in Done returns to when its thread is unarchived. */
  returnColumnId: Schema.optional(Schema.NullOr(BoardColumnId)),
});
export type ThreadBoardPlacement = typeof ThreadBoardPlacement.Type;

export const DEFAULT_PROJECT_BOARD: ProjectBoard = {
  columns: [
    { id: BoardColumnId.make("ideas"), title: "Ideas" },
    { id: BoardColumnId.make("in-progress"), title: "In progress" },
    { id: BoardColumnId.make("testing"), title: "Testing" },
    { id: BoardColumnId.make("done"), title: "Done" },
  ],
  inboxColumnId: BoardColumnId.make("in-progress"),
  liveColumnId: BoardColumnId.make("testing"),
  doneColumnId: BoardColumnId.make("done"),
};

export type ProjectBoardFlag = "inbox" | "live" | "done";

export type ProjectBoardIssue =
  | { readonly code: "column-count"; readonly count: number }
  | { readonly code: "duplicate-column-id"; readonly columnId: BoardColumnId }
  | {
      readonly code: "unknown-flag-column";
      readonly flag: ProjectBoardFlag;
      readonly columnId: BoardColumnId;
    }
  | { readonly code: "done-column-conflict"; readonly flag: "inbox" | "live" }
  | { readonly code: "retired-column-active"; readonly columnId: BoardColumnId }
  | { readonly code: "duplicate-retired-column"; readonly columnId: BoardColumnId }
  | { readonly code: "unresolved-retired-column"; readonly columnId: BoardColumnId };

/**
 * The active column a column id renders in: itself when active, otherwise
 * the end of its retired `movedTo` chain. Null for unknown ids and cycles.
 */
export function resolveProjectBoardColumnId(
  board: Pick<ProjectBoard, "columns" | "retiredColumns">,
  columnId: BoardColumnId,
): BoardColumnId | null {
  const active = new Set(board.columns.map((column) => column.id));
  const retired = new Map((board.retiredColumns ?? []).map((entry) => [entry.id, entry.movedTo]));
  const seen = new Set<BoardColumnId>();
  let current = columnId;
  while (!active.has(current)) {
    const next = retired.get(current);
    if (next === undefined || seen.has(current)) return null;
    seen.add(current);
    current = next;
  }
  return current;
}

/** Cross-field rules a board must satisfy before it is stored. Empty means valid. */
export function validateProjectBoard(board: ProjectBoard): ReadonlyArray<ProjectBoardIssue> {
  const issues: ProjectBoardIssue[] = [];
  const count = board.columns.length;
  if (count < PROJECT_BOARD_MIN_COLUMNS || count > PROJECT_BOARD_MAX_COLUMNS) {
    issues.push({ code: "column-count", count });
  }
  const active = new Set<BoardColumnId>();
  for (const column of board.columns) {
    if (active.has(column.id)) issues.push({ code: "duplicate-column-id", columnId: column.id });
    active.add(column.id);
  }
  const flags: ReadonlyArray<readonly [ProjectBoardFlag, BoardColumnId | null]> = [
    ["inbox", board.inboxColumnId],
    ["live", board.liveColumnId],
    ["done", board.doneColumnId],
  ];
  for (const [flag, columnId] of flags) {
    if (columnId !== null && !active.has(columnId)) {
      issues.push({ code: "unknown-flag-column", flag, columnId });
    }
  }
  if (board.doneColumnId === board.inboxColumnId) {
    issues.push({ code: "done-column-conflict", flag: "inbox" });
  }
  if (board.doneColumnId === board.liveColumnId) {
    issues.push({ code: "done-column-conflict", flag: "live" });
  }
  const retiredIds = new Set<BoardColumnId>();
  for (const entry of board.retiredColumns ?? []) {
    if (active.has(entry.id)) {
      issues.push({ code: "retired-column-active", columnId: entry.id });
    } else if (retiredIds.has(entry.id)) {
      issues.push({ code: "duplicate-retired-column", columnId: entry.id });
    } else if (resolveProjectBoardColumnId(board, entry.id) === null) {
      issues.push({ code: "unresolved-retired-column", columnId: entry.id });
    }
    retiredIds.add(entry.id);
  }
  return issues;
}
