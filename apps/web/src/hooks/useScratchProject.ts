import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import { availableScratchWorkspaceRoot } from "@supaterm/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { EnvironmentId } from "@supaterm/contracts";
import { useCallback, useMemo } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironments } from "~/state/environments";
import { useProjects } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

function reportScratchFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * Threads without a project live in the environment's scratch project, a
 * plain folder the server owns (users see it as "No project"). The server
 * creates it on first use; after that it is an ordinary project on the
 * non-git path, and each thread gets its own subfolder.
 */
export function useScratchProject() {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  const scratchWorkspaceRoots = useMemo(
    () =>
      new Map(
        environments.map((environment) => [
          environment.environmentId,
          availableScratchWorkspaceRoot({
            environmentId: environment.environmentId,
            connectionPhase: environment.connection.phase,
            serverConfig: environment.serverConfig,
            projects,
          }),
        ]),
      ),
    [environments, projects],
  );
  const scratchWorkspaceRootFor = useCallback(
    (environmentId: EnvironmentId | null): string | null =>
      environmentId === null ? null : (scratchWorkspaceRoots.get(environmentId) ?? null),
    [scratchWorkspaceRoots],
  );

  // A thread without a project starts on the machine the user is working on,
  // and only there. With no current machine (the hosted app with nothing
  // open), it starts on the one machine that offers it, never a silent pick.
  const scratchEnvironmentId = useCallback(
    (current: EnvironmentId | null): EnvironmentId | null => {
      if (current !== null) return scratchWorkspaceRootFor(current) !== null ? current : null;
      const offering = environments.filter(
        (entry) => scratchWorkspaceRootFor(entry.environmentId) !== null,
      );
      return offering.length === 1 ? (offering[0]?.environmentId ?? null) : null;
    },
    [environments, scratchWorkspaceRootFor],
  );

  /** Resolves to the scratch project once it is in this client's store. */
  const openScratchProject = useCallback(
    async (
      environmentId: EnvironmentId,
      failureTitle = "Could not start without a project",
    ): Promise<EnvironmentProject | null> => {
      const result = await openScratch({ environmentId, input: {} });
      if (result._tag === "Success") return result.value;
      if (!isAtomCommandInterrupted(result)) {
        reportScratchFailure(failureTitle, squashAtomCommandFailure(result));
      }
      return null;
    },
    [openScratch],
  );

  const startScratchThread = useCallback(
    async (environmentId: EnvironmentId, prompt?: string) => {
      const project = await openScratchProject(environmentId);
      if (!project) return;
      const opened = await handleNewThread(
        scopeProjectRef(project.environmentId, project.id),
      ).catch((error: unknown) => {
        reportScratchFailure("Could not start without a project", error);
        return null;
      });
      if (opened && prompt !== undefined) {
        useComposerDraftStore.getState().setPrompt(opened.draftId, prompt);
      }
    },
    [handleNewThread, openScratchProject],
  );

  return { scratchWorkspaceRootFor, scratchEnvironmentId, openScratchProject, startScratchThread };
}
