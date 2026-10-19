import type { AssetResource, ScopedThreadRef, ThreadProgressUpdate } from "@supaterm/contracts";

import { useComposerDraftStore } from "../../composerDraftStore";
import { readFileAsDataUrl } from "../../lib/imageCompression";
import { randomUUID } from "../../lib/utils";

/** The signed-URL request for a progress image, with its real name and type. */
export function progressImageResource(update: ThreadProgressUpdate): AssetResource {
  return {
    _tag: "attachment",
    attachmentId: update.image.id,
    fileName: update.image.name,
    mimeType: update.image.mimeType,
  };
}

/**
 * Puts a progress image into the thread's composer so the designer can reply
 * to exactly what they saw. Throws when the image can't be read or the
 * composer is full.
 */
export async function addProgressImageToComposer(
  threadRef: ScopedThreadRef,
  imageUrl: string,
): Promise<void> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("The image could not be loaded.");
  const blob = await response.blob();
  const file = new File([blob], "progress.jpg", { type: blob.type || "image/jpeg" });
  const dataUrl = await readFileAsDataUrl(file);
  const id = randomUUID();
  const store = useComposerDraftStore.getState();
  const added = store.addImage(threadRef, {
    type: "image",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: dataUrl,
    file,
  });
  if (!added) throw new Error("Remove an attachment, then try again.");
  const persisted = store.getComposerDraft(threadRef)?.persistedAttachments ?? [];
  await store.syncPersistedAttachments(threadRef, [
    ...persisted,
    { id, name: file.name, mimeType: file.type, sizeBytes: file.size, dataUrl },
  ]);
}
