import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  ThreadId,
  type ProjectId,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import { CameraIcon, MessageCircleQuestionIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { cn } from "~/lib/utils";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadProgress } from "../../state/threadProgress";
import { useAtomCommand } from "../../state/use-atom-command";
import { useProjectLiveEnvironments } from "../board/liveEnvironmentState";
import { Button } from "../ui/button";
import { coverState } from "./cardProgress.logic";
import { progressImageResource } from "./progressImage";
import { ProgressViewer } from "./ProgressViewer";
import { useThreadProgress } from "./progressState";

/**
 * The thread's latest progress image in its header, so the card's cover stays
 * one click away while chatting. Opens every image the card has.
 */
export function ThreadProgressChip({
  threadRef,
  projectId,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
}) {
  const projectRef = useMemo(
    () => scopeProjectRef(threadRef.environmentId, projectId),
    [projectId, threadRef.environmentId],
  );
  const progress = useThreadProgress(threadRef.environmentId, projectId, threadRef.threadId);
  const live = useProjectLiveEnvironments(projectRef).byThreadId.get(threadRef.threadId);
  const thread = useThreadShell(threadRef);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const capture = useAtomCommand(threadProgress.capture);
  const [viewing, setViewing] = useState(false);
  const cover = progress?.updates.at(-1);
  const image = useAssetUrlState(
    threadRef.environmentId,
    cover === undefined ? null : progressImageResource(cover),
  );
  const canCapture = canOperate && live?.status === "ready";
  const capturing = progress?.capture?._tag === "capturing";

  if (progress === undefined || cover === undefined) {
    if (!canCapture) return null;
    return (
      <Button
        size="compact"
        variant="ghost"
        disabled={capturing}
        aria-label="Capture the running app as this card's cover"
        onClick={() =>
          void capture({
            environmentId: threadRef.environmentId,
            input: { threadId: ThreadId.make(threadRef.threadId) },
          })
        }
      >
        <CameraIcon />
        {capturing ? "Capturing…" : "Capture"}
      </Button>
    );
  }

  const state = coverState(progress, cover, thread?.latestRun?.startedAt);
  const questions = cover.questions.length;
  return (
    <>
      <Button
        size="compact"
        variant="ghost"
        aria-label="View progress images"
        onClick={() => setViewing(true)}
      >
        <span
          aria-hidden
          className={cn(
            "relative block aspect-[16/10] h-5 shrink-0 overflow-hidden rounded-sm border bg-muted",
            state.kind !== "current" && "opacity-60",
          )}
        >
          {image._tag === "Success" ? (
            <img src={image.url} alt="" className="size-full object-cover object-top" />
          ) : null}
        </span>
        {state.kind === "capturing"
          ? "Capturing…"
          : state.kind === "stale"
            ? "Progress · out of date"
            : "Progress"}
        {questions > 0 ? (
          <span className="flex items-center gap-0.5 text-warning-foreground">
            <MessageCircleQuestionIcon aria-hidden />
            {questions}
          </span>
        ) : null}
      </Button>
      {viewing ? (
        <ProgressViewer
          environmentId={threadRef.environmentId}
          threadRef={threadRef}
          title={thread?.title ?? "This thread"}
          progress={progress}
          latestRunStartedAt={thread?.latestRun?.startedAt}
          canCapture={canCapture}
          onOpenChange={setViewing}
        />
      ) : null}
    </>
  );
}
