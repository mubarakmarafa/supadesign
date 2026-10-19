import {
  DEFAULT_PROJECT_WORKSPACE,
  type ProjectWorkspace,
  ProjectWorkspaceWidgetId,
  validateProjectWorkspace,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addWorkspaceWidget,
  figmaEmbedUrl,
  isBoardOnly,
  moveWorkspaceWidget,
  nudgeWorkspaceWidget,
  patchWorkspaceAppearance,
  type PreviewPortCandidate,
  removeWorkspaceWidget,
  resizeWorkspaceWidget,
  previewServerOwner,
  resolvePreviewSelection,
  setWorkspaceWidgetSettings,
  workspaceBackgroundStyle,
} from "./workspaceLogic";

const id = ProjectWorkspaceWidgetId.make;
const ids = (workspace: ProjectWorkspace) => workspace.widgets.map((widget) => widget.id);

function workspaceOf(...kinds: Array<"kanban" | "usage" | "git" | "figma">): ProjectWorkspace {
  return {
    widgets: kinds.map((kind) => ({ id: id(kind), kind, w: 1, h: 1 })),
  };
}

describe("addWorkspaceWidget", () => {
  it("narrows a full-width board so the first widget lands beside it", () => {
    const next = addWorkspaceWidget(DEFAULT_PROJECT_WORKSPACE, "live-preview", id("preview"))!;
    expect(next.widgets).toEqual([
      { id: "kanban", kind: "kanban", w: 3, h: 2 },
      { id: "preview", kind: "live-preview", w: 1, h: 2 },
    ]);
    expect(isBoardOnly(next)).toBe(false);
    expect(validateProjectWorkspace(next)).toEqual([]);
  });

  it("leaves a board the user sized alone once other widgets exist", () => {
    const start: ProjectWorkspace = {
      widgets: [
        { id: id("kanban"), kind: "kanban", w: 4, h: 2 },
        { id: id("usage"), kind: "usage", w: 1, h: 1 },
      ],
    };
    const next = addWorkspaceWidget(start, "git", id("git"))!;
    expect(next.widgets[0]).toEqual(start.widgets[0]);
    expect(ids(next)).toEqual(["kanban", "usage", "git"]);
  });

  it("allows one board, and puts a re-added board first", () => {
    expect(addWorkspaceWidget(DEFAULT_PROJECT_WORKSPACE, "kanban", id("again"))).toBeNull();
    const withoutBoard = removeWorkspaceWidget(workspaceOf("kanban", "usage"), id("kanban"));
    const readded = addWorkspaceWidget(withoutBoard, "kanban", id("board"))!;
    expect(readded.widgets[0]).toEqual({ id: "board", kind: "kanban", w: 3, h: 2 });
    const alone = addWorkspaceWidget({ widgets: [] }, "kanban", id("board"))!;
    expect(isBoardOnly(alone)).toBe(true);
    expect(alone.widgets[0]?.w).toBe(4);
  });

  it("stops at the widget limit", () => {
    const full: ProjectWorkspace = {
      widgets: Array.from({ length: 24 }, (_, index) => ({
        id: id(`usage-${index}`),
        kind: "usage",
        w: 1,
        h: 1,
      })),
    };
    expect(addWorkspaceWidget(full, "git", id("git"))).toBeNull();
  });
});

describe("rearranging", () => {
  it("nudges a widget toward either end and stops there", () => {
    const start = workspaceOf("kanban", "usage", "git");
    expect(ids(nudgeWorkspaceWidget(start, id("git"), "earlier")!)).toEqual([
      "kanban",
      "git",
      "usage",
    ]);
    expect(nudgeWorkspaceWidget(start, id("kanban"), "earlier")).toBeNull();
    expect(nudgeWorkspaceWidget(start, id("git"), "later")).toBeNull();
  });

  it("drops a dragged widget into the slot of the one under it", () => {
    const start = workspaceOf("kanban", "usage", "git", "figma");
    expect(ids(moveWorkspaceWidget(start, id("figma"), id("usage"))!)).toEqual([
      "kanban",
      "figma",
      "usage",
      "git",
    ]);
    expect(ids(moveWorkspaceWidget(start, id("kanban"), id("git"))!)).toEqual([
      "usage",
      "git",
      "kanban",
      "figma",
    ]);
    expect(moveWorkspaceWidget(start, id("git"), id("git"))).toBeNull();
    expect(moveWorkspaceWidget(start, id("gone"), id("git"))).toBeNull();
  });

  it("resizes only the widget asked for", () => {
    const next = resizeWorkspaceWidget(workspaceOf("kanban", "usage"), id("usage"), { w: 2, h: 3 });
    expect(next.widgets.map(({ w, h }) => [w, h])).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });
});

describe("setWorkspaceWidgetSettings", () => {
  it("sets and clears settings without leaving undefined keys behind", () => {
    const pinned = setWorkspaceWidgetSettings(workspaceOf("usage"), id("usage"), {
      previewPort: 5173,
    });
    expect(pinned.widgets[0]).toEqual({
      id: "usage",
      kind: "usage",
      w: 1,
      h: 1,
      previewPort: 5173,
    });
    const cleared = setWorkspaceWidgetSettings(pinned, id("usage"), { previewPort: null });
    expect(cleared.widgets[0]).toEqual({ id: "usage", kind: "usage", w: 1, h: 1 });
    expect(Object.keys(cleared.widgets[0]!)).not.toContain("previewPort");
  });
});

describe("appearance", () => {
  it("patches fields and drops an appearance left empty", () => {
    const tinted = patchWorkspaceAppearance(DEFAULT_PROJECT_WORKSPACE, {
      background: "sand",
      accentColor: "#ff8800",
    });
    expect(tinted.appearance).toEqual({ background: "sand", accentColor: "#ff8800" });
    const reset = patchWorkspaceAppearance(tinted, { background: null, accentColor: null });
    expect(reset).toEqual(DEFAULT_PROJECT_WORKSPACE);
    expect("appearance" in reset).toBe(false);
  });

  it("draws tints and gradients mixed with the theme, and nothing for unknown presets", () => {
    expect(workspaceBackgroundStyle(undefined)).toBeNull();
    expect(workspaceBackgroundStyle({ background: "from-a-newer-client" })).toBeNull();
    expect(workspaceBackgroundStyle({ background: "sand" })?.backgroundColor).toContain(
      "var(--background)",
    );
    expect(workspaceBackgroundStyle({ background: "dusk" })?.backgroundImage).toMatch(
      /^linear-gradient\(135deg, color-mix/,
    );
    expect(
      workspaceBackgroundStyle({ background: "custom", backgroundColor: "#123456" })
        ?.backgroundColor,
    ).toContain("#123456");
  });

  it("only places https images, with quotes encoded", () => {
    expect(
      workspaceBackgroundStyle({ backgroundImageUrl: 'https://img.test/a".png' })?.backgroundImage,
    ).toContain('url("https://img.test/a%22.png")');
    expect(workspaceBackgroundStyle({ backgroundImageUrl: "http://img.test/a.png" })).toBeNull();
  });
});

describe("figmaEmbedUrl", () => {
  it("wraps the pasted link in Figma's embed endpoint", () => {
    expect(figmaEmbedUrl(" https://www.figma.com/proto/abc/Flow?node-id=1-2 ")).toBe(
      "https://www.figma.com/embed?embed_host=supadesign&url=https%3A%2F%2Fwww.figma.com%2Fproto%2Fabc%2FFlow%3Fnode-id%3D1-2",
    );
  });
});

describe("resolvePreviewSelection", () => {
  const port = (overrides: Partial<PreviewPortCandidate> & { port: number }) => ({
    url: `http://localhost:${overrides.port}/`,
    threadTitle: null,
    branch: null,
    ownedByProject: false,
    updatedAtMs: 0,
    processName: null,
    ...overrides,
  });
  const live = { url: "http://localhost:3000/", branch: "feat/hero", threadTitle: "Hero" };

  it("shows the pinned port while it runs, and says so when it stops", () => {
    const ports = [port({ port: 5173, branch: "main" })];
    expect(resolvePreviewSelection({ pinnedPort: 5173, live, ports })).toEqual({
      kind: "port",
      port: 5173,
      url: "http://localhost:5173/",
      branch: "main",
      fallback: false,
    });
    expect(resolvePreviewSelection({ pinnedPort: 4000, live, ports })).toEqual({
      kind: "pinned-missing",
      port: 4000,
    });
  });

  it("follows the live card, then the project's most recently active port", () => {
    const ports = [
      port({ port: 8080 }),
      port({ port: 5174, ownedByProject: true, updatedAtMs: 10, branch: "old" }),
      port({ port: 5175, ownedByProject: true, updatedAtMs: 20, branch: "new" }),
    ];
    expect(resolvePreviewSelection({ pinnedPort: undefined, live, ports })).toEqual({
      kind: "live",
      url: live.url,
      branch: "feat/hero",
    });
    expect(resolvePreviewSelection({ pinnedPort: undefined, live: null, ports })).toMatchObject({
      kind: "port",
      port: 5175,
      branch: "new",
      fallback: true,
    });
    expect(
      resolvePreviewSelection({ pinnedPort: undefined, live: null, ports: [port({ port: 8080 })] }),
    ).toEqual({ kind: "none" });
  });
});

describe("previewServerOwner", () => {
  const threads = [
    { id: "local", worktreePath: null },
    { id: "card", worktreePath: "/wt/card" },
    { id: "nested", worktreePath: "/wt/card/packages/site" },
  ];
  const owner = (terminalThreadId: string | null, cwd: string | null) => {
    const result = previewServerOwner({
      terminalThreadId,
      cwd,
      workspaceRoot: "/repo/portfolio",
      threads,
    });
    return [result.thread?.id ?? null, result.inProject];
  };

  it("ties a server an agent started to the worktree it runs in", () => {
    expect(owner(null, "/wt/card/apps/web")).toEqual(["card", true]);
    expect(owner(null, "/wt/card/packages/site")).toEqual(["nested", true]);
  });

  it("counts a server in the project folder as the project's, without guessing a card", () => {
    expect(owner(null, "/repo/portfolio")).toEqual([null, true]);
    expect(owner(null, "/repo/portfolio-old")).toEqual([null, false]);
    expect(owner(null, null)).toEqual([null, false]);
  });

  it("keeps a terminal's own thread first", () => {
    expect(owner("local", "/wt/card")).toEqual(["local", true]);
    expect(owner("elsewhere", null)).toEqual([null, false]);
  });
});
