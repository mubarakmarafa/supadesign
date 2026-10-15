import { useNavigation } from "@react-navigation/native";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { ScopedProjectRef } from "@supaterm/contracts";
import { useCallback, useEffect } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects } from "../../state/projects";
import {
  ensureComposerDraftsLoaded,
  stickyNewTaskProjectAtom,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";

/**
 * Where compose goes inside the new-task sheet: the remembered project's
 * draft, the picker when it is not listed, or nowhere while already composing.
 */
export function resolveStartNewTaskTarget(input: {
  readonly topRouteName: string | undefined;
  readonly stickyProject: ScopedProjectRef | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}) {
  // New params would retarget the open draft to the remembered project.
  if (input.topRouteName === "NewTaskSheet") {
    return null;
  }
  const sticky = input.stickyProject;
  const project = sticky
    ? input.projects.find(
        (candidate) =>
          candidate.environmentId === sticky.environmentId && candidate.id === sticky.projectId,
      )
    : undefined;
  if (!project) {
    return { screen: "NewTask" } as const;
  }
  return {
    screen: "NewTaskDraft",
    params: {
      environmentId: project.environmentId,
      projectId: project.id,
      title: project.title,
    },
  } as const;
}

/** A screen's navigation or a navigator's own helpers. */
interface StartNewTaskNavigation {
  getParent(): StartNewTaskNavigation | undefined;
  getState():
    | { readonly index: number; readonly routes: ReadonlyArray<{ readonly name: string }> }
    | undefined;
  navigate(
    name: "NewTaskSheet",
    params: NonNullable<ReturnType<typeof resolveStartNewTaskTarget>>,
  ): void;
}

/**
 * The compose action. Waits for the remembered project to hydrate and reads
 * state at press time, so callers do not re-render on project changes.
 * Navigators, which cannot call the hook, pass their own navigation.
 */
export function startNewTask(navigation: StartNewTaskNavigation): void {
  void waitForComposerDraftsLoaded()
    .then(
      () => appAtomRegistry.get(stickyNewTaskProjectAtom),
      () => null,
    )
    .then((stickyProject) => {
      let root = navigation;
      for (let parent = root.getParent(); parent; parent = parent.getParent()) {
        root = parent;
      }
      const rootState = root.getState();
      const target = resolveStartNewTaskTarget({
        topRouteName: rootState?.routes[rootState.index]?.name,
        stickyProject,
        // The draft's own catalog: projects on enabled environments only.
        projects: appAtomRegistry.get(environmentProjects.projectsAtom),
      });
      if (target) {
        navigation.navigate("NewTaskSheet", target);
      }
    });
}

export function useStartNewTask(): () => void {
  const navigation = useNavigation();
  useEffect(() => {
    ensureComposerDraftsLoaded();
  }, []);
  return useCallback(() => startNewTask(navigation), [navigation]);
}
