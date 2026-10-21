import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { ProjectWorkspaceWidget } from "@supaterm/contracts";
import { BotIcon, Maximize2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { newThreadId } from "../../../lib/utils";
import { useThreadShell } from "../../../state/entities";
import ChatView from "../../ChatView";
import { useOpenThreadFromBoard } from "../../board/boardNavigation";
import { useCreateBoardCard } from "../../board/useCreateBoardCard";
import { Button } from "../../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../../ui/empty";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { useWorkspaceFrame, WorkspaceWidgetFrame } from "../WorkspaceWidgetFrame";

/**
 * A chat with the project's board agent: it turns ideas into cards, hands work
 * to cards, and moves them, so the board runs from a conversation. Its thread
 * is made on first use and kept on the workspace, which keeps it off the board.
 */
export function BoardAgentWidget({
  widget,
  project,
}: {
  widget: ProjectWorkspaceWidget;
  project: EnvironmentProject;
}) {
  const { workspace, canEdit, commit } = useWorkspaceFrame();
  const threadId = workspace.boardAgentThreadId;
  const threadRef = useMemo(
    () => (threadId === undefined ? null : scopeThreadRef(project.environmentId, threadId)),
    [project.environmentId, threadId],
  );
  const thread = useThreadShell(threadRef);
  const openThread = useOpenThreadFromBoard();
  const createThread = useCreateBoardCard(project);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    const id = newThreadId();
    // Recorded first, so the new thread never shows on the board as a card.
    commit({ ...workspace, boardAgentThreadId: id });
    const result = await createThread({ title: "Board agent", note: "", threadId: id });
    setStarting(false);
    if (result._tag === "created") return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Couldn't start the board agent",
        description:
          result._tag === "no-model"
            ? "Pick a default model for this project in Settings first."
            : (result.message ?? "An error occurred."),
      }),
    );
  };

  return (
    <WorkspaceWidgetFrame
      widget={widget}
      title="Board agent"
      icon={<BotIcon />}
      actions={
        threadRef !== null && thread !== null ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Open full page"
            onClick={() => openThread(threadRef, project.id)}
          >
            <Maximize2Icon />
          </Button>
        ) : null
      }
    >
      {threadRef !== null && thread !== null ? (
        // Layout containment pins the thread's corner controls to the widget, not the window.
        <div className="relative flex min-h-0 flex-1 flex-col [contain:layout]">
          <ChatView
            key={scopedThreadKey(threadRef)}
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            routeKind="server"
            reserveTitleBarControlInset={false}
          />
        </div>
      ) : (
        <Empty size="compact">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotIcon />
            </EmptyMedia>
            <EmptyTitle>Run the board from a chat</EmptyTitle>
            <EmptyDescription>
              Tell the board agent your ideas and it adds them as cards, starts work on them, and
              moves cards for you.
            </EmptyDescription>
          </EmptyHeader>
          {canEdit ? (
            <EmptyContent>
              <Button size="sm" disabled={starting} onClick={() => void start()}>
                {starting ? "Starting…" : "Start the board agent"}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </WorkspaceWidgetFrame>
  );
}
