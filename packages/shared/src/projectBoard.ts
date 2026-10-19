import {
  type BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  type ProjectBoard,
  type ProjectBoardColumn,
  resolveProjectBoardColumnId,
  type ThreadBoardPlacement,
  type ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";

import { planPinnedReorder } from "./orderKeys.ts";

/** The thread fields board resolution reads; works for server and client shells. */
export interface BoardThread {
  readonly id: string;
  readonly createdAt: string | DateTime.Utc;
  readonly archivedAt: string | DateTime.Utc | null;
  readonly board?: ThreadBoardPlacement | null | undefined;
}

export interface BoardCard<T extends BoardThread> {
  readonly thread: T;
  /** Key the card sorts by in this column; null for cards shown here without a slot of their own. */
  readonly orderKey: string | null;
}

export interface ResolvedBoardColumn<T extends BoardThread> {
  readonly column: ProjectBoardColumn;
  /** Top to bottom. */
  readonly cards: ReadonlyArray<BoardCard<T>>;
}

/** Unplaced cards (no usable slot here) sort first, newest first; then cards
    placed in this column; then cards placed in a deleted column moved here. */
const CardGroup = { Unplaced: 0, Native: 1, Retired: 2 } as const;
type CardGroup = (typeof CardGroup)[keyof typeof CardGroup];

interface SortableCard<T extends BoardThread> extends BoardCard<T> {
  readonly group: CardGroup;
  readonly createdAtMs: number;
}

function epochMillis(value: string | DateTime.Utc): number {
  if (typeof value !== "string") return DateTime.toEpochMillis(value);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareCards<T extends BoardThread>(left: SortableCard<T>, right: SortableCard<T>) {
  if (left.group !== right.group) return left.group - right.group;
  if (left.group === CardGroup.Unplaced) {
    const byAge = right.createdAtMs - left.createdAtMs;
    if (byAge !== 0) return byAge;
  } else if (left.orderKey !== right.orderKey) {
    return left.orderKey! < right.orderKey! ? -1 : 1;
  }
  return left.thread.id < right.thread.id ? -1 : left.thread.id > right.thread.id ? 1 : 0;
}

/**
 * Lay threads out on a board (the default board when `board` is null).
 *
 * - Archived threads always sit in the done column.
 * - A thread placed in done but not archived (unarchived elsewhere, or its
 *   archive failed) returns to `returnColumnId`, else the inbox.
 * - A thread placed in a deleted column follows `retiredColumns`, after the
 *   cards placed natively in that column.
 * - Unplaced threads and unknown columns land in the inbox.
 * - Within a column: unplaced cards first, newest first; then placed cards by
 *   `orderKey`.
 */
export function resolveBoardColumns<T extends BoardThread>(
  board: ProjectBoard | null,
  threads: ReadonlyArray<T>,
): ReadonlyArray<ResolvedBoardColumn<T>> {
  const layout = board ?? DEFAULT_PROJECT_BOARD;
  const buckets = new Map<BoardColumnId, SortableCard<T>[]>(
    layout.columns.map((column) => [column.id, []]),
  );
  const resolveColumn = (columnId: BoardColumnId | null | undefined) =>
    columnId == null ? null : resolveProjectBoardColumnId(layout, columnId);

  for (const thread of threads) {
    const placement = thread.board ?? null;
    const placedColumn = resolveColumn(placement?.columnId);
    const placedNatively = placedColumn !== null && placedColumn === placement?.columnId;
    let columnId: BoardColumnId;
    let group: CardGroup = CardGroup.Unplaced;
    if (thread.archivedAt !== null) {
      columnId = layout.doneColumnId;
      if (placedColumn === layout.doneColumnId) {
        group = placedNatively ? CardGroup.Native : CardGroup.Retired;
      }
    } else if (placedColumn === layout.doneColumnId) {
      columnId = resolveColumn(placement?.returnColumnId) ?? layout.inboxColumnId;
      if (columnId === layout.doneColumnId) columnId = layout.inboxColumnId;
    } else if (placedColumn !== null) {
      columnId = placedColumn;
      group = placedNatively ? CardGroup.Native : CardGroup.Retired;
    } else {
      columnId = layout.inboxColumnId;
    }
    buckets.get(columnId)?.push({
      thread,
      group,
      orderKey: group === CardGroup.Unplaced ? null : placement!.orderKey,
      createdAtMs: epochMillis(thread.createdAt),
    });
  }

  return layout.columns.map((column) => ({
    column,
    cards: (buckets.get(column.id) ?? [])
      .sort(compareCards)
      .map(({ thread, orderKey }) => ({ thread, orderKey })),
  }));
}

/** The live column's top unarchived thread, or null when the board has no live column. */
export function liveCard<T extends BoardThread>(
  board: ProjectBoard | null,
  resolved: ReadonlyArray<ResolvedBoardColumn<T>>,
): T | null {
  const liveColumnId = (board ?? DEFAULT_PROJECT_BOARD).liveColumnId;
  if (liveColumnId === null) return null;
  const column = resolved.find((entry) => entry.column.id === liveColumnId);
  return column?.cards.find((card) => card.thread.archivedAt === null)?.thread ?? null;
}

/**
 * The card a project wants live. On the board it is the live column's top
 * card; in an opened thread it is that thread when it sits in the live
 * column. Undefined means the open thread is elsewhere, so whatever is live
 * stays live.
 */
export function desiredLiveCardId<T extends BoardThread>(
  board: ProjectBoard | null,
  resolved: ReadonlyArray<ResolvedBoardColumn<T>>,
  openedThreadId: string | null,
): string | null | undefined {
  if (openedThreadId === null) return liveCard(board, resolved)?.id ?? null;
  const liveColumnId = (board ?? DEFAULT_PROJECT_BOARD).liveColumnId;
  const column = resolved.find((entry) => entry.column.id === liveColumnId);
  const opened = column?.cards.find((card) => card.thread.id === openedThreadId);
  return opened !== undefined && opened.thread.archivedAt === null ? openedThreadId : undefined;
}

// ── Moving cards ────────────────────────────────────────────────────────

/** One card of the target column as displayed after the drop. */
export interface BoardMoveCard {
  readonly threadId: ThreadId;
  /** The card's sort key in this column (`BoardCard.orderKey`); null when it has none here. */
  readonly orderKey: string | null;
  /** The thread's stored placement, so a rewrite keeps its return column. */
  readonly placement: ThreadBoardPlacement | null;
}

export type BoardMoveStep =
  | {
      readonly type: "place";
      readonly threadId: ThreadId;
      readonly columnId: BoardColumnId;
      readonly orderKey: string;
      readonly returnColumnId: BoardColumnId | null;
    }
  | { readonly type: "archive"; readonly threadId: ThreadId }
  | { readonly type: "unarchive"; readonly threadId: ThreadId };

/**
 * Commands that realize one card drag, in dispatch order. Placement comes
 * first and the archive/unarchive last, so a failed archive leaves the card
 * resolving back to its return column instead of stranding it.
 *
 * - Into done: the moved card remembers `fromColumnId` as its return column.
 * - Within done: the moved card keeps its return column.
 * - Out of done: the thread is unarchived after it is placed.
 *
 * Usually one placement. When a neighbor has no slot of its own (an unplaced
 * thread) the whole target column gets fresh keys, once.
 */
/** A drop that leaves a keyed card between keyed neighbors it already sorts between. */
function keepsSlot(cards: ReadonlyArray<BoardMoveCard>, threadId: ThreadId, sameColumn: boolean) {
  if (!sameColumn) return false;
  const index = cards.findIndex((card) => card.threadId === threadId);
  const key = cards[index]?.orderKey;
  if (key == null) return false;
  const before = index > 0 ? cards[index - 1]!.orderKey : "";
  const after = index < cards.length - 1 ? cards[index + 1]!.orderKey : undefined;
  return (
    before !== null && before < key && (after === undefined || (after !== null && key < after))
  );
}

export function planBoardMove(input: {
  readonly board: ProjectBoard | null;
  readonly threadId: ThreadId;
  readonly archived: boolean;
  readonly fromColumnId: BoardColumnId;
  readonly toColumnId: BoardColumnId;
  /** The target column after the drop, top to bottom, including the moved card. */
  readonly targetCards: ReadonlyArray<BoardMoveCard>;
}): ReadonlyArray<BoardMoveStep> {
  const { threadId, fromColumnId, toColumnId, targetCards } = input;
  const doneColumnId = (input.board ?? DEFAULT_PROJECT_BOARD).doneColumnId;
  if (!targetCards.some((card) => card.threadId === threadId)) return [];
  const intoDone = toColumnId === doneColumnId;
  const fromDone = fromColumnId === doneColumnId;

  const keys = keepsSlot(targetCards, threadId, fromColumnId === toColumnId)
    ? []
    : planPinnedReorder({
        orderedIds: targetCards.map((card) => card.threadId),
        keysById: new Map(
          targetCards.map((card) => [
            card.threadId,
            // The moved card's old key belongs to its source column.
            card.threadId === threadId && fromColumnId !== toColumnId ? null : card.orderKey,
          ]),
        ),
        movedId: threadId,
      });
  const placementsById = new Map(targetCards.map((card) => [card.threadId, card.placement]));
  const returnColumnFor = (id: ThreadId): BoardColumnId | null => {
    if (!intoDone) return null;
    if (id === threadId && !fromDone) return fromColumnId;
    return placementsById.get(id)?.returnColumnId ?? null;
  };
  const place = (id: ThreadId, orderKey: string): BoardMoveStep => ({
    type: "place",
    threadId: id,
    columnId: toColumnId,
    orderKey,
    returnColumnId: returnColumnFor(id),
  });

  const keysById = new Map(keys.map((entry) => [entry.id, entry.orderKey]));
  const steps: BoardMoveStep[] = [];
  const movedKey = keysById.get(threadId);
  if (movedKey !== undefined) steps.push(place(threadId, movedKey));
  for (const card of targetCards) {
    const orderKey = keysById.get(card.threadId);
    if (card.threadId !== threadId && orderKey !== undefined) {
      steps.push(place(card.threadId, orderKey));
    }
  }
  if (intoDone && !input.archived) steps.push({ type: "archive", threadId });
  if (!intoDone && input.archived) steps.push({ type: "unarchive", threadId });
  return steps;
}

/** Where a card sits on the board, or null when it isn't on it. */
export function findBoardCardColumn<T extends BoardThread>(
  resolved: ReadonlyArray<ResolvedBoardColumn<T>>,
  threadId: string,
): BoardColumnId | null {
  return (
    resolved.find((entry) => entry.cards.some((card) => card.thread.id === threadId))?.column.id ??
    null
  );
}

/**
 * Plans moving a card to `index` of a column (clamped, counted without the
 * card itself) from a resolved board, for callers that have no layout of
 * their own, such as an agent. A thread missing from `resolved` is new and
 * moves from the inbox.
 */
export function planBoardCardMove<T extends BoardThread & { readonly id: ThreadId }>(input: {
  readonly board: ProjectBoard | null;
  readonly resolved: ReadonlyArray<ResolvedBoardColumn<T>>;
  readonly threadId: ThreadId;
  readonly archived: boolean;
  readonly toColumnId: BoardColumnId;
  readonly index: number;
}): ReadonlyArray<BoardMoveStep> {
  const layout = input.board ?? DEFAULT_PROJECT_BOARD;
  const target = input.resolved.find((entry) => entry.column.id === input.toColumnId);
  if (target === undefined) return [];
  const fromColumnId = findBoardCardColumn(input.resolved, input.threadId) ?? layout.inboxColumnId;
  const others = target.cards
    .filter((card) => card.thread.id !== input.threadId)
    .map((card): BoardMoveCard => ({
      threadId: card.thread.id,
      orderKey: card.orderKey,
      placement: card.thread.board ?? null,
    }));
  const moved = target.cards.find((card) => card.thread.id === input.threadId);
  const index = Math.max(0, Math.min(Math.trunc(input.index), others.length));
  return planBoardMove({
    board: input.board,
    threadId: input.threadId,
    archived: input.archived,
    fromColumnId,
    toColumnId: input.toColumnId,
    targetCards: [
      ...others.slice(0, index),
      {
        threadId: input.threadId,
        orderKey: moved?.orderKey ?? null,
        placement: moved?.thread.board ?? null,
      },
      ...others.slice(index),
    ],
  });
}

/**
 * Where a new card goes in its column: the top, except in the live column,
 * where it goes under the live card so adding an idea never swaps what's running.
 */
export function newBoardCardIndex(
  board: ProjectBoard,
  columnId: BoardColumnId,
  cardCount: number,
): number {
  return columnId === board.liveColumnId && cardCount > 0 ? 1 : 0;
}
