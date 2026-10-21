import {
  DEFAULT_CLIENT_SETTINGS,
  type PreviewOpenInput,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { __setClientSettingsForTests } from "~/hooks/useSettings";
import {
  selectThreadPreviewMiniPlayerTabId,
  usePreviewMiniPlayerStore,
} from "~/previewMiniPlayerStore";
import { applyPreviewServerSnapshot, resetPreviewStateForTests } from "~/previewStateStore";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";

import { findPreviewTabForOrigin, floatPreviewTab, openUrlInPreview } from "./openFileInPreview";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot = (
  tabId: string,
  navStatus: PreviewSessionSnapshot["navStatus"],
): PreviewSessionSnapshot => ({
  threadId: threadRef.threadId,
  tabId,
  navStatus,
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-21T19:00:00.000Z",
});

const nav = (tag: "Loading" | "Success", url: string) =>
  ({ _tag: tag, url, title: "Page" }) as PreviewSessionSnapshot["navStatus"];

const floatingTab = () =>
  selectThreadPreviewMiniPlayerTabId(usePreviewMiniPlayerStore.getState().byThreadKey, threadRef);
const dockedSurface = () =>
  selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef);

beforeEach(() => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
  usePreviewMiniPlayerStore.setState({ byThreadKey: {}, closedGeometryByThreadKey: {} });
});

describe("findPreviewTabForOrigin", () => {
  it("returns the tab already on that server, wherever the designer navigated in it", () => {
    applyPreviewServerSnapshot(threadRef, snapshot("docs", nav("Success", "https://example.com/")));
    applyPreviewServerSnapshot(
      threadRef,
      snapshot("app", nav("Success", "http://localhost:5173/settings/team")),
    );
    expect(findPreviewTabForOrigin(threadRef, "http://localhost:5173/")).toBe("app");
    expect(findPreviewTabForOrigin(threadRef, "http://localhost:3000/")).toBeNull();
  });

  it("skips a tab that failed to load, which would float as nothing", () => {
    applyPreviewServerSnapshot(
      threadRef,
      snapshot("app", {
        ...nav("Success", "http://localhost:5173/"),
        _tag: "LoadFailed",
        code: -102,
        description: "Connection refused",
      } as PreviewSessionSnapshot["navStatus"]),
    );
    expect(findPreviewTabForOrigin(threadRef, "http://localhost:5173/")).toBeNull();
  });
});

describe("floating a live page", () => {
  it("takes a docked tab out of the right panel", () => {
    useRightPanelStore.getState().openBrowser(threadRef, "app");
    expect(dockedSurface()).toMatchObject({ kind: "preview", resourceId: "app" });

    floatPreviewTab(threadRef, "app");

    expect(floatingTab()).toBe("app");
    expect(dockedSurface()).toBeNull();
  });

  it("opens a new page floating rather than docked", async () => {
    const openPreview = vi.fn(async (_input: PreviewOpenInput) =>
      AsyncResult.success(snapshot("new", nav("Loading", "http://localhost:5173/"))),
    );

    await openUrlInPreview({
      threadRef,
      url: "http://localhost:5173/",
      openPreview: ({ input }) => openPreview(input),
      floating: true,
    });

    expect(floatingTab()).toBe("new");
    expect(dockedSurface()).toBeNull();
  });
});
