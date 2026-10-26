import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

import type { SidebarSweepAction } from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Icon button on a snoozed or done row. Pressing it and dragging sweeps
    the same action across neighboring rows in that shelf. */
export function SidebarParkedActionButton(props: {
  action: SidebarSweepAction;
  label: string;
  shortcut?: string | null;
  onClick: (event: ReactMouseEvent) => void;
  onSweepStart: (action: SidebarSweepAction, event: ReactPointerEvent) => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            onClick={props.onClick}
            onPointerDown={(event) => props.onSweepStart(props.action, event)}
            className="pointer-events-none inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100 group-focus-within/sidebar-row:pointer-events-auto group-focus-within/sidebar-row:opacity-100"
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top" shortcut={props.shortcut}>
        {props.label}
      </TooltipPopup>
    </Tooltip>
  );
}
