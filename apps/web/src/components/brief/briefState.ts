import type { EnvironmentId, ProjectId, ThreadBrief, ThreadBriefList } from "@supaterm/contracts";
import { useMemo } from "react";

import { useServerConfigs } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { threadBrief } from "../../state/threadBrief";

const EMPTY: ReadonlyMap<string, ThreadBrief> = new Map();

export function useThreadBriefSupported(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  if (environmentId === null) return false;
  return configs.get(environmentId)?.environment.capabilities.threadBrief === true;
}

/** Each card's brief and decisions in a project, kept current by the server. */
export function useProjectThreadBriefs(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
): ReadonlyMap<string, ThreadBrief> {
  const supported = useThreadBriefSupported(environmentId);
  const query = useEnvironmentQuery(
    environmentId === null || projectId === null || !supported
      ? null
      : threadBrief.briefs({ environmentId, input: { projectId } }),
  );
  const list: ThreadBriefList | null = query.data;
  return useMemo(
    () => (list === null ? EMPTY : new Map(list.map((brief) => [brief.threadId, brief]))),
    [list],
  );
}
