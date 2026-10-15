import { resolveEnvironmentMachineKind } from "@supaterm/contracts";
import { ChevronDownIcon, FolderIcon, LayersIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { EnvironmentPresentation } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button, InlineButton } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import type { ResolvedSettingsScope, SettingsScopeSearch } from "./settingsScope";
import {
  ALL_ENVIRONMENTS_VALUE,
  ALL_PROJECTS_VALUE,
  environmentAxisValue,
  projectAxisValue,
  selectEnvironmentAxis,
  selectProjectAxis,
  settingsScopeEnvironmentLabel,
} from "./settingsScopeAxis";

interface ScopeSentenceProps {
  readonly lead: string;
  readonly presentation?: "sentence" | "filters";
  readonly value: SettingsScopeSearch;
  /** `value` resolved against `groups` and `environments`. */
  readonly scope: ResolvedSettingsScope;
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly environments: readonly EnvironmentPresentation[];
  /** Drops "All environments" for pages that always target one environment. */
  readonly singleEnvironment?: boolean;
  readonly onChange: (next: SettingsScopeSearch) => void;
}

type ScopeMenuProps = Omit<ScopeSentenceProps, "lead">;

/** "<lead> <project> across <environment>", with a picker for each axis. */
export function ScopeSentence({ lead, ...props }: ScopeSentenceProps) {
  if (props.presentation === "filters") {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label={lead}>
        <ProjectScopeMenu {...props} />
        <EnvironmentScopeMenu {...props} />
      </div>
    );
  }
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-3 text-base text-muted-foreground sm:px-4">
      {/* Each connective stays with its picker so a wrap never strands "on". */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0">{lead}</span>
        <ProjectScopeMenu {...props} />
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0">
          {/* A legacy checkout link names one environment without `machine`. */}
          {props.value.machine || props.scope.kind === "checkout" ? "on" : "across"}
        </span>
        <EnvironmentScopeMenu {...props} />
      </span>
    </p>
  );
}

function ScopeMenu({
  ariaLabel,
  icon,
  label,
  children,
  presentation,
}: {
  ariaLabel: string;
  icon: ReactNode;
  label: string;
  children: ReactNode;
  presentation?: ScopeSentenceProps["presentation"];
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`${ariaLabel}: ${label}`}
        render={
          presentation === "filters" ? (
            <Button variant="outline" size="comfortable" />
          ) : (
            <InlineButton tone="picker" />
          )
        }
        className="min-w-0 max-w-72"
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start">{children}</MenuPopup>
    </Menu>
  );
}

function EnvironmentScopeMenu({
  value,
  scope,
  environments,
  onChange,
  singleEnvironment = false,
  presentation,
}: ScopeMenuProps) {
  const environmentValue = environmentAxisValue(
    value,
    scope.kind === "checkout" ? scope.environmentId : null,
  );
  const selected = environments.find(
    (environment) => environment.environmentId === environmentValue,
  );
  return (
    <ScopeMenu
      ariaLabel="Environment scope"
      presentation={presentation}
      icon={
        selected ? (
          <EnvironmentMachineIcon
            aria-hidden
            kind={resolveEnvironmentMachineKind(selected.serverConfig)}
            className="size-3.5 shrink-0"
          />
        ) : presentation === "filters" ? (
          <LayersIcon aria-hidden className="size-3.5 shrink-0" />
        ) : null
      }
      label={
        selected
          ? settingsScopeEnvironmentLabel(selected, environments)
          : environmentValue !== ALL_ENVIRONMENTS_VALUE
            ? "Unavailable environment"
            : singleEnvironment
              ? "No environments"
              : "All environments"
      }
    >
      <MenuRadioGroup
        value={environmentValue}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(selectEnvironmentAxis(value, next));
        }}
      >
        {!singleEnvironment ? (
          <>
            <MenuRadioItem value={ALL_ENVIRONMENTS_VALUE} closeOnClick>
              <span className="flex min-w-0 items-center gap-2">
                <LayersIcon aria-hidden className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">All environments</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
            <MenuSeparator />
          </>
        ) : null}
        {environments.map((environment) => (
          <MenuRadioItem
            key={environment.environmentId}
            value={environment.environmentId}
            closeOnClick
          >
            <span className="flex min-w-0 items-center gap-2">
              <EnvironmentMachineIcon
                aria-hidden
                kind={resolveEnvironmentMachineKind(environment.serverConfig)}
                className="size-3.5"
              />
              <span className="min-w-0 flex-1 truncate">
                {settingsScopeEnvironmentLabel(environment, environments)}
              </span>
              {environment.connection.phase === "connected" ? null : (
                <span className="shrink-0 text-xs text-muted-foreground">Offline</span>
              )}
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </ScopeMenu>
  );
}

function ProjectScopeMenu({ value, groups, onChange, presentation }: ScopeMenuProps) {
  const selected = groups.find((group) => group.projectKey === value.project);
  return (
    <ScopeMenu
      ariaLabel="Project scope"
      presentation={presentation}
      icon={
        selected ? (
          <ProjectFavicon project={selected} className="size-3.5 shrink-0" />
        ) : presentation === "filters" ? (
          <FolderIcon aria-hidden className="size-3.5 shrink-0" />
        ) : null
      }
      label={selected?.displayName ?? (value.project ? "Unavailable project" : "All projects")}
    >
      <MenuRadioGroup
        value={projectAxisValue(value)}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(selectProjectAxis(value, next));
        }}
      >
        <MenuRadioItem value={ALL_PROJECTS_VALUE} closeOnClick>
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate">All projects</span>
            <MenuRadioItemIndicator />
          </span>
        </MenuRadioItem>
        <MenuSeparator />
        {groups.map((group) => (
          <MenuRadioItem key={group.projectKey} value={group.projectKey} closeOnClick>
            <span className="flex min-w-0 items-center gap-2">
              <ProjectFavicon project={group} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{group.displayName}</span>
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </ScopeMenu>
  );
}
