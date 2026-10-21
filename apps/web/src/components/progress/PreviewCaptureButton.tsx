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
 * opens it for markup, so feedback points at the exact screen the designer
 * navigated to rather than the app's first page.
 */
export function PreviewCaptureButton({
  threadRef,
  grab,
}: {
  threadRef: ScopedThreadRef;
  /** The preview's pixels and page right now, or null before it has drawn anything. */
  grab: () => Promise<ThreadProgressScreen | null>;
}) {
  const thread = useThreadShell(threadRef);
  const projectId = thread?.projectId ?? null;
  const supported = useThreadProgressSupported(threadRef.environmentId);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const progress = useThreadProgress(threadRef.environmentId, projectId, threadRef.threadId);
  const capture = useAtomCommand(threadProgress.capture);
  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured] = useState<ThreadProgressUpdateId | null>(null);

  if (!supported || !canOperate || projectId === null) return null;
  // The image reaches the thread's progress just after the capture returns.
  const ready = progress?.updates.some((update) => update.id === captured) ? progress : undefined;

  const run = async () => {
    setCapturing(true);
    try {
      const screen = await grab();
      if (screen === null) throw new Error("The preview hasn't shown a page yet.");
      const result = await capture({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, screen },
      });
      if (result._tag === "Success") setCaptured(result.value.id);
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
    <>
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
      {ready !== undefined && captured !== null ? (
        <ProgressViewer
          environmentId={threadRef.environmentId}
          threadRef={threadRef}
          title={thread?.title ?? "This thread"}
          progress={ready}
          latestRunStartedAt={thread?.latestRun?.startedAt}
          canCapture={false}
          initialSelectedId={captured}
          startInMarkup
          onOpenChange={(open) => {
            if (!open) setCaptured(null);
          }}
        />
      ) : null}
    </>
  );
}
