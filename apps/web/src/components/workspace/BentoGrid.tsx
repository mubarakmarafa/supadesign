import type {
  ProjectWorkspaceLayout,
  ProjectWorkspaceWidget,
  ProjectWorkspaceWidgetId,
} from "@supaterm/contracts";
import {
  createContext,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { cn } from "~/lib/utils";
import {
  dropOnBoardEdge,
  dropTile,
  dropZoneAt,
  type Edge,
  evenGutter,
  type Gutter,
  gutterRange,
  layoutGutters,
  layoutRects,
  neighbourTile,
  resizeGutter,
  swapTiles,
  type TileRect,
} from "./bentoLayout";

/**
 * The workspace's bento: tiles on one CSS grid that fills the board. Each
 * tile is a direct child of the grid and keeps its DOM position for life, so
 * moving or resizing it only changes its `grid-area` and embedded previews
 * never reload. Below `md` the tiles stack and scroll instead.
 */
export function BentoGrid({
  widgets,
  layout,
  canArrange,
  commitLayout,
  renderWidget,
}: {
  widgets: ReadonlyArray<ProjectWorkspaceWidget>;
  layout: ProjectWorkspaceLayout;
  canArrange: boolean;
  commitLayout: (layout: ProjectWorkspaceLayout) => void;
  renderWidget: (widget: ProjectWorkspaceWidget) => ReactNode;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const endInteraction = useRef<(() => void) | null>(null);
  /** The arrangement while a gap is being dragged, before it is saved. */
  const [draft, setDraft] = useState<{ layout: ProjectWorkspaceLayout; gutter: string } | null>(
    null,
  );
  const [tileDrag, setTileDrag] = useState<TileDrag | null>(null);
  const [maximized, setMaximized] = useState<ProjectWorkspaceWidgetId | null>(null);

  const shown = draft?.layout ?? layout;
  const rects = layoutRects(shown);
  const rectById = new Map(rects.map((rect) => [rect.widgetId, rect]));
  const readingOrder = new Map(
    [...rects]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((rect, index) => [rect.widgetId, index] as const),
  );
  const maximizedId = maximized !== null && rectById.has(maximized) ? maximized : null;
  const interacting = draft !== null || tileDrag !== null;

  useEffect(() => () => endInteraction.current?.(), []);

  useEffect(() => {
    if (maximizedId === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isEditable(event.target)) return;
      animateTiles(gridRef.current, () => setMaximized(null));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maximizedId]);

  const commit = (next: ProjectWorkspaceLayout, animate: boolean) => {
    if (animate) animateTiles(gridRef.current, () => commitLayout(next));
    else commitLayout(next);
  };

  const startGutterDrag = (gutter: Gutter, event: PointerEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (!canArrange || event.button !== 0 || grid === null) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const trackPx = trackSize(
      grid,
      gutter.axis,
      gutter.axis === "row" ? layout.columns : layout.rows,
    );
    const origin = gutter.axis === "row" ? event.clientX : event.clientY;
    const key = gutterKey(gutter);
    let delta = 0;
    const onMove = (move: globalThis.PointerEvent) => {
      const position = gutter.axis === "row" ? move.clientX : move.clientY;
      const range = gutterRange(layout, gutter);
      const next = Math.max(
        range.min,
        Math.min(range.max, Math.round((position - origin) / trackPx)),
      );
      if (next === delta) return;
      delta = next;
      setDraft({ layout: resizeGutter(layout, gutter, delta), gutter: key });
    };
    const finish = (save: boolean) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      endInteraction.current = null;
      setDraft(null);
      if (save && delta !== 0) commit(resizeGutter(layout, gutter, delta), false);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (key: globalThis.KeyboardEvent) => {
      if (key.key === "Escape") finish(false);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    endInteraction.current = () => finish(false);
    setDraft({ layout, gutter: key });
  };

  const onGutterKeyDown = (gutter: Gutter, event: KeyboardEvent<HTMLDivElement>) => {
    const back = gutter.axis === "row" ? "ArrowLeft" : "ArrowUp";
    const forward = gutter.axis === "row" ? "ArrowRight" : "ArrowDown";
    if (event.key === back || event.key === forward) {
      event.preventDefault();
      commit(resizeGutter(layout, gutter, event.key === back ? -1 : 1), false);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(evenGutter(layout, gutter), true);
    }
  };

  const startTileDrag = (id: ProjectWorkspaceWidgetId, event: PointerEvent<HTMLElement>) => {
    const grid = gridRef.current;
    if (!canArrange || maximizedId !== null || event.button !== 0 || grid === null) return;
    if ((event.target as Element).closest("button, a, input, textarea, select, [role=menuitem]")) {
      return;
    }
    // Narrow windows stack the tiles; there is no grid to drop onto.
    if (getComputedStyle(grid).display !== "grid") return;
    const header = event.currentTarget;
    header.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    let active = false;
    let current: TileDrag = { id, key: "", result: null, landing: null };
    let tiles: ReadonlyArray<{ id: ProjectWorkspaceWidgetId; box: DOMRect }> = [];

    const onMove = (move: globalThis.PointerEvent) => {
      if (!active) {
        if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < DRAG_THRESHOLD_PX) return;
        active = true;
        tiles = [...grid.querySelectorAll<HTMLElement>("[data-bento-tile]")].map((element) => ({
          id: element.dataset.bentoTile as ProjectWorkspaceWidgetId,
          box: element.getBoundingClientRect(),
        }));
      }
      const next = dropAt(layout, id, { x: move.clientX, y: move.clientY }, grid, tiles);
      if (next.key === current.key && current.key !== "") return;
      current = next;
      setTileDrag(next);
    };
    const finish = (save: boolean) => {
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerup", onUp);
      header.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      endInteraction.current = null;
      setTileDrag(null);
      if (save && active && current.result !== null) commit(current.result, true);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (key: globalThis.KeyboardEvent) => {
      if (key.key === "Escape") finish(false);
    };
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);
    header.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    endInteraction.current = () => finish(false);
  };

  const toggleMaximized = (id: ProjectWorkspaceWidgetId) =>
    animateTiles(gridRef.current, () => setMaximized((current) => (current === id ? null : id)));

  const onTileKeyDown = (id: ProjectWorkspaceWidgetId, event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || !event.altKey) return;
    const edge = ARROW_EDGES[event.key];
    if (edge === undefined) return;
    const neighbour = neighbourTile(layout, id, edge);
    if (neighbour === null) return;
    event.preventDefault();
    if (event.shiftKey && canArrange) {
      commit(swapTiles(layout, id, neighbour), true);
      return;
    }
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-bento-tile="${CSS.escape(neighbour)}"] header`)
      ?.focus();
  };

  // Tiles render in a fixed order so React never moves one in the DOM.
  const ordered = widgets.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return (
    <div
      ref={gridRef}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3",
        "md:grid md:grid-cols-[repeat(var(--bento-columns),minmax(0,1fr))] md:grid-rows-[repeat(var(--bento-rows),minmax(0,1fr))] md:overflow-hidden",
        // Frames swallow pointer events; keep them out of the way while arranging.
        interacting && "[&_iframe]:pointer-events-none",
        tileDrag !== null && "cursor-grabbing",
      )}
      style={{ "--bento-columns": layout.columns, "--bento-rows": layout.rows } as CSSProperties}
    >
      {interacting ? <GridTicks columns={layout.columns} rows={layout.rows} /> : null}
      {ordered.map((widget) => {
        const rect = rectById.get(widget.id);
        if (rect === undefined) return null;
        const isMaximized = maximizedId === widget.id;
        const hidden = maximizedId !== null && !isMaximized;
        return (
          <div
            key={widget.id}
            data-bento-tile={widget.id}
            aria-hidden={hidden || undefined}
            className={cn(
              "flex min-h-80 min-w-0 flex-col md:min-h-0 md:[grid-area:var(--bento-area)]",
              isMaximized && "z-10",
              hidden && "invisible",
            )}
            style={
              {
                "--bento-area": isMaximized ? "1 / 1 / -1 / -1" : gridArea(rect),
                order: readingOrder.get(widget.id),
              } as CSSProperties
            }
          >
            <BentoTileSlot
              widgetId={widget.id}
              canArrange={canArrange}
              dragging={tileDrag?.id === widget.id && tileDrag.key !== ""}
              maximized={isMaximized}
              toggleMaximized={toggleMaximized}
              startDrag={startTileDrag}
              onKeyDown={onTileKeyDown}
            >
              {renderWidget(widget)}
            </BentoTileSlot>
          </div>
        );
      })}
      {canArrange && maximizedId === null
        ? layoutGutters(shown).map((gutter) => (
            <GutterHandle
              key={gutterKey(gutter)}
              gutter={gutter}
              layout={shown}
              active={draft?.gutter === gutterKey(gutter)}
              onPointerDown={(event) => startGutterDrag(gutter, event)}
              onDoubleClick={() => commit(evenGutter(layout, gutter), true)}
              onKeyDown={(event) => onGutterKeyDown(gutter, event)}
            />
          ))
        : null}
      {tileDrag?.landing ? (
        <div
          aria-hidden
          className="pointer-events-none z-20 hidden rounded-xl border-2 border-primary bg-primary/10 md:block md:[grid-area:var(--bento-area)]"
          style={{ "--bento-area": gridArea(tileDrag.landing) } as CSSProperties}
        />
      ) : null}
    </div>
  );
}

interface TileDrag {
  readonly id: ProjectWorkspaceWidgetId;
  /** What the pointer is over, so moves within one drop spot do not re-render. */
  readonly key: string;
  readonly result: ProjectWorkspaceLayout | null;
  /** Where the dragged tile would land. */
  readonly landing: TileRect | null;
}

/** How far a title bar moves before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;
/** Within this distance of the board's outer edge, a drop adds a strip along that side. */
const BOARD_EDGE_PX = 20;

const ARROW_EDGES: Readonly<Record<string, Edge>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "top",
  ArrowDown: "bottom",
};

/** The drop a pointer position would make. */
function dropAt(
  layout: ProjectWorkspaceLayout,
  id: ProjectWorkspaceWidgetId,
  point: { readonly x: number; readonly y: number },
  grid: HTMLElement,
  tiles: ReadonlyArray<{ readonly id: ProjectWorkspaceWidgetId; readonly box: DOMRect }>,
): TileDrag {
  const box = grid.getBoundingClientRect();
  const edges: ReadonlyArray<readonly [Edge, number]> = [
    ["left", point.x - box.left],
    ["right", box.right - point.x],
    ["top", point.y - box.top],
    ["bottom", box.bottom - point.y],
  ];
  const [edge, distance] = edges.reduce((nearest, entry) =>
    entry[1] < nearest[1] ? entry : nearest,
  );
  let key = "none";
  let result: ProjectWorkspaceLayout | null = null;
  if (distance >= 0 && distance < BOARD_EDGE_PX) {
    key = `edge:${edge}`;
    result = dropOnBoardEdge(layout, id, edge);
  } else {
    const over = tiles.find(
      (tile) =>
        tile.id !== id &&
        point.x >= tile.box.left &&
        point.x <= tile.box.right &&
        point.y >= tile.box.top &&
        point.y <= tile.box.bottom,
    );
    if (over !== undefined) {
      const zone = dropZoneAt(point, over.box);
      key = `${over.id}:${zone}`;
      result = dropTile(layout, id, over.id, zone);
    }
  }
  const landing =
    result === null ? null : (layoutRects(result).find((rect) => rect.widgetId === id) ?? null);
  return { id, key, result, landing };
}

function GutterHandle({
  gutter,
  layout,
  active,
  onPointerDown,
  onDoubleClick,
  onKeyDown,
}: {
  gutter: Gutter;
  layout: ProjectWorkspaceLayout;
  active: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const vertical = gutter.axis === "row";
  const range = gutterRange(layout, gutter);
  const area = vertical
    ? `${gutter.start + 1} / ${gutter.line + 1} / span ${gutter.length} / span 1`
    : `${gutter.line + 1} / ${gutter.start + 1} / span 1 / span ${gutter.length}`;
  return (
    // Sits on the track after the gap and reaches back over it, so it needs no measuring.
    <div
      className={cn(
        "relative z-10 hidden md:block md:[grid-area:var(--bento-area)]",
        vertical ? "w-0 justify-self-start" : "h-0 self-start",
      )}
      style={{ "--bento-area": area } as CSSProperties}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label={
          vertical ? "Resize the tiles on either side" : "Resize the tiles above and below"
        }
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-valuemin={0}
        aria-valuemax={range.max - range.min}
        aria-valuenow={-range.min}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        className={cn(
          "group absolute flex touch-none items-center justify-center outline-none",
          vertical
            ? "inset-y-2 -left-[calc(0.375rem+0.5rem)] w-4 cursor-col-resize"
            : "inset-x-2 -top-[calc(0.375rem+0.5rem)] h-4 cursor-row-resize",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "rounded-full bg-primary opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-100",
            vertical ? "h-full max-h-16 w-1" : "h-1 w-full max-w-16",
            active && "opacity-100",
          )}
        />
      </div>
    </div>
  );
}

/** Faint cells showing where edges can snap, only while arranging. */
function GridTicks({ columns, rows }: { columns: number; rows: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-3 hidden gap-3 md:grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: columns * rows }, (_, index) => (
        <div key={index} className="rounded-lg border border-dashed border-foreground/10" />
      ))}
    </div>
  );
}

interface BentoTileContextValue {
  readonly canArrange: boolean;
  readonly dragging: boolean;
  readonly maximized: boolean;
  readonly toggleMaximized: () => void;
  readonly onHeaderPointerDown: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  readonly onHeaderDoubleClick: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  readonly onHeaderKeyDown: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
}

const BentoTileContext = createContext<BentoTileContextValue | null>(null);

function BentoTileSlot({
  widgetId,
  canArrange,
  dragging,
  maximized,
  toggleMaximized,
  startDrag,
  onKeyDown,
  children,
}: {
  widgetId: ProjectWorkspaceWidgetId;
  canArrange: boolean;
  dragging: boolean;
  maximized: boolean;
  toggleMaximized: (id: ProjectWorkspaceWidgetId) => void;
  startDrag: (id: ProjectWorkspaceWidgetId, event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (id: ProjectWorkspaceWidgetId, event: KeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  const value = useMemo<BentoTileContextValue>(
    () => ({
      canArrange,
      dragging,
      maximized,
      toggleMaximized: () => toggleMaximized(widgetId),
      onHeaderPointerDown: (event) => startDrag(widgetId, event),
      onHeaderDoubleClick: (event) => {
        if ((event.target as Element).closest("button, a, input")) return;
        toggleMaximized(widgetId);
      },
      onHeaderKeyDown: (event) => onKeyDown(widgetId, event),
    }),
    [canArrange, dragging, maximized, onKeyDown, startDrag, toggleMaximized, widgetId],
  );
  return <BentoTileContext.Provider value={value}>{children}</BentoTileContext.Provider>;
}

const STANDALONE_TILE: BentoTileContextValue = {
  canArrange: false,
  dragging: false,
  maximized: false,
  toggleMaximized: () => undefined,
  onHeaderPointerDown: undefined,
  onHeaderDoubleClick: undefined,
  onHeaderKeyDown: undefined,
};

/** How a widget frame takes part in the bento; inert outside one. */
export function useBentoTile(): BentoTileContextValue {
  return useContext(BentoTileContext) ?? STANDALONE_TILE;
}

function gridArea(rect: Pick<TileRect, "x" | "y" | "w" | "h">): string {
  return `${rect.y + 1} / ${rect.x + 1} / span ${rect.h} / span ${rect.w}`;
}

function gutterKey(gutter: Pick<Gutter, "path" | "index">): string {
  return `${gutter.path.join(".")}:${gutter.index}`;
}

/** One track plus its share of the gaps, in pixels. */
function trackSize(grid: HTMLElement, axis: "row" | "column", tracks: number): number {
  const style = getComputedStyle(grid);
  const box = grid.getBoundingClientRect();
  const inner =
    axis === "row"
      ? box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      : box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const gap = parseFloat(axis === "row" ? style.columnGap : style.rowGap) || 0;
  return (inner + gap) / tracks;
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { readonly finished: Promise<void> };
};

/**
 * Runs a layout change as a view transition, so tiles glide to their new
 * places once instead of jumping. Skipped when the browser lacks it or the
 * user prefers less motion.
 */
function animateTiles(grid: HTMLElement | null, update: () => void) {
  const transitionDocument = document as TransitionDocument;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (grid === null || reduceMotion || transitionDocument.startViewTransition === undefined) {
    update();
    return;
  }
  // Names only for the length of the transition, so they never clash with another one.
  const tiles = [...grid.querySelectorAll<HTMLElement>("[data-bento-tile]")];
  tiles.forEach((tile, index) => {
    tile.style.viewTransitionName = `bento-tile-${index}`;
  });
  const transition = transitionDocument.startViewTransition(() => flushSync(update));
  void transition.finished.finally(() => {
    for (const tile of tiles) tile.style.viewTransitionName = "";
  });
}
