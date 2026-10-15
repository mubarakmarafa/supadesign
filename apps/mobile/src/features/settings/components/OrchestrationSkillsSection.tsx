import type { OrchestrationSkillsEnvironment } from "@supaterm/client-runtime/orchestrationSkills";
import { useOrchestrationSkills } from "../../../state/useOrchestrationSkills";
import { serverEnvironment } from "../../../state/server";
import { AppText as Text } from "../../../components/AppText";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

export function OrchestrationSkillsSection({
  environments,
}: {
  environments: readonly OrchestrationSkillsEnvironment[];
}) {
  const skills = useOrchestrationSkills(environments, serverEnvironment);
  const busy = skills.pending !== null;
  return (
    <SettingsSection title="Orchestration skills">
      <Text className="p-4 text-sm text-foreground-muted">
        Install supaterm-commitee and supaterm-advisor skills.
      </Text>
      <SettingsRow
        icon="arrow.down.circle"
        label={
          skills.installed ? "Installed" : skills.pending === "Install" ? "Installing…" : "Install"
        }
        disabled={busy || !skills.canInstall}
        onPress={() => void skills.request("Install")}
      />
      {skills.canUninstall ? (
        <SettingsRow
          icon="trash"
          label={skills.pending === "Uninstall" ? "Uninstalling…" : "Uninstall"}
          disabled={busy || !skills.canUninstall}
          onPress={() => void skills.request("Uninstall")}
        />
      ) : null}
      {skills.notices.map((notice) => (
        <Text key={notice} className="p-4 text-sm text-foreground-muted">
          {notice}
        </Text>
      ))}
      {skills.error ? (
        <SettingsRow
          icon="arrow.clockwise"
          label="Retry"
          value="Retry the selected environments."
          disabled={busy}
          onPress={() => void skills.request("Status")}
        />
      ) : null}
    </SettingsSection>
  );
}
