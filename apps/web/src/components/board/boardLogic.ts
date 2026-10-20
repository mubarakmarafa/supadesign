import {
  type BoardAutomationStep,
  type BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  PROJECT_BOARD_COLUMN_TITLE_MAX_LENGTH,
  PROJECT_BOARD_MAX_COLUMNS,
  PROJECT_BOARD_MIN_COLUMNS,
  type ProjectBoard,
  type ProjectBoardFlag,
  THREAD_SUMMARY_MAX_LENGTH,
} from "@supaterm/contracts";

/** Card ids per column, left to right and top to bottom, as the board shows them. */
export interface BoardLayoutColumn {
  readonly columnId: BoardColumnId;
  readonly cardIds: ReadonlyArray<string>;
}
export type BoardLayout = ReadonlyArray<BoardLayoutColumn>;

export type BoardFocusKey = "up" | "down" | "left" | "right" | "home" | "end";
export type BoardMoveDirection = "up" | "down" | "left" | "right";

export function findBoardCard(
  layout: BoardLayout,
  cardId: string,
): { readonly columnIndex: number; readonly index: number } | null {
  for (let columnIndex = 0; columnIndex < layout.length; columnIndex += 1) {
    const index = layout[columnIndex]!.cardIds.indexOf(cardId);
    if (index !== -1) return { columnIndex, index };
  }
  return null;
}

/**
 * The card that roving focus lands on after a navigation key. Left and right
 * skip empty columns and keep the row where the next column is long enough.
 * With nothing focused yet, any key lands on the first card on the board.
 */
export function nextBoardFocus(
  layout: BoardLayout,
  cardId: string | null,
  key: BoardFocusKey,
): string | null {
  const position = cardId === null ? null : findBoardCard(layout, cardId);
  if (position === null) {
    return layout.find((column) => column.cardIds.length > 0)?.cardIds[0] ?? null;
  }
  const cards = layout[position.columnIndex]!.cardIds;
  switch (key) {
    case "up":
      return cards[Math.max(0, position.index - 1)]!;
    case "down":
      return cards[Math.min(cards.length - 1, position.index + 1)]!;
    case "home":
      return cards[0]!;
    case "end":
      return cards[cards.length - 1]!;
    case "left":
    case "right": {
      const step = key === "left" ? -1 : 1;
      for (let index = position.columnIndex + step; index >= 0 && index < layout.length;) {
        const next = layout[index]!.cardIds;
        if (next.length > 0) return next[Math.min(position.index, next.length - 1)]!;
        index += step;
      }
      return cardId;
    }
  }
}

/** Moves a card to `toIndex` of a column (clamped), counted after it leaves its old slot. */
export function moveBoardCard(
  layout: BoardLayout,
  cardId: string,
  toColumnId: BoardColumnId,
  toIndex: number,
): BoardLayout {
  if (!layout.some((column) => column.columnId === toColumnId)) return layout;
  const without = layout.map((column) =>
    column.cardIds.includes(cardId)
      ? { ...column, cardIds: column.cardIds.filter((id) => id !== cardId) }
      : column,
  );
  return without.map((column) => {
    if (column.columnId !== toColumnId) return column;
    const index = Math.max(0, Math.min(toIndex, column.cardIds.length));
    return {
      ...column,
      cardIds: [...column.cardIds.slice(0, index), cardId, ...column.cardIds.slice(index)],
    };
  });
}

/**
 * One keyboard move: up and down swap with the neighbor, left and right move
 * to the adjacent column at the same row. Null at the board's edges.
 */
export function nudgeBoardCard(
  layout: BoardLayout,
  cardId: string,
  direction: BoardMoveDirection,
): {
  readonly layout: BoardLayout;
  readonly fromColumnId: BoardColumnId;
  readonly toColumnId: BoardColumnId;
} | null {
  const position = findBoardCard(layout, cardId);
  if (position === null) return null;
  const from = layout[position.columnIndex]!;
  if (direction === "up" || direction === "down") {
    const toIndex = position.index + (direction === "up" ? -1 : 1);
    if (toIndex < 0 || toIndex >= from.cardIds.length) return null;
    return {
      layout: moveBoardCard(layout, cardId, from.columnId, toIndex),
      fromColumnId: from.columnId,
      toColumnId: from.columnId,
    };
  }
  const target = layout[position.columnIndex + (direction === "left" ? -1 : 1)];
  if (target === undefined) return null;
  return {
    layout: moveBoardCard(layout, cardId, target.columnId, position.index),
    fromColumnId: from.columnId,
    toColumnId: target.columnId,
  };
}

// ── Column editing ──────────────────────────────────────────────────────

export function normalizeBoardColumnTitle(title: string): string | null {
  const trimmed = title.trim().slice(0, PROJECT_BOARD_COLUMN_TITLE_MAX_LENGTH).trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** New columns go just before Done when Done is last, so Done stays the board's end. */
export function addBoardColumn(
  board: ProjectBoard,
  column: { readonly id: BoardColumnId; readonly title: string },
): ProjectBoard | null {
  const title = normalizeBoardColumnTitle(column.title);
  if (title === null || board.columns.length >= PROJECT_BOARD_MAX_COLUMNS) return null;
  const last = board.columns[board.columns.length - 1];
  const insertAt =
    last?.id === board.doneColumnId ? board.columns.length - 1 : board.columns.length;
  return {
    ...board,
    columns: [
      ...board.columns.slice(0, insertAt),
      { id: column.id, title },
      ...board.columns.slice(insertAt),
    ],
  };
}

export function renameBoardColumn(
  board: ProjectBoard,
  columnId: BoardColumnId,
  title: string,
): ProjectBoard | null {
  const next = normalizeBoardColumnTitle(title);
  const current = board.columns.find((column) => column.id === columnId);
  if (next === null || current === undefined || current.title === next) return null;
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId ? { ...column, title: next } : column,
    ),
  };
}

export function moveBoardColumn(
  board: ProjectBoard,
  columnId: BoardColumnId,
  direction: "left" | "right",
): ProjectBoard | null {
  const index = board.columns.findIndex((column) => column.id === columnId);
  const target = index + (direction === "left" ? -1 : 1);
  if (index === -1 || target < 0 || target >= board.columns.length) return null;
  const columns = [...board.columns];
  [columns[index], columns[target]] = [columns[target]!, columns[index]!];
  return { ...board, columns };
}

/** Done cannot share a column with the inbox, live, or send flags. */
export function canSetBoardColumnFlag(
  board: ProjectBoard,
  columnId: BoardColumnId,
  flag: ProjectBoardFlag,
): boolean {
  switch (flag) {
    case "inbox":
      return columnId !== board.inboxColumnId && columnId !== board.doneColumnId;
    case "live":
    case "send":
      return columnId !== board.doneColumnId;
    case "done":
      return (
        columnId !== board.doneColumnId &&
        columnId !== board.inboxColumnId &&
        columnId !== board.liveColumnId &&
        columnId !== board.sendColumnId
      );
  }
}

/** Sets a flag on a column. Setting live or send on its own column turns that flag off. */
export function setBoardColumnFlag(
  board: ProjectBoard,
  columnId: BoardColumnId,
  flag: ProjectBoardFlag,
): ProjectBoard | null {
  if (!canSetBoardColumnFlag(board, columnId, flag)) return null;
  switch (flag) {
    case "inbox":
      return { ...board, inboxColumnId: columnId };
    case "live":
      return { ...board, liveColumnId: board.liveColumnId === columnId ? null : columnId };
    case "send":
      return { ...board, sendColumnId: board.sendColumnId === columnId ? null : columnId };
    case "done":
      return { ...board, doneColumnId: columnId };
  }
}

/** What the column settings dialog edits: a column's name, built-in behaviours, and steps. */
export interface BoardColumnSettings {
  readonly title: string;
  /** The top card runs its dev server in the live preview. */
  readonly live: boolean;
  /** Arriving cards send their banked messages. */
  readonly send: boolean;
  readonly onEnter: ReadonlyArray<BoardAutomationStep>;
  readonly onLeave: ReadonlyArray<BoardAutomationStep>;
  /** Where a card goes once its agent reports the arrival steps done; null stays put. */
  readonly moveWhenDone: BoardColumnId | null;
}

export function boardColumnSettings(
  board: ProjectBoard,
  columnId: BoardColumnId,
): BoardColumnSettings | null {
  const column = board.columns.find((entry) => entry.id === columnId);
  if (column === undefined) return null;
  return {
    title: column.title,
    live: board.liveColumnId === columnId,
    send: board.sendColumnId === columnId,
    onEnter: column.onEnter ?? [],
    onLeave: column.onLeave ?? [],
    moveWhenDone: column.moveWhenDone ?? null,
  };
}

/**
 * Applies a column's settings. Turning live preview or sending on takes it
 * from whichever column had it; Done keeps neither, and no steps, since it
 * archives its cards. Null when the name is empty or the column is gone.
 */
export function applyBoardColumnSettings(
  board: ProjectBoard,
  columnId: BoardColumnId,
  settings: BoardColumnSettings,
): ProjectBoard | null {
  const title = normalizeBoardColumnTitle(settings.title);
  if (title === null || !board.columns.some((column) => column.id === columnId)) return null;
  const isDone = columnId === board.doneColumnId;
  const flag = (enabled: boolean, current: BoardColumnId | null | undefined) =>
    enabled && !isDone ? columnId : current === columnId ? null : (current ?? null);
  const onEnter = isDone ? [] : settings.onEnter;
  const onLeave = isDone ? [] : settings.onLeave;
  // Moving on only follows arrival steps, and never back into the same column.
  const moveWhenDone =
    onEnter.length > 0 && settings.moveWhenDone !== columnId ? settings.moveWhenDone : null;
  return {
    ...board,
    liveColumnId: flag(settings.live, board.liveColumnId),
    sendColumnId: flag(settings.send, board.sendColumnId),
    columns: board.columns.map((column) =>
      column.id === columnId
        ? {
            id: column.id,
            title,
            ...(onEnter.length > 0 ? { onEnter } : {}),
            ...(onLeave.length > 0 ? { onLeave } : {}),
            ...(moveWhenDone === null ? {} : { moveWhenDone }),
          }
        : column,
    ),
  };
}

export type BoardColumnDeleteBlocker = "done" | "inbox" | "live" | "min-columns";

export function boardColumnDeleteBlocker(
  board: ProjectBoard,
  columnId: BoardColumnId,
): BoardColumnDeleteBlocker | null {
  if (columnId === board.doneColumnId) return "done";
  if (columnId === board.inboxColumnId) return "inbox";
  if (columnId === board.liveColumnId) return "live";
  if (board.columns.length <= PROJECT_BOARD_MIN_COLUMNS) return "min-columns";
  return null;
}

/**
 * Deletes a column. Its cards move to the left neighbor (the right one for
 * the first column) through `retiredColumns`, so no thread is rewritten.
 */
export function deleteBoardColumn(
  board: ProjectBoard,
  columnId: BoardColumnId,
): ProjectBoard | null {
  if (boardColumnDeleteBlocker(board, columnId) !== null) return null;
  const index = board.columns.findIndex((column) => column.id === columnId);
  if (index === -1) return null;
  const neighbor = board.columns[index === 0 ? 1 : index - 1]!;
  return {
    ...board,
    ...(board.sendColumnId === columnId ? { sendColumnId: null } : {}),
    columns: board.columns.filter((column) => column.id !== columnId),
    retiredColumns: [...(board.retiredColumns ?? []), { id: columnId, movedTo: neighbor.id }],
  };
}

export function boardOrDefault(board: ProjectBoard | null | undefined): ProjectBoard {
  return board ?? DEFAULT_PROJECT_BOARD;
}

// ── Cards made on the board ─────────────────────────────────────────────

export const BOARD_CARD_TITLE_MAX_LENGTH = 80;

/**
 * Splits what someone typed into a new card: the first line is its title, and
 * whatever doesn't fit there becomes its summary. Null when there's nothing.
 */
export function boardCardFromText(
  text: string,
): { readonly title: string; readonly summary: string | null } | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const first = lines[0];
  if (first === undefined) return null;
  const summaryOf = (value: string) =>
    value.length === 0
      ? null
      : value.length <= THREAD_SUMMARY_MAX_LENGTH
        ? value
        : `${value.slice(0, THREAD_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
  if (first.length <= BOARD_CARD_TITLE_MAX_LENGTH) {
    return { title: first, summary: summaryOf(lines.slice(1).join("\n")) };
  }
  const cut = first.lastIndexOf(" ", BOARD_CARD_TITLE_MAX_LENGTH - 1);
  const end = cut > BOARD_CARD_TITLE_MAX_LENGTH / 2 ? cut : BOARD_CARD_TITLE_MAX_LENGTH - 1;
  return { title: `${first.slice(0, end).trimEnd()}…`, summary: summaryOf(lines.join("\n")) };
}
