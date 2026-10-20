import type { BoardAutomationRun, EnvironmentId } from "@supaterm/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { TriangleAlertIcon, ZapIcon } from "lucide-react";

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

/**
 * A card's column automation: a countdown it can be cancelled or sped up
 * from, what was sent while the card's agent works on it, or why it failed.
 */
export function BoardAutomationCardStatus({
  environmentId,
  run,
  working,
}: {
  environmentId: EnvironmentId;
  run: BoardAutomationRun;
  /** The card's agent is busy, so a sent run is still being worked on. */
  working: boolean;
}) {
  const scheduled = run.status === "scheduled";
  // A five-second countdown; the timer only runs while one is showing.
  const now = useNow(1_000, scheduled);
  const cancel = useAtomCommand(boardAutomation.cancel, { reportFailure: false });
  const runNow = useAtomCommand(boardAutomation.runNow, { reportFailure: false });
  const input = { environmentId, input: { threadId: run.threadId } };
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
  const names = joinNames(run.stepNames);
  return (
    <div
      className="flex flex-col gap-1 border-t pt-1.5"
      onPointerDown={stopCardGestures}
      onDoubleClick={stopCardGestures}
      onKeyDown={stopCardGestures}
    >
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-xs",
          run.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
        )}
      >
        {run.status === "failed" ? (
          <TriangleAlertIcon aria-hidden className="size-3 shrink-0" />
        ) : (
          <ZapIcon aria-hidden className="size-3 shrink-0" />
        )}
        <span className="min-w-0 truncate" role="status">
          {scheduled
            ? `${names} in ${boardAutomationSecondsLeft(run, now)}s`
            : run.status === "sent"
              ? `Sent ${names}`
              : `${names} didn't run`}
        </span>
      </span>
      {run.note ? (
        <p className="line-clamp-3 text-xs wrap-anywhere text-muted-foreground">{run.note}</p>
      ) : null}
      {scheduled || run.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-1">
          {scheduled ? (
            <Button
              size="compact"
              variant="ghost"
              onClick={() => void runNow(input).then(report("Couldn't run it now"))}
            >
              Run now
            </Button>
          ) : null}
          <Button
            size="compact"
            variant="ghost"
            onClick={() => void cancel(input).then(report("Couldn't cancel it"))}
          >
            {scheduled ? "Cancel" : "Dismiss"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
