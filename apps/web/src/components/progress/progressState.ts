import type {
  EnvironmentId,
  ProjectId,
  ThreadProgress,
  ThreadProgressList,
} from "@supaterm/contracts";
import { useMemo } from "react";

import { useServerConfigs } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { threadProgress } from "../../state/threadProgress";

const EMPTY: ReadonlyMap<string, ThreadProgress> = new Map();

export function useThreadProgressSupported(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  if (environmentId === null) return false;
  return configs.get(environmentId)?.environment.capabilities.threadProgress === true;
}

/** Each card's progress images and summary in a project, kept current by the server. */
export function useProjectThreadProgress(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
): ReadonlyMap<string, ThreadProgress> {
  const supported = useThreadProgressSupported(environmentId);
  const query = useEnvironmentQuery(
    environmentId === null || projectId === null || !supported
      ? null
      : threadProgress.progress({ environmentId, input: { projectId } }),
  );
  const list: ThreadProgressList | null = query.data;
  return useMemo(
    () => (list === null ? EMPTY : new Map(list.map((progress) => [progress.threadId, progress]))),
    [list],
  );
}

export function useThreadProgress(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
  threadId: string | null,
): ThreadProgress | undefined {
  const all = useProjectThreadProgress(environmentId, projectId);
  return threadId === null ? undefined : all.get(threadId);
}
