import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ApplicationProjectMetaUpdatedPayload } from "./applicationEvent.ts";
import { OrchestrationProjectShell } from "./orchestrationProject.ts";
import { ProjectUpdatePayload } from "./project.ts";
import {
  DEFAULT_PROJECT_WORKSPACE,
  isFigmaUrl,
  ProjectWorkspace,
  type ProjectWorkspace as ProjectWorkspaceType,
  ProjectWorkspaceWidgetId,
  ReceivedProjectWorkspace,
  validateProjectWorkspace,
} from "./projectWorkspace.ts";

const decodeWorkspace = Schema.decodeUnknownSync(ProjectWorkspace);
const decodeReceived = Schema.decodeUnknownSync(ReceivedProjectWorkspace);
const decodeShell = Schema.decodeUnknownSync(OrchestrationProjectShell);
const decodeUpdate = Schema.decodeUnknownSync(ProjectUpdatePayload);
const decodeMetaUpdated = Schema.decodeUnknownSync(ApplicationProjectMetaUpdatedPayload);

const id = ProjectWorkspaceWidgetId.make;

describe("validateProjectWorkspace", () => {
  it("accepts the default workspace", () => {
    expect(validateProjectWorkspace(DEFAULT_PROJECT_WORKSPACE)).toEqual([]);
  });

  it("reports duplicate ids, a second kanban, and links that cannot embed", () => {
    const workspace: ProjectWorkspaceType = {
      widgets: [
        { id: id("kanban"), kind: "kanban", w: 3, h: 2 },
        { id: id("board-2"), kind: "kanban", w: 1, h: 1 },
        { id: id("figma"), kind: "figma", w: 1, h: 1, figmaUrl: "https://example.com/file" },
        { id: id("figma"), kind: "figma", w: 1, h: 1 },
      ],
      appearance: { backgroundImageUrl: "http://example.com/a.png" },
    };
    expect(validateProjectWorkspace(workspace)).toEqual([
      { code: "invalid-figma-url", widgetId: "figma" },
      { code: "duplicate-widget-id", widgetId: "figma" },
      { code: "multiple-kanban" },
      { code: "invalid-background-image-url" },
    ]);
  });
});

describe("isFigmaUrl", () => {
  it("accepts https figma.com pages only", () => {
    expect(isFigmaUrl("https://www.figma.com/proto/abc/My-File?node-id=1-2")).toBe(true);
    expect(isFigmaUrl("https://figma.com/design/abc/File")).toBe(true);
    expect(isFigmaUrl("http://www.figma.com/file/abc")).toBe(false);
    expect(isFigmaUrl("https://figma.com.evil.test/file/abc")).toBe(false);
    expect(isFigmaUrl("not a url")).toBe(false);
  });
});

describe("workspace schemas", () => {
  it("keeps a widget kind this build does not know", () => {
    const decoded = decodeWorkspace({
      widgets: [{ id: "notes", kind: "sticky-notes", w: 2, h: 1 }],
    });
    expect(decoded.widgets[0]?.kind).toBe("sticky-notes");
  });

  it("rejects spans outside the grid when a client sends them", () => {
    expect(() =>
      decodeUpdate({ workspace: { widgets: [{ id: "a", kind: "usage", w: 5, h: 1 }] } }),
    ).toThrow();
    expect(() =>
      decodeUpdate({ workspace: { widgets: [{ id: "a", kind: "usage", w: 1, h: 0 }] } }),
    ).toThrow();
  });

  it("drops only the widget a received workspace cannot read", () => {
    const decoded = decodeReceived({
      widgets: [
        { id: "kanban", kind: "kanban", w: 3, h: 2 },
        { id: "wide", kind: "usage", w: 6, h: 1 },
      ],
      appearance: { background: "sand", accentColor: "#ff8800" },
    });
    expect(decoded).toEqual({
      widgets: [{ id: "kanban", kind: "kanban", w: 3, h: 2 }],
      appearance: { background: "sand", accentColor: "#ff8800" },
    });
  });

  it("rejects colours that are not #rrggbb", () => {
    expect(() => decodeWorkspace({ widgets: [], appearance: { accentColor: "red" } })).toThrow();
  });

  it("decodes shells and meta updates with and without a workspace", () => {
    const shell = {
      id: "project-1",
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      deletedAt: null,
    };
    expect(decodeShell(shell).workspace).toBeUndefined();
    expect(decodeShell({ ...shell, workspace: null }).workspace).toBeNull();
    expect(decodeShell({ ...shell, workspace: DEFAULT_PROJECT_WORKSPACE }).workspace).toEqual(
      DEFAULT_PROJECT_WORKSPACE,
    );
    expect(
      decodeMetaUpdated({
        projectId: "project-1",
        workspace: DEFAULT_PROJECT_WORKSPACE,
        updatedAt: "2026-10-01T00:00:00.000Z",
      }).workspace,
    ).toEqual(DEFAULT_PROJECT_WORKSPACE);
  });
});
