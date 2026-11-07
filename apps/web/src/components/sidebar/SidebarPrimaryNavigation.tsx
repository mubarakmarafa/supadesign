/**
 * The sidebar's top rows: start a thread, open the projects grid, and open Automations.
 */
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { CalendarClockIcon, LayoutGridIcon, SquarePenIcon } from "@supaterm/icons";

import { openCommandPalette } from "../../commandPaletteBus";
import { useStartNewThreadInCurrentProject } from "../../hooks/useHandleNewThread";
import { useShortcutLabel } from "../../hooks/useShortcutLabel";
import { useAnyProjectBoardSupported } from "../board/boardNavigation";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

export function SidebarPrimaryNavigation({ projectGroupCount }: { projectGroupCount: number }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const size = isMobile ? "default" : "compact";
  const newThreadShortcut = useShortcutLabel("chat.newLocal");
  const automationsShortcut = useShortcutLabel("automations.open");
  const boardSupported = useAnyProjectBoardSupported();
  // A board sits under Projects, so the item stays selected inside one.
  const projectsActive = useLocation({
    select: (location) =>
      location.pathname === "/projects" || location.pathname.startsWith("/board/"),
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
    void startNewThreadInCurrentProject().then((started) => {
      if (!started) openCommandPalette({ open: "new-thread-in" });
    });
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
      {boardSupported ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            size={size}
            isActive={projectsActive}
            render={<Link to="/projects" onClick={closeMobileSidebar} />}
          >
            <LayoutGridIcon />
            <span>Projects</span>
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
