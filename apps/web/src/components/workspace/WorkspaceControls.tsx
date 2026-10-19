import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import {
  isHttpsUrl,
  type ProjectWorkspace,
  type ProjectWorkspaceWidgetKind,
  ProjectWorkspaceWidgetId,
  type ScopedProjectRef,
} from "@supaterm/contracts";
import {
  BotIcon,
  GaugeIcon,
  GitBranchIcon,
  KanbanIcon,
  LayoutGridIcon,
  MonitorIcon,
  PaletteIcon,
  PenToolIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn, randomUUID } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { useProjectWorkspace } from "./useProjectWorkspace";
import {
  ACCENT_PRESETS,
  addWorkspaceWidget,
  BACKGROUND_PRESETS,
  canAddWidget,
  patchWorkspaceAppearance,
  workspaceBackgroundStyle,
} from "./workspaceLogic";

const WIDGET_CATALOG: ReadonlyArray<{
  readonly kind: ProjectWorkspaceWidgetKind;
  readonly label: string;
  readonly description: string;
  readonly icon: ReactNode;
}> = [
  {
    kind: "board-agent",
    label: "Board agent",
    description: "Chat to add ideas, hand out work, and move cards",
    icon: <BotIcon />,
  },
  {
    kind: "live-preview",
    label: "Live preview",
    description: "The live card's dev server, or another running port",
    icon: <MonitorIcon />,
  },
  {
    kind: "figma",
    label: "Figma",
    description: "A design or prototype to compare with",
    icon: <PenToolIcon />,
  },
  {
    kind: "usage",
    label: "Usage",
    description: "Tokens, spend, and plan limits",
    icon: <GaugeIcon />,
  },
  {
    kind: "git",
    label: "Git",
    description: "Branches and open pull requests",
    icon: <GitBranchIcon />,
  },
  { kind: "kanban", label: "Board", description: "This project's cards", icon: <KanbanIcon /> },
];

/** Board header controls for the project's workspace: add widgets and set its look. */
export function WorkspaceControls({
  projectRef,
  project,
}: {
  projectRef: ScopedProjectRef;
  project: EnvironmentProject;
}) {
  const { workspace, canEdit, commit } = useProjectWorkspace(projectRef, project);
  if (!canEdit) return null;
  return (
    <>
      <Menu>
        <MenuTrigger render={<Button size="sm" variant="ghost" />}>
          <LayoutGridIcon />
          Add widget
        </MenuTrigger>
        <MenuPopup align="end">
          {WIDGET_CATALOG.map((entry) => (
            <MenuItem
              key={entry.kind}
              disabled={!canAddWidget(workspace, entry.kind)}
              onClick={() =>
                commit(
                  addWorkspaceWidget(
                    workspace,
                    entry.kind,
                    ProjectWorkspaceWidgetId.make(`${entry.kind}-${randomUUID().slice(0, 8)}`),
                  ),
                )
              }
            >
              {entry.icon}
              <span className="flex min-w-0 flex-col">
                <span>{entry.label}</span>
                <span className="text-xs text-muted-foreground">{entry.description}</span>
              </span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
      <Popover>
        <PopoverTrigger
          render={<Button size="icon-sm" variant="ghost" aria-label="Project look" />}
        >
          <PaletteIcon />
        </PopoverTrigger>
        <PopoverPopup align="end" width="sm">
          <AppearanceEditor workspace={workspace} commit={commit} />
        </PopoverPopup>
      </Popover>
    </>
  );
}

function AppearanceEditor({
  workspace,
  commit,
}: {
  workspace: ProjectWorkspace;
  commit: (next: ProjectWorkspace | null) => void;
}) {
  const appearance = workspace.appearance;
  const patch = (fields: Parameters<typeof patchWorkspaceAppearance>[1]) =>
    commit(patchWorkspaceAppearance(workspace, fields));
  const usingImage = appearance?.backgroundImageUrl !== undefined;
  const background = usingImage ? null : (appearance?.background ?? null);

  return (
    <div className="flex flex-col gap-4">
      <PopoverTitle>Project look</PopoverTitle>
      <p className="-mt-2 text-xs text-muted-foreground">
        Each project keeps its own look, so you can tell them apart at a glance.
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Background</legend>
        <div className="flex flex-wrap gap-2">
          <Swatch
            label="No background"
            selected={background === null && !usingImage}
            onSelect={() =>
              patch({ background: null, backgroundColor: null, backgroundImageUrl: null })
            }
          />
          {BACKGROUND_PRESETS.map((preset) => (
            <Swatch
              key={preset.id}
              label={preset.label}
              selected={background === preset.id}
              fill={workspaceBackgroundStyle({ background: preset.id })}
              onSelect={() => patch({ background: preset.id, backgroundImageUrl: null })}
            />
          ))}
          <CustomColorSwatch
            label="Custom background colour"
            value={appearance?.backgroundColor}
            selected={background === "custom"}
            onCommit={(color) =>
              patch({ background: "custom", backgroundColor: color, backgroundImageUrl: null })
            }
          />
        </div>
        <ImageUrlField
          key={appearance?.backgroundImageUrl ?? ""}
          value={appearance?.backgroundImageUrl ?? ""}
          onCommit={(url) => patch({ backgroundImageUrl: url })}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Accent</legend>
        <div className="flex flex-wrap gap-2">
          <Swatch
            label="No accent"
            selected={appearance?.accentColor === undefined}
            onSelect={() => patch({ accentColor: null })}
          />
          {ACCENT_PRESETS.map((color) => (
            <Swatch
              key={color}
              label={`Accent ${color}`}
              selected={appearance?.accentColor?.toLowerCase() === color}
              fill={{ backgroundColor: color }}
              onSelect={() => patch({ accentColor: color })}
            />
          ))}
          <CustomColorSwatch
            label="Custom accent colour"
            value={appearance?.accentColor}
            selected={
              appearance?.accentColor !== undefined &&
              !ACCENT_PRESETS.includes(appearance.accentColor.toLowerCase())
            }
            onCommit={(color) => patch({ accentColor: color })}
          />
        </div>
      </fieldset>

      {appearance !== undefined ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() =>
            patch({
              background: null,
              backgroundColor: null,
              backgroundImageUrl: null,
              accentColor: null,
            })
          }
        >
          Reset look
        </Button>
      ) : null}
    </div>
  );
}

const SWATCH_CLASS =
  "relative size-6 shrink-0 cursor-pointer rounded-full border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

function Swatch({
  label,
  selected,
  fill,
  onSelect,
}: {
  label: string;
  selected: boolean;
  fill?: ReturnType<typeof workspaceBackgroundStyle>;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        SWATCH_CLASS,
        "bg-background",
        selected && "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
      )}
      style={fill ?? undefined}
    >
      {fill ? null : (
        <span aria-hidden className="absolute inset-1 rotate-45 border-t border-muted-foreground" />
      )}
    </button>
  );
}

/** How long a colour picker drag settles before the colour is saved. */
const COLOR_COMMIT_DELAY_MS = 400;

function CustomColorSwatch({
  label,
  value,
  selected,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  selected: boolean;
  onCommit: (color: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const shown = draft ?? value ?? "#888888";
  return (
    <label
      className={cn(
        SWATCH_CLASS,
        "overflow-hidden",
        selected && "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
      )}
      style={{
        background:
          value === undefined && draft === null
            ? "conic-gradient(#e0524a, #f0a030, #34b98a, #4f8fe8, #9b7be8, #e868b0, #e0524a)"
            : shown,
      }}
    >
      <span className="sr-only">{label}</span>
      <input
        type="color"
        value={shown}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        onChange={(event) => {
          const color = event.target.value;
          setDraft(color);
          if (timer.current !== null) clearTimeout(timer.current);
          // The picker reports every drag step; save once it settles.
          timer.current = setTimeout(() => {
            timer.current = null;
            setDraft(null);
            onCommit(color);
          }, COLOR_COMMIT_DELAY_MS);
        }}
      />
    </label>
  );
}

function ImageUrlField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (url: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const save = () => {
    const trimmed = draft.trim();
    if (trimmed === value) return;
    if (trimmed === "") {
      onCommit(null);
      return;
    }
    if (!isHttpsUrl(trimmed)) {
      setInvalid(true);
      return;
    }
    onCommit(trimmed);
  };
  return (
    <div className="flex flex-col gap-1">
      <Input
        size="sm"
        type="url"
        aria-label="Background image link"
        placeholder="Or an image link (https://…)"
        value={draft}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
        }}
      />
      {invalid ? (
        <p className="text-xs text-destructive-foreground">Use an https image link.</p>
      ) : null}
    </div>
  );
}
