import type { PreviewAnnotationPoint, PreviewAnnotationRect } from "@supaterm/contracts";

/*
 * Geometry for design mode's marks (box, circle, arrow, pen), shared by the
 * desktop preview overlay and the web markup of past progress images so a mark
 * means the same thing on either surface.
 */

const ELLIPSE_SEGMENTS = 48;
const ARROW_HEAD_ANGLE = Math.PI / 7;

/** A closed ellipse inscribed in the box two drag corners span, as one stroke. */
export function ellipsePoints(
  start: PreviewAnnotationPoint,
  end: PreviewAnnotationPoint,
): ReadonlyArray<PreviewAnnotationPoint> {
  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;
  const rx = Math.abs(end.x - start.x) / 2;
  const ry = Math.abs(end.y - start.y) / 2;
  return Array.from({ length: ELLIPSE_SEGMENTS + 1 }, (_, index) => {
    // The last point repeats the first exactly, closing the outline.
    const angle = ((index % ELLIPSE_SEGMENTS) / ELLIPSE_SEGMENTS) * Math.PI * 2;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

/**
 * An arrow from `start` to `end` as one continuous stroke: the shaft, then
 * each side of the head, returning to the tip between them.
 */
export function arrowPoints(
  start: PreviewAnnotationPoint,
  end: PreviewAnnotationPoint,
): ReadonlyArray<PreviewAnnotationPoint> {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) return [start, end];
  const head = Math.min(18, Math.max(8, length / 4));
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const side = (offset: number) => ({
    x: end.x - head * Math.cos(angle + offset),
    y: end.y - head * Math.sin(angle + offset),
  });
  return [start, end, side(ARROW_HEAD_ANGLE), end, side(-ARROW_HEAD_ANGLE)];
}

/** Straight segments through the points, so drawn shapes keep their corners. */
export function polylinePath(points: ReadonlyArray<PreviewAnnotationPoint>): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

/** A shape smaller than this in both directions is treated as a stray click. */
export function isDeliberateShape(
  start: PreviewAnnotationPoint,
  end: PreviewAnnotationPoint,
): boolean {
  return Math.abs(end.x - start.x) >= 6 || Math.abs(end.y - start.y) >= 6;
}

/** A smoothed pen stroke through the points, as a path. */
export function smoothPath(points: ReadonlyArray<PreviewAnnotationPoint>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y} l 0.01 0.01`;
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]!;
    const next = points[index + 1]!;
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  const last = points[points.length - 1]!;
  path += ` L ${last.x} ${last.y}`;
  return path;
}

/** The box a stroke of `width` covers, with room for its round caps. */
export function strokeBounds(
  points: ReadonlyArray<PreviewAnnotationPoint>,
  width: number,
): PreviewAnnotationRect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const padding = width + 3;
  const left = Math.min(...xs) - padding;
  const top = Math.min(...ys) - padding;
  const right = Math.max(...xs) + padding;
  const bottom = Math.max(...ys) + padding;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The box two drag corners span, whichever way the drag went. */
export function normalizeRect(
  start: PreviewAnnotationPoint,
  end: PreviewAnnotationPoint,
): PreviewAnnotationRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** A dragged box big enough to be a region rather than a click. */
export function isUsableRect(rect: PreviewAnnotationRect): boolean {
  return rect.width >= 3 && rect.height >= 3;
}

/**
 * The box around every mark, grown by `padding` and kept inside `frame` (the
 * viewport, or the image being marked up): the screenshot an annotation
 * carries. Null without marks.
 */
export function unionRects(
  rects: ReadonlyArray<PreviewAnnotationRect>,
  frame: { readonly width: number; readonly height: number },
  padding = 20,
): PreviewAnnotationRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const x = Math.max(0, left - padding);
  const y = Math.max(0, top - padding);
  const maxWidth = Math.max(1, frame.width - x);
  const maxHeight = Math.max(1, frame.height - y);
  return {
    x,
    y,
    width: Math.min(maxWidth, right - left + padding * 2),
    height: Math.min(maxHeight, bottom - top + padding * 2),
  };
}
