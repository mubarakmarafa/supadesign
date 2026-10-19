import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type {
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { firstOrderedProjectRef } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { readProject, readProjects, readThreadShell } from "../../state/entities";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../../state/server";
import { resolveThreadRouteTarget, buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";

/** Marks a thread entry opened from a board, so Escape can return to it. */
export interface BoardOrigin {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** History index of the board entry the thread was pushed from. */
  readonly index: number;
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    boardOrigin?: BoardOrigin;
  }
}

export const BOARD_ROUTE = "/board/$environmentId/$projectId";

export function readProjectBoardSupported(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .projectBoard === true
  );
}

/** Whether any connected environment can show boards; gates every board entry point. */
export function useAnyProjectBoardSupported(): boolean {
  const configs = useAtomValue(environmentServerConfigsAtom);
  for (const config of configs.values()) {
    if (config.environment.capabilities.projectBoard === true) return true;
  }
  return false;
}

/** The project a board shortcut means right now: the open board's, the open thread's or draft's, then the first one. */
function resolveContextProjectRef(
  params: Record<string, string | undefined>,
  pathname: string,
): ScopedProjectRef | null {
  if (pathname.startsWith("/board/") && params.environmentId && params.projectId) {
    return scopeProjectRef(params.environmentId as EnvironmentId, params.projectId as ProjectId);
  }
  const target = resolveThreadRouteTarget(params);
  if (target?.kind === "server") {
    const thread = readThreadShell(target.threadRef);
    if (thread) return scopeProjectRef(thread.environmentId, thread.projectId);
  } else if (target?.kind === "draft") {
    const draft = useComposerDraftStore.getState().getDraftSession(target.draftId);
    if (draft) return scopeProjectRef(draft.environmentId, draft.projectId);
  }
  return null;
}

/**
 * Opens a project board. Without a preferred project it uses the one in view,
 * falling back to the first project whose environment supports boards.
 * Returns false when no board can be shown.
 */
export function useOpenProjectBoard() {
  const router = useRouter();
  return useCallback(
    (preferred?: ScopedProjectRef | null): boolean => {
      const match = router.state.matches[router.state.matches.length - 1];
      const contextRef =
        preferred ??
        resolveContextProjectRef(
          (match?.params ?? {}) as Record<string, string | undefined>,
          router.state.location.pathname,
        );
      const ref =
        contextRef !== null && readProjectBoardSupported(contextRef.environmentId)
          ? contextRef
          : firstOrderedProjectRef(
              readProjects().filter((project) => readProjectBoardSupported(project.environmentId)),
              useUiStateStore.getState().projectOrder,
            );
      if (ref === null) return false;
      void router.navigate({
        to: BOARD_ROUTE,
        params: { environmentId: ref.environmentId, projectId: ref.projectId },
      });
      return true;
    },
    [router],
  );
}

/** Opens a card's thread, remembering the board entry so Escape can go back to it. */
export function useOpenThreadFromBoard() {
  const router = useRouter();
  return useCallback(
    (threadRef: ScopedThreadRef, projectId: ProjectId) => {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
        state: {
          boardOrigin: {
            environmentId: threadRef.environmentId,
            projectId,
            index: router.history.location.state.__TSR_index,
          },
        },
      });
    },
    [router],
  );
}

/**
 * Opens a project at its board, the project's home. Returns false, doing
 * nothing, for the "No project" folder and environments without boards, so
 * the caller can open a thread as before.
 */
export function useOpenProjectHome() {
  const router = useRouter();
  const { scratchWorkspaceRootFor } = useScratchProject();
  return useCallback(
    (projectRef: ScopedProjectRef, options?: { readonly replace?: boolean }): boolean => {
      const project = readProject(projectRef);
      const scratch =
        project !== null &&
        isScratchProject(project, scratchWorkspaceRootFor(projectRef.environmentId));
      if (scratch || !readProjectBoardSupported(projectRef.environmentId)) return false;
      void router.navigate({
        to: BOARD_ROUTE,
        params: { environmentId: projectRef.environmentId, projectId: projectRef.projectId },
        ...(options?.replace ? { replace: true } : {}),
      });
      return true;
    },
    [router, scratchWorkspaceRootFor],
  );
}

/** Whether a project has a board to go back to. */
export function useProjectHasBoard(project: EnvironmentProject | null): boolean {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const { scratchWorkspaceRootFor } = useScratchProject();
  if (project === null) return false;
  return (
    configs.get(project.environmentId)?.environment.capabilities.projectBoard === true &&
    !isScratchProject(project, scratchWorkspaceRootFor(project.environmentId))
  );
}

/**
 * Leaves a thread for its project's board: back through history when the
 * thread was opened from that board, so the board is as it was, otherwise
 * straight to it. On the board itself it closes the side peek.
 */
export function useBackToProjectBoard() {
  const router = useRouter();
  return useCallback(
    (projectRef: ScopedProjectRef) => {
      const location = router.state.location;
      const origin = location.state.boardOrigin;
      if (
        origin !== undefined &&
        origin.environmentId === projectRef.environmentId &&
        origin.projectId === projectRef.projectId &&
        origin.index === location.state.__TSR_index - 1
      ) {
        router.history.back();
        return;
      }
      const params = { environmentId: projectRef.environmentId, projectId: projectRef.projectId };
      const onBoard = location.pathname === `/board/${params.environmentId}/${params.projectId}`;
      void router.navigate({
        to: BOARD_ROUTE,
        params,
        ...(onBoard ? { search: {}, replace: true } : {}),
      });
    },
    [router],
  );
}
