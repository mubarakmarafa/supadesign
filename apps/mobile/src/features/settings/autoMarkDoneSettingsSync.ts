import type { EnvironmentId, ProjectId, ServerSettings } from "@supaterm/contracts";
import * as Struct from "effect/Struct";

export const AUTO_MARK_DONE_KEYS = [
  "sidebarAutoMarkDoneAfterDays",
  "sidebarAutoMarkDoneOnMerge",
  "sidebarAutoMarkDoneKeepPullRequests",
] as const satisfies ReadonlyArray<keyof ServerSettings>;

export type AutoMarkDoneSettings = Pick<ServerSettings, (typeof AUTO_MARK_DONE_KEYS)[number]>;

interface AutoMarkDoneSyncTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId | null;
  readonly label: string;
  readonly settings: AutoMarkDoneSettings | null;
}

/** Receives connected, capable targets. Applying these defaults must preserve other settings. */
export function planAutoMarkDoneSettingsSync(
  reference: {
    readonly environmentId: EnvironmentId;
    readonly projectId?: ProjectId | null;
    readonly settings: AutoMarkDoneSettings;
  },
  targets: readonly AutoMarkDoneSyncTarget[],
) {
  const patch: AutoMarkDoneSettings = Struct.pick(reference.settings, AUTO_MARK_DONE_KEYS);
  const mismatches = targets.filter(
    ({ environmentId, projectId, settings }) =>
      (environmentId !== reference.environmentId || projectId !== reference.projectId) &&
      settings !== null &&
      AUTO_MARK_DONE_KEYS.some((key) => settings[key] !== patch[key]),
  );
  return { patch, mismatches };
}
