import {
  BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  type ProjectBoard,
  type ThreadBoardPlacement,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  type BoardThread,
  desiredLiveCardId,
  liveCard,
  newBoardCardIndex,
  planBoardCardMove,
  resolveBoardColumns,
} from "./projectBoard.ts";

const col = BoardColumnId.make;

function thread(
  id: string,
  options: {
    readonly createdAt?: string;
    readonly archived?: boolean;
    readonly board?: ThreadBoardPlacement | null;
  } = {},
): BoardThread {
  return {
    id,
    createdAt: options.createdAt ?? "2026-01-01T00:00:00.000Z",
    archivedAt: options.archived === true ? "2026-02-01T00:00:00.000Z" : null,
    board: options.board ?? null,
  };
}

function layout(board: ProjectBoard | null, threads: ReadonlyArray<BoardThread>) {
  return Object.fromEntries(
    resolveBoardColumns(board, threads).map((entry) => [
      entry.column.id,
      entry.cards.map((card) => card.thread.id),
    ]),
  );
}

describe("resolveBoardColumns", () => {
  it("uses the default board and puts unplaced threads in the inbox, newest first", () => {
    expect(
      layout(null, [
        thread("old", { createdAt: "2026-01-01T00:00:00.000Z" }),
        thread("new", { createdAt: "2026-01-03T00:00:00.000Z" }),
        thread("unknown", {
          createdAt: "2026-01-02T00:00:00.000Z",
          board: { columnId: col("deleted-without-trace"), orderKey: "a" },
        }),
      ]),
    ).toEqual({ ideas: [], "in-progress": ["new", "unknown", "old"], testing: [], done: [] });
  });

  it("orders unplaced cards before placed ones, placed ones by key", () => {
    expect(
      layout(DEFAULT_PROJECT_BOARD, [
        thread("second", { board: { columnId: col("in-progress"), orderKey: "t" } }),
        thread("first", { board: { columnId: col("in-progress"), orderKey: "g" } }),
        thread("unplaced"),
      ])["in-progress"],
    ).toEqual(["unplaced", "first", "second"]);
  });

  it("keeps archived threads in done and returns unarchived done cards", () => {
    expect(
      layout(DEFAULT_PROJECT_BOARD, [
        thread("archived-from-sidebar", {
          archived: true,
          board: { columnId: col("testing"), orderKey: "n" },
        }),
        thread("archived-on-board", {
          archived: true,
          board: { columnId: col("done"), orderKey: "n", returnColumnId: col("testing") },
        }),
        thread("unarchived-with-return", {
          board: { columnId: col("done"), orderKey: "n", returnColumnId: col("ideas") },
        }),
        thread("unarchived-without-return", { board: { columnId: col("done"), orderKey: "n" } }),
      ]),
    ).toEqual({
      ideas: ["unarchived-with-return"],
      "in-progress": ["unarchived-without-return"],
      testing: [],
      done: ["archived-from-sidebar", "archived-on-board"],
    });
  });

  it("sorts cards from retired columns after the target's own cards", () => {
    const board: ProjectBoard = {
      ...DEFAULT_PROJECT_BOARD,
      retiredColumns: [{ id: col("review"), movedTo: col("testing") }],
    };
    expect(
      layout(board, [
        thread("moved", { board: { columnId: col("review"), orderKey: "b" } }),
        thread("native", { board: { columnId: col("testing"), orderKey: "y" } }),
      ]).testing,
    ).toEqual(["native", "moved"]);
  });

  it("accepts DateTime timestamps from server shells", () => {
    const resolved = resolveBoardColumns(null, [
      { ...thread("older"), createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z") },
      { ...thread("newer"), createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z") },
    ]);
    expect(resolved[1]?.cards.map((card) => card.thread.id)).toEqual(["newer", "older"]);
  });
});

describe("liveCard", () => {
  it("returns the top card of the live column", () => {
    const threads = [
      thread("lower", { board: { columnId: col("testing"), orderKey: "t" } }),
      thread("top", { board: { columnId: col("testing"), orderKey: "g" } }),
    ];
    expect(liveCard(null, resolveBoardColumns(null, threads))?.id).toBe("top");
  });

  it("returns null without a live column or cards", () => {
    const board = { ...DEFAULT_PROJECT_BOARD, liveColumnId: null };
    const threads = [thread("t", { board: { columnId: col("testing"), orderKey: "g" } })];
    expect(liveCard(board, resolveBoardColumns(board, threads))).toBeNull();
    expect(liveCard(null, resolveBoardColumns(null, []))).toBeNull();
  });
});

describe("desiredLiveCardId", () => {
  const testing = (orderKey: string) => ({ columnId: col("testing"), orderKey });
  const threads = [
    thread("top", { board: testing("a") }),
    thread("second", { board: testing("b") }),
    thread("elsewhere"),
  ];
  const resolved = resolveBoardColumns(null, threads);

  it("is the live column's top card on the board", () => {
    expect(desiredLiveCardId(null, resolved, null)).toBe("top");
  });

  it("is a card opened from the live column", () => {
    expect(desiredLiveCardId(null, resolved, "second")).toBe("second");
  });

  it("leaves things alone for a thread outside the live column", () => {
    expect(desiredLiveCardId(null, resolved, "elsewhere")).toBeUndefined();
  });

  it("is nothing when the board has no live column", () => {
    const board = { ...DEFAULT_PROJECT_BOARD, liveColumnId: null };
    expect(desiredLiveCardId(board, resolveBoardColumns(board, threads), null)).toBeNull();
    expect(desiredLiveCardId(board, resolveBoardColumns(board, threads), "top")).toBeUndefined();
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

describe("planBoardCardMove", () => {
  const card = (id: string, board: ThreadBoardPlacement | null, archived = false) => ({
    ...thread(id, { board, archived }),
    id: ThreadId.make(id),
  });
  const cards = [
    card("idea", { columnId: col("ideas"), orderKey: "m" }),
    card("first", { columnId: col("testing"), orderKey: "g" }),
    card("second", { columnId: col("testing"), orderKey: "p" }),
  ];
  const resolved = resolveBoardColumns(null, cards);

  it("places a card at an index of another column with one key", () => {
    const steps = planBoardCardMove({
      board: null,
      resolved,
      threadId: ThreadId.make("idea"),
      archived: false,
      toColumnId: col("testing"),
      index: 1,
    });
    expect(steps).toHaveLength(1);
    const [step] = steps;
    expect(step).toMatchObject({ type: "place", columnId: "testing", returnColumnId: null });
    expect(step?.type === "place" && step.orderKey > "g" && step.orderKey < "p").toBe(true);
  });

  it("clamps the index and archives a card moved into done, remembering where it came from", () => {
    const steps = planBoardCardMove({
      board: null,
      resolved,
      threadId: ThreadId.make("first"),
      archived: false,
      toColumnId: col("done"),
      index: 99,
    });
    expect(steps.map((step) => step.type)).toEqual(["place", "archive"]);
    expect(steps[0]).toMatchObject({ columnId: "done", returnColumnId: "testing" });
  });

  it("places a thread that isn't on the board yet", () => {
    const steps = planBoardCardMove({
      board: null,
      resolved,
      threadId: ThreadId.make("new"),
      archived: false,
      toColumnId: col("testing"),
      index: 0,
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.type === "place" && steps[0].orderKey < "g").toBe(true);
  });

  it("does nothing for an unknown column", () => {
    expect(
      planBoardCardMove({
        board: null,
        resolved,
        threadId: ThreadId.make("idea"),
        archived: false,
        toColumnId: col("nowhere"),
        index: 0,
      }),
    ).toEqual([]);
  });
});
