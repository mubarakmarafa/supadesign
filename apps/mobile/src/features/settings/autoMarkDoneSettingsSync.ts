import type { EnvironmentId, ProjectId, ServerSettings } from "@supaterm/contracts";

export type AutoMarkDoneSettings = Pick<
  ServerSettings,
  "sidebarAutoMarkDoneAfterDays" | "sidebarAutoMarkDoneOnMerge"
>;

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
  const patch: AutoMarkDoneSettings = {
    sidebarAutoMarkDoneAfterDays: reference.settings.sidebarAutoMarkDoneAfterDays,
    sidebarAutoMarkDoneOnMerge: reference.settings.sidebarAutoMarkDoneOnMerge,
  };
  const mismatches = targets.filter(
    (target) =>
      (target.environmentId !== reference.environmentId ||
        target.projectId !== reference.projectId) &&
      target.settings !== null &&
      (target.settings.sidebarAutoMarkDoneAfterDays !== patch.sidebarAutoMarkDoneAfterDays ||
        target.settings.sidebarAutoMarkDoneOnMerge !== patch.sidebarAutoMarkDoneOnMerge),
  );
  return { patch, mismatches };
}
