import { BoardColumnId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { type BoardMoveCard, planBoardMove } from "./projectBoardMove.ts";

const col = BoardColumnId.make;
const moved = ThreadId.make("moved");
const above = ThreadId.make("above");
const below = ThreadId.make("below");

function card(
  threadId: ThreadId,
  orderKey: string | null,
  returnColumnId?: BoardColumnId,
): BoardMoveCard {
  return {
    threadId,
    orderKey,
    placement:
      orderKey === null
        ? null
        : { columnId: col("x"), orderKey, ...(returnColumnId ? { returnColumnId } : {}) },
  };
}

const plan = (input: {
  readonly archived?: boolean;
  readonly from: string;
  readonly to: string;
  readonly targetCards: ReadonlyArray<BoardMoveCard>;
}) =>
  planBoardMove({
    board: null,
    threadId: moved,
    archived: input.archived ?? false,
    fromColumnId: col(input.from),
    toColumnId: col(input.to),
    targetCards: input.targetCards,
  });

describe("planBoardMove", () => {
  it("places a card between keyed neighbors with one write", () => {
    expect(
      plan({
        from: "ideas",
        to: "testing",
        targetCards: [card(above, "g"), card(moved, "zz"), card(below, "t")],
      }),
    ).toEqual([
      {
        type: "place",
        threadId: moved,
        columnId: "testing",
        orderKey: "n",
        returnColumnId: null,
      },
    ]);
  });

  it("records the source column and archives when moving into done", () => {
    expect(
      plan({ from: "testing", to: "done", targetCards: [card(moved, "n"), card(below, "t")] }),
    ).toEqual([
      {
        type: "place",
        threadId: moved,
        columnId: "done",
        orderKey: "k",
        returnColumnId: "testing",
      },
      { type: "archive", threadId: moved },
    ]);
  });

  it("places then unarchives when moving out of done", () => {
    expect(
      plan({ archived: true, from: "done", to: "ideas", targetCards: [card(moved, "n")] }),
    ).toEqual([
      { type: "place", threadId: moved, columnId: "ideas", orderKey: "n", returnColumnId: null },
      { type: "unarchive", threadId: moved },
    ]);
  });

  it("only reorders within done and keeps the return column", () => {
    expect(
      plan({
        archived: true,
        from: "done",
        to: "done",
        targetCards: [card(above, "g", col("ideas")), card(moved, "t", col("testing"))],
      }),
    ).toEqual([]);
    expect(
      plan({
        archived: true,
        from: "done",
        to: "done",
        targetCards: [card(moved, "t", col("testing")), card(above, "g", col("ideas"))],
      }),
    ).toEqual([
      {
        type: "place",
        threadId: moved,
        columnId: "done",
        orderKey: "d",
        returnColumnId: "testing",
      },
    ]);
  });

  it("gives unplaced neighbors slots of their own", () => {
    const steps = plan({
      from: "ideas",
      to: "in-progress",
      targetCards: [card(above, null), card(moved, null), card(below, "t")],
    });
    expect(steps.map((step) => step.type === "place" && step.threadId)).toEqual([
      moved,
      above,
      below,
    ]);
    const keys = steps.map((step) => (step.type === "place" ? step.orderKey : ""));
    expect(keys[1]! < keys[0]! && keys[0]! < keys[2]!).toBe(true);
  });
});
