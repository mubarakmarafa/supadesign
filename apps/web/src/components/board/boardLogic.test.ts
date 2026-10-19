import { BoardColumnId, DEFAULT_PROJECT_BOARD, type ProjectBoard } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addBoardColumn,
  boardCardFromText,
  type BoardLayout,
  boardColumnDeleteBlocker,
  deleteBoardColumn,
  moveBoardCard,
  moveBoardColumn,
  newBoardCardIndex,
  nextBoardFocus,
  nudgeBoardCard,
  renameBoardColumn,
  setBoardColumnFlag,
} from "./boardLogic";

const col = (id: string) => BoardColumnId.make(id);

const layout: BoardLayout = [
  { columnId: col("ideas"), cardIds: ["a", "b", "c"] },
  { columnId: col("empty"), cardIds: [] },
  { columnId: col("testing"), cardIds: ["d"] },
  { columnId: col("done"), cardIds: ["e", "f"] },
];

describe("nextBoardFocus", () => {
  it("lands on the first card when nothing is focused", () => {
    expect(nextBoardFocus(layout, null, "down")).toBe("a");
    expect(nextBoardFocus(layout, "gone", "right")).toBe("a");
  });

  it("moves within a column and clamps at its ends", () => {
    expect(nextBoardFocus(layout, "a", "up")).toBe("a");
    expect(nextBoardFocus(layout, "a", "down")).toBe("b");
    expect(nextBoardFocus(layout, "c", "down")).toBe("c");
    expect(nextBoardFocus(layout, "b", "home")).toBe("a");
    expect(nextBoardFocus(layout, "a", "end")).toBe("c");
  });

  it("skips empty columns and clamps the row", () => {
    expect(nextBoardFocus(layout, "c", "right")).toBe("d");
    expect(nextBoardFocus(layout, "d", "left")).toBe("a");
    expect(nextBoardFocus(layout, "d", "right")).toBe("e");
    expect(nextBoardFocus(layout, "f", "right")).toBe("f");
  });
});

describe("moveBoardCard", () => {
  it("reorders within a column using the index after removal", () => {
    expect(moveBoardCard(layout, "a", col("ideas"), 2)[0]!.cardIds).toEqual(["b", "c", "a"]);
  });

  it("moves across columns and clamps the index", () => {
    const next = moveBoardCard(layout, "b", col("empty"), 9);
    expect(next[0]!.cardIds).toEqual(["a", "c"]);
    expect(next[1]!.cardIds).toEqual(["b"]);
  });

  it("ignores unknown columns", () => {
    expect(moveBoardCard(layout, "a", col("nope"), 0)).toBe(layout);
  });
});

describe("nudgeBoardCard", () => {
  it("swaps with a neighbor and stops at the column's ends", () => {
    expect(nudgeBoardCard(layout, "b", "up")?.layout[0]!.cardIds).toEqual(["b", "a", "c"]);
    expect(nudgeBoardCard(layout, "a", "up")).toBeNull();
    expect(nudgeBoardCard(layout, "c", "down")).toBeNull();
  });

  it("moves into the adjacent column, empty or not, at the same row", () => {
    const right = nudgeBoardCard(layout, "c", "right");
    expect(right?.fromColumnId).toBe("ideas");
    expect(right?.toColumnId).toBe("empty");
    expect(right?.layout[1]!.cardIds).toEqual(["c"]);
    const left = nudgeBoardCard(layout, "f", "left");
    expect(left?.layout[2]!.cardIds).toEqual(["d", "f"]);
    expect(nudgeBoardCard(layout, "a", "left")).toBeNull();
    expect(nudgeBoardCard(layout, "e", "right")).toBeNull();
  });
});

describe("board column editing", () => {
  const board = DEFAULT_PROJECT_BOARD;

  it("adds new columns before a trailing done column", () => {
    const next = addBoardColumn(board, { id: col("review"), title: "  Review " });
    expect(next?.columns.map((column) => column.id)).toEqual([
      "ideas",
      "in-progress",
      "testing",
      "review",
      "done",
    ]);
    expect(next?.columns[3]!.title).toBe("Review");
    expect(addBoardColumn(board, { id: col("x"), title: "   " })).toBeNull();
  });

  it("renames and reorders columns, returning null for no-ops", () => {
    expect(renameBoardColumn(board, col("ideas"), "Backlog")?.columns[0]!.title).toBe("Backlog");
    expect(renameBoardColumn(board, col("ideas"), "Ideas")).toBeNull();
    expect(moveBoardColumn(board, col("ideas"), "left")).toBeNull();
    expect(moveBoardColumn(board, col("ideas"), "right")?.columns[1]!.id).toBe("ideas");
  });

  it("keeps done apart from the inbox and live flags", () => {
    expect(setBoardColumnFlag(board, col("done"), "inbox")).toBeNull();
    expect(setBoardColumnFlag(board, col("done"), "live")).toBeNull();
    expect(setBoardColumnFlag(board, col("testing"), "done")).toBeNull();
    expect(setBoardColumnFlag(board, col("ideas"), "done")?.doneColumnId).toBe("ideas");
    expect(setBoardColumnFlag(board, col("ideas"), "inbox")?.inboxColumnId).toBe("ideas");
  });

  it("toggles the live flag off when set on the live column", () => {
    expect(setBoardColumnFlag(board, col("testing"), "live")?.liveColumnId).toBeNull();
    expect(setBoardColumnFlag(board, col("ideas"), "live")?.liveColumnId).toBe("ideas");
  });

  it("toggles the send flag and keeps it off the done column", () => {
    const sending = setBoardColumnFlag(board, col("in-progress"), "send");
    expect(sending?.sendColumnId).toBe("in-progress");
    expect(setBoardColumnFlag(sending!, col("in-progress"), "send")?.sendColumnId).toBeNull();
    expect(setBoardColumnFlag(board, col("done"), "send")).toBeNull();
    expect(setBoardColumnFlag(sending!, col("in-progress"), "done")).toBeNull();
  });

  it("drops the send flag with its deleted column", () => {
    const sending = { ...board, sendColumnId: col("ideas") };
    expect(deleteBoardColumn(sending, col("ideas"))?.sendColumnId).toBeNull();
  });

  it("refuses to delete flagged columns or drop below the minimum", () => {
    expect(boardColumnDeleteBlocker(board, col("done"))).toBe("done");
    expect(boardColumnDeleteBlocker(board, col("in-progress"))).toBe("inbox");
    expect(boardColumnDeleteBlocker(board, col("testing"))).toBe("live");
    const small: ProjectBoard = {
      columns: [
        { id: col("todo"), title: "Todo" },
        { id: col("done"), title: "Done" },
      ],
      inboxColumnId: col("todo"),
      liveColumnId: null,
      doneColumnId: col("done"),
    };
    expect(boardColumnDeleteBlocker(small, col("todo"))).toBe("inbox");
    expect(deleteBoardColumn(small, col("todo"))).toBeNull();
  });

  it("retires a deleted column into its left neighbor, or the right one when first", () => {
    const middle = deleteBoardColumn(
      { ...board, retiredColumns: [{ id: col("old"), movedTo: col("ideas") }] },
      col("ideas"),
    );
    expect(middle?.columns.map((column) => column.id)).toEqual(["in-progress", "testing", "done"]);
    expect(middle?.retiredColumns).toEqual([
      { id: "old", movedTo: "ideas" },
      { id: "ideas", movedTo: "in-progress" },
    ]);
    const withExtra = addBoardColumn(board, { id: col("review"), title: "Review" })!;
    expect(deleteBoardColumn(withExtra, col("review"))?.retiredColumns).toEqual([
      { id: "review", movedTo: "testing" },
    ]);
  });
});

describe("boardCardFromText", () => {
  it("uses the first line as the title and the rest as the summary", () => {
    expect(boardCardFromText("  Sound pass \n\n make taps feel tactile \n and fresh ")).toEqual({
      title: "Sound pass",
      summary: "make taps feel tactile\nand fresh",
    });
    expect(boardCardFromText("Onboarding copy")).toEqual({
      title: "Onboarding copy",
      summary: null,
    });
  });

  it("shortens a long first line at a word and keeps all of it in the summary", () => {
    const text =
      "make sure we are fun and creative with the sounds, i really want to make the app feel tactile and fresh";
    const card = boardCardFromText(text)!;
    expect(card.title.length).toBeLessThanOrEqual(80);
    expect(card.title).toBe(
      "make sure we are fun and creative with the sounds, i really want to make the…",
    );
    expect(card.summary).toBe(text);
  });

  it("ignores blank input", () => {
    expect(boardCardFromText(" \n  ")).toBeNull();
  });
});

describe("newBoardCardIndex", () => {
  it("adds to the top, but under the live card in the live column", () => {
    const board = DEFAULT_PROJECT_BOARD;
    expect(newBoardCardIndex(board, col("ideas"), 3)).toBe(0);
    expect(newBoardCardIndex(board, board.liveColumnId!, 2)).toBe(1);
    expect(newBoardCardIndex(board, board.liveColumnId!, 0)).toBe(0);
  });
});
