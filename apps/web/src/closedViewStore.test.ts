import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  type EnvironmentId,
  INCOGNITO_BROWSER_PROFILE_ID,
  type PreviewSessionSnapshot,
  ThreadId,
} from "@supaterm/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useClosedViewStore } from "./closedViewStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-2" as EnvironmentId, ThreadId.make("thread-A"));
const diff = (threadRef: typeof refA) =>
  ({ kind: "panel-tab", threadRef, surface: { kind: "diff", id: "diff" } }) as const;

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
});

const snapshot: PreviewSessionSnapshot = {
  threadId: refA.threadId,
  tabId: "private-tab",
  profileId: INCOGNITO_BROWSER_PROFILE_ID,
  navStatus: { _tag: "Success", url: "https://private.example", title: "Private page" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-06T17:00:00.000Z",
};

describe("closedViewStore", () => {
  it("keeps private tabs available in memory without saving their metadata", async () => {
    const store = useClosedViewStore.getState();
    const publicId = store.remember(diff(refA));
    const privateId = store.remember({ kind: "browser", threadRef: refA, snapshot });
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([
      privateId,
      publicId,
    ]);
    const { storage, name } = useClosedViewStore.persist.getOptions();
    const saved = JSON.stringify(await storage!.getItem(name!));
    expect(saved).not.toContain("private.example");
    expect(saved).not.toContain("Private page");
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([publicId]);
  });

  it("keeps newest first, moves a re-closed tab to the front, and caps at 20", () => {
    const store = useClosedViewStore.getState();
    store.remember(diff(refA));
    store.remember(diff(refB));
    store.remember(diff(refA));
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { threadRef: refA },
      { threadRef: refB },
    ]);

    for (let index = 0; index < 24; index++) {
      store.remember({
        kind: "panel-tab",
        threadRef: refA,
        surface: {
          kind: "file",
          id: `file:${index}`,
          relativePath: `${index}.ts`,
          revealLine: null,
          revealRequestId: 0,
        },
      });
    }
    const entries = useClosedViewStore.getState().entries;
    expect(entries).toHaveLength(20);
    expect(entries[0]).toMatchObject({ surface: { id: "file:23" } });
  });
});
