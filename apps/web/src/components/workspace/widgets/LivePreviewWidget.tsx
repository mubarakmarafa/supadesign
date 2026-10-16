import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { ProjectWorkspaceWidget, ScopedProjectRef } from "@supaterm/contracts";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  MonitorIcon,
  RotateCwIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { useThreadShellsForProjectRefs } from "../../../state/entities";
import { useProjectLiveEnvironments } from "../../board/liveEnvironmentState";
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
  resolvePreviewSelection,
  setWorkspaceWidgetSettings,
  sortPreviewPorts,
} from "../workspaceLogic";

const LIVE_VALUE = "live";

/**
 * A frame onto a dev server that is already running: the project's live card
 * by default, or a port picked from the menu. It never starts anything.
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
  const [reloadKey, setReloadKey] = useState(0);

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
          const thread =
            server.terminal === null ? undefined : threadById.get(server.terminal.threadId);
          return {
            port: server.port,
            url: server.url,
            threadTitle: thread?.title ?? null,
            branch: thread?.branch ?? null,
            ownedByProject: thread !== undefined,
            updatedAtMs: thread === undefined ? 0 : Date.parse(thread.updatedAt) || 0,
            processName: server.processName,
          };
        }),
      ),
    [servers, threadById],
  );

  const selection = resolvePreviewSelection({ pinnedPort: widget.previewPort, live, ports });
  const url = selection.kind === "live" || selection.kind === "port" ? selection.url : null;
  const branch = selection.kind === "live" || selection.kind === "port" ? selection.branch : null;
  const sourceLabel =
    widget.previewPort !== undefined
      ? `:${widget.previewPort}`
      : selection.kind === "port"
        ? `Recent · :${selection.port}`
        : "Live card";

  const pin = (port: number | null) =>
    commit(setWorkspaceWidgetSettings(workspace, widget.id, { previewPort: port }));
  const ownPorts = ports.filter((port) => port.ownedByProject);
  const otherPorts = ports.filter((port) => !port.ownedByProject);

  const sourcePicker = (
    <Menu>
      <MenuTrigger
        render={<Button size="compact" variant="ghost-muted" aria-label="Preview source" />}
      >
        <span className="max-w-32 truncate">{sourceLabel}</span>
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
          <MenuRadioItem value={LIVE_VALUE} disabled={!canEdit}>
            <PortRow label="Live card" detail={live?.branch ?? live?.threadTitle ?? null} />
          </MenuRadioItem>
          {ownPorts.length > 0 ? (
            <MenuGroup>
              <MenuGroupLabel>This project</MenuGroupLabel>
              {ownPorts.map((port) => (
                <MenuRadioItem key={port.port} value={String(port.port)} disabled={!canEdit}>
                  <PortRow label={`:${port.port}`} detail={port.branch ?? port.threadTitle} />
                </MenuRadioItem>
              ))}
            </MenuGroup>
          ) : null}
          {otherPorts.length > 0 ? (
            <MenuGroup>
              <MenuGroupLabel>Other running servers</MenuGroupLabel>
              {otherPorts.map((port) => (
                <MenuRadioItem key={port.port} value={String(port.port)} disabled={!canEdit}>
                  <PortRow label={`:${port.port}`} detail={port.processName} />
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
      ) : (
        <WidgetMessage>
          <p>Nothing is running for this project.</p>
          <p className="text-xs">
            Move a card into the live preview column to start its dev server, then it shows here.
          </p>
        </WidgetMessage>
      )}
    </WorkspaceWidgetFrame>
  );
}

function PortRow({ label, detail }: { label: string; detail: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="shrink-0 tabular-nums">{label}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{detail}</span>
      <MenuRadioItemIndicator />
    </span>
  );
}
