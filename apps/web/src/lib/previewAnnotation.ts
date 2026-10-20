import type { PreviewAnnotationPayload } from "@supaterm/contracts";

import type { ComposerImageAttachment } from "../composerDraftStore";
import { dataUrlToFile } from "./imageCompression";

export type PreviewAnnotationCapture =
  /** The crop is ready to attach. */
  | { readonly status: "captured"; readonly file: File }
  /** The pick carried no crop, which is normal for comment-only annotations. */
  | { readonly status: "none" }
  /** The crop could not be decoded. Send the annotation without it. */
  | { readonly status: "failed" };

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

/** Decode Electron's PNG crop locally; fetching a data URL violates desktop connect-src. */
export function capturePreviewAnnotationScreenshot(
  annotation: PreviewAnnotationPayload,
): PreviewAnnotationCapture {
  if (!annotation.screenshot) return { status: "none" };
  try {
    const { dataUrl } = annotation.screenshot;
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
      return { status: "failed" };
    }
    const file = dataUrlToFile(dataUrl, `preview-annotation-${annotation.id}.png`, "image/png");
    return file.size > 0 ? { status: "captured", file } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

/**
 * What one annotation puts into the composer: its citation, and its crop as
 * the image attachment that shares the annotation's id. A crop that can't be
 * decoded is dropped from the citation too, so the prompt never names a
 * screenshot that wasn't sent.
 */
export function previewAnnotationComposerItems(picked: PreviewAnnotationPayload): {
  readonly annotation: PreviewAnnotationPayload;
  readonly image: ComposerImageAttachment | null;
  readonly captureFailed: boolean;
} {
  const capture = capturePreviewAnnotationScreenshot(picked);
  const annotation = capture.status === "failed" ? { ...picked, screenshot: null } : picked;
  const image =
    capture.status === "captured" && annotation.screenshot
      ? ({
          type: "image",
          id: annotation.id,
          name: capture.file.name,
          mimeType: capture.file.type,
          sizeBytes: capture.file.size,
          previewUrl: annotation.screenshot.dataUrl,
          file: capture.file,
        } satisfies ComposerImageAttachment)
      : null;
  return { annotation, image, captureFailed: capture.status === "failed" };
}
