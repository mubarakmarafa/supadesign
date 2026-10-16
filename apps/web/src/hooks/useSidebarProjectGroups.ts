import { useMemo } from "react";

import { orderItemsByPreferredIds, sortSidebarV2ProjectGroups } from "../components/Sidebar.logic";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useEnvironmentIdentities, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useSidebarThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { useClientSettings } from "./useSettings";

export function useSidebarProjectGroups() {
  const projects = useProjects();
  const threads = useSidebarThreadShells();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const sortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const environments = useEnvironmentIdentities();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
      }),
    [projectOrder, projects],
  );
  const unsortedGroups = useMemo(() => {
    const labels = new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    );
    return buildSidebarProjectSnapshots({
      projects: sortOrder === "manual" ? orderedProjects : projects,
      groupScratchProjects: true,
      settings: groupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => labels.get(environmentId) ?? null,
    });
  }, [environments, groupingSettings, orderedProjects, primaryEnvironmentId, projects, sortOrder]);
  return useMemo(
    () => sortSidebarV2ProjectGroups(unsortedGroups, threads, sortOrder),
    [sortOrder, threads, unsortedGroups],
  );
}
