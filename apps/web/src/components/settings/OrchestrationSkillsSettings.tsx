import type { OrchestrationSkillsEnvironment } from "@supaterm/client-runtime/orchestrationSkills";
import { useOrchestrationSkills } from "../../state/useOrchestrationSkills";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

function SelectedEnvironmentSkills({
  environments,
}: {
  environments: readonly OrchestrationSkillsEnvironment[];
}) {
  const skills = useOrchestrationSkills(environments, serverEnvironment);
  const busy = skills.pending !== null;
  const stateLabel =
    skills.pending === "Status"
      ? "Checking…"
      : skills.pending === null && skills.installed
        ? "Installed"
        : null;
  const hasControl =
    stateLabel !== null || skills.canUninstall || skills.canInstall || skills.error;
  return (
    <SettingsRow
      title="Orchestration skills"
      description={
        <>
          Install supaterm-commitee and supaterm-advisor skills.
          {skills.notices.map((notice) => (
            <span className="block" key={notice}>
              {notice}
            </span>
          ))}
        </>
      }
      control={
        hasControl ? (
          <>
            {stateLabel ? (
              <span className="text-xs text-muted-foreground">{stateLabel}</span>
            ) : null}
            {skills.canUninstall ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void skills.request("Uninstall")}
              >
                {skills.pending === "Uninstall" ? "Uninstalling…" : "Uninstall"}
              </Button>
            ) : null}
            {skills.canInstall ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void skills.request("Install")}
              >
                {skills.pending === "Install" ? "Installing…" : "Install"}
              </Button>
            ) : null}
            {skills.error ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void skills.request("Status")}
              >
                Retry
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}

export function OrchestrationSkillsSettings() {
  const { environments, connectedEnvironments } = useSettingsScope();
  const offline = environments.filter(
    (environment) =>
      !connectedEnvironments.some(
        (connected) => connected.environmentId === environment.environmentId,
      ),
  );
  return (
    <SettingsSection {...searchableSetting("orchestration-skills")} hideTitle>
      {connectedEnvironments.length === 0 ? (
        <SettingsRow
          title="Orchestration skills"
          description="Connect to an environment to install supaterm-commitee and supaterm-advisor skills."
        />
      ) : (
        <SelectedEnvironmentSkills
          key={connectedEnvironments
            .map((environment) => environment.environmentId)
            .sort()
            .join(",")}
          environments={connectedEnvironments}
        />
      )}
      {offline.length > 0 ? (
        <SettingsRow
          title="Offline environments"
          description={`Skipped: ${offline.map((environment) => environment.label).join(", ")}. Reconnect and install again to include them.`}
        />
      ) : null}
    </SettingsSection>
  );
}
