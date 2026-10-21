import {
  AuthOrchestrationOperateScope,
  type ScopedThreadRef,
  type ThreadProgressScreen,
  type ThreadProgressUpdateId,
} from "@supaterm/contracts";
import { CameraIcon } from "lucide-react";
import { useState } from "react";

import { useThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadProgress } from "../../state/threadProgress";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useThreadProgress, useThreadProgressSupported } from "./progressState";
import { ProgressViewer } from "./ProgressViewer";

/**
 * Keeps what a preview shows right now as the thread's progress image, then
 * hands it to `onCaptured` so the caller can open it for markup. Feedback then
 * points at the exact screen the designer navigated to, not the app's first page.
 */
export function PreviewCaptureButton({
  threadRef,
  grab,
  onCaptured,
}: {
  threadRef: ScopedThreadRef;
  /** The preview's pixels and page right now, or null before it has drawn anything. */
  grab: () => Promise<ThreadProgressScreen | null>;
  onCaptured: (id: ThreadProgressUpdateId) => void;
}) {
  const thread = useThreadShell(threadRef);
  const projectId = thread?.projectId ?? null;
  const supported = useThreadProgressSupported(threadRef.environmentId);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const capture = useAtomCommand(threadProgress.capture);
  const [capturing, setCapturing] = useState(false);

  if (!supported || !canOperate || projectId === null) return null;

  const run = async () => {
    setCapturing(true);
    try {
      const screen = await grab();
      if (screen === null) throw new Error("The preview hasn't shown a page yet.");
      const result = await capture({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, screen },
      });
      if (result._tag === "Success") onCaptured(result.value.id);
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn't capture this screen",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Capture this screen to mark up"
            disabled={capturing}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void run()}
          />
        }
      >
        <CameraIcon />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {capturing ? "Capturing…" : "Capture this screen to mark up"}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * Opens a fresh capture ready to mark up once it reaches the thread's
 * progress, which happens just after the capture returns. Render it outside
 * any drag handle: React events from the dialog bubble through its parents.
 */
export function CapturedScreenMarkup({
  threadRef,
  updateId,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  updateId: ThreadProgressUpdateId;
  onClose: () => void;
}) {
  const thread = useThreadShell(threadRef);
  const progress = useThreadProgress(
    threadRef.environmentId,
    thread?.projectId ?? null,
    threadRef.threadId,
  );
  if (!progress?.updates.some((update) => update.id === updateId)) return null;
  return (
    <ProgressViewer
      environmentId={threadRef.environmentId}
      threadRef={threadRef}
      title={thread?.title ?? "This thread"}
      progress={progress}
      latestRunStartedAt={thread?.latestRun?.startedAt}
      canCapture={false}
      initialSelectedId={updateId}
      startInMarkup
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    />
  );
}
