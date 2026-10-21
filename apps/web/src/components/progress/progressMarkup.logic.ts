import type {
  PreviewAnnotationPayload,
  PreviewAnnotationPoint,
  PreviewAnnotationRect,
  PreviewAnnotationRegionTarget,
  PreviewAnnotationStrokeTarget,
  ThreadProgressUpdate,
} from "@supaterm/contracts";
import {
  arrowPoints,
  ellipsePoints,
  isDeliberateShape,
  isUsableRect,
  normalizeRect,
  strokeBounds,
  unionRects,
} from "@supaterm/shared/annotationShapes";

/**
 * Marking up a past progress image uses design mode's tools and keys, minus
 * Select, which picks page elements an image doesn't have.
 */
export type MarkupTool = "box" | "circle" | "arrow" | "pen" | "erase";

/**
 * The markup palette, after CleanShot's: bright enough to read on most
 * screens, plus black and white for the screens they aren't.
 */
export const MARK_COLORS = [
  { name: "Red", value: "#ff3b30" },
  { name: "Orange", value: "#ff9500" },
  { name: "Yellow", value: "#ffcc00" },
  { name: "Green", value: "#34c759" },
  { name: "Blue", value: "#007aff" },
  { name: "Purple", value: "#af52de" },
  { name: "Black", value: "#1c1c1e" },
  { name: "White", value: "#ffffff" },
] as const;

export const DEFAULT_MARK_COLOR = MARK_COLORS[0].value;

/** A box keeps the color it was drawn in, like every other mark. */
export interface ColoredRegion extends PreviewAnnotationRegionTarget {
  readonly color: string;
}

/** Marks on one image, in the image's own pixels (`update.width` by `update.height`). */
export interface ImageMarks {
  readonly regions: ReadonlyArray<ColoredRegion>;
  readonly strokes: ReadonlyArray<PreviewAnnotationStrokeTarget>;
  /** Pen strokes, drawn smoothed; circles and arrows keep their corners. */
  readonly smoothStrokeIds: ReadonlyArray<string>;
}

export const NO_MARKS: ImageMarks = { regions: [], strokes: [], smoothStrokeIds: [] };

/** Design mode's single-key tool shortcuts. */
export function markupToolForKey(key: string): MarkupTool | null {
  switch (key.toLowerCase()) {
    case "b":
    case "r":
      return "box";
    case "o":
      return "circle";
    case "a":
      return "arrow";
    case "p":
    case "d":
      return "pen";
    case "e":
      return "erase";
    default:
      return null;
  }
}

export function hasMarks(marks: ImageMarks): boolean {
  return marks.regions.length > 0 || marks.strokes.length > 0;
}

/** A mark being drawn, in image pixels. */
export type MarkDraft =
  | {
      readonly tool: "box" | "circle" | "arrow";
      readonly start: PreviewAnnotationPoint;
      readonly end: PreviewAnnotationPoint;
    }
  | { readonly tool: "pen"; readonly points: ReadonlyArray<PreviewAnnotationPoint> };

/** How a new mark looks, in image pixels at the current zoom. */
export interface MarkStyle {
  readonly id: string;
  readonly color: string;
  readonly width: number;
  /** Image pixels per screen pixel, so stray-click thresholds hold on screen. */
  readonly scale: number;
}

/** The stroke a circle, arrow or pen draft draws; a box is a region instead. */
export function draftStroke(
  draft: MarkDraft,
  style: Pick<MarkStyle, "id" | "color" | "width">,
): PreviewAnnotationStrokeTarget | null {
  const points =
    draft.tool === "pen"
      ? draft.points
      : draft.tool === "circle"
        ? ellipsePoints(draft.start, draft.end)
        : draft.tool === "arrow"
          ? arrowPoints(draft.start, draft.end)
          : null;
  if (points === null || points.length === 0) return null;
  return {
    id: style.id,
    color: style.color,
    width: style.width,
    points,
    bounds: strokeBounds(points, style.width),
  };
}

const onScreen = (point: PreviewAnnotationPoint, scale: number) => ({
  x: point.x / scale,
  y: point.y / scale,
});

/** Adds a finished draft, dropping one too small to be deliberate, as design mode does. */
export function commitDraft(marks: ImageMarks, draft: MarkDraft, style: MarkStyle): ImageMarks {
  if (draft.tool === "box") {
    const screenRect = normalizeRect(
      onScreen(draft.start, style.scale),
      onScreen(draft.end, style.scale),
    );
    if (!isUsableRect(screenRect)) return marks;
    const region = {
      id: style.id,
      color: style.color,
      rect: normalizeRect(draft.start, draft.end),
    };
    return { ...marks, regions: [...marks.regions, region] };
  }
  const deliberate =
    draft.tool === "pen"
      ? draft.points.length > 1
      : isDeliberateShape(onScreen(draft.start, style.scale), onScreen(draft.end, style.scale));
  const stroke = deliberate ? draftStroke(draft, style) : null;
  if (stroke === null) return marks;
  return {
    ...marks,
    strokes: [...marks.strokes, stroke],
    smoothStrokeIds:
      draft.tool === "pen" ? [...marks.smoothStrokeIds, stroke.id] : marks.smoothStrokeIds,
  };
}

const contains = (rect: PreviewAnnotationRect, point: PreviewAnnotationPoint) =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

/** Removes the newest mark under `point`, as design mode's eraser does. */
export function eraseMarkAt(marks: ImageMarks, point: PreviewAnnotationPoint): ImageMarks {
  const strokeIndex = marks.strokes.findLastIndex((stroke) => contains(stroke.bounds, point));
  if (strokeIndex >= 0) {
    const removed = marks.strokes[strokeIndex]!.id;
    return {
      ...marks,
      strokes: marks.strokes.toSpliced(strokeIndex, 1),
      smoothStrokeIds: marks.smoothStrokeIds.filter((id) => id !== removed),
    };
  }
  const regionIndex = marks.regions.findLastIndex((region) => contains(region.rect, point));
  if (regionIndex >= 0) return { ...marks, regions: marks.regions.toSpliced(regionIndex, 1) };
  return marks;
}

const NOTE_IN_TITLE_MAX_CHARS = 80;

/** What the agent reads as the annotated page: the capture it came from, and when. */
function progressImageTitle(update: Pick<ThreadProgressUpdate, "createdAt" | "note">) {
  const note = update.note?.trim().replace(/\s+/g, " ") ?? "";
  const shortNote =
    note.length > NOTE_IN_TITLE_MAX_CHARS ? `${note.slice(0, NOTE_IN_TITLE_MAX_CHARS - 1)}…` : note;
  return `Progress image captured ${update.createdAt}${shortNote ? `: ${shortNote}` : ""}`;
}

/**
 * One design-mode annotation of a progress image, without its screenshot yet,
 * and the part of the image that screenshot shows: the marks plus design
 * mode's padding, kept inside the image. Null without marks.
 */
export function progressImageAnnotation(input: {
  readonly id: string;
  readonly update: Pick<ThreadProgressUpdate, "url" | "createdAt" | "note" | "width" | "height">;
  readonly marks: ImageMarks;
  readonly comment: string;
  readonly createdAt: string;
}): {
  readonly annotation: PreviewAnnotationPayload;
  readonly cropRect: PreviewAnnotationRect;
} | null {
  const cropRect = unionRects(
    [
      ...input.marks.regions.map((region) => region.rect),
      ...input.marks.strokes.map((stroke) => stroke.bounds),
    ],
    { width: input.update.width, height: input.update.height },
  );
  if (cropRect === null) return null;
  return {
    annotation: {
      id: input.id,
      pageUrl: input.update.url,
      pageTitle: progressImageTitle(input.update),
      comment: input.comment.trim(),
      elements: [],
      // The agent reads where the boxes are; their colors only matter in the screenshot.
      regions: input.marks.regions.map(({ id, rect }) => ({ id, rect })),
      strokes: input.marks.strokes,
      styleChanges: [],
      screenshot: null,
      createdAt: input.createdAt,
    },
    cropRect,
  };
}
