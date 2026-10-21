import { threadRuntimeCanArchive } from "@supaterm/client-runtime/state/models";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { ProjectWorkspaceWidget, ScopedProjectRef } from "@supaterm/contracts";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  MonitorIcon,
  RotateCcwIcon,
  RotateCwIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useThreadShellsForProjectRefs } from "../../../state/entities";
import { liveEnvironment } from "../../../state/liveEnvironment";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useNow, useProjectLiveEnvironments } from "../../board/liveEnvironmentState";
import { useDiscoveredLocalServers } from "../../preview/useDiscoveredLocalServers";
import { Button } from "../../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../../ui/menu";
import { openExternalUrl } from "../openExternalUrl";
import { WidgetMessage, WorkspaceWidgetFrame, useWorkspaceFrame } from "../WorkspaceWidgetFrame";
import {
  type LivePreviewCandidate,
  type PreviewPortCandidate,
  previewServerName,
  previewServerOwner,
  resolvePreviewSelection,
  setWorkspaceWidgetSettings,
  sortPreviewPorts,
} from "../workspaceLogic";

const LIVE_VALUE = "live";

/**
 * A frame onto a dev server that is already running. By default it follows
 * the project's live card, else the server whose agent is working, else the
 * newest one; the menu lists every running server to pick from instead. It
 * never starts anything.
 */
export function LivePreviewWidget({
  widget,
  projectRef,
  project,
}: {
  widget: ProjectWorkspaceWidget;
  projectRef: ScopedProjectRef;
  project: EnvironmentProject;
}) {
  const { workspace, canEdit, commit } = useWorkspaceFrame();
  const environmentId = projectRef.environmentId;
  const projectRefs = useMemo(() => [projectRef], [projectRef]);
  const threads = useThreadShellsForProjectRefs(projectRefs);
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id as string, thread])),
    [threads],
  );
  const liveEnvironments = useProjectLiveEnvironments(projectRef).byThreadId;
  const servers = useDiscoveredLocalServers({ environmentId });
  const retryLive = useAtomCommand(liveEnvironment.retry);
  const [reloadKey, setReloadKey] = useState(0);
  const failedLive =
    [...liveEnvironments.values()].find((entry) => entry.active && entry.status === "failed") ??
    null;

  const live = useMemo((): LivePreviewCandidate | null => {
    const ready = [...liveEnvironments.values()].filter(
      (snapshot) => snapshot.status === "ready" && snapshot.url !== null,
    );
    const snapshot = ready.find((entry) => entry.active) ?? ready[0];
    if (snapshot === undefined || snapshot.url === null) return null;
    const thread = threadById.get(snapshot.threadId);
    return {
      url: resolveDiscoveredServerUrl(environmentId, snapshot.url),
      branch: thread?.branch ?? null,
      threadTitle: thread?.title ?? null,
    };
  }, [environmentId, liveEnvironments, threadById]);

  const ports = useMemo(
    () =>
      sortPreviewPorts(
        servers.map((server): PreviewPortCandidate => {
          const cwd = server.cwd ?? null;
          const { thread, inProject } = previewServerOwner({
            terminalThreadId: server.terminal?.threadId ?? null,
            cwd,
            workspaceRoot: project.workspaceRoot,
            threads,
            projectId: project.id,
            checkoutProjectId: server.checkout?.projectId ?? null,
          });
          const startedAtMs = server.startedAt ? Date.parse(server.startedAt) || 0 : 0;
          return {
            port: server.port,
            url: server.url,
            name: previewServerName({
              cwd,
              checkoutPath: server.checkout?.path ?? null,
              threadTitle: thread?.title ?? null,
              processName: server.processName,
              port: server.port,
            }),
            threadTitle: thread?.title ?? null,
            branch: thread?.branch ?? server.checkout?.branch ?? null,
            ownedByProject: inProject,
            working: thread !== null && !threadRuntimeCanArchive(thread.runtime),
            recencyMs:
              startedAtMs > 0
                ? startedAtMs
                : thread === null
                  ? 0
                  : Date.parse(thread.updatedAt) || 0,
            startedAt: server.startedAt ?? null,
            processName: server.processName,
          };
        }),
      ),
    [project.id, project.workspaceRoot, servers, threads],
  );

  const selection = resolvePreviewSelection({ pinnedPort: widget.previewPort, live, ports });
  const url = selection.kind === "live" || selection.kind === "port" ? selection.url : null;
  const branch = selection.kind === "live" || selection.kind === "port" ? selection.branch : null;
  const shownPort =
    selection.kind === "port" ? ports.find((port) => port.port === selection.port) : undefined;
  const sourceLabel =
    selection.kind === "live"
      ? "Live card"
      : shownPort !== undefined
        ? `${shownPort.name} :${shownPort.port}`
        : widget.previewPort !== undefined
          ? `:${widget.previewPort}`
          : "Running servers";
  // Only for "started 5m ago", so a minute is fine-grained enough.
  const now = useNow(60_000, ports.length > 0);

  const pin = (port: number | null) =>
    commit(setWorkspaceWidgetSettings(workspace, widget.id, { previewPort: port }));
  const ownPorts = ports.filter((port) => port.ownedByProject);
  const otherPorts = ports.filter((port) => !port.ownedByProject);
  const portDetail = (port: PreviewPortCandidate) =>
    [
      port.working ? "Agent working" : null,
      // Two servers from one folder (a dev server and its worker, say) differ by process.
      ports.some((other) => other.port !== port.port && other.name === port.name)
        ? port.processName
        : null,
      port.branch,
      port.startedAt !== null && port.threadTitle === null
        ? `started ${formatRelativeTimeLabel(port.startedAt, now)}`
        : port.threadTitle !== port.name
          ? port.threadTitle
          : null,
    ]
      .filter((part) => part !== null && part !== "")
      .join(" · ") || null;

  const sourcePicker = (
    <Menu>
      <MenuTrigger
        render={<Button size="compact" variant="ghost-muted" aria-label="Preview source" />}
      >
        <span className="max-w-40 truncate">{sourceLabel}</span>
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={widget.previewPort === undefined ? LIVE_VALUE : String(widget.previewPort)}
          onValueChange={(value: string) => {
            if (!canEdit) return;
            pin(value === LIVE_VALUE ? null : Number(value));
          }}
        >
          <MenuRadioItem value={LIVE_VALUE} disabled={!canEdit} closeOnClick>
            <PortRow
              label="Automatic"
              detail={
                live !== null
                  ? `Live card · ${live.branch ?? live.threadTitle ?? ""}`
                  : "Live card, else where an agent is working, else the newest"
              }
              port={null}
            />
          </MenuRadioItem>
          {ownPorts.length > 0 ? (
            <MenuGroup>
              <MenuGroupLabel>This project</MenuGroupLabel>
              {ownPorts.map((port) => (
                <MenuRadioItem
                  key={port.port}
                  value={String(port.port)}
                  disabled={!canEdit}
                  closeOnClick
                >
                  <PortRow label={port.name} detail={portDetail(port)} port={port.port} />
                </MenuRadioItem>
              ))}
            </MenuGroup>
          ) : null}
          {otherPorts.length > 0 ? (
            <MenuGroup>
              <MenuGroupLabel>Other running servers</MenuGroupLabel>
              {otherPorts.map((port) => (
                <MenuRadioItem
                  key={port.port}
                  value={String(port.port)}
                  disabled={!canEdit}
                  closeOnClick
                >
                  <PortRow label={port.name} detail={portDetail(port)} port={port.port} />
                </MenuRadioItem>
              ))}
            </MenuGroup>
          ) : null}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );

  return (
    <WorkspaceWidgetFrame
      widget={widget}
      title="Live preview"
      icon={<MonitorIcon />}
      actions={
        <>
          {branch !== null ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <GitBranchIcon aria-hidden className="size-3 shrink-0" />
              <span className="max-w-28 truncate">{branch}</span>
            </span>
          ) : null}
          {sourcePicker}
          {url !== null ? (
            <>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Reload preview"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                <RotateCwIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Open preview in browser"
                onClick={() => openExternalUrl(url)}
              >
                <ExternalLinkIcon />
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {url !== null ? (
        <iframe
          key={`${url}#${reloadKey}`}
          title={`${project.title} live preview`}
          src={url}
          // Apps under test need their own storage. A dev server's origin (its own
          // port) is never the app's, so same-origin grants nothing here; the
          // sandbox still blocks top navigation.
          // oxlint-disable-next-line react/iframe-missing-sandbox
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : selection.kind === "pinned-missing" ? (
        <WidgetMessage>
          <p>Nothing is running on port {selection.port}.</p>
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => pin(null)}>
              Follow the live card
            </Button>
          ) : null}
        </WidgetMessage>
      ) : failedLive !== null ? (
        <WidgetMessage>
          <p>The live card's dev server didn't start.</p>
          {failedLive.error !== null ? <p className="text-xs">{failedLive.error}</p> : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void retryLive({ environmentId, input: { threadId: failedLive.threadId } })
            }
          >
            <RotateCcwIcon />
            Retry
          </Button>
        </WidgetMessage>
      ) : (
        <WidgetMessage>
          <p>Nothing is running for this project.</p>
          <p className="text-xs">
            Move a card into the live preview column to start its dev server. Servers an agent
            starts, in the project folder or any of its worktrees, show here too.
          </p>
          {otherPorts.length > 0 && canEdit ? (
            <div className="flex w-full max-w-72 flex-col gap-1 pt-2 text-left">
              <p className="text-xs font-medium text-foreground">Other running servers</p>
              {otherPorts.map((port) => (
                <button
                  key={port.port}
                  type="button"
                  className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => pin(port.port)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{port.name}</span>
                    {portDetail(port) !== null ? (
                      <span className="block truncate text-xs">{portDetail(port)}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums">:{port.port}</span>
                </button>
              ))}
            </div>
          ) : null}
        </WidgetMessage>
      )}
    </WorkspaceWidgetFrame>
  );
}

function PortRow({
  label,
  detail,
  port,
}: {
  label: string;
  detail: string | null;
  port: number | null;
}) {
  return (
    <span className="flex min-w-0 max-w-80 items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {detail !== null ? (
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      {port !== null ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">:{port}</span>
      ) : null}
      <MenuRadioItemIndicator />
    </span>
  );
}
