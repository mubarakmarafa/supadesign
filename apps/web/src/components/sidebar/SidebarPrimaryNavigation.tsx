/**
 * The sidebar's top rows: start a thread, search through the command palette,
 * open the project board, and open Automations.
 */
import type { ScopedProjectRef } from "@supaterm/contracts";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { CalendarClockIcon, KanbanIcon, SearchIcon, SquarePenIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useStartNewThreadInCurrentProject } from "../../hooks/useHandleNewThread";
import { useShortcutLabel } from "../../hooks/useShortcutLabel";
import { useAnyProjectBoardSupported, useOpenProjectBoard } from "../board/boardNavigation";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

export function SidebarPrimaryNavigation({
  projectGroupCount,
  boardProjectRef = null,
}: {
  projectGroupCount: number;
  /** The project the sidebar is scoped to; the board opens it before the one in view. */
  boardProjectRef?: ScopedProjectRef | null;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const size = isMobile ? "default" : "compact";
  const newThreadShortcut = useShortcutLabel("chat.newLocal");
  const searchShortcut = useShortcutLabel("commandPalette.toggle");
  const automationsShortcut = useShortcutLabel("automations.open");
  const boardShortcut = useShortcutLabel("board.open");
  const boardSupported = useAnyProjectBoardSupported();
  const openProjectBoard = useOpenProjectBoard();
  const boardActive = useLocation({
    select: (location) => location.pathname.startsWith("/board/"),
  });
  const startNewThreadInCurrentProject = useStartNewThreadInCurrentProject();
  const newThreadActive = useParams({
    strict: false,
    select: (params) => Boolean(params.draftId),
  });
  const automationsActive = useLocation({
    select: (location) => location.pathname === "/automations",
  });
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  const handleNewThread = () => {
    closeMobileSidebar();
    void startNewThreadInCurrentProject();
  };

  return (
    <SidebarMenu size={size}>
      <SidebarMenuItem>
        <SidebarMenuButton
          size={size}
          isActive={newThreadActive}
          disabled={projectGroupCount === 0}
          onClick={handleNewThread}
          shortcut={newThreadShortcut}
        >
          <SquarePenIcon />
          <span>New thread</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          size={size}
          // The palette is a dialog over the whole app; on narrow screens the
          // sidebar sheet closes first so the two never stack.
          onClick={() => {
            closeMobileSidebar();
            openCommandPalette();
          }}
          shortcut={searchShortcut}
        >
          <SearchIcon />
          <span>Search</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {boardSupported ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            size={size}
            isActive={boardActive}
            disabled={projectGroupCount === 0}
            onClick={() => {
              closeMobileSidebar();
              openProjectBoard(boardProjectRef);
            }}
            shortcut={boardShortcut}
          >
            <KanbanIcon />
            <span>Board</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
      <SidebarMenuItem>
        <SidebarMenuButton
          size={size}
          isActive={automationsActive}
          render={<Link to="/automations" onClick={closeMobileSidebar} />}
          shortcut={automationsShortcut}
        >
          <CalendarClockIcon />
          <span>Automations</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
