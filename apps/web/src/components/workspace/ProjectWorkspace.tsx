import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import {
  isProjectWorkspaceWidgetKind,
  type ProjectWorkspaceWidget,
  type ScopedProjectRef,
} from "@supaterm/contracts";
import { KanbanIcon, LayoutGridIcon, PuzzleIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { BentoGrid } from "./BentoGrid";
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
import {
  isBoardOnly,
  withWorkspaceLayout,
  workspaceBackgroundStyle,
  workspaceLayout,
} from "./workspaceLogic";

/**
 * A project's workspace: its widgets on a bento that fills the board, over
 * the project's own background. With only the board and no custom look it renders the board
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
  const { workspace, canEdit, canArrange, commit } = useProjectWorkspace(projectRef, project);
  const accentColor = workspace.appearance?.accentColor;
  const background = workspaceBackgroundStyle(workspace.appearance);
  const frame = useMemo<WorkspaceFrameContextValue>(
    () => ({ workspace, canEdit, commit, accentColor }),
    [accentColor, canEdit, commit, workspace],
  );
  const layout = useMemo(() => workspaceLayout(workspace), [workspace]);

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
      ) : layout === null ? (
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
          <BentoGrid
            widgets={workspace.widgets}
            layout={layout}
            canArrange={canArrange}
            commitLayout={(next) => commit(withWorkspaceLayout(workspace, next))}
            renderWidget={(widget) => (
              <WorkspaceWidget
                widget={widget}
                projectRef={projectRef}
                project={project}
                kanban={kanban}
              />
            )}
          />
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
