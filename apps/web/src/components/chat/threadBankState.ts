import type {
  EnvironmentId,
  ProjectId,
  ThreadBankEntry,
  ThreadBankList,
} from "@supaterm/contracts";
import { useMemo } from "react";

import { useServerConfigs } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { threadBank } from "../../state/threadBank";

const EMPTY_BANKS: ReadonlyMap<string, ReadonlyArray<ThreadBankEntry>> = new Map();
const EMPTY_ENTRIES: ReadonlyArray<ThreadBankEntry> = [];

export function useThreadBankSupported(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  if (environmentId === null) return false;
  return configs.get(environmentId)?.environment.capabilities.threadBank === true;
}

/** Each thread's banked messages in a project, kept current by the server. */
export function useProjectThreadBanks(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
): ReadonlyMap<string, ReadonlyArray<ThreadBankEntry>> {
  const supported = useThreadBankSupported(environmentId);
  const query = useEnvironmentQuery(
    environmentId === null || projectId === null || !supported
      ? null
      : threadBank.banks({ environmentId, input: { projectId } }),
  );
  const banks: ThreadBankList | null = query.data;
  return useMemo(
    () =>
      banks === null ? EMPTY_BANKS : new Map(banks.map((bank) => [bank.threadId, bank.entries])),
    [banks],
  );
}

export function useThreadBankEntries(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
  threadId: string | null,
): ReadonlyArray<ThreadBankEntry> {
  const banks = useProjectThreadBanks(environmentId, projectId);
  return (threadId === null ? undefined : banks.get(threadId)) ?? EMPTY_ENTRIES;
}
