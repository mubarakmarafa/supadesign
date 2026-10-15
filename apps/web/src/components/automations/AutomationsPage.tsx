import { CircleAlertIcon, Clock3Icon, PlusIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import type { EnvironmentId, ScheduledTask, ScheduledTaskId } from "@supaterm/contracts";
import { AuthOrchestrationOperateScope, resolveEnvironmentMachineKind } from "@supaterm/contracts";

import { isElectron } from "../../env";
import { useNowMinuteMs } from "../../hooks/useNowMinute";
import { projectGroupMemberKeys } from "../../sidebarProjectGrouping";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ScopeSentence } from "../settings/ScopeSentence";
import { selectScopedSettingsEnvironments } from "../settings/scopedSettings";
import { resolveSettingsScope, type ResolvedSettingsScope } from "../settings/settingsScope";
import { SettingsGroup } from "../settings/SettingsGroup";
import { useSettingsProjectGroups } from "../settings/useSettingsProjectGroups";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { AutomationEditorDialog } from "./AutomationEditorDialog";
import { AutomationRow } from "./AutomationRow";
import { automationsScopeSearch, matchesAutomationScope } from "./automations.logic";

const route = getRouteApi("/_chat/automations");

/**
 * Every environment's scheduled tasks in one list. The project and environment
 * scope narrows both the list and where a new automation can be created.
 */
export function AutomationsPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const groups = useSettingsProjectGroups();
  const { environments: availableEnvironments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const scope = useMemo(
    () => resolveSettingsScope(search, groups, availableEnvironments),
    [availableEnvironments, groups, search],
  );
  const {
    environments,
    connectedEnvironments,
    environment: defaultEnvironment,
  } = selectScopedSettingsEnvironments(scope, availableEnvironments, primaryEnvironmentId);
  const writableEnvironmentIds = useEnvironmentsWithScope(
    connectedEnvironments,
    AuthOrchestrationOperateScope,
  );
  const writableEnvironments = connectedEnvironments.filter((entry) =>
    writableEnvironmentIds.has(entry.environmentId),
  );
  const creationEnvironment =
    writableEnvironments.find(
      (entry) => entry.environmentId === defaultEnvironment?.environmentId,
    ) ?? writableEnvironments[0];
  const projectNameByKey = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          [...projectGroupMemberKeys(group)].map((key) => [key, group.displayName] as const),
        ),
      ),
    [groups],
  );
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    task: ScheduledTask | null;
  } | null>(null);
  const openForEdit = useCallback((environmentId: EnvironmentId, task: ScheduledTask) => {
    setEditor({ environmentId, task });
  }, []);
  const openForCreate = useCallback((environmentId: EnvironmentId) => {
    if (readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      setEditor({ environmentId, task: null });
    }
  }, []);
  const hasTaskLink = search.environmentId !== undefined || search.taskId !== undefined;
  const closeEditor = () => {
    setEditor(null);
    if (!hasTaskLink) return;
    void navigate({ search: automationsScopeSearch, replace: true });
  };
  const linkEnvironmentId = search.environmentId ?? defaultEnvironment?.environmentId;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Automations breadcrumb" className="min-w-0 flex-1">
            <WorkspaceBreadcrumbItem current>
              <h1>Automations</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <Button
            variant="default"
            disabled={!creationEnvironment}
            onClick={() => creationEnvironment && openForCreate(creationEnvironment.environmentId)}
          >
            <PlusIcon />
            New automation
          </Button>
        </WorkspacePageHeader>

        <div className="topbar-scroll-fade scrollbar-gutter-both flex-1 overflow-y-auto">
          <WorkspacePageContainer>
            <ScopeSentence
              lead="Showing automations for"
              presentation="filters"
              value={search}
              scope={scope}
              groups={groups}
              environments={availableEnvironments}
              onChange={(next) => void navigate({ search: automationsScopeSearch(next) })}
            />
            {scope.kind === "unavailable" ? (
              <p className="text-sm text-muted-foreground">{scope.message}</p>
            ) : environments.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Clock3Icon />
                  </EmptyMedia>
                  <EmptyTitle>No environments available</EmptyTitle>
                  <EmptyDescription>Connect an environment to manage automations.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              environments.map((entry) => (
                <AutomationEnvironmentSection
                  key={`${entry.environmentId}:${search.taskId ?? ""}`}
                  environment={entry}
                  scope={scope}
                  showEnvironmentHeading={environments.length > 1}
                  projectNameByKey={projectNameByKey}
                  taskId={linkEnvironmentId === entry.environmentId ? search.taskId : undefined}
                  canCreate={writableEnvironmentIds.has(entry.environmentId)}
                  onCreate={openForCreate}
                  onEdit={openForEdit}
                />
              ))
            )}
          </WorkspacePageContainer>
        </div>
      </div>
      {editor ? (
        <AutomationEditorDialog
          key={`${editor.environmentId}:${editor.task?.id ?? "new"}`}
          initialEnvironmentId={editor.environmentId}
          task={editor.task}
          scope={scope}
          connectedEnvironments={writableEnvironments}
          onClose={closeEditor}
        />
      ) : null}
    </SidebarInset>
  );
}

function AutomationEnvironmentSection({
  environment,
  scope,
  showEnvironmentHeading,
  projectNameByKey,
  taskId,
  canCreate,
  onCreate,
  onEdit,
}: {
  readonly environment: EnvironmentPresentation;
  readonly scope: ResolvedSettingsScope;
  readonly showEnvironmentHeading: boolean;
  readonly projectNameByKey: ReadonlyMap<string, string>;
  readonly taskId?: ScheduledTaskId | undefined;
  readonly canCreate: boolean;
  readonly onCreate: (environmentId: EnvironmentId) => void;
  readonly onEdit: (environmentId: EnvironmentId, task: ScheduledTask) => void;
}) {
  const connected =
    environment.connection.phase === "connected" && environment.serverConfig !== null;
  const tasksQuery = useEnvironmentQuery(
    connected
      ? serverEnvironment.scheduledTasksLive({
          environmentId: environment.environmentId,
          input: {},
        })
      : null,
  );
  const tasks = tasksQuery.data?.tasks.filter((task) =>
    matchesAutomationScope(scope, environment.environmentId, task.projectId),
  );
  const linkedTask = tasks?.find((task) => task.id === taskId);
  const openedLink = useRef(false);
  useEffect(() => {
    if (!openedLink.current && linkedTask) {
      openedLink.current = true;
      onEdit(environment.environmentId, linkedTask);
    }
  }, [environment.environmentId, linkedTask, onEdit]);
  const now = useNowMinuteMs();
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={environment.label}>
      {showEnvironmentHeading ? (
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <EnvironmentMachineIcon
              aria-hidden
              kind={resolveEnvironmentMachineKind(environment.serverConfig)}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{environment.label}</span>
          </h2>
          {connected && !tasksQuery.error && tasks ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {tasks.length} {tasks.length === 1 ? "automation" : "automations"}
            </span>
          ) : null}
        </div>
      ) : (
        <h2 className="sr-only">{environment.label}</h2>
      )}
      <SettingsGroup>
        {!connected ? (
          <AutomationNotice
            title="Environment disconnected"
            description={`Reconnect ${environment.label} to view its automations.`}
          />
        ) : tasksQuery.error ? (
          <AutomationNotice
            title="Could not load automations"
            description={tasksQuery.error}
            error
          />
        ) : !tasks ? (
          <div role="status" aria-label="Loading automations">
            <span className="sr-only">Loading automations…</span>
            {[0, 1].map((index) => (
              <div
                key={index}
                aria-hidden
                className="flex flex-col gap-3 px-4 py-4 sm:px-5 sm:py-5"
              >
                <div className="flex flex-col gap-1.5">
                  <div className="h-5 w-1/3 rounded bg-muted" />
                  <div className="h-10 w-4/5 rounded bg-muted/60" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="h-4 w-1/2 rounded bg-muted/60" />
                  <div className="h-4 w-2/3 rounded bg-muted/60" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {taskId && !linkedTask ? (
              <AutomationNotice
                title="Automation unavailable"
                description="This automation no longer exists or is outside the selected project."
              />
            ) : null}
            {tasks.length === 0 ? (
              <AutomationNotice
                title="No automations yet"
                description="Schedule a prompt to keep work moving in this environment."
                action={
                  canCreate ? (
                    <Button
                      variant="outline"
                      aria-label={`Create automation on ${environment.label}`}
                      onClick={() => onCreate(environment.environmentId)}
                    >
                      <PlusIcon />
                      Create automation
                    </Button>
                  ) : null
                }
              />
            ) : (
              tasks.map((task) => (
                <AutomationRow
                  key={task.id}
                  environmentId={environment.environmentId}
                  task={task}
                  projectName={
                    projectNameByKey.get(`${environment.environmentId}:${task.projectId}`) ?? null
                  }
                  now={now}
                  onEdit={() => onEdit(environment.environmentId, task)}
                />
              ))
            )}
          </>
        )}
      </SettingsGroup>
    </section>
  );
}

function AutomationNotice({
  title,
  description,
  action,
  error = false,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly error?: boolean;
}) {
  const Icon = error ? CircleAlertIcon : Clock3Icon;
  return (
    <div className="flex min-h-36 flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-5">
      <div className="flex min-w-0 items-start gap-3" role="status">
        <Icon
          aria-hidden
          className={`mt-0.5 size-4 shrink-0 ${error ? "text-destructive" : "text-muted-foreground"}`}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="max-w-[65ch] text-xs leading-5 text-muted-foreground wrap-anywhere">
            {description}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}
