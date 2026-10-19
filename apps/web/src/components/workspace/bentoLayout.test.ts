import {
  type ProjectWorkspaceLayout,
  type ProjectWorkspaceLayoutNode,
  ProjectWorkspaceWidgetId,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildLayout,
  distribute,
  dropOnBoardEdge,
  dropTile,
  dropZoneAt,
  evenGutter,
  evenOutLayout,
  gutterRange,
  insertTile,
  layoutGutters,
  layoutRects,
  neighbourTile,
  reconcileLayout,
  removeTile,
  resizeGutter,
  swapTiles,
} from "./bentoLayout";

const id = ProjectWorkspaceWidgetId.make;
const board = id("kanban");
const agent = id("board-agent");
const preview = id("preview");
const figma = id("figma");

/** Each tile as `id x,y wxh`, in reading order. */
function describeLayout(layout: ProjectWorkspaceLayout | null): ReadonlyArray<string> {
  if (layout === null) return [];
  return [...layoutRects(layout)]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((rect) => `${rect.widgetId} ${rect.x},${rect.y} ${rect.w}x${rect.h}`);
}

/** Tiles cover every cell of the grid exactly once. */
function expectFilled(layout: ProjectWorkspaceLayout | null) {
  expect(layout).not.toBeNull();
  const cells = new Map<string, string>();
  for (const rect of layoutRects(layout!)) {
    expect(rect.w).toBeGreaterThanOrEqual(1);
    expect(rect.h).toBeGreaterThanOrEqual(1);
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        expect(cells.has(`${x},${y}`)).toBe(false);
        cells.set(`${x},${y}`, rect.widgetId);
      }
    }
  }
  expect(cells.size).toBe(layout!.columns * layout!.rows);
}

const row = (
  ...children: ReadonlyArray<ProjectWorkspaceLayoutNode>
): ProjectWorkspaceLayoutNode => ({ type: "split", axis: "row", span: 1, children });
const tile = (widgetId: string, span: number): ProjectWorkspaceLayoutNode => ({
  type: "tile",
  widgetId: id(widgetId),
  span,
});

describe("buildLayout", () => {
  it("puts the board agent a quarter wide beside the board", () => {
    const layout = buildLayout([board, agent]);
    expectFilled(layout);
    expect(describeLayout(layout)).toEqual(["kanban 0,0 6x6", "board-agent 6,0 2x6"]);
  });

  it("keeps splitting the biggest tile and always fills the grid", () => {
    const ids = [board, agent, preview, figma, id("usage")];
    const layout = buildLayout(ids);
    expectFilled(layout);
    expect(
      layoutRects(layout!)
        .map((rect) => rect.widgetId)
        .toSorted(),
    ).toEqual(ids.toSorted());
  });

  it("fits as many widgets as the grid has room for", () => {
    const ids = Array.from({ length: 24 }, (_, index) => id(`w${index}`));
    const layout = buildLayout(ids);
    expectFilled(layout);
    expect(layoutRects(layout!)).toHaveLength(24);
  });
});

describe("reconcileLayout", () => {
  it("drops tiles for removed widgets and places new ones", () => {
    const stored = buildLayout([board, agent, preview])!;
    const layout = reconcileLayout([board, preview, figma], stored);
    expectFilled(layout);
    expect(
      layoutRects(layout!)
        .map((rect) => rect.widgetId)
        .toSorted(),
    ).toEqual([board, figma, preview].toSorted());
  });

  it("keeps a widget's first tile when the stored tree repeats it", () => {
    const stored: ProjectWorkspaceLayout = {
      columns: 8,
      rows: 6,
      root: row(tile("kanban", 4), tile("board-agent", 2), tile("kanban", 2)),
    };
    expect(describeLayout(reconcileLayout([board, agent], stored))).toEqual([
      "kanban 0,0 4x6",
      "board-agent 4,0 4x6",
    ]);
  });

  it("rebuilds from order when spans do not add up or the grid changed", () => {
    const broken: ProjectWorkspaceLayout = {
      columns: 8,
      rows: 6,
      root: row(tile("kanban", 5), tile("board-agent", 5)),
    };
    expect(reconcileLayout([board, agent], broken)).toEqual(buildLayout([board, agent]));
    const otherGrid = { ...buildLayout([board, agent])!, columns: 12 };
    expect(reconcileLayout([board, agent], otherGrid)).toEqual(buildLayout([board, agent]));
  });

  it("has nothing to draw without widgets", () => {
    expect(reconcileLayout([], buildLayout([board])!)).toBeNull();
  });
});

describe("resizing gaps", () => {
  it("trades tracks only between the tiles beside the gap", () => {
    const layout = insertTile(buildLayout([board, agent])!, preview)!;
    expect(describeLayout(layout)).toEqual([
      "kanban 0,0 4x6",
      "preview 4,0 2x6",
      "board-agent 6,0 2x6",
    ]);
    expect(describeLayout(resizeGutter(layout, layoutGutters(layout)[0]!, -1))).toEqual([
      "kanban 0,0 3x6",
      "preview 3,0 3x6",
      "board-agent 6,0 2x6",
    ]);
  });

  it("stops each tile at one track", () => {
    const layout = buildLayout([board, agent])!;
    const [gutter] = layoutGutters(layout);
    expect(gutterRange(layout, gutter!)).toEqual({ min: -5, max: 1 });
    expect(describeLayout(resizeGutter(layout, gutter!, 10))).toEqual([
      "kanban 0,0 7x6",
      "board-agent 7,0 1x6",
    ]);
  });

  it("shrinks the tiles nearest the gap first, then the next", () => {
    // a | ((b c) over d): dragging the outer gap right eats into b, then c.
    const layout: ProjectWorkspaceLayout = {
      columns: 8,
      rows: 6,
      root: row(tile("a", 2), {
        type: "split",
        axis: "column",
        span: 6,
        children: [{ ...row(tile("b", 3), tile("c", 3)), span: 3 }, tile("d", 3)],
      }),
    };
    expectFilled(layout);
    const outer = layoutGutters(layout).find((gutter) => gutter.path.length === 0)!;
    expect(gutterRange(layout, outer)).toEqual({ min: -1, max: 4 });
    expect(describeLayout(resizeGutter(layout, outer, 4))).toEqual([
      "a 0,0 6x6",
      "b 6,0 1x3",
      "c 7,0 1x3",
      "d 6,3 2x3",
    ]);
  });

  it("evens out one gap or the whole board", () => {
    const start = buildLayout([board, agent])!;
    const layout = resizeGutter(start, layoutGutters(start)[0]!, 1);
    expect(describeLayout(evenGutter(layout, layoutGutters(layout)[0]!))).toEqual([
      "kanban 0,0 4x6",
      "board-agent 4,0 4x6",
    ]);
    const many = buildLayout([board, agent, preview, figma])!;
    const even = evenOutLayout(many);
    expectFilled(even);
  });
});

describe("moving tiles", () => {
  it("swaps two tiles in place", () => {
    const layout = buildLayout([board, agent])!;
    expect(describeLayout(swapTiles(layout, board, agent))).toEqual([
      "board-agent 0,0 6x6",
      "kanban 6,0 2x6",
    ]);
    expect(describeLayout(dropTile(layout, agent, board, "center"))).toEqual(
      describeLayout(swapTiles(layout, board, agent)),
    );
  });

  it("splits the target on the edge it is dropped on", () => {
    const layout = buildLayout([board, agent, preview])!;
    const dropped = dropTile(layout, agent, board, "bottom");
    expectFilled(dropped);
    const boardRect = layoutRects(dropped!).find((rect) => rect.widgetId === board)!;
    const agentRect = layoutRects(dropped!).find((rect) => rect.widgetId === agent)!;
    expect(agentRect.y).toBe(boardRect.y + boardRect.h);
    expect(agentRect.x).toBe(boardRect.x);
    expect(agentRect.w).toBe(boardRect.w);
  });

  it("refuses a split the target has no room for", () => {
    const layout: ProjectWorkspaceLayout = {
      columns: 8,
      rows: 6,
      root: {
        type: "split",
        axis: "column",
        span: 1,
        children: [{ ...row(tile("a", 4), tile("b", 4)), span: 5 }, tile("c", 1)],
      },
    };
    // c is one track tall, so it cannot be stacked with another tile.
    expect(dropTile(layout, id("a"), id("c"), "top")).toBeNull();
    expectFilled(dropTile(layout, id("a"), id("c"), "left"));
    expect(dropTile(layout, id("a"), id("a"), "left")).toBeNull();
  });

  it("drops onto the board's edge as a full strip", () => {
    const layout = buildLayout([board, agent, preview])!;
    const dropped = dropOnBoardEdge(layout, agent, "top");
    expectFilled(dropped);
    const agentRect = layoutRects(dropped!).find((rect) => rect.widgetId === agent)!;
    expect(agentRect).toMatchObject({ x: 0, y: 0, w: 8 });
  });

  it("finds the neighbour sharing the longest edge", () => {
    const layout = buildLayout([board, agent])!;
    expect(neighbourTile(layout, board, "right")).toBe(agent);
    expect(neighbourTile(layout, board, "left")).toBeNull();
  });

  it("removes a tile and gives its space to a neighbour", () => {
    const layout = buildLayout([board, agent, preview])!;
    const removed = removeTile(layout, preview);
    expectFilled(removed);
    expect(layoutRects(removed!)).toHaveLength(2);
    expect(removeTile(buildLayout([board])!, board)).toBeNull();
  });
});

describe("dropZoneAt", () => {
  const rect = { left: 0, top: 0, width: 400, height: 200 };
  it("swaps in the middle and splits near an edge", () => {
    expect(dropZoneAt({ x: 200, y: 100 }, rect)).toBe("center");
    expect(dropZoneAt({ x: 20, y: 100 }, rect)).toBe("left");
    expect(dropZoneAt({ x: 390, y: 100 }, rect)).toBe("right");
    expect(dropZoneAt({ x: 200, y: 10 }, rect)).toBe("top");
    expect(dropZoneAt({ x: 200, y: 190 }, rect)).toBe("bottom");
  });
});

describe("distribute", () => {
  it("splits by weight and lifts shares to their minimum", () => {
    expect(distribute(8, [1, 1, 1], [1, 1, 1])).toEqual([3, 3, 2]);
    expect(distribute(6, [10, 0], [1, 1])).toEqual([5, 1]);
  });
});
