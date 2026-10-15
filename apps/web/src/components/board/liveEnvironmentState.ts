import type { EnvironmentId, LiveEnvironmentSnapshot, ScopedProjectRef } from "@supaterm/contracts";
import { useEffect, useMemo, useState } from "react";

import { useServerConfigs } from "../../state/entities";
import { liveEnvironment } from "../../state/liveEnvironment";
import { useEnvironmentQuery } from "../../state/query";

const EMPTY: ReadonlyMap<string, LiveEnvironmentSnapshot> = new Map();

export function useLiveEnvironmentSupported(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  if (environmentId === null) return false;
  const capabilities = configs.get(environmentId)?.environment.capabilities;
  return capabilities?.projectBoard === true && capabilities.liveEnvironment === true;
}

/** The project's live environments by thread id, kept current by the server. */
export function useProjectLiveEnvironments(projectRef: ScopedProjectRef | null): {
  readonly byThreadId: ReadonlyMap<string, LiveEnvironmentSnapshot>;
  readonly loaded: boolean;
} {
  const supported = useLiveEnvironmentSupported(projectRef?.environmentId ?? null);
  const query = useEnvironmentQuery(
    projectRef === null || !supported
      ? null
      : liveEnvironment.environments({
          environmentId: projectRef.environmentId,
          input: { projectId: projectRef.projectId },
        }),
  );
  const environments = query.data?.environments;
  const byThreadId = useMemo(
    () =>
      environments === undefined
        ? EMPTY
        : new Map(environments.map((environment) => [environment.threadId, environment])),
    [environments],
  );
  return { byThreadId, loaded: environments !== undefined };
}

/** Wall-clock time that advances every `intervalMs` while enabled, for countdowns. */
export function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [enabled, intervalMs]);
  return now;
}

/** "localhost:5173" for a dev server URL, keeping any path. */
export function displayLiveUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}
