import {
  PROJECT_WORKSPACE_LAYOUT_COLUMNS,
  PROJECT_WORKSPACE_LAYOUT_ROWS,
  type ProjectWorkspaceLayout,
  type ProjectWorkspaceLayoutNode as LayoutNode,
  type ProjectWorkspaceWidgetId as WidgetId,
} from "@supaterm/contracts";

/**
 * The bento: a split tree over a snap grid. Tiles always cover the grid, so
 * there are no holes, and moving a gap only trades tracks between the two
 * tiles beside it. Everything here is pure; the grid renders the rectangles.
 */

export type Axis = "row" | "column";
export type Edge = "left" | "right" | "top" | "bottom";
type Split = Extract<LayoutNode, { type: "split" }>;
type Path = ReadonlyArray<number>;

/** A tile's place on the grid, in tracks from the top-left. */
export interface TileRect {
  readonly widgetId: WidgetId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The gap between two siblings of a split, which drags to resize them. */
export interface Gutter {
  /** The split, as child indexes from the root. */
  readonly path: Path;
  /** The gap sits after this child. */
  readonly index: number;
  /** `row` gaps are vertical lines between side-by-side tiles. */
  readonly axis: Axis;
  /** The grid line the gap sits on, along `axis`. */
  readonly line: number;
  /** Where the gap starts and how long it runs, across `axis`. */
  readonly start: number;
  readonly length: number;
}

/** Roughly how much wider a column track is than a row track on a typical board. */
const TRACK_ASPECT = 1.2;
/** A widget squeezed down to this many tracks still shows its title and a line of content. */
const MIN_SPAN = 1;
/** New side-by-side tiles start a quarter of the board wide. */
const COMFORTABLE_COLUMNS = Math.max(1, Math.round(PROJECT_WORKSPACE_LAYOUT_COLUMNS / 4));

export function emptyGrid(): Pick<ProjectWorkspaceLayout, "columns" | "rows"> {
  return { columns: PROJECT_WORKSPACE_LAYOUT_COLUMNS, rows: PROJECT_WORKSPACE_LAYOUT_ROWS };
}

// ── Reading ──

export function layoutRects(layout: ProjectWorkspaceLayout): ReadonlyArray<TileRect> {
  const rects: TileRect[] = [];
  const walk = (node: LayoutNode, x: number, y: number, w: number, h: number) => {
    if (node.type === "tile") {
      rects.push({ widgetId: node.widgetId, x, y, w, h });
      return;
    }
    let offset = node.axis === "row" ? x : y;
    for (const child of node.children) {
      if (node.axis === "row") walk(child, offset, y, child.span, h);
      else walk(child, x, offset, w, child.span);
      offset += child.span;
    }
  };
  walk(layout.root, 0, 0, layout.columns, layout.rows);
  return rects;
}

export function layoutGutters(layout: ProjectWorkspaceLayout): ReadonlyArray<Gutter> {
  const gutters: Gutter[] = [];
  const walk = (node: LayoutNode, path: Path, x: number, y: number, w: number, h: number) => {
    if (node.type === "tile") return;
    let offset = node.axis === "row" ? x : y;
    node.children.forEach((child, index) => {
      if (node.axis === "row") walk(child, [...path, index], offset, y, child.span, h);
      else walk(child, [...path, index], x, offset, w, child.span);
      offset += child.span;
      if (index < node.children.length - 1) {
        gutters.push({
          path,
          index,
          axis: node.axis,
          line: offset,
          start: node.axis === "row" ? y : x,
          length: node.axis === "row" ? h : w,
        });
      }
    });
  };
  walk(layout.root, [], 0, 0, layout.columns, layout.rows);
  return gutters;
}

/** The smallest size a node can shrink to along an axis. */
function minExtent(node: LayoutNode, axis: Axis): number {
  if (node.type === "tile") return MIN_SPAN;
  const mins = node.children.map((child) => minExtent(child, axis));
  return node.axis === axis
    ? mins.reduce((sum, value) => sum + value, 0)
    : Math.max(MIN_SPAN, ...mins);
}

/** Whether every split's children fill it exactly and none is below its minimum. */
function isValidNode(node: LayoutNode, w: number, h: number): boolean {
  if (w < MIN_SPAN || h < MIN_SPAN) return false;
  if (node.type === "tile") return true;
  if (node.children.length === 0) return false;
  const extent = node.axis === "row" ? w : h;
  const total = node.children.reduce((sum, child) => sum + child.span, 0);
  if (total !== extent) return false;
  return node.children.every((child) =>
    node.axis === "row" ? isValidNode(child, child.span, h) : isValidNode(child, w, child.span),
  );
}

function tileIds(node: LayoutNode): ReadonlyArray<WidgetId> {
  return node.type === "tile" ? [node.widgetId] : node.children.flatMap(tileIds);
}

// ── Building ──

/**
 * The layout to draw for these widgets: the stored one with gone widgets
 * dropped and new ones placed, or one built from their order when there is
 * none or it does not fit this grid.
 */
export function reconcileLayout(
  widgetIds: ReadonlyArray<WidgetId>,
  stored: ProjectWorkspaceLayout | undefined,
): ProjectWorkspaceLayout | null {
  const grid = emptyGrid();
  const usable =
    stored !== undefined &&
    stored.columns === grid.columns &&
    stored.rows === grid.rows &&
    isValidNode(stored.root, stored.columns, stored.rows);
  if (!usable) return buildLayout(widgetIds);

  const wanted = new Set(widgetIds);
  let layout: ProjectWorkspaceLayout | null = stored;
  const kept = new Set<WidgetId>();
  for (const id of tileIds(stored.root)) {
    // A duplicate goes from the end, so the first tile for a widget stays.
    if (wanted.has(id) && !kept.has(id)) kept.add(id);
    else if (layout !== null) layout = removeTile(layout, id);
  }
  for (const id of widgetIds) {
    if (kept.has(id)) continue;
    layout = layout === null ? singleTile(id) : (insertTile(layout, id) ?? layout);
  }
  return layout;
}

/** Lays widgets out in order, each splitting the biggest tile so far. */
export function buildLayout(widgetIds: ReadonlyArray<WidgetId>): ProjectWorkspaceLayout | null {
  let layout: ProjectWorkspaceLayout | null = null;
  for (const id of widgetIds) {
    layout = layout === null ? singleTile(id) : (insertTile(layout, id) ?? layout);
  }
  return layout;
}

function singleTile(widgetId: WidgetId): ProjectWorkspaceLayout {
  return { ...emptyGrid(), root: { type: "tile", widgetId, span: 1 } };
}

/**
 * Places a widget by splitting the biggest tile along its longer side. A
 * wide tile gives the newcomer a comfortable quarter of the board; anything
 * else is halved. Null when no tile can split.
 */
export function insertTile(
  layout: ProjectWorkspaceLayout,
  widgetId: WidgetId,
): ProjectWorkspaceLayout | null {
  const candidates = [...layoutRects(layout)].sort(
    (left, right) => right.w * TRACK_ASPECT * right.h - left.w * TRACK_ASPECT * left.h,
  );
  for (const rect of candidates) {
    const wide = rect.w * TRACK_ASPECT >= rect.h;
    const axes: ReadonlyArray<Axis> = wide ? ["row", "column"] : ["column", "row"];
    for (const axis of axes) {
      const extent = axis === "row" ? rect.w : rect.h;
      if (extent < MIN_SPAN * 2) continue;
      const span =
        axis === "row" && extent >= COMFORTABLE_COLUMNS * 2
          ? COMFORTABLE_COLUMNS
          : Math.floor(extent / 2);
      const next = splitTile(layout, rect.widgetId, widgetId, axis, "end", span);
      if (next !== null) return next;
    }
  }
  return null;
}

// ── Editing ──

/**
 * Removes a widget's (last) tile; the sibling before it, or else after it,
 * takes its space, which undoes an insert. Null when it was the only tile.
 */
export function removeTile(
  layout: ProjectWorkspaceLayout,
  widgetId: WidgetId,
): ProjectWorkspaceLayout | null {
  const path = findTile(layout.root, widgetId);
  if (path === null) return layout;
  if (path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1]!;
  const parent = nodeAt(layout.root, parentPath) as Split;
  const removed = parent.children[index]!;
  const children = [...parent.children];
  const heir = index > 0 ? index - 1 : index + 1;
  const heirNode = children[heir]!;
  children[heir] = {
    ...adjustEdge(heirNode, parent.axis, heir > index ? "start" : "end", removed.span),
    span: heirNode.span + removed.span,
  };
  children.splice(index, 1);
  return withRoot(layout, replaceAt(layout.root, parentPath, { ...parent, children }));
}

export function swapTiles(
  layout: ProjectWorkspaceLayout,
  a: WidgetId,
  b: WidgetId,
): ProjectWorkspaceLayout {
  if (a === b) return layout;
  const swap = (node: LayoutNode): LayoutNode => {
    if (node.type === "split") return { ...node, children: node.children.map(swap) };
    if (node.widgetId === a) return { ...node, widgetId: b };
    if (node.widgetId === b) return { ...node, widgetId: a };
    return node;
  };
  return { ...layout, root: swap(layout.root) };
}

/** How far, in tracks, a gap can move each way before a tile hits its minimum. */
export function gutterRange(
  layout: ProjectWorkspaceLayout,
  gutter: Pick<Gutter, "path" | "index">,
): { readonly min: number; readonly max: number } {
  const split = nodeAt(layout.root, gutter.path);
  if (split?.type !== "split") return { min: 0, max: 0 };
  const before = split.children[gutter.index];
  const after = split.children[gutter.index + 1];
  if (before === undefined || after === undefined) return { min: 0, max: 0 };
  return {
    min: -(before.span - minExtent(before, split.axis)),
    max: after.span - minExtent(after, split.axis),
  };
}

/**
 * Moves a gap by `delta` tracks: the tile before it grows and the one after
 * shrinks (or the reverse). Only tiles touching the gap change size.
 */
export function resizeGutter(
  layout: ProjectWorkspaceLayout,
  gutter: Pick<Gutter, "path" | "index">,
  delta: number,
): ProjectWorkspaceLayout {
  const range = gutterRange(layout, gutter);
  const step = Math.max(range.min, Math.min(range.max, Math.round(delta)));
  if (step === 0) return layout;
  const split = nodeAt(layout.root, gutter.path) as Split;
  const children = [...split.children];
  const before = children[gutter.index]!;
  const after = children[gutter.index + 1]!;
  children[gutter.index] = {
    ...adjustEdge(before, split.axis, "end", step),
    span: before.span + step,
  };
  children[gutter.index + 1] = {
    ...adjustEdge(after, split.axis, "start", -step),
    span: after.span - step,
  };
  return withRoot(layout, replaceAt(layout.root, gutter.path, { ...split, children }));
}

/** Makes the two tiles beside a gap the same size, as near as the grid allows. */
export function evenGutter(
  layout: ProjectWorkspaceLayout,
  gutter: Pick<Gutter, "path" | "index">,
): ProjectWorkspaceLayout {
  const split = nodeAt(layout.root, gutter.path);
  if (split?.type !== "split") return layout;
  const before = split.children[gutter.index];
  const after = split.children[gutter.index + 1];
  if (before === undefined || after === undefined) return layout;
  const target = Math.floor((before.span + after.span) / 2);
  return resizeGutter(layout, gutter, target - before.span);
}

/** Every split shares its space equally among its children. */
export function evenOutLayout(layout: ProjectWorkspaceLayout): ProjectWorkspaceLayout {
  const even = (node: LayoutNode, w: number, h: number): LayoutNode => {
    if (node.type === "tile") return node;
    const extent = node.axis === "row" ? w : h;
    const spans = distribute(
      extent,
      node.children.map(() => 1),
      node.children.map((child) => minExtent(child, node.axis)),
    );
    return {
      ...node,
      children: node.children.map((child, index) => ({
        ...(node.axis === "row" ? even(child, spans[index]!, h) : even(child, w, spans[index]!)),
        span: spans[index]!,
      })),
    };
  };
  return { ...layout, root: even(layout.root, layout.columns, layout.rows) };
}

export type DropZone = "center" | Edge;

/** Which part of a tile a pointer is over: near an edge splits that side, the middle swaps. */
export function dropZoneAt(
  point: { readonly x: number; readonly y: number },
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
): DropZone {
  const fx = (point.x - rect.left) / rect.width;
  const fy = (point.y - rect.top) / rect.height;
  const distances: ReadonlyArray<readonly [Edge, number]> = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  const [edge, distance] = distances.reduce((nearest, entry) =>
    entry[1] < nearest[1] ? entry : nearest,
  );
  return distance < EDGE_ZONE ? edge : "center";
}

/** The outer share of a tile, per side, that splits rather than swaps. */
const EDGE_ZONE = 0.25;

/**
 * Drops a dragged tile on another: the middle swaps them; an edge splits the
 * target and puts the dragged tile on that side. Null when it cannot fit.
 */
export function dropTile(
  layout: ProjectWorkspaceLayout,
  dragged: WidgetId,
  target: WidgetId,
  zone: DropZone,
): ProjectWorkspaceLayout | null {
  if (dragged === target) return null;
  if (zone === "center") return swapTiles(layout, dragged, target);
  const without = removeTile(layout, dragged);
  if (without === null) return null;
  const rect = layoutRects(without).find((entry) => entry.widgetId === target);
  if (rect === undefined) return null;
  const axis: Axis = zone === "left" || zone === "right" ? "row" : "column";
  const extent = axis === "row" ? rect.w : rect.h;
  if (extent < MIN_SPAN * 2) return null;
  const side = zone === "left" || zone === "top" ? "start" : "end";
  return splitTile(without, target, dragged, axis, side, Math.floor(extent / 2));
}

/**
 * Drops a dragged tile on the board's outer edge: it becomes a strip along
 * that whole side and everything else shrinks to make room.
 */
export function dropOnBoardEdge(
  layout: ProjectWorkspaceLayout,
  dragged: WidgetId,
  edge: Edge,
): ProjectWorkspaceLayout | null {
  const without = removeTile(layout, dragged);
  if (without === null) return null;
  const axis: Axis = edge === "left" || edge === "right" ? "row" : "column";
  const extent = axis === "row" ? layout.columns : layout.rows;
  const minRest = minExtent(without.root, axis);
  const span = Math.min(axis === "row" ? COMFORTABLE_COLUMNS : 2, extent - minRest);
  if (span < MIN_SPAN) return null;
  const rest = fit(without.root, axis, extent - span);
  const tile: LayoutNode = { type: "tile", widgetId: dragged, span };
  const restChildren =
    rest.type === "split" && rest.axis === axis
      ? rest.children
      : [{ ...rest, span: extent - span }];
  const children =
    edge === "left" || edge === "top" ? [tile, ...restChildren] : [...restChildren, tile];
  return withRoot(without, { type: "split", axis, span: 1, children });
}

/** The tile next to one, in a direction, sharing the longest edge with it. */
export function neighbourTile(
  layout: ProjectWorkspaceLayout,
  widgetId: WidgetId,
  edge: Edge,
): WidgetId | null {
  const rects = layoutRects(layout);
  const from = rects.find((rect) => rect.widgetId === widgetId);
  if (from === undefined) return null;
  let best: { readonly id: WidgetId; readonly overlap: number } | null = null;
  for (const rect of rects) {
    const touches =
      edge === "left"
        ? rect.x + rect.w === from.x
        : edge === "right"
          ? rect.x === from.x + from.w
          : edge === "top"
            ? rect.y + rect.h === from.y
            : rect.y === from.y + from.h;
    if (!touches) continue;
    const overlap =
      edge === "left" || edge === "right"
        ? Math.min(rect.y + rect.h, from.y + from.h) - Math.max(rect.y, from.y)
        : Math.min(rect.x + rect.w, from.x + from.w) - Math.max(rect.x, from.x);
    if (overlap > 0 && (best === null || overlap > best.overlap)) {
      best = { id: rect.widgetId, overlap };
    }
  }
  return best?.id ?? null;
}

// ── Tree helpers ──

/**
 * Splits a tile in two along an axis; the new tile takes `span` tracks on
 * `side`. Joins the parent split when it already runs along that axis.
 */
function splitTile(
  layout: ProjectWorkspaceLayout,
  target: WidgetId,
  widgetId: WidgetId,
  axis: Axis,
  side: "start" | "end",
  span: number,
): ProjectWorkspaceLayout | null {
  const path = findTile(layout.root, target);
  if (path === null) return null;
  const rect = layoutRects(layout).find((entry) => entry.widgetId === target)!;
  const extent = axis === "row" ? rect.w : rect.h;
  if (span < MIN_SPAN || extent - span < MIN_SPAN) return null;
  const existing = nodeAt(layout.root, path) as Extract<LayoutNode, { type: "tile" }>;
  const added: LayoutNode = { type: "tile", widgetId, span };
  const kept: LayoutNode = { ...existing, span: extent - span };
  const pair = side === "start" ? [added, kept] : [kept, added];

  const parentPath = path.slice(0, -1);
  const parent = path.length === 0 ? null : (nodeAt(layout.root, parentPath) as Split);
  if (parent !== null && parent.axis === axis) {
    const index = path[path.length - 1]!;
    const children = [...parent.children];
    children.splice(index, 1, ...pair);
    return withRoot(layout, replaceAt(layout.root, parentPath, { ...parent, children }));
  }
  const split: LayoutNode = { type: "split", axis, span: existing.span, children: pair };
  return withRoot(layout, replaceAt(layout.root, path, split));
}

/**
 * Changes a node's size along an axis by `delta` tracks at one edge. Growth
 * goes to the child on that edge; shrinking takes from that child down to its
 * minimum, then the next. The caller keeps `delta` within range and sets the
 * node's own span.
 */
function adjustEdge(
  node: LayoutNode,
  axis: Axis,
  edge: "start" | "end",
  delta: number,
): LayoutNode {
  if (node.type === "tile" || delta === 0) return node;
  if (node.axis !== axis) {
    return {
      ...node,
      children: node.children.map((child) => adjustEdge(child, axis, edge, delta)),
    };
  }
  const children = [...node.children];
  const order = children.map((_, index) =>
    edge === "start" ? index : children.length - 1 - index,
  );
  if (delta > 0) {
    const index = order[0]!;
    const child = children[index]!;
    children[index] = { ...adjustEdge(child, axis, edge, delta), span: child.span + delta };
    return { ...node, children };
  }
  let remaining = -delta;
  for (const index of order) {
    if (remaining === 0) break;
    const child = children[index]!;
    const take = Math.min(remaining, child.span - minExtent(child, axis));
    if (take <= 0) continue;
    children[index] = { ...adjustEdge(child, axis, edge, -take), span: child.span - take };
    remaining -= take;
  }
  return { ...node, children };
}

/** Rescales a node to a new size along an axis, keeping its children's proportions. */
function fit(node: LayoutNode, axis: Axis, extent: number): LayoutNode {
  if (node.type === "tile") return node;
  if (node.axis !== axis) {
    return { ...node, children: node.children.map((child) => fit(child, axis, extent)) };
  }
  const spans = distribute(
    extent,
    node.children.map((child) => child.span),
    node.children.map((child) => minExtent(child, axis)),
  );
  return {
    ...node,
    children: node.children.map((child, index) => ({
      ...fit(child, axis, spans[index]!),
      span: spans[index]!,
    })),
  };
}

/**
 * Splits `total` whole tracks by weight, largest remainders first, then lifts
 * any share below its minimum by taking from the roomiest. `total` must cover
 * the minimums.
 */
export function distribute(
  total: number,
  weights: ReadonlyArray<number>,
  mins: ReadonlyArray<number>,
): ReadonlyArray<number> {
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const exact = weights.map((weight) =>
    weightSum === 0 ? total / weights.length : (total * weight) / weightSum,
  );
  const spans = exact.map(Math.floor);
  let left = total - spans.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (left === 0) break;
    spans[index] = spans[index]! + 1;
    left -= 1;
  }
  for (let index = 0; index < spans.length; index++) {
    while (spans[index]! < mins[index]!) {
      let donor = -1;
      for (let other = 0; other < spans.length; other++) {
        if (other === index || spans[other]! <= mins[other]!) continue;
        if (donor === -1 || spans[other]! - mins[other]! > spans[donor]! - mins[donor]!) {
          donor = other;
        }
      }
      if (donor === -1) break;
      spans[donor] = spans[donor]! - 1;
      spans[index] = spans[index]! + 1;
    }
  }
  return spans;
}

/** The path to a widget's last tile. */
function findTile(node: LayoutNode, widgetId: WidgetId): Path | null {
  let found: Path | null = null;
  const walk = (current: LayoutNode, path: Path) => {
    if (current.type === "tile") {
      if (current.widgetId === widgetId) found = path;
      return;
    }
    current.children.forEach((child, index) => walk(child, [...path, index]));
  };
  walk(node, []);
  return found;
}

function nodeAt(node: LayoutNode, path: Path): LayoutNode | undefined {
  let current: LayoutNode | undefined = node;
  for (const index of path) {
    current = current?.type === "split" ? current.children[index] : undefined;
  }
  return current;
}

function replaceAt(node: LayoutNode, path: Path, next: LayoutNode): LayoutNode {
  if (path.length === 0) return next;
  if (node.type === "tile") return node;
  const [index, ...rest] = path;
  return {
    ...node,
    children: node.children.map((child, position) =>
      position === index ? replaceAt(child, rest, next) : child,
    ),
  };
}

function withRoot(layout: ProjectWorkspaceLayout, root: LayoutNode): ProjectWorkspaceLayout {
  return { ...layout, root: normalize(root, root.span) };
}

/** Collapses one-child splits and folds a split into a parent along the same axis. */
function normalize(node: LayoutNode, span: number): LayoutNode {
  if (node.type === "tile") return { ...node, span };
  const children = node.children.flatMap((child) => {
    const next = normalize(child, child.span);
    return next.type === "split" && next.axis === node.axis ? next.children : [next];
  });
  if (children.length === 1) return { ...children[0]!, span };
  return { ...node, span, children };
}
