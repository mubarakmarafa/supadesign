import { ProjectId, ThreadId } from "@supaterm/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  parsePersistedState,
  PERSISTED_STATE_KEY,
  type PersistedUiState,
  persistState,
  reorderProjects,
  setDefaultAdvertisedEndpointKey,
  setSidebarProjectScopeKey,
  setThreadChangedFilesExpanded,
  type UiState,
} from "./uiStateStore";

function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
    projectOrder: [],
    sidebarProjectScopeKey: null,
    threadChangedFilesExpandedById: {},
    defaultAdvertisedEndpointKey: null,
    pullRequestMergeMethod: "merge",
    ...overrides,
  };
}

describe("uiStateStore pure functions", () => {
  it("reorders from the current atom-derived project order", () => {
    const project1 = ProjectId.make("project-1");
    const project2 = ProjectId.make("project-2");
    const project3 = ProjectId.make("project-3");
    const currentOrder = [project1, project2, project3];

    const next = reorderProjects(makeUiState(), currentOrder, [project1], [project3]);

    expect(next.projectOrder).toEqual([project2, project3, project1]);
  });

  it("moves grouped project members together", () => {
    const keyALocal = "env-local:proj-a";
    const keyARemote = "env-remote:proj-a";
    const keyB = "env-local:proj-b";
    const keyC = "env-local:proj-c";
    const currentOrder = [keyALocal, keyARemote, keyB, keyC];

    const next = reorderProjects(makeUiState(), currentOrder, [keyALocal, keyARemote], [keyC]);

    expect(next.projectOrder).toEqual([keyB, keyC, keyALocal, keyARemote]);
  });

  it("does not reorder missing or identical groups", () => {
    const currentOrder = ["env-local:proj-a", "env-local:proj-b"];
    const state = makeUiState();

    expect(reorderProjects(state, currentOrder, ["env-local:missing"], ["env-local:proj-b"])).toBe(
      state,
    );
    expect(reorderProjects(state, currentOrder, ["env-local:proj-a"], ["env-local:proj-a"])).toBe(
      state,
    );
  });

  it("stores explicit changed-file expansion choices", () => {
    const threadId = ThreadId.make("thread-1");
    const collapsed = setThreadChangedFilesExpanded(makeUiState(), threadId, "turn-1", false);

    expect(collapsed.threadChangedFilesExpandedById).toEqual({
      [threadId]: {
        "turn-1": false,
      },
    });
    expect(
      setThreadChangedFilesExpanded(collapsed, threadId, "turn-1", true)
        .threadChangedFilesExpandedById,
    ).toEqual({
      [threadId]: {
        "turn-1": true,
      },
    });
  });

  it("stores the endpoint preference by stable key", () => {
    const next = setDefaultAdvertisedEndpointKey(makeUiState(), "desktop-core:lan:http");

    expect(next.defaultAdvertisedEndpointKey).toBe("desktop-core:lan:http");
    expect(setDefaultAdvertisedEndpointKey(next, "desktop-core:lan:http")).toBe(next);
    expect(setDefaultAdvertisedEndpointKey(next, "")).toMatchObject({
      defaultAdvertisedEndpointKey: null,
    });
  });

  it("stores the sidebar project scope and resets it to all projects", () => {
    const scoped = setSidebarProjectScopeKey(makeUiState(), "github.com/supabitapp/supacode-next");

    expect(scoped.sidebarProjectScopeKey).toBe("github.com/supabitapp/supacode-next");
    expect(setSidebarProjectScopeKey(scoped, "github.com/supabitapp/supacode-next")).toBe(scoped);
    expect(setSidebarProjectScopeKey(scoped, null).sidebarProjectScopeKey).toBeNull();
    expect(setSidebarProjectScopeKey(scoped, "").sidebarProjectScopeKey).toBeNull();
  });
});

describe("parsePersistedState", () => {
  it("hydrates the last selected pull request merge method", () => {
    const parsed = parsePersistedState({
      pullRequestMergeMethod: "squash",
    });
    const invalid = parsePersistedState({
      pullRequestMergeMethod: "fast-forward",
    });

    expect(parsed.pullRequestMergeMethod).toBe("squash");
    expect(invalid.pullRequestMergeMethod).toBe("merge");
  });

  it("hydrates raw UI-owned state without server entities", () => {
    const parsed = parsePersistedState({
      projectOrder: ["physical-b", "", "physical-a", "physical-b"],
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
    });

    expect(parsed).toEqual({
      projectOrder: ["physical-b", "physical-a"],
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      sidebarProjectScopeKey: null,
      pullRequestMergeMethod: "merge",
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
    });
  });
});

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => {
      store.clear();
    },
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("uiStateStore persistence", () => {
  let localStorageStub: Storage;

  beforeEach(() => {
    localStorageStub = createLocalStorageStub();
    vi.stubGlobal("window", { localStorage: localStorageStub });
    vi.stubGlobal("localStorage", localStorageStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists UI-owned preferences", () => {
    const state = makeUiState({
      projectOrder: ["physical-b", "physical-a"],
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
    });

    persistState(state);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    expect(persisted).toEqual({
      projectOrder: ["physical-b", "physical-a"],
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      sidebarProjectScopeKey: null,
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
      pullRequestMergeMethod: "merge",
    });
    expect(parsePersistedState(persisted)).toEqual({
      ...state,
    });
  });

  it("restores the sidebar project scope across reloads", () => {
    persistState(makeUiState({ sidebarProjectScopeKey: "github.com/supabitapp/supacode-next" }));

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;

    expect(parsePersistedState(persisted).sidebarProjectScopeKey).toBe(
      "github.com/supabitapp/supacode-next",
    );
  });
});
