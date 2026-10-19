import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import {
  isProjectWorkspaceWidgetKind,
  type ProjectWorkspaceWidget,
  type ScopedProjectRef,
} from "@supaterm/contracts";
import { KanbanIcon, LayoutGridIcon, PuzzleIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { useProjectWorkspace } from "./useProjectWorkspace";
import { BoardAgentWidget } from "./widgets/BoardAgentWidget";
import { FigmaWidget } from "./widgets/FigmaWidget";
import { GitWidget } from "./widgets/GitWidget";
import { LivePreviewWidget } from "./widgets/LivePreviewWidget";
import { UsageWidget } from "./widgets/UsageWidget";
import {
  WidgetMessage,
  WorkspaceFrameContext,
  type WorkspaceFrameContextValue,
  WorkspaceWidgetFrame,
} from "./WorkspaceWidgetFrame";
import { isBoardOnly, workspaceBackgroundStyle } from "./workspaceLogic";

/**
 * A project's workspace: its widgets on a bento grid over the project's own
 * background. With only the board and no custom look it renders the board
 * exactly as before, with nothing wrapped around it.
 */
export function ProjectWorkspace({
  projectRef,
  project,
  kanban,
}: {
  projectRef: ScopedProjectRef;
  project: EnvironmentProject;
  /** The project's kanban, rendered by the board page that owns its state. */
  kanban: ReactNode;
}) {
  const { workspace, canEdit, commit } = useProjectWorkspace(projectRef, project);
  const [drag, setDrag] = useState<WorkspaceFrameContextValue["drag"]>(null);
  const accentColor = workspace.appearance?.accentColor;
  const background = workspaceBackgroundStyle(workspace.appearance);
  const frame = useMemo<WorkspaceFrameContextValue>(
    () => ({ workspace, canEdit, commit, accentColor, drag, setDrag }),
    [accentColor, canEdit, commit, drag, workspace],
  );

  const boardOnly = isBoardOnly(workspace);
  if (boardOnly && background === null && accentColor === undefined) return kanban;

  const accentStrip =
    accentColor === undefined ? null : (
      <div aria-hidden className="h-0.5 shrink-0" style={{ backgroundColor: accentColor }} />
    );

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      style={background === null ? undefined : background}
    >
      {accentStrip}
      {boardOnly ? (
        kanban
      ) : workspace.widgets.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutGridIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing in this workspace</EmptyTitle>
            <EmptyDescription>
              Use Add widget above to bring back the board or add its agent, a preview, a Figma
              frame, usage, or Git.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <WorkspaceFrameContext.Provider value={frame}>
          <div
            className={cn(
              "grid min-h-0 flex-1 grid-flow-row-dense auto-rows-[minmax(13rem,1fr)] grid-cols-1 gap-3 overflow-y-auto p-3 md:grid-cols-4",
              // Frames swallow drag events; let the grid see them while a widget moves.
              drag !== null && "[&_iframe]:pointer-events-none",
            )}
          >
            {workspace.widgets.map((widget) => (
              <WorkspaceWidget
                key={widget.id}
                widget={widget}
                projectRef={projectRef}
                project={project}
                kanban={kanban}
              />
            ))}
          </div>
        </WorkspaceFrameContext.Provider>
      )}
    </div>
  );
}

function WorkspaceWidget({
  widget,
  projectRef,
  project,
  kanban,
}: {
  widget: ProjectWorkspaceWidget;
  projectRef: ScopedProjectRef;
  project: EnvironmentProject;
  kanban: ReactNode;
}) {
  if (!isProjectWorkspaceWidgetKind(widget.kind)) {
    return (
      <WorkspaceWidgetFrame widget={widget} title="Unsupported widget" icon={<PuzzleIcon />}>
        <WidgetMessage>Update Supadesign to see this widget.</WidgetMessage>
      </WorkspaceWidgetFrame>
    );
  }
  switch (widget.kind) {
    case "kanban":
      return (
        <WorkspaceWidgetFrame widget={widget} title="Board" icon={<KanbanIcon />}>
          {kanban}
        </WorkspaceWidgetFrame>
      );
    case "live-preview":
      return <LivePreviewWidget widget={widget} projectRef={projectRef} project={project} />;
    case "figma":
      return <FigmaWidget widget={widget} />;
    case "usage":
      return <UsageWidget widget={widget} environmentId={projectRef.environmentId} />;
    case "git":
      return <GitWidget widget={widget} projectRef={projectRef} project={project} />;
    case "board-agent":
      return <BoardAgentWidget widget={widget} project={project} />;
  }
}
