import type { BoardAutomationRun, EnvironmentId } from "@supaterm/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { CircleCheckIcon, TriangleAlertIcon, ZapIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { boardAutomation } from "../../state/boardAutomation";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useNow } from "./liveEnvironmentState";
import { stopCardGestures } from "./LiveEnvironmentStatus";

const joinNames = (names: ReadonlyArray<string>) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Seconds until a waiting run sends, never below one while it still waits. */
export function boardAutomationSecondsLeft(run: BoardAutomationRun, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(run.at) - now) / 1000));
}

type Tone = "muted" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  muted: "text-muted-foreground",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  danger: "text-destructive-foreground",
};

const TONE_ICONS: Record<Tone, ReactNode> = {
  muted: <ZapIcon aria-hidden className="size-3 shrink-0" />,
  success: <CircleCheckIcon aria-hidden className="size-3 shrink-0" />,
  warning: <TriangleAlertIcon aria-hidden className="size-3 shrink-0" />,
  danger: <TriangleAlertIcon aria-hidden className="size-3 shrink-0" />,
};

/** What a run's line says, and how loudly. */
function describeRun(run: BoardAutomationRun, now: number): { tone: Tone; label: string } {
  const names = joinNames(run.stepNames);
  switch (run.status) {
    case "scheduled":
      return { tone: "muted", label: `${names} in ${boardAutomationSecondsLeft(run, now)}s` };
    case "sent":
      return { tone: "muted", label: `Running ${names}` };
    case "done":
      return { tone: "success", label: `${names} done` };
    case "needs-you":
      return { tone: "warning", label: `Needs you: ${names}` };
    case "finished":
      return { tone: "muted", label: `${names} finished without a report` };
    case "failed":
      return { tone: "danger", label: `${names} didn't run` };
  }
}

/**
 * A card's column automation: a countdown it can be cancelled or sped up
 * from, the steps its agent is working on, and what the agent reported, with
 * the way forward when it needs the designer.
 */
export function BoardAutomationCardStatus({
  environmentId,
  run,
  working,
  moveTargetTitle,
  onOpenThread,
  onMoveOn,
}: {
  environmentId: EnvironmentId;
  run: BoardAutomationRun;
  /** The card's agent is busy, so a sent run is still being worked on. */
  working: boolean;
  /** The column the run sends the card to once it's done. */
  moveTargetTitle: string | null;
  onOpenThread: () => void;
  /** Moves the card where its column sends done cards. */
  onMoveOn: (() => void) | null;
}) {
  const scheduled = run.status === "scheduled";
  // A five-second countdown; the timer only runs while one is showing.
  const now = useNow(1_000, scheduled);
  const cancel = useAtomCommand(boardAutomation.cancel, { reportFailure: false });
  const runNow = useAtomCommand(boardAutomation.runNow, { reportFailure: false });
  const report = (title: string) => (result: Awaited<ReturnType<typeof cancel>>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };
  if (run.status === "sent" && !working) return null;
  const { tone, label } = describeRun(run, now);
  const threadInput = { threadId: run.threadId };
  const dismiss = () =>
    void cancel({ environmentId, input: threadInput }).then(report("Couldn't dismiss it"));
  const runAgain = () =>
    void runNow({ environmentId, input: { ...threadInput, columnId: run.toColumnId } }).then(
      report("Couldn't run it again"),
    );
  return (
    <div
      className="flex flex-col gap-1 border-t pt-1.5"
      onPointerDown={stopCardGestures}
      onDoubleClick={stopCardGestures}
      onKeyDown={stopCardGestures}
    >
      <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", TONE_CLASSES[tone])}>
        {TONE_ICONS[tone]}
        <span className="min-w-0 truncate" role="status">
          {label}
        </span>
      </span>
      {run.note ? (
        <p className="line-clamp-3 text-xs wrap-anywhere text-muted-foreground">{run.note}</p>
      ) : null}
      {run.status === "sent" ? null : (
        <div className="flex flex-wrap items-center gap-1">
          {scheduled ? (
            <>
              <Button
                size="compact"
                variant="ghost"
                onClick={() =>
                  void runNow({ environmentId, input: threadInput }).then(
                    report("Couldn't run it now"),
                  )
                }
              >
                Run now
              </Button>
              <Button size="compact" variant="ghost" onClick={dismiss}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {run.status === "finished" && onMoveOn && moveTargetTitle ? (
                <Button size="compact" variant="ghost" onClick={onMoveOn}>
                  Move to {moveTargetTitle}
                </Button>
              ) : null}
              {run.status === "needs-you" || run.status === "finished" ? (
                <Button size="compact" variant="ghost" onClick={onOpenThread}>
                  Open thread
                </Button>
              ) : null}
              {run.status === "needs-you" || run.status === "failed" ? (
                <Button size="compact" variant="ghost" onClick={runAgain}>
                  Run again
                </Button>
              ) : null}
              <Button size="compact" variant="ghost" onClick={dismiss}>
                Dismiss
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
