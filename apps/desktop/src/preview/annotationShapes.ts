import type { PreviewAnnotationPoint } from "@supaterm/contracts";

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
