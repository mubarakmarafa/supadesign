import { scopedProjectKey } from "@supaterm/client-runtime/environment";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  type ProjectWorkspace,
  type ScopedProjectRef,
  validateProjectWorkspace,
} from "@supaterm/contracts";
import { useCallback } from "react";
import { create } from "zustand";

import { useServerConfigs } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentScope } from "../../state/session";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { workspaceOrDefault } from "./workspaceLogic";

/**
 * The last workspace edit per project, shown until the server echoes it. The
 * header controls and the grid both read it, so it lives outside either.
 */
interface WorkspaceEditStore {
  readonly edits: Readonly<
    Record<string, { readonly base: ProjectWorkspace | null; readonly workspace: ProjectWorkspace }>
  >;
  set: (
    key: string,
    edit: { readonly base: ProjectWorkspace | null; readonly workspace: ProjectWorkspace } | null,
  ) => void;
}

const useWorkspaceEditStore = create<WorkspaceEditStore>((set) => ({
  edits: {},
  set: (key, edit) =>
    set((state) => {
      const { [key]: _previous, ...rest } = state.edits;
      return { edits: edit === null ? rest : { ...rest, [key]: edit } };
    }),
}));

export interface ProjectWorkspaceState {
  /** Servers older than workspaces show the plain board and no controls. */
  readonly supported: boolean;
  readonly canEdit: boolean;
  readonly workspace: ProjectWorkspace;
  readonly commit: (next: ProjectWorkspace | null) => void;
}

export function useProjectWorkspace(
  projectRef: ScopedProjectRef,
  project: EnvironmentProject,
): ProjectWorkspaceState {
  const key = scopedProjectKey(projectRef);
  const configs = useServerConfigs();
  const supported =
    configs.get(projectRef.environmentId)?.environment.capabilities.projectWorkspace === true;
  const canOperate = useEnvironmentScope(projectRef.environmentId, AuthOrchestrationOperateScope);
  const updateProject = useOrchestrationCommand(projectEnvironment.update);
  const serverWorkspace = project.workspace ?? null;
  const edit = useWorkspaceEditStore((state) => state.edits[key]);
  const setEdit = useWorkspaceEditStore((state) => state.set);
  const stored =
    edit !== undefined && edit.base === serverWorkspace ? edit.workspace : serverWorkspace;

  const commit = useCallback(
    (next: ProjectWorkspace | null) => {
      if (next === null) return;
      if (validateProjectWorkspace(next).length > 0) {
        toastManager.add(
          stackedThreadToast({
            type: "info",
            title: "Couldn't update the workspace",
            description: "That change would leave the workspace invalid.",
          }),
        );
        return;
      }
      setEdit(key, { base: serverWorkspace, workspace: next });
      void updateProject({
        environmentId: projectRef.environmentId,
        input: { projectId: projectRef.projectId, workspace: next },
      }).then((result) => {
        if (result._tag === "Failure") setEdit(key, null);
      });
    },
    [key, projectRef, serverWorkspace, setEdit, updateProject],
  );

  return {
    supported,
    canEdit: supported && canOperate,
    workspace: supported ? workspaceOrDefault(stored) : workspaceOrDefault(null),
    commit,
  };
}
