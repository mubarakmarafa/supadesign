import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { ProjectWorkspaceWidget, ScopedProjectRef } from "@supaterm/contracts";
import { Link } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";
import { useMemo } from "react";

import { usePullRequestList } from "../../../state/pullRequests";
import { useEnvironmentQuery } from "../../../state/query";
import { vcsEnvironment } from "../../../state/vcs";
import { PullRequestGlyph } from "../../pullRequest/pullRequestIcons";
import { Badge } from "../../ui/badge";
import { openExternalUrl } from "../openExternalUrl";
import { WidgetMessage, WorkspaceWidgetFrame } from "../WorkspaceWidgetFrame";

const BRANCH_LIMIT = 12;
const PULL_REQUEST_LIMIT = 10;

/**
 * The project folder's branch and changes, its local branches, and its open
 * pull requests. Read-only: switching, pushing, and merging stay where they
 * are today until the Git visualizer arrives.
 */
export function GitWidget({
  widget,
  projectRef,
  project,
}: {
  widget: ProjectWorkspaceWidget;
  projectRef: ScopedProjectRef;
  project: EnvironmentProject;
}) {
  const { environmentId } = projectRef;
  const cwd = project.workspaceRoot;
  const status = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }));
  const branches = useEnvironmentQuery(
    vcsEnvironment.listRefs({
      environmentId,
      input: { cwd, refKind: "local", limit: BRANCH_LIMIT },
    }),
  );
  const pullRequestTargets = useMemo(
    () => [
      {
        environmentId,
        input: {
          state: "open" as const,
          projectId: projectRef.projectId,
          limit: PULL_REQUEST_LIMIT,
        },
      },
    ],
    [environmentId, projectRef.projectId],
  );
  const pullRequests = usePullRequestList(pullRequestTargets);
  const openPullRequests = pullRequests.data?.entries ?? [];

  const current = status.data;
  let body;
  if (current !== null && !current.isRepo) {
    body = <WidgetMessage>This project isn't a Git repository.</WidgetMessage>;
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm">
        <section aria-label="Current branch" className="flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <GitBranchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">
              {current?.refName ?? (status.isPending ? "Reading…" : "Detached")}
            </span>
            {current?.isDefaultRef ? <Badge variant="secondary">default</Badge> : null}
          </div>
          {current ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {current.hasUpstream
                ? `${current.aheadCount} ahead · ${current.behindCount} behind`
                : "Not pushed yet"}
              {current.hasWorkingTreeChanges
                ? ` · ${current.workingTree.files.length} changed (+${current.workingTree.insertions} −${current.workingTree.deletions})`
                : " · No uncommitted changes"}
            </p>
          ) : null}
          {current?.pr ? (
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5 text-start text-xs hover:underline"
              onClick={() => current.pr && openExternalUrl(current.pr.url)}
            >
              <PullRequestGlyph.pullRequest aria-hidden className="size-3 shrink-0" />
              <span className="min-w-0 truncate">
                #{current.pr.number} {current.pr.title}
              </span>
            </button>
          ) : null}
        </section>

        <section aria-label="Open pull requests" className="flex flex-col gap-1">
          <h3 className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            Open pull requests
            <Link
              to="/pull-requests"
              search={{ involvement: "all", state: "open", projectId: projectRef.projectId }}
              className="font-normal underline-offset-4 hover:underline"
            >
              All
            </Link>
          </h3>
          {openPullRequests.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {pullRequests.isPending
                ? "Loading…"
                : (pullRequests.error ?? "No open pull requests.")}
            </p>
          ) : (
            <ul className="flex flex-col">
              {openPullRequests.map((entry) => (
                <li key={`${entry.host} ${entry.repository} ${entry.number}`}>
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-start hover:bg-accent"
                    onClick={() => openExternalUrl(entry.url)}
                  >
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      #{entry.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    {entry.isDraft ? <Badge variant="outline">draft</Badge> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Local branches" className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Branches</h3>
          {(branches.data?.refs.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">
              {branches.isPending ? "Loading…" : (branches.error ?? "No local branches.")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {branches.data?.refs.map((branch) => (
                <li key={branch.name} className="flex min-w-0 items-center gap-2 px-1 text-xs">
                  <span
                    className={branch.current ? "min-w-0 truncate font-medium" : "min-w-0 truncate"}
                  >
                    {branch.name}
                  </span>
                  {branch.current ? <Badge variant="secondary">current</Badge> : null}
                  {branch.worktreePath !== null && !branch.current ? (
                    <Badge variant="outline">worktree</Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <WorkspaceWidgetFrame widget={widget} title="Git" icon={<GitBranchIcon />}>
      {body}
    </WorkspaceWidgetFrame>
  );
}
