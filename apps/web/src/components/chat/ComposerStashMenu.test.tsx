// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId } from "@supaterm/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ComposerStashMenu } from "./ComposerStashMenu";

describe("ComposerStashMenu", () => {
  it("shows saved image thumbnails and incomplete image states", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[
          {
            id: "with-images",
            createdAt: new Date(0).toISOString(),
            prompt: "Compare these screenshots",
            attachments: [
              {
                id: "image-one",
                name: "before.png",
                mimeType: "image/png",
                sizeBytes: 128,
                dataUrl: "data:image/png;base64,AA==",
              },
            ],
            droppedImageNames: ["after.png"],
            unreadableImageNames: [],
            pendingImageCount: 0,
          },
          {
            id: "saving-images",
            createdAt: new Date(0).toISOString(),
            prompt: "Save this image",
            attachments: [],
            droppedImageNames: [],
            unreadableImageNames: [],
            pendingImageCount: 1,
          },
        ]}
        stashShortcutLabel="Ctrl+S"
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain('src="data:image/png;base64,AA=="');
    expect(markup).toContain("1 image dropped");
    expect(markup).toContain("saving 1 image");
  });

  it("labels mixed file and image stashes without treating images as files", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[
          {
            id: "mixed-attachments",
            createdAt: new Date(0).toISOString(),
            prompt: "",
            attachments: [
              {
                id: "image-one",
                name: "before.png",
                mimeType: "image/png",
                sizeBytes: 128,
                dataUrl: "data:image/png;base64,AA==",
              },
            ],
            files: [
              {
                id: "file-one",
                name: "report.pdf",
                mimeType: "application/pdf",
                sizeBytes: 42,
                attachmentId: "pending-report-pdf",
                environmentId: EnvironmentId.make("environment-1"),
              },
            ],
            droppedImageNames: [],
          },
        ]}
        stashShortcutLabel={null}
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("(2 attachments)");
    expect(markup).not.toContain("(2 files)");
  });

  describe("deleting", () => {
    let root: Root;
    let container: HTMLDivElement;

    beforeEach(() => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.useFakeTimers({ now: 0 });
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    });

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("deletes on a second press and lets Escape cancel the delete before closing", () => {
      const onDelete = vi.fn();
      const onClose = vi.fn();
      act(() =>
        root.render(
          <ComposerStashMenu
            entries={[
              {
                id: "entry",
                createdAt: new Date(0).toISOString(),
                prompt: "Keep this prompt",
                attachments: [],
                droppedImageNames: [],
              },
            ]}
            stashShortcutLabel={null}
            onRestore={() => {}}
            onDelete={onDelete}
            onClose={onClose}
          />,
        ),
      );
      const deleteButton = () =>
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="Delete stashed prompt"], button[aria-label="Confirm delete"]',
        )!;
      const escape = () =>
        act(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        });

      act(() => deleteButton().click());
      expect(deleteButton().getAttribute("aria-label")).toBe("Confirm delete");
      escape();
      expect(onClose).not.toHaveBeenCalled();
      expect(deleteButton().getAttribute("aria-label")).toBe("Delete stashed prompt");
      escape();
      expect(onClose).toHaveBeenCalledOnce();

      act(() => deleteButton().click());
      act(() => vi.advanceTimersByTime(500));
      act(() => deleteButton().click());
      expect(onDelete).toHaveBeenCalledOnce();
    });
  });
});
