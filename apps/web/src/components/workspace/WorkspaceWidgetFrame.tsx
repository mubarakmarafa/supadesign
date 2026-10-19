import type { ProjectWorkspace, ProjectWorkspaceWidget } from "@supaterm/contracts";
import { EllipsisIcon, GripVerticalIcon, Minimize2Icon } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { useBentoTile } from "./BentoGrid";
import { removeWorkspaceWidget } from "./workspaceLogic";

/** What every widget frame in one workspace shares. */
export interface WorkspaceFrameContextValue {
  readonly workspace: ProjectWorkspace;
  readonly canEdit: boolean;
  readonly commit: (next: ProjectWorkspace | null) => void;
  readonly accentColor: string | undefined;
}

export const WorkspaceFrameContext = createContext<WorkspaceFrameContextValue | null>(null);

export function useWorkspaceFrame(): WorkspaceFrameContextValue {
  const value = useContext(WorkspaceFrameContext);
  if (value === null) throw new Error("useWorkspaceFrame must be used inside a workspace.");
  return value;
}

/**
 * One widget's tile: a title bar that drags to rearrange (double-click
 * maximizes), its actions, and a menu. Widgets render their own body inside.
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
  const { workspace, canEdit, commit } = frame;
  const tile = useBentoTile();

  const remove = () => {
    commit(removeWorkspaceWidget(workspace, widget.id));
    const id = toastManager.add({
      type: "info",
      title: `Removed ${title}`,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(id);
          commit(workspace);
        },
      },
    });
  };

  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background",
        tile.dragging && "opacity-50",
      )}
    >
      <header
        tabIndex={tile.canArrange ? 0 : undefined}
        onPointerDown={tile.onHeaderPointerDown}
        onDoubleClick={tile.onHeaderDoubleClick}
        onKeyDown={tile.onHeaderKeyDown}
        className={cn(
          "flex h-9 shrink-0 items-center gap-1.5 border-b ps-2 pe-1 text-sm outline-none select-none focus-visible:bg-accent",
          tile.canArrange && "cursor-grab touch-none active:cursor-grabbing",
        )}
      >
        {tile.canArrange ? (
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
        {tile.maximized ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Restore size"
            onClick={tile.toggleMaximized}
          >
            <Minimize2Icon />
          </Button>
        ) : null}
        <Menu>
          <MenuTrigger
            render={<Button size="icon-xs" variant="ghost-muted" aria-label={`${title} options`} />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {canEdit && menuItems ? (
              <>
                {menuItems}
                <MenuSeparator />
              </>
            ) : null}
            <MenuItem onClick={tile.toggleMaximized}>
              {tile.maximized ? "Restore size" : "Maximize"}
            </MenuItem>
            {canEdit ? (
              <>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={remove}>
                  Remove widget
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
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
