import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
} from "@supaterm/contracts";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  environments: [] as Array<Record<string, unknown>>,
  projects: [] as Array<Record<string, unknown>>,
  permissions: new Set<string>(),
  tasks: new Map<string, ScheduledTask[]>(),
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  upsert: vi.fn(),
  toggle: vi.fn(),
  run: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({
    useSearch: () => state.search,
    useNavigate: () => state.navigate,
  }),
  useNavigate: () => state.navigate,
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: state.environments }),
  usePrimaryEnvironmentId: () => state.environments[0]?.environmentId ?? null,
  useEnvironment: (environmentId: string) =>
    state.environments.find((environment) => environment.environmentId === environmentId) ?? null,
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: (environmentId: string | null, scope: string) =>
    scope === AuthOrchestrationOperateScope &&
    environmentId !== null &&
    state.permissions.has(environmentId),
  readEnvironmentScope: (environmentId: string, scope: string) =>
    scope === AuthOrchestrationOperateScope && state.permissions.has(environmentId),
  useEnvironmentsWithScope: (environments: Array<{ environmentId: string }>, scope: string) =>
    new Set(
      environments.flatMap(({ environmentId }) =>
        scope === AuthOrchestrationOperateScope && state.permissions.has(environmentId)
          ? [environmentId]
          : [],
      ),
    ),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => state.projects,
  useThreadShell: () => null,
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: { environmentId: string } | null) => ({
    data: query === null ? null : { tasks: state.tasks.get(query.environmentId) ?? [] },
    error: null,
  }),
}));
vi.mock("../../state/server", () => ({
  EMPTY_SERVER_PROVIDERS: [],
  serverEnvironment: {
    providersValueAtom: () => "providers",
    scheduledTasksLive: ({ environmentId }: { environmentId: string }) => ({ environmentId }),
    upsertScheduledTask: "upsert",
    setScheduledTaskEnabled: "toggle",
    runScheduledTaskNow: "run",
    deleteScheduledTask: "remove",
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    ({ upsert: state.upsert, toggle: state.toggle, run: state.run, remove: state.remove })[
      command as "upsert" | "toggle" | "run" | "remove"
    ],
}));
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => DEFAULT_SERVER_SETTINGS,
}));
vi.mock("../settings/useSettingsProjectGroups", () => ({ useSettingsProjectGroups: () => [] }));
vi.mock("../../hooks/useNowMinute", () => ({
  useNowMinuteMs: () => Date.parse("2026-10-07T12:00:00Z"),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("../EnvironmentMachineIcon", () => ({ EnvironmentMachineIcon: () => null }));
vi.mock("../WorktreeBaseBranchPicker", () => ({ WorktreeBaseBranchPicker: "div" }));
vi.mock("../chat/ProviderModelPicker", () => ({ ProviderModelPicker: "div" }));
vi.mock("../settings/settingsLayout", () => ({
  SETTINGS_PICKER_TRIGGER_CLASSNAME: "",
  SettingsRow: ({ title, description, status, control }: Record<string, React.ReactNode>) => (
    <div>
      <span>{title}</span>
      {description}
      {status}
      {control}
    </div>
  ),
  SettingsSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock("../settings/ScopeSentence", () => ({ ScopeSentence: () => null }));
vi.mock("../WorkspaceBreadcrumb", () => ({
  WorkspaceBreadcrumb: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  WorkspaceBreadcrumbItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../WorkspacePageContainer", () => ({
  WorkspacePageContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));
vi.mock("../ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/empty", () => ({
  Empty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  EmptyDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  EmptyHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  EmptyMedia: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  EmptyTitle: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
vi.mock("../ui/menu", () => ({
  Menu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuItem: "button",
  MenuPopup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuSeparator: () => <hr />,
  MenuTrigger: "button",
}));
vi.mock("../ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("../ui/switch", () => ({ Switch: "button" }));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TooltipPopup: () => null,
}));
vi.mock("../ui/toast", () => ({
  stackedThreadToast: (value: unknown) => value,
  toastManager: { add: vi.fn() },
}));
vi.mock("./AutomationEditorDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./AutomationEditorDialog")>()),
}));
vi.mock("../ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogClose: "button",
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogPopup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("../ui/input", () => ({ Input: "input" }));
vi.mock("../ui/label", () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));
vi.mock("../ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectPopup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  SelectValue: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../ui/textarea", () => ({ Textarea: "textarea" }));
vi.mock("../ui/toggle-group", () => ({
  Toggle: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  ToggleGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AutomationsPage } from "./AutomationsPage";
import { AutomationEditorDialog } from "./AutomationEditorDialog";
import type { EnvironmentPresentation } from "../../state/environments";
import type { ResolvedSettingsScope } from "../settings/settingsScope";

const primaryId = EnvironmentId.make("primary");
const remoteId = EnvironmentId.make("remote");
const primaryProjectId = ProjectId.make("project-primary");
const remoteProjectId = ProjectId.make("project-remote");
const taskId = ScheduledTaskId.make("task");
const instanceId = ProviderInstanceId.make("codex");

const environment = (environmentId: EnvironmentId, label: string) => ({
  environmentId,
  label,
  connection: { phase: "connected" },
  serverConfig: {
    settings: DEFAULT_SERVER_SETTINGS,
    environment: { platform: { machine: "server" } },
  },
});

const task = (projectId: ProjectId): ScheduledTask =>
  ({
    id: taskId,
    title: "Read only automation",
    prompt: "Review recent changes",
    enabled: true,
    schedule: { type: "interval", everyMs: 900_000 },
    projectId,
    threadId: null,
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId, model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    lastRunStatus: "never",
    lastRunAt: null,
    lastRunError: null,
    nextRunAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    runCount: 0,
  }) as ScheduledTask;

const scope: ResolvedSettingsScope = {
  kind: "all",
  label: "All environments",
  members: [],
  environmentIds: [primaryId, remoteId],
};

function textContent(renderer: ReactTestRenderer): string {
  const visit = (node: ReactTestInstance | string): string =>
    typeof node === "string" ? node : node.children.map(visit).join("");
  return visit(renderer.root);
}

function nodeText(node: ReactTestInstance): string {
  const visit = (child: ReactTestInstance | string): string =>
    typeof child === "string" ? child : child.children.map(visit).join("");
  return visit(node);
}

function buttonNamed(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType("button").find((button) => {
    const children = Array.isArray(button.props.children)
      ? button.props.children.join("")
      : String(button.props.children ?? "");
    return children.includes(label);
  });
}

describe("automation permissions", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    state.environments = [environment(primaryId, "Local"), environment(remoteId, "Remote")];
    state.projects = [
      {
        id: primaryProjectId,
        environmentId: primaryId,
        title: "Local project",
        workspaceRoot: "/local",
      },
      {
        id: remoteProjectId,
        environmentId: remoteId,
        title: "Remote project",
        workspaceRoot: "/remote",
      },
    ];
    state.permissions = new Set([primaryId, remoteId]);
    state.tasks = new Map();
    state.search = {};
    state.navigate.mockReset();
    state.upsert.mockReset().mockResolvedValue({ _tag: "Success" });
    state.toggle.mockReset().mockResolvedValue({ _tag: "Success" });
    state.run.mockReset().mockResolvedValue({ _tag: "Success" });
    state.remove.mockReset().mockResolvedValue({ _tag: "Success" });
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("creates in a writable connected environment when the default is read-only", async () => {
    state.permissions = new Set([remoteId]);
    await act(async () => {
      renderer = create(<AutomationsPage />);
    });

    const createButton = buttonNamed(renderer!, "New automation");
    expect(createButton?.props.disabled).not.toBe(true);
    await act(async () => createButton?.props.onClick());

    const environmentSelect = renderer!.root.findByProps({ id: "scheduled-task-environment" });
    expect(nodeText(environmentSelect)).toContain("Remote");
  });

  it("creates from an empty environment and rechecks its grant before opening", async () => {
    state.permissions = new Set([remoteId]);
    await act(async () => {
      renderer = create(<AutomationsPage />);
    });

    expect(
      renderer!.root.findAllByProps({ "aria-label": "Create automation on Local" }),
    ).toHaveLength(0);
    const createButton = renderer!.root.findByProps({
      "aria-label": "Create automation on Remote",
    });
    state.permissions.delete(remoteId);
    await act(async () => createButton.props.onClick());
    expect(renderer!.root.findAllByProps({ id: "scheduled-task-environment" })).toHaveLength(0);

    state.permissions.add(remoteId);
    await act(async () => createButton.props.onClick());
    const environmentSelect = renderer!.root.findByProps({ id: "scheduled-task-environment" });
    expect(nodeText(environmentSelect)).toContain("Remote");
  });

  it("opens a read-only editor for a deep-linked task without enabling edits", async () => {
    const existing = task(primaryProjectId);
    state.tasks.set(primaryId, [existing]);
    state.permissions.delete(primaryId);
    state.search = { environmentId: primaryId, taskId };

    await act(async () => {
      renderer = create(<AutomationsPage />);
    });

    expect(textContent(renderer!)).toContain("Edit automation");
    expect(textContent(renderer!)).toContain(
      "This connection does not have permission to manage automations.",
    );
    expect(renderer!.root.findByType("fieldset").props.disabled).toBe(true);
    expect(buttonNamed(renderer!, "Save automation")?.props.disabled).toBe(true);
  });

  it("rechecks permission at submit after access is revoked while the editor is open", async () => {
    const existing = task(remoteProjectId);
    state.tasks.set(remoteId, [existing]);
    const connectedEnvironments = [state.environments[1] as unknown as EnvironmentPresentation];

    await act(async () => {
      renderer = create(
        <AutomationEditorDialog
          initialEnvironmentId={remoteId}
          task={existing}
          scope={scope}
          connectedEnvironments={connectedEnvironments}
          onClose={vi.fn()}
        />,
      );
    });

    const saveButton = buttonNamed(renderer!, "Save automation");
    expect(saveButton?.props.disabled).not.toBe(true);
    state.permissions.delete(remoteId);
    await act(async () => saveButton?.props.onClick());

    expect(state.upsert).not.toHaveBeenCalled();
    await act(async () => {
      renderer!.update(
        <AutomationEditorDialog
          initialEnvironmentId={remoteId}
          task={existing}
          scope={scope}
          connectedEnvironments={connectedEnvironments}
          onClose={vi.fn()}
        />,
      );
    });
    expect(renderer!.root.findByType("fieldset").props.disabled).toBe(true);
    expect(buttonNamed(renderer!, "Save automation")?.props.disabled).toBe(true);
  });

  it("rechecks permission before a retained edit action opens the editor", async () => {
    state.tasks.set(remoteId, [task(remoteProjectId)]);
    await act(async () => {
      renderer = create(<AutomationsPage />);
    });
    const edit = buttonNamed(renderer!, "Edit");
    expect(edit).toBeDefined();

    state.permissions.delete(remoteId);
    await act(async () => edit?.props.onClick());

    expect(textContent(renderer!)).not.toContain("Edit automation");
  });

  it("blocks retained row actions after the environment grant is revoked", async () => {
    state.tasks.set(remoteId, [task(remoteProjectId)]);
    await act(async () => {
      renderer = create(<AutomationsPage />);
    });

    const toggle = renderer!.root.findByProps({ "aria-label": "Pause Read only automation" });
    const run = buttonNamed(renderer!, "Run now");
    const remove = buttonNamed(renderer!, "Delete");
    expect(run).toBeDefined();
    expect(remove).toBeDefined();

    await act(async () => remove?.props.onClick({ timeStamp: 1_000 }));
    state.permissions.delete(remoteId);
    await act(async () => {
      await toggle.props.onCheckedChange(false);
      run?.props.onClick();
      remove?.props.onClick({ timeStamp: 1_500 });
    });

    expect(state.toggle).not.toHaveBeenCalled();
    expect(state.run).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
});
