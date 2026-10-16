import { scopeProjectRef, scopedProjectKey } from "@supaterm/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@supaterm/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { LayoutGridIcon, PlusIcon, SettingsIcon, XIcon } from "lucide-react";
import { useEffect } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { liveEnvironment } from "../../state/liveEnvironment";
import { useAtomCommand } from "../../state/use-atom-command";
import { forgetLiveActivation } from "../board/LiveEnvironmentDriver";
import { useLiveEnvironmentSupported } from "../board/liveEnvironmentState";
import { cn } from "../../lib/utils";
import { useAllEnvironmentShellsBootstrapped, useProject, useProjects } from "../../state/entities";
import { BOARD_ROUTE, useAnyProjectBoardSupported } from "../board/boardNavigation";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import type { ProjectTab } from "./projectTabs.logic";
import { useProjectTabsStore } from "./projectTabsStore";

/** Whether project tabs replace the sidebar on this device. */
export function useProjectTabsMode(): boolean {
  const enabled = useClientSettings((settings) => settings.projectTabsEnabled);
  return useAnyProjectBoardSupported() && enabled;
}

/** Records the board in view as the current tab. */
export function useShowProjectTab(tab: ProjectTab | null) {
  const show = useProjectTabsStore((state) => state.show);
  const environmentId = tab?.environmentId;
  const projectId = tab?.projectId;
  useEffect(() => {
    if (environmentId && projectId) show({ environmentId, projectId });
  }, [environmentId, projectId, show]);
}

/**
 * The tab strip that heads the board and projects pages in tabs mode: one tab
 * per open project, a + that opens the projects grid, and settings, since the
 * sidebar that usually holds them is hidden.
 */
export function ProjectTabsBar({ active }: { active: ProjectTab | null }) {
  const tabs = useProjectTabsStore((state) => state.tabs);
  const close = useProjectTabsStore((state) => state.close);
  const prune = useProjectTabsStore((state) => state.prune);
  const projects = useProjects();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const navigate = useNavigate();
  const activate = useAtomCommand(liveEnvironment.activate);

  useEffect(() => {
    if (!bootstrapped) return;
    const known = new Set(projects.map((project) => `${project.environmentId}\n${project.id}`));
    prune((tab) => known.has(`${tab.environmentId}\n${tab.projectId}`));
  }, [bootstrapped, projects, prune]);

  const closeTab = (tab: ProjectTab, liveSupported: boolean) => {
    const next = close(tab);
    // A closed project's live card goes warm, as if its board were left.
    if (liveSupported) {
      const ref = scopeProjectRef(tab.environmentId as EnvironmentId, tab.projectId as ProjectId);
      forgetLiveActivation(scopedProjectKey(ref));
      void activate({
        environmentId: ref.environmentId,
        input: { projectId: ref.projectId, threadId: null },
      });
    }
    if (!isSameTab(active, tab)) return;
    void (next === null
      ? navigate({ to: "/projects" })
      : navigate({
          to: BOARD_ROUTE,
          params: { environmentId: next.environmentId, projectId: next.projectId },
        }));
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <nav aria-label="Projects" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <ProjectTabItem
            key={`${tab.environmentId}\n${tab.projectId}`}
            tab={tab}
            active={isSameTab(active, tab)}
            onClose={(liveSupported) => closeTab(tab, liveSupported)}
          />
        ))}
      </nav>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Open a project"
        title="Open a project"
        render={<Link to="/projects" />}
      >
        {tabs.length === 0 ? <LayoutGridIcon /> : <PlusIcon />}
      </Button>
      <div className="min-w-4 flex-1" />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Settings"
        title="Settings"
        render={<Link to="/settings" />}
      >
        <SettingsIcon />
      </Button>
    </div>
  );
}

function isSameTab(a: ProjectTab | null, b: ProjectTab) {
  return a !== null && a.environmentId === b.environmentId && a.projectId === b.projectId;
}

function ProjectTabItem({
  tab,
  active,
  onClose,
}: {
  tab: ProjectTab;
  active: boolean;
  onClose: (liveSupported: boolean) => void;
}) {
  const project = useProject(
    scopeProjectRef(tab.environmentId as EnvironmentId, tab.projectId as ProjectId),
  );
  const liveSupported = useLiveEnvironmentSupported(tab.environmentId as EnvironmentId);
  if (project === null) return null;
  // The project's own accent, so the tab is recognisable before reading it.
  const accentColor = project.workspace?.appearance?.accentColor;
  return (
    <div
      className={cn(
        "group/tab flex h-7 max-w-52 shrink-0 items-center rounded-md text-sm",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Link
        to={BOARD_ROUTE}
        params={{ environmentId: tab.environmentId, projectId: tab.projectId }}
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 items-center gap-1.5 rounded-md py-1 ps-2 pe-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ProjectFavicon project={project} className="size-3.5 shrink-0" />
        <span className="truncate">{project.title}</span>
        {accentColor === undefined ? null : (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
        )}
      </Link>
      <button
        type="button"
        aria-label={`Close ${project.title}`}
        onClick={() => onClose(liveSupported)}
        className={cn(
          "me-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          !active && "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100",
        )}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
