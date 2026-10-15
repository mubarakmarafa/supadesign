import {
  type BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  type ProjectBoard,
  type ProjectBoardColumn,
  resolveProjectBoardColumnId,
  type ThreadBoardPlacement,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";

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
