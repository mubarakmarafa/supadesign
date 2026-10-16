import type { ProjectWorkspace, ProjectWorkspaceWidget } from "@supaterm/contracts";
import { EllipsisIcon, GripVerticalIcon } from "lucide-react";
import { createContext, type DragEvent, type ReactNode, useContext } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  moveWorkspaceWidget,
  nudgeWorkspaceWidget,
  removeWorkspaceWidget,
  resizeWorkspaceWidget,
  WIDGET_SIZE_PRESETS,
} from "./workspaceLogic";

/** What every widget frame in one workspace shares. */
export interface WorkspaceFrameContextValue {
  readonly workspace: ProjectWorkspace;
  readonly canEdit: boolean;
  readonly commit: (next: ProjectWorkspace | null) => void;
  readonly accentColor: string | undefined;
  /** The widget being dragged by its title bar, and the one it is over. */
  readonly drag: { readonly id: string; readonly overId: string | null } | null;
  readonly setDrag: (drag: { readonly id: string; readonly overId: string | null } | null) => void;
}

export const WorkspaceFrameContext = createContext<WorkspaceFrameContextValue | null>(null);

export function useWorkspaceFrame(): WorkspaceFrameContextValue {
  const value = useContext(WorkspaceFrameContext);
  if (value === null) throw new Error("useWorkspaceFrame must be used inside a workspace.");
  return value;
}

const DRAG_TYPE = "application/x-supadesign-widget";

// Static class names so Tailwind sees every span.
const COLUMN_SPAN: Readonly<Record<number, string>> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
  4: "md:col-span-4",
};
const ROW_SPAN: Readonly<Record<number, string>> = {
  1: "row-span-1",
  2: "row-span-2",
  3: "row-span-3",
};

/**
 * One widget's tile: a title bar that drags to rearrange, its actions, and a
 * menu for size, order, and removal. Widgets render their own body inside.
 */
export function WorkspaceWidgetFrame({
  widget,
  title,
  icon,
  actions,
  menuItems,
  children,
}: {
  widget: ProjectWorkspaceWidget;
  title: string;
  icon: ReactNode;
  /** Controls beside the menu, such as a source picker. */
  actions?: ReactNode;
  /** Widget-specific entries at the top of its menu. */
  menuItems?: ReactNode;
  children: ReactNode;
}) {
  const frame = useWorkspaceFrame();
  const { workspace, canEdit, commit, drag, setDrag } = frame;
  const index = workspace.widgets.findIndex((entry) => entry.id === widget.id);
  const isDropTarget = drag !== null && drag.id !== widget.id && drag.overId === widget.id;

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (drag === null || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (drag.overId !== widget.id) setDrag({ ...drag, overId: widget.id });
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (drag === null) return;
    event.preventDefault();
    setDrag(null);
    commit(moveWorkspaceWidget(workspace, drag.id as typeof widget.id, widget.id));
  };

  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-background",
        COLUMN_SPAN[widget.w],
        ROW_SPAN[widget.h],
        isDropTarget && "ring-2 ring-ring",
        drag?.id === widget.id && "opacity-60",
      )}
      onDragOver={canEdit ? onDragOver : undefined}
      onDrop={canEdit ? onDrop : undefined}
    >
      <header
        draggable={canEdit}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(DRAG_TYPE, widget.id);
          setDrag({ id: widget.id, overId: null });
        }}
        onDragEnd={() => setDrag(null)}
        className={cn(
          "flex h-9 shrink-0 items-center gap-1.5 border-b ps-2 pe-1 text-sm",
          canEdit && "cursor-grab active:cursor-grabbing",
        )}
      >
        {canEdit ? (
          <GripVerticalIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
        <span
          aria-hidden
          className="flex shrink-0 text-muted-foreground [&_svg]:size-3.5"
          style={frame.accentColor === undefined ? undefined : { color: frame.accentColor }}
        >
          {icon}
        </span>
        <h2 className="min-w-0 truncate font-medium">{title}</h2>
        <span className="min-w-2 flex-1" />
        {actions}
        {canEdit ? (
          <Menu>
            <MenuTrigger
              render={
                <Button size="icon-xs" variant="ghost-muted" aria-label={`${title} options`} />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              {menuItems}
              {menuItems ? <MenuSeparator /> : null}
              <MenuSub>
                <MenuSubTrigger>Size</MenuSubTrigger>
                <MenuSubPopup>
                  <MenuRadioGroup
                    value={`${widget.w}x${widget.h}`}
                    onValueChange={(value: string) => {
                      const preset = WIDGET_SIZE_PRESETS.find(
                        (entry) => `${entry.w}x${entry.h}` === value,
                      );
                      if (preset) commit(resizeWorkspaceWidget(workspace, widget.id, preset));
                    }}
                  >
                    {WIDGET_SIZE_PRESETS.map((preset) => (
                      <MenuRadioItem key={preset.label} value={`${preset.w}x${preset.h}`}>
                        <span className="flex items-center gap-3">
                          <span className="min-w-0 flex-1">{preset.label}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {preset.w}×{preset.h}
                          </span>
                          <MenuRadioItemIndicator />
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubPopup>
              </MenuSub>
              <MenuItem
                disabled={index <= 0}
                onClick={() => commit(nudgeWorkspaceWidget(workspace, widget.id, "earlier"))}
              >
                Move earlier
              </MenuItem>
              <MenuItem
                disabled={index === -1 || index >= workspace.widgets.length - 1}
                onClick={() => commit(nudgeWorkspaceWidget(workspace, widget.id, "later"))}
              >
                Move later
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                onClick={() => commit(removeWorkspaceWidget(workspace, widget.id))}
              >
                Remove widget
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** A line of muted text that fills a widget body, for empty and error states. */
export function WidgetMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
