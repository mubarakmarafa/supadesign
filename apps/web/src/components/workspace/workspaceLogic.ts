import {
  DEFAULT_PROJECT_WORKSPACE,
  PROJECT_WORKSPACE_COLUMNS,
  PROJECT_WORKSPACE_MAX_ROW_SPAN,
  PROJECT_WORKSPACE_MAX_WIDGETS,
  type ProjectWorkspace,
  type ProjectWorkspaceLayout,
  type ProjectWorkspaceAppearance,
  type ProjectWorkspaceWidget,
  type ProjectWorkspaceWidgetId,
  type ProjectWorkspaceWidgetKind,
} from "@supaterm/contracts";

import { buildLayout, insertTile, layoutRects, reconcileLayout, removeTile } from "./bentoLayout";

// ── Layout ──

export function workspaceOrDefault(
  workspace: ProjectWorkspace | null | undefined,
): ProjectWorkspace {
  return workspace ?? DEFAULT_PROJECT_WORKSPACE;
}

/** Only the kanban: the workspace renders exactly as the plain board. */
export function isBoardOnly(workspace: ProjectWorkspace): boolean {
  return workspace.widgets.length === 1 && workspace.widgets[0]!.kind === "kanban";
}

/**
 * The most tiles a workspace takes, so everything on it stays visible on one
 * screen. Workspaces saved with more keep them; they just cannot grow.
 */
export const WORKSPACE_MAX_TILES = 5;

/** Kinds that can appear once per workspace. */
const SINGLE_KINDS: ReadonlySet<string> = new Set(["kanban", "board-agent"]);

export function canAddWidget(workspace: ProjectWorkspace, kind: ProjectWorkspaceWidgetKind) {
  if (workspace.widgets.length >= Math.min(WORKSPACE_MAX_TILES, PROJECT_WORKSPACE_MAX_WIDGETS)) {
    return false;
  }
  return !SINGLE_KINDS.has(kind) || !workspace.widgets.some((widget) => widget.kind === kind);
}

/** The bento arrangement to draw: the stored one, or one built from widget order. */
export function workspaceLayout(workspace: ProjectWorkspace): ProjectWorkspaceLayout | null {
  return reconcileLayout(
    workspace.widgets.map((widget) => widget.id),
    workspace.layout,
  );
}

/**
 * Saves an arrangement. Each widget also keeps a rough `w`/`h` in the old
 * 4×3 grid, so a client from before the bento still draws something close.
 */
export function withWorkspaceLayout(
  workspace: ProjectWorkspace,
  layout: ProjectWorkspaceLayout | null,
): ProjectWorkspace {
  if (layout === null) {
    const { layout: _previous, ...rest } = workspace;
    return rest;
  }
  const rects = new Map(layoutRects(layout).map((rect) => [rect.widgetId, rect]));
  const scaleX = PROJECT_WORKSPACE_COLUMNS / layout.columns;
  const scaleY = PROJECT_WORKSPACE_MAX_ROW_SPAN / layout.rows;
  const clamp = (value: number, max: number) => Math.max(1, Math.min(max, Math.round(value)));
  const order = [...layoutRects(layout)].sort((a, b) => a.y - b.y || a.x - b.x);
  const position = new Map(order.map((rect, index) => [rect.widgetId, index]));
  return {
    ...workspace,
    widgets: workspace.widgets
      .map((widget) => {
        const rect = rects.get(widget.id);
        return rect === undefined
          ? widget
          : {
              ...widget,
              w: clamp(rect.w * scaleX, PROJECT_WORKSPACE_COLUMNS),
              h: clamp(rect.h * scaleY, PROJECT_WORKSPACE_MAX_ROW_SPAN),
            };
      })
      // Older clients place widgets in array order, so keep it close to reading order.
      .toSorted(
        (a, b) =>
          (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (position.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      ),
    layout,
  };
}

/** Adds a widget by splitting the biggest tile; null when it cannot be added. */
export function addWorkspaceWidget(
  workspace: ProjectWorkspace,
  kind: ProjectWorkspaceWidgetKind,
  id: ProjectWorkspaceWidgetId,
): ProjectWorkspace | null {
  if (!canAddWidget(workspace, kind)) return null;
  const current = workspaceLayout(workspace);
  const layout = current === null ? buildLayout([id]) : insertTile(current, id);
  if (layout === null) return null;
  const widget = { id, kind, ...LEGACY_SIZES[kind] };
  return withWorkspaceLayout({ ...workspace, widgets: [...workspace.widgets, widget] }, layout);
}

/** Starting `w`/`h`, replaced from the layout as soon as it is saved. */
const LEGACY_SIZES: Readonly<Record<ProjectWorkspaceWidgetKind, { w: number; h: number }>> = {
  kanban: { w: 3, h: 2 },
  "live-preview": { w: 1, h: 2 },
  figma: { w: 1, h: 2 },
  usage: { w: 1, h: 1 },
  git: { w: 1, h: 1 },
  "board-agent": { w: 1, h: 2 },
};

/** Removes a widget; its neighbour takes the space. */
export function removeWorkspaceWidget(
  workspace: ProjectWorkspace,
  id: ProjectWorkspaceWidgetId,
): ProjectWorkspace {
  const current = workspaceLayout(workspace);
  const remaining = {
    ...workspace,
    widgets: workspace.widgets.filter((widget) => widget.id !== id),
  };
  return withWorkspaceLayout(remaining, current === null ? null : removeTile(current, id));
}

/** Lays the widgets out afresh: the board, then its agent, then the rest in reading order. */
export function resetWorkspaceLayout(workspace: ProjectWorkspace): ProjectWorkspace {
  const current = workspaceLayout(workspace);
  const reading =
    current === null
      ? workspace.widgets.map((widget) => widget.id)
      : [...layoutRects(current)]
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((rect) => rect.widgetId);
  const kinds = new Map(workspace.widgets.map((widget) => [widget.id, widget.kind]));
  const rank = (id: ProjectWorkspaceWidgetId) => {
    const kind = kinds.get(id);
    return kind === "kanban" ? 0 : kind === "board-agent" ? 1 : 2;
  };
  return withWorkspaceLayout(workspace, buildLayout(reading.toSorted((a, b) => rank(a) - rank(b))));
}

/** Sets or (with null) clears a widget's own settings. */
export function setWorkspaceWidgetSettings(
  workspace: ProjectWorkspace,
  id: ProjectWorkspaceWidgetId,
  settings: { readonly figmaUrl?: string | null; readonly previewPort?: number | null },
): ProjectWorkspace {
  return mapWidget(workspace, id, (widget) => {
    const { figmaUrl, previewPort, ...rest } = widget;
    const nextFigma = settings.figmaUrl === undefined ? figmaUrl : settings.figmaUrl;
    const nextPort = settings.previewPort === undefined ? previewPort : settings.previewPort;
    return {
      ...rest,
      ...(nextFigma == null ? {} : { figmaUrl: nextFigma }),
      ...(nextPort == null ? {} : { previewPort: nextPort }),
    };
  });
}

function mapWidget(
  workspace: ProjectWorkspace,
  id: ProjectWorkspaceWidgetId,
  update: (widget: ProjectWorkspaceWidget) => ProjectWorkspaceWidget,
): ProjectWorkspace {
  return {
    ...workspace,
    widgets: workspace.widgets.map((widget) => (widget.id === id ? update(widget) : widget)),
  };
}

// ── Appearance ──

export interface BackgroundPreset {
  readonly id: string;
  readonly label: string;
  /** One colour is a tint; more make a gradient. */
  readonly colors: ReadonlyArray<string>;
}

export const BACKGROUND_PRESETS: ReadonlyArray<BackgroundPreset> = [
  { id: "sand", label: "Sand", colors: ["#e9b44c"] },
  { id: "sage", label: "Sage", colors: ["#6b9e78"] },
  { id: "sky", label: "Sky", colors: ["#4f8fe8"] },
  { id: "lilac", label: "Lilac", colors: ["#9b7be8"] },
  { id: "rose", label: "Rose", colors: ["#e8657f"] },
  { id: "slate", label: "Slate", colors: ["#64748b"] },
  { id: "dusk", label: "Dusk", colors: ["#9b7be8", "#e8657f"] },
  { id: "lagoon", label: "Lagoon", colors: ["#34b98a", "#4f8fe8"] },
  { id: "sunset", label: "Sunset", colors: ["#f0a030", "#e0524a"] },
  { id: "aurora", label: "Aurora", colors: ["#2bb8d0", "#9b7be8", "#e868b0"] },
];

export const ACCENT_PRESETS: ReadonlyArray<string> = [
  "#e0524a",
  "#f0a030",
  "#34b98a",
  "#4f8fe8",
  "#9b7be8",
  "#e868b0",
  "#64748b",
];

/** How much colour a tint mixes into the theme background; low so text stays legible. */
const TINT_PERCENT = 18;

function tint(color: string, percent = TINT_PERCENT): string {
  return `color-mix(in oklab, ${color} ${percent}%, var(--background))`;
}

export interface WorkspaceBackgroundStyle {
  readonly backgroundColor?: string;
  readonly backgroundImage?: string;
  readonly backgroundSize?: string;
  readonly backgroundPosition?: string;
}

/**
 * The workspace background for an appearance, mixed with the theme background
 * so light and dark mode both stay readable. Null draws the plain theme.
 */
export function workspaceBackgroundStyle(
  appearance: ProjectWorkspaceAppearance | undefined,
): WorkspaceBackgroundStyle | null {
  if (appearance === undefined) return null;
  const imageUrl = safeImageUrl(appearance.backgroundImageUrl);
  if (imageUrl !== null) {
    // A wash over the image keeps widget titles and the board readable.
    const wash = "color-mix(in oklab, var(--background) 55%, transparent)";
    return {
      backgroundColor: "var(--background)",
      backgroundImage: `linear-gradient(${wash}, ${wash}), url("${imageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  if (appearance.background === "custom" && appearance.backgroundColor !== undefined) {
    return { backgroundColor: tint(appearance.backgroundColor, 24) };
  }
  const preset = BACKGROUND_PRESETS.find((entry) => entry.id === appearance.background);
  if (preset === undefined) return null;
  if (preset.colors.length === 1) return { backgroundColor: tint(preset.colors[0]!) };
  return {
    backgroundColor: "var(--background)",
    backgroundImage: `linear-gradient(135deg, ${preset.colors.map((color) => tint(color)).join(", ")})`,
  };
}

/** An https image URL safe to place in a CSS `url("…")`, or null. */
function safeImageUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    // href percent-encodes quotes and spaces; backslashes and newlines cannot survive parsing.
    return url.href.replaceAll('"', "%22");
  } catch {
    return null;
  }
}

/** Whether an appearance changes anything the plain board would draw. */
export function hasCustomLook(appearance: ProjectWorkspaceAppearance | undefined): boolean {
  return workspaceBackgroundStyle(appearance) !== null || appearance?.accentColor !== undefined;
}

const APPEARANCE_KEYS = [
  "background",
  "backgroundColor",
  "backgroundImageUrl",
  "accentColor",
] as const satisfies ReadonlyArray<keyof ProjectWorkspaceAppearance>;

/** Patches an appearance; a null field is cleared. An empty result is dropped. */
export function patchWorkspaceAppearance(
  workspace: ProjectWorkspace,
  patch: Partial<Record<keyof ProjectWorkspaceAppearance, string | null>>,
): ProjectWorkspace {
  const next: { -readonly [Key in keyof ProjectWorkspaceAppearance]?: string } = {};
  for (const key of APPEARANCE_KEYS) {
    const value = patch[key] === undefined ? workspace.appearance?.[key] : patch[key];
    if (value != null) next[key] = value;
  }
  const { appearance: _previous, ...rest } = workspace;
  return Object.keys(next).length === 0 ? rest : { ...rest, appearance: next };
}

// ── Figma ──

/** Figma's embed endpoint for a figma.com file, design, or prototype link. */
export function figmaEmbedUrl(url: string): string {
  return `https://www.figma.com/embed?embed_host=supadesign&url=${encodeURIComponent(url.trim())}`;
}

// ── Live preview ──

/** A dev server already running on the project's environment. */
export interface PreviewPortCandidate {
  readonly port: number;
  /** Where this client loads it; remote connections go through the environment. */
  readonly url: string;
  /** The thread whose terminal or worktree runs it, when known. */
  readonly threadTitle: string | null;
  readonly branch: string | null;
  /** It runs in this project's folder or one of its threads. */
  readonly ownedByProject: boolean;
  /** The thread's last update, ms; 0 when unknown. */
  readonly updatedAtMs: number;
  readonly processName: string | null;
}

export interface LivePreviewCandidate {
  readonly url: string;
  readonly branch: string | null;
  readonly threadTitle: string | null;
}

export type PreviewSelection =
  | { readonly kind: "live"; readonly url: string; readonly branch: string | null }
  | {
      readonly kind: "port";
      readonly port: number;
      readonly url: string;
      readonly branch: string | null;
      /** Picked because nothing was pinned and no card is live. */
      readonly fallback: boolean;
    }
  | { readonly kind: "pinned-missing"; readonly port: number }
  | { readonly kind: "none" };

/**
 * What a live preview widget shows: the pinned port when it is running, else
 * the project's live card, else the project's most recently active port.
 * Never anything that is not already running.
 */
export function resolvePreviewSelection(input: {
  readonly pinnedPort: number | undefined;
  readonly live: LivePreviewCandidate | null;
  readonly ports: ReadonlyArray<PreviewPortCandidate>;
}): PreviewSelection {
  if (input.pinnedPort !== undefined) {
    const pinned = input.ports.find((port) => port.port === input.pinnedPort);
    return pinned === undefined
      ? { kind: "pinned-missing", port: input.pinnedPort }
      : {
          kind: "port",
          port: pinned.port,
          url: pinned.url,
          branch: pinned.branch,
          fallback: false,
        };
  }
  if (input.live !== null) {
    return { kind: "live", url: input.live.url, branch: input.live.branch };
  }
  const recent = sortPreviewPorts(input.ports).find((port) => port.ownedByProject);
  return recent === undefined
    ? { kind: "none" }
    : { kind: "port", port: recent.port, url: recent.url, branch: recent.branch, fallback: true };
}

/** Whether `path` is `root` or inside it. Both are absolute paths on the server. */
export function pathWithin(root: string, path: string): boolean {
  const base = root.length > 1 ? root.replace(/[\\/]+$/, "") : root;
  return path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}\\`);
}

/**
 * Who a running server belongs to: the thread whose terminal started it, else
 * the thread whose worktree it runs in, else just the project when it runs in
 * the project folder. Agents often start servers outside a terminal, so the
 * working directory is what ties those back.
 */
export function previewServerOwner<
  T extends { readonly id: string; readonly worktreePath: string | null },
>(input: {
  readonly terminalThreadId: string | null;
  readonly cwd: string | null;
  readonly workspaceRoot: string;
  readonly threads: ReadonlyArray<T>;
}): { readonly thread: T | null; readonly inProject: boolean } {
  if (input.terminalThreadId !== null) {
    const thread = input.threads.find((entry) => entry.id === input.terminalThreadId) ?? null;
    return { thread, inProject: thread !== null };
  }
  const cwd = input.cwd;
  if (cwd === null) return { thread: null, inProject: false };
  let thread: T | null = null;
  for (const entry of input.threads) {
    if (entry.worktreePath === null || !pathWithin(entry.worktreePath, cwd)) continue;
    if (thread === null || entry.worktreePath.length > thread.worktreePath!.length) thread = entry;
  }
  return { thread, inProject: thread !== null || pathWithin(input.workspaceRoot, cwd) };
}

/** The project's own ports first, most recently active first, then the rest by port. */
export function sortPreviewPorts(
  ports: ReadonlyArray<PreviewPortCandidate>,
): ReadonlyArray<PreviewPortCandidate> {
  return [...ports].sort((left, right) => {
    if (left.ownedByProject !== right.ownedByProject) return left.ownedByProject ? -1 : 1;
    if (left.updatedAtMs !== right.updatedAtMs) return right.updatedAtMs - left.updatedAtMs;
    return left.port - right.port;
  });
}
