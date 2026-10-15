import {
  type BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  type ProjectBoard,
  type ThreadBoardPlacement,
  type ThreadId,
} from "@supaterm/contracts";

import { planPinnedReorder } from "./threadSort.ts";

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
