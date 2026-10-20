import type { BoardAutomationRun, EnvironmentId, ProjectId } from "@supaterm/contracts";
import { useMemo } from "react";

import { boardAutomation } from "../../state/boardAutomation";
import { useServerConfigs } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";

const EMPTY_RUNS: ReadonlyMap<string, BoardAutomationRun> = new Map();

export function useBoardAutomationsSupported(environmentId: EnvironmentId): boolean {
  const configs = useServerConfigs();
  return configs.get(environmentId)?.environment.capabilities.boardAutomations === true;
}

/** Each card's waiting, sent, or failed column automations, kept current by the server. */
export function useProjectBoardAutomations(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyMap<string, BoardAutomationRun> {
  const supported = useBoardAutomationsSupported(environmentId);
  const query = useEnvironmentQuery(
    supported ? boardAutomation.runs({ environmentId, input: { projectId } }) : null,
  );
  const runs = query.data;
  return useMemo(
    () => (runs === null ? EMPTY_RUNS : new Map(runs.map((run) => [run.threadId, run]))),
    [runs],
  );
}
