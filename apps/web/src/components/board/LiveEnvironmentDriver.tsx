import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@supaterm/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ScopedProjectRef,
  type ThreadId,
} from "@supaterm/contracts";
import { desiredLiveCardId, resolveBoardColumns } from "@supaterm/shared/projectBoard";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import {
  useAllEnvironmentShellsBootstrapped,
  useProject,
  useThreadShell,
  useThreadShellsForProjectRefs,
} from "../../state/entities";
import { liveEnvironment } from "../../state/liveEnvironment";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { isSidebarSubagentThread } from "../Sidebar.logic";
import { useLiveEnvironmentSupported, useProjectLiveEnvironments } from "./liveEnvironmentState";

/** The last card each project was told to make live, so a view only reports changes. */
const lastActivated = new Map<string, string | null>();
const activationsInFlight = new Set<string>();

/** Forgets what a project was told, so viewing it again activates its live card anew. */
export function forgetLiveActivation(projectKey: string) {
  lastActivated.delete(projectKey);
}

/**
 * Tells the server which card each project wants live, based on what the user
 * is looking at: a project board makes its live column's top card live, and a
 * thread opened from the live column makes itself live. The server keeps the
 * previous card warm, so flipping between cards does not restart anything.
 */
export function LiveEnvironmentDriver() {
  const routeKey = useRouterState({
    select: (state) => {
      const match = state.matches[state.matches.length - 1];
      const params = (match?.params ?? {}) as Record<string, string | undefined>;
      if (state.location.pathname.startsWith("/board/")) {
        return params.environmentId && params.projectId
          ? `board\n${params.environmentId}\n${params.projectId}`
          : "";
      }
      const threadRef = resolveThreadRouteRef(params);
      return threadRef ? `thread\n${threadRef.environmentId}\n${threadRef.threadId}` : "";
    },
  });
  const [mode, environmentId, id] = routeKey.split("\n");
  const threadRef = useMemo(
    () =>
      mode === "thread" && environmentId && id
        ? scopeThreadRef(environmentId as EnvironmentId, id as ThreadId)
        : null,
    [environmentId, id, mode],
  );
  const openedThread = useThreadShell(threadRef);
  const boardProjectId = mode === "board" ? id : undefined;
  const projectEnvironmentId = mode === "board" ? environmentId : openedThread?.environmentId;
  const projectId = boardProjectId ?? openedThread?.projectId;
  const projectRef = useMemo(
    () =>
      projectEnvironmentId && projectId
        ? scopeProjectRef(projectEnvironmentId as EnvironmentId, projectId as ProjectId)
        : null,
    [projectEnvironmentId, projectId],
  );
  if (projectRef === null) return null;
  return (
    <ProjectLiveEnvironmentDriver
      key={scopedProjectKey(projectRef)}
      projectRef={projectRef}
      openedThreadId={mode === "thread" ? (id ?? null) : null}
    />
  );
}

function ProjectLiveEnvironmentDriver({
  projectRef,
  openedThreadId,
}: {
  projectRef: ScopedProjectRef;
  openedThreadId: string | null;
}) {
  const supported = useLiveEnvironmentSupported(projectRef.environmentId);
  const canOperate = useEnvironmentScope(projectRef.environmentId, AuthOrchestrationOperateScope);
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const project = useProject(projectRef);
  const projectRefs = useMemo(() => [projectRef], [projectRef]);
  const threads = useThreadShellsForProjectRefs(projectRefs);
  const environments = useProjectLiveEnvironments(projectRef);
  const activate = useAtomCommand(liveEnvironment.activate);

  const board = project?.board ?? null;
  const desired = useMemo(() => {
    const cards = threads.filter(
      (thread) => thread.deletedAt === null && !isSidebarSubagentThread(thread),
    );
    return desiredLiveCardId(board, resolveBoardColumns(board, cards), openedThreadId);
  }, [board, openedThreadId, threads]);

  useEffect(() => {
    if (!supported || !canOperate || !bootstrapped || project === null) return;
    if (desired === undefined) return;
    const key = scopedProjectKey(projectRef);
    if (activationsInFlight.has(key)) return;
    // A restarted server forgets its environments; ask again when the live card has none.
    const missing =
      desired !== null && environments.loaded && !environments.byThreadId.has(desired);
    if (lastActivated.has(key) && lastActivated.get(key) === desired && !missing) return;
    lastActivated.set(key, desired);
    activationsInFlight.add(key);
    void activate({
      environmentId: projectRef.environmentId,
      input: { projectId: projectRef.projectId, threadId: desired as ThreadId | null },
    }).then((result) => {
      activationsInFlight.delete(key);
      if (result._tag === "Failure") lastActivated.delete(key);
    });
  }, [activate, bootstrapped, canOperate, desired, environments, project, projectRef, supported]);

  return null;
}
