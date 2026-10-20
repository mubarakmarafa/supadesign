import type { PreviewAnnotationRect, PreviewAnnotationScreenshot } from "@supaterm/contracts";
import { polylinePath, smoothPath } from "@supaterm/shared/annotationShapes";

import type { ImageMarks } from "./progressMarkup.logic";

/** Drawn around every mark so a dark theme color still shows on a dark capture. */
export const MARK_HALO = "rgb(255 255 255 / 0.9)";

/** A stroke's outline as it is drawn on screen: pen strokes smoothed, shapes with their corners. */
export function markStrokePath(marks: ImageMarks, stroke: ImageMarks["strokes"][number]): string {
  return marks.smoothStrokeIds.includes(stroke.id)
    ? smoothPath(stroke.points)
    : polylinePath(stroke.points);
}

/**
 * Draws the cropped part of a progress image with its marks on top, the same
 * picture design mode's screenshot shows of the page. `imageUrl` is fetched as
 * a blob so a cross-origin asset can't taint the canvas.
 */
export async function renderMarkedCrop(input: {
  readonly imageUrl: string;
  /** The image's size in the units marks use. */
  readonly frame: { readonly width: number; readonly height: number };
  readonly marks: ImageMarks;
  readonly cropRect: PreviewAnnotationRect;
  readonly color: string;
  /** A region's outline width, in mark units. */
  readonly regionLineWidth: number;
}): Promise<PreviewAnnotationScreenshot> {
  const response = await fetch(input.imageUrl);
  if (!response.ok) throw new Error("The image could not be loaded.");
  const bitmap = await createImageBitmap(await response.blob());
  try {
    // Captures can be stored at a different density than the size they report.
    const scale = bitmap.width / input.frame.width;
    const { cropRect } = input;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cropRect.width * scale));
    canvas.height = Math.max(1, Math.round(cropRect.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("The image could not be drawn.");
    context.drawImage(
      bitmap,
      cropRect.x * scale,
      cropRect.y * scale,
      cropRect.width * scale,
      cropRect.height * scale,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    context.scale(scale, scale);
    context.translate(-cropRect.x, -cropRect.y);
    context.strokeStyle = input.color;
    context.fillStyle = input.color;
    context.lineCap = "round";
    context.lineJoin = "round";
    // A light halo keeps marks readable on dark captures, matching the screen.
    context.shadowColor = MARK_HALO;
    context.shadowBlur = 3;
    for (const region of input.marks.regions) {
      const { x, y, width, height } = region.rect;
      context.globalAlpha = 0.06;
      context.fillRect(x, y, width, height);
      context.globalAlpha = 1;
      context.lineWidth = input.regionLineWidth;
      context.strokeRect(x, y, width, height);
    }
    for (const stroke of input.marks.strokes) {
      context.lineWidth = stroke.width;
      context.stroke(new Path2D(markStrokePath(input.marks, stroke)));
    }
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      cropRect,
    };
  } finally {
    bitmap.close();
  }
}
