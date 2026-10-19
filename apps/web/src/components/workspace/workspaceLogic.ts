import {
  DEFAULT_PROJECT_WORKSPACE,
  PROJECT_WORKSPACE_COLUMNS,
  PROJECT_WORKSPACE_MAX_WIDGETS,
  type ProjectWorkspace,
  type ProjectWorkspaceAppearance,
  type ProjectWorkspaceWidget,
  type ProjectWorkspaceWidgetId,
  type ProjectWorkspaceWidgetKind,
} from "@supaterm/contracts";

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

export interface WidgetSize {
  readonly w: number;
  readonly h: number;
}

export const WIDGET_SIZE_PRESETS: ReadonlyArray<WidgetSize & { readonly label: string }> = [
  { label: "Small", w: 1, h: 1 },
  { label: "Wide", w: 2, h: 1 },
  { label: "Tall", w: 1, h: 2 },
  { label: "Large", w: 2, h: 2 },
  { label: "Wide and tall", w: 3, h: 2 },
  { label: "Full width", w: 4, h: 2 },
  { label: "Full width, tall", w: 4, h: 3 },
];

export const WIDGET_DEFAULT_SIZES: Readonly<Record<ProjectWorkspaceWidgetKind, WidgetSize>> = {
  kanban: { w: 4, h: 2 },
  "live-preview": { w: 1, h: 2 },
  figma: { w: 1, h: 2 },
  usage: { w: 1, h: 1 },
  git: { w: 1, h: 1 },
};

/** Kinds that can appear once per workspace. */
const SINGLE_KINDS: ReadonlySet<string> = new Set(["kanban"]);

export function canAddWidget(workspace: ProjectWorkspace, kind: ProjectWorkspaceWidgetKind) {
  if (workspace.widgets.length >= PROJECT_WORKSPACE_MAX_WIDGETS) return false;
  return !SINGLE_KINDS.has(kind) || !workspace.widgets.some((widget) => widget.kind === kind);
}

/**
 * Adds a widget at its default size; null when it cannot be added. The first
 * widget beside a full-width kanban narrows the kanban so the newcomer lands
 * beside it rather than under it. A re-added kanban goes first.
 */
export function addWorkspaceWidget(
  workspace: ProjectWorkspace,
  kind: ProjectWorkspaceWidgetKind,
  id: ProjectWorkspaceWidgetId,
): ProjectWorkspace | null {
  if (!canAddWidget(workspace, kind)) return null;
  const size = WIDGET_DEFAULT_SIZES[kind];
  if (kind === "kanban") {
    const w = workspace.widgets.length === 0 ? PROJECT_WORKSPACE_COLUMNS : size.w - 1;
    return { ...workspace, widgets: [{ id, kind, w, h: size.h }, ...workspace.widgets] };
  }
  const widgets = isBoardOnly(workspace)
    ? workspace.widgets.map((widget) =>
        widget.w === PROJECT_WORKSPACE_COLUMNS
          ? { ...widget, w: PROJECT_WORKSPACE_COLUMNS - 1 }
          : widget,
      )
    : workspace.widgets;
  return { ...workspace, widgets: [...widgets, { id, kind, ...size }] };
}

export function removeWorkspaceWidget(
  workspace: ProjectWorkspace,
  id: ProjectWorkspaceWidgetId,
): ProjectWorkspace {
  return { ...workspace, widgets: workspace.widgets.filter((widget) => widget.id !== id) };
}

export function resizeWorkspaceWidget(
  workspace: ProjectWorkspace,
  id: ProjectWorkspaceWidgetId,
  size: WidgetSize,
): ProjectWorkspace {
  return mapWidget(workspace, id, (widget) => ({ ...widget, w: size.w, h: size.h }));
}

/** Swaps a widget with its neighbour; null at either end. */
export function nudgeWorkspaceWidget(
  workspace: ProjectWorkspace,
  id: ProjectWorkspaceWidgetId,
  direction: "earlier" | "later",
): ProjectWorkspace | null {
  const index = workspace.widgets.findIndex((widget) => widget.id === id);
  const target = direction === "earlier" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= workspace.widgets.length) return null;
  const widgets = [...workspace.widgets];
  [widgets[index], widgets[target]] = [widgets[target]!, widgets[index]!];
  return { ...workspace, widgets };
}

/** Moves a dragged widget into the slot of the widget it was dropped on. */
export function moveWorkspaceWidget(
  workspace: ProjectWorkspace,
  id: ProjectWorkspaceWidgetId,
  overId: ProjectWorkspaceWidgetId,
): ProjectWorkspace | null {
  const from = workspace.widgets.findIndex((widget) => widget.id === id);
  const to = workspace.widgets.findIndex((widget) => widget.id === overId);
  if (from === -1 || to === -1 || from === to) return null;
  const widgets = [...workspace.widgets];
  const [moved] = widgets.splice(from, 1);
  widgets.splice(to, 0, moved!);
  return { ...workspace, widgets };
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
