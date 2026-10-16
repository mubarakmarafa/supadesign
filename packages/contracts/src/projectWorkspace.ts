import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Stable id of one widget in a project workspace. */
export const ProjectWorkspaceWidgetId = TrimmedNonEmptyString.check(Schema.isMaxLength(64)).pipe(
  Schema.brand("ProjectWorkspaceWidgetId"),
);
export type ProjectWorkspaceWidgetId = typeof ProjectWorkspaceWidgetId.Type;

/** Widget kinds this build renders. Others decode and show as unsupported. */
export const PROJECT_WORKSPACE_WIDGET_KINDS = [
  "kanban",
  "live-preview",
  "figma",
  "usage",
  "git",
] as const;
export type ProjectWorkspaceWidgetKind = (typeof PROJECT_WORKSPACE_WIDGET_KINDS)[number];

export function isProjectWorkspaceWidgetKind(kind: string): kind is ProjectWorkspaceWidgetKind {
  return (PROJECT_WORKSPACE_WIDGET_KINDS as ReadonlyArray<string>).includes(kind);
}

/** The grid is this many columns wide; a widget spans 1..columns of them. */
export const PROJECT_WORKSPACE_COLUMNS = 4;
/** A widget spans 1..rows grid rows. */
export const PROJECT_WORKSPACE_MAX_ROW_SPAN = 3;
export const PROJECT_WORKSPACE_MAX_WIDGETS = 24;
export const PROJECT_WORKSPACE_URL_MAX_LENGTH = 2048;

const WorkspaceUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_WORKSPACE_URL_MAX_LENGTH),
);

export const ProjectWorkspaceWidget = Schema.Struct({
  id: ProjectWorkspaceWidgetId,
  /**
   * One of {@link PROJECT_WORKSPACE_WIDGET_KINDS}, or a kind a newer client
   * added. A plain string so an older client keeps (and round-trips) it.
   */
  kind: TrimmedNonEmptyString.check(Schema.isMaxLength(40)),
  /** Columns spanned. */
  w: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: PROJECT_WORKSPACE_COLUMNS })),
  /** Rows spanned. */
  h: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: PROJECT_WORKSPACE_MAX_ROW_SPAN })),
  /** Figma widgets: the figma.com link the user pasted. */
  figmaUrl: Schema.optional(WorkspaceUrl),
  /** Live preview widgets: a pinned port. Absent follows the project's live card. */
  previewPort: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
});
export type ProjectWorkspaceWidget = typeof ProjectWorkspaceWidget.Type;

/** `#rrggbb`. */
export const ProjectWorkspaceColor = TrimmedNonEmptyString.check(
  Schema.isPattern(/^#[0-9a-f]{6}$/i),
);

export const ProjectWorkspaceAppearance = Schema.Struct({
  /**
   * A background preset id, or `custom` for {@link backgroundColor}. A plain
   * string so presets can grow; an id a client does not know renders as none.
   */
  background: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(40))),
  backgroundColor: Schema.optional(ProjectWorkspaceColor),
  /** https image drawn behind the widgets. */
  backgroundImageUrl: Schema.optional(WorkspaceUrl),
  /** Marks the project in its tab and workspace so it is recognisable at a glance. */
  accentColor: Schema.optional(ProjectWorkspaceColor),
});
export type ProjectWorkspaceAppearance = typeof ProjectWorkspaceAppearance.Type;

/**
 * A project's workspace: its widgets in grid order and its look. What a
 * client sends; cross-field rules live in {@link validateProjectWorkspace}.
 */
export const ProjectWorkspace = Schema.Struct({
  widgets: Schema.Array(ProjectWorkspaceWidget).check(
    Schema.isMaxLength(PROJECT_WORKSPACE_MAX_WIDGETS),
  ),
  appearance: Schema.optional(ProjectWorkspaceAppearance),
});
export type ProjectWorkspace = typeof ProjectWorkspace.Type;

/**
 * The same workspace as stored and received. A widget this build cannot read
 * (say, a span a newer client allows) costs only itself, never the project.
 */
export const ReceivedProjectWorkspace = Schema.Struct({
  widgets: ForwardCompatibleArray(ProjectWorkspaceWidget),
  appearance: Schema.optional(ProjectWorkspaceAppearance),
});

export const PROJECT_WORKSPACE_KANBAN_WIDGET_ID = ProjectWorkspaceWidgetId.make("kanban");

/** What a project without a stored workspace shows: today's board, alone. */
export const DEFAULT_PROJECT_WORKSPACE: ProjectWorkspace = {
  widgets: [{ id: PROJECT_WORKSPACE_KANBAN_WIDGET_ID, kind: "kanban", w: 4, h: 2 }],
};

/** Whether a pasted link is a figma.com page the embed endpoint accepts. */
export function isFigmaUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "figma.com" || host.endsWith(".figma.com"));
  } catch {
    return false;
  }
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

export type ProjectWorkspaceIssue =
  | { readonly code: "widget-count"; readonly count: number }
  | { readonly code: "duplicate-widget-id"; readonly widgetId: ProjectWorkspaceWidgetId }
  | { readonly code: "multiple-kanban" }
  | { readonly code: "invalid-figma-url"; readonly widgetId: ProjectWorkspaceWidgetId }
  | { readonly code: "invalid-background-image-url" };

/** Cross-field rules a workspace must satisfy before it is stored. Empty means valid. */
export function validateProjectWorkspace(
  workspace: ProjectWorkspace,
): ReadonlyArray<ProjectWorkspaceIssue> {
  const issues: ProjectWorkspaceIssue[] = [];
  if (workspace.widgets.length > PROJECT_WORKSPACE_MAX_WIDGETS) {
    issues.push({ code: "widget-count", count: workspace.widgets.length });
  }
  const ids = new Set<ProjectWorkspaceWidgetId>();
  let kanbans = 0;
  for (const widget of workspace.widgets) {
    if (ids.has(widget.id)) issues.push({ code: "duplicate-widget-id", widgetId: widget.id });
    ids.add(widget.id);
    if (widget.kind === "kanban") kanbans += 1;
    if (widget.figmaUrl !== undefined && !isFigmaUrl(widget.figmaUrl)) {
      issues.push({ code: "invalid-figma-url", widgetId: widget.id });
    }
  }
  if (kanbans > 1) issues.push({ code: "multiple-kanban" });
  const imageUrl = workspace.appearance?.backgroundImageUrl;
  if (imageUrl !== undefined && !isHttpsUrl(imageUrl)) {
    issues.push({ code: "invalid-background-image-url" });
  }
  return issues;
}
