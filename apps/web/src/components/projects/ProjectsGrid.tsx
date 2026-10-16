import { scopeProjectRef, scopedProjectKey } from "@supaterm/client-runtime/environment";
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import { Link } from "@tanstack/react-router";
import { FolderPlusIcon, LayoutGridIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useScratchProject } from "../../hooks/useScratchProject";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useServerConfigs,
  useThreadShellsForProjectRefs,
} from "../../state/entities";
import { projectSummary } from "../../state/projectSummary";
import { useEnvironmentQuery } from "../../state/query";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { BOARD_ROUTE } from "../board/boardNavigation";
import { useNow } from "../board/liveEnvironmentState";
import { ProjectFavicon } from "../ProjectFavicon";
import { isSidebarSubagentThread } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ProjectTabsBar, useProjectTabsMode } from "./ProjectTabs";
import { buildProjectsGrid } from "./projectsGrid.logic";

/** Every project whose environment shows boards, as cards that open the board. */
export function ProjectsGridPage() {
  const projects = useProjects();
  const configs = useServerConfigs();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const tabsMode = useProjectTabsMode();
  const { scratchWorkspaceRootFor } = useScratchProject();
  // The "No project" folder holds loose chats, not a repo to plan on a board.
  const boardProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          configs.get(project.environmentId)?.environment.capabilities.projectBoard === true &&
          !isScratchProject(project, scratchWorkspaceRootFor(project.environmentId)),
      ),
    [configs, projects, scratchWorkspaceRootFor],
  );
  const projectRefs = useMemo(
    () => boardProjects.map((project) => scopeProjectRef(project.environmentId, project.id)),
    [boardProjects],
  );
  const threads = useThreadShellsForProjectRefs(projectRefs);
  const entries = useMemo(
    () =>
      buildProjectsGrid(
        boardProjects,
        threads.filter((thread) => !isSidebarSubagentThread(thread)),
      ),
    [boardProjects, threads],
  );
  // Relative times only need minute precision.
  const now = useNow(60_000, entries.length > 0);

  let body;
  if (entries.length > 0) {
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 p-4">
          {entries.map((entry) => (
            <ProjectCard
              key={scopedProjectKey(scopeProjectRef(entry.project.environmentId, entry.project.id))}
              project={entry.project}
              lastThread={entry.lastThread}
              lastActivityMs={entry.lastActivityMs}
              threadCount={entry.threadCount}
              now={now}
            />
          ))}
        </ul>
      </div>
    );
  } else if (!bootstrapped) {
    body = null;
  } else {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutGridIcon />
          </EmptyMedia>
          <EmptyTitle>No projects yet</EmptyTitle>
          <EmptyDescription>Add a repo to plan its work on a board.</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => openCommandPalette({ open: "add-project" })}>
          <FolderPlusIcon />
          Add project
        </Button>
      </Empty>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          {tabsMode ? (
            <ProjectTabsBar active={null} />
          ) : (
            <WorkspaceBreadcrumb ariaLabel="Projects breadcrumb" className="min-w-0 flex-1">
              <WorkspaceBreadcrumbItem current>
                <h1>Projects</h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
          )}
        </WorkspacePageHeader>
        {body}
      </div>
    </SidebarInset>
  );
}

const ProjectCard = memo(function ProjectCard({
  project,
  lastThread,
  lastActivityMs,
  threadCount,
  now,
}: {
  project: EnvironmentProject;
  lastThread: EnvironmentThreadShell | null;
  lastActivityMs: number | null;
  threadCount: number;
  now: number;
}) {
  const summarySupported =
    useServerConfigs().get(project.environmentId)?.environment.capabilities.projectSummary === true;
  const summary = useEnvironmentQuery(
    summarySupported
      ? projectSummary.summary({
          environmentId: project.environmentId,
          input: { projectId: project.id },
        })
      : null,
  );
  const description = summary.data?.description ?? null;
  const edited =
    lastActivityMs === null
      ? null
      : formatRelativeTimeLabel(new Date(lastActivityMs).toISOString(), now);

  return (
    <li className="flex">
      <Link
        to={BOARD_ROUTE}
        params={{ environmentId: project.environmentId, projectId: project.id }}
        className="flex w-full flex-col gap-2 rounded-lg border bg-card p-3.5 text-start shadow-xs outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ProjectFavicon project={project} className="size-4 shrink-0" />
          <span className="truncate text-sm font-medium text-foreground">{project.title}</span>
        </span>
        <span className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
          {description ?? (summary.data === null ? "" : "No description")}
        </span>
        <span className="mt-auto flex min-w-0 flex-col gap-0.5 border-t pt-2 text-xs text-muted-foreground">
          {lastThread ? (
            <span className="truncate">
              <span className="text-foreground/80">Last thread</span> · {lastThread.title}
            </span>
          ) : (
            <span>No threads yet</span>
          )}
          <span className="truncate">
            {edited ? `Edited ${edited}` : null}
            {edited && threadCount > 0 ? " · " : null}
            {threadCount > 0 ? `${threadCount} ${threadCount === 1 ? "thread" : "threads"}` : null}
          </span>
        </span>
      </Link>
    </li>
  );
});
