import {
  BOARD_ONLY_PROJECT_WORKSPACE,
  DEFAULT_PROJECT_WORKSPACE,
  type ProjectWorkspace,
  ProjectWorkspaceWidgetId,
  validateProjectWorkspace,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { layoutGutters, layoutRects, resizeGutter, swapTiles } from "./bentoLayout";
import {
  addWorkspaceWidget,
  figmaEmbedUrl,
  isBoardOnly,
  patchWorkspaceAppearance,
  type PreviewPortCandidate,
  previewServerName,
  previewServerOwner,
  removeWorkspaceWidget,
  resetWorkspaceLayout,
  resolvePreviewSelection,
  setWorkspaceWidgetSettings,
  withWorkspaceLayout,
  WORKSPACE_MAX_TILES,
  workspaceBackgroundStyle,
  workspaceLayout,
} from "./workspaceLogic";

const id = ProjectWorkspaceWidgetId.make;
const ids = (workspace: ProjectWorkspace) => workspace.widgets.map((widget) => widget.id);

function workspaceOf(...kinds: Array<"kanban" | "usage" | "git" | "figma">): ProjectWorkspace {
  return {
    widgets: kinds.map((kind) => ({ id: id(kind), kind, w: 1, h: 1 })),
  };
}

describe("addWorkspaceWidget", () => {
  it("puts the first widget a quarter wide beside the board", () => {
    const next = addWorkspaceWidget(BOARD_ONLY_PROJECT_WORKSPACE, "live-preview", id("preview"))!;
    expect(next.widgets).toEqual([
      { id: "kanban", kind: "kanban", w: 3, h: 3 },
      { id: "preview", kind: "live-preview", w: 1, h: 3 },
    ]);
    expect(layoutRects(next.layout!)).toEqual([
      { widgetId: "kanban", x: 0, y: 0, w: 6, h: 6 },
      { widgetId: "preview", x: 6, y: 0, w: 2, h: 6 },
    ]);
    expect(isBoardOnly(next)).toBe(false);
    expect(validateProjectWorkspace(next)).toEqual([]);
  });

  it("keeps a layout the user arranged and only splits the biggest tile", () => {
    const start = addWorkspaceWidget(DEFAULT_PROJECT_WORKSPACE, "git", id("git"))!;
    const next = addWorkspaceWidget(start, "usage", id("usage"))!;
    const agentBefore = layoutRects(start.layout!).find((rect) => rect.widgetId === "board-agent");
    const agentAfter = layoutRects(next.layout!).find((rect) => rect.widgetId === "board-agent");
    expect(agentAfter).toEqual(agentBefore);
    expect(ids(next).toSorted()).toEqual(["board-agent", "git", "kanban", "usage"]);
  });

  it("allows one board and one board agent", () => {
    expect(addWorkspaceWidget(DEFAULT_PROJECT_WORKSPACE, "kanban", id("again"))).toBeNull();
    expect(addWorkspaceWidget(DEFAULT_PROJECT_WORKSPACE, "board-agent", id("again"))).toBeNull();
    const withoutBoard = removeWorkspaceWidget(workspaceOf("kanban", "usage"), id("kanban"));
    expect(addWorkspaceWidget(withoutBoard, "kanban", id("board"))).not.toBeNull();
    const alone = addWorkspaceWidget({ widgets: [] }, "kanban", id("board"))!;
    expect(isBoardOnly(alone)).toBe(true);
  });

  it("stops once everything would no longer fit on one screen", () => {
    let workspace: ProjectWorkspace = DEFAULT_PROJECT_WORKSPACE;
    for (const kind of ["live-preview", "figma", "usage"] as const) {
      workspace = addWorkspaceWidget(workspace, kind, id(kind))!;
    }
    expect(workspace.widgets).toHaveLength(WORKSPACE_MAX_TILES);
    expect(addWorkspaceWidget(workspace, "git", id("git"))).toBeNull();
  });
});

describe("arranging", () => {
  it("removes a widget and gives its space to a neighbour", () => {
    const start = addWorkspaceWidget(DEFAULT_PROJECT_WORKSPACE, "figma", id("figma"))!;
    const next = removeWorkspaceWidget(start, id("figma"));
    expect(ids(next)).toEqual(["kanban", "board-agent"]);
    expect(layoutRects(next.layout!).map((rect) => rect.w)).toEqual([6, 2]);
  });

  it("orders widgets by where they sit, so older clients draw them close", () => {
    const start = addWorkspaceWidget(DEFAULT_PROJECT_WORKSPACE, "figma", id("figma"))!;
    const swapped = withWorkspaceLayout(start, swapTiles(start.layout!, id("kanban"), id("figma")));
    expect(ids(swapped)).toEqual(["figma", "kanban", "board-agent"]);
  });

  it("resets to the default arrangement in reading order", () => {
    const start = addWorkspaceWidget(DEFAULT_PROJECT_WORKSPACE, "figma", id("figma"))!;
    const squeezed = withWorkspaceLayout(
      start,
      resizeGutter(start.layout!, layoutGutters(start.layout!)[0]!, -3),
    );
    expect(resetWorkspaceLayout(squeezed).layout).toEqual(start.layout);
  });

  it("lays out a workspace without a stored layout from its order", () => {
    expect(layoutRects(workspaceLayout(DEFAULT_PROJECT_WORKSPACE)!)).toEqual([
      { widgetId: "kanban", x: 0, y: 0, w: 6, h: 6 },
      { widgetId: "board-agent", x: 6, y: 0, w: 2, h: 6 },
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
    name: `Port ${overrides.port}`,
    threadTitle: null,
    branch: null,
    ownedByProject: false,
    working: false,
    recencyMs: 0,
    startedAt: null,
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

  it("follows the live card, then the project's newest port", () => {
    const ports = [
      port({ port: 8080 }),
      port({ port: 5174, ownedByProject: true, recencyMs: 10, branch: "old" }),
      port({ port: 5175, ownedByProject: true, recencyMs: 20, branch: "new" }),
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

describe("resolvePreviewSelection with a working agent", () => {
  it("prefers the project's server whose agent is working over a newer idle one", () => {
    const base = {
      threadTitle: null,
      ownedByProject: true,
      processName: null,
      name: "web",
      startedAt: null,
    };
    const ports = [
      {
        ...base,
        port: 4173,
        url: "http://localhost:4173/",
        branch: "new",
        working: false,
        recencyMs: 30,
      },
      {
        ...base,
        port: 5173,
        url: "http://localhost:5173/",
        branch: "busy",
        working: true,
        recencyMs: 10,
      },
    ];
    expect(resolvePreviewSelection({ pinnedPort: undefined, live: null, ports })).toMatchObject({
      kind: "port",
      port: 5173,
    });
    expect(
      resolvePreviewSelection({
        pinnedPort: undefined,
        live: null,
        ports: ports.map((entry) => ({ ...entry, working: false })),
      }),
    ).toMatchObject({ kind: "port", port: 4173 });
  });
});

describe("previewServerName", () => {
  const name = (
    cwd: string | null,
    checkoutPath: string | null,
    threadTitle: string | null = null,
  ) => previewServerName({ cwd, checkoutPath, threadTitle, processName: "node", port: 4173 });

  it("names a server by its folder in the checkout", () => {
    expect(name("/wt/app/apps/landing", "/wt/app")).toBe("apps/landing");
    expect(name("/wt/app/apps/landing", "/wt/app/", "Hero")).toBe("apps/landing");
  });

  it("falls back to the checkout, then the thread, then the process", () => {
    expect(name("/wt/supacode-7a45", "/wt/supacode-7a45")).toBe("supacode-7a45");
    expect(name("/wt/card", "/wt/card", "Hero")).toBe("Hero");
    expect(name(null, null, "Hero")).toBe("Hero");
    expect(name(null, null)).toBe("node");
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

  it("counts a worktree of the project's repository that another tool made", () => {
    const result = previewServerOwner({
      terminalThreadId: null,
      cwd: "/Users/me/.other-tool/worktrees/portfolio/review/apps/web",
      workspaceRoot: "/repo/portfolio",
      threads,
      projectId: "portfolio",
      checkoutProjectId: "portfolio",
    });
    expect([result.thread, result.inProject]).toEqual([null, true]);
    expect(
      previewServerOwner({
        terminalThreadId: null,
        cwd: "/elsewhere/site",
        workspaceRoot: "/repo/portfolio",
        threads,
        projectId: "portfolio",
        checkoutProjectId: "other",
      }).inProject,
    ).toBe(false);
  });

  it("keeps a terminal's own thread first", () => {
    expect(owner("local", "/wt/card")).toEqual(["local", true]);
    expect(owner("elsewhere", null)).toEqual([null, false]);
  });
});
