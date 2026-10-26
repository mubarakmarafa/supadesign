import type {
  OrchestrationV2Notification,
  PullRequestCheckStatus,
  PullRequestWorkflowRun,
  ThreadWorkflowRunKey,
  ThreadWorkflowRunWatch,
} from "@supaterm/contracts";

/** Whether two references name one run; hosts and repositories compare case-insensitively. */
export function sameWorkflowRun(left: ThreadWorkflowRunKey, right: ThreadWorkflowRunKey): boolean {
  return (
    left.runId === right.runId &&
    left.host.toLowerCase() === right.host.toLowerCase() &&
    left.repository.toLowerCase() === right.repository.toLowerCase()
  );
}

const VERDICTS: Record<PullRequestCheckStatus, string> = {
  success: "succeeded",
  failure: "failed",
  cancelled: "was cancelled",
  skipped: "was skipped",
  neutral: "finished",
  "action-required": "needs action",
  pending: "is still running",
};

// Jobs that did not pass, listed by name in this order. A skipped job is listed because a run
// that succeeded with its deploy job skipped did not deploy.
const LISTED: ReadonlyArray<readonly [PullRequestCheckStatus, string]> = [
  ["failure", "Failed"],
  ["cancelled", "Cancelled"],
  ["action-required", "Needs action"],
  ["pending", "Still running"],
  ["skipped", "Skipped"],
  ["neutral", "Neutral"],
];

function runLabel(watch: ThreadWorkflowRunWatch): string {
  return `${watch.name} run (${watch.url ?? `${watch.repository} run ${watch.runId}`})`;
}

type WorkflowRunWatchWake = {
  readonly text: string;
  readonly notification: OrchestrationV2Notification;
};

/** The wake for a watched run that completed: its verdict, then each job that did not pass. */
export function workflowRunWatchMessage(
  watch: ThreadWorkflowRunWatch,
  run: PullRequestWorkflowRun,
): WorkflowRunWatchWake {
  const verdict = VERDICTS[run.status];
  const lines = LISTED.flatMap(([status, label]) => {
    const names = run.checks.filter((check) => check.status === status).map((c) => c.name);
    return names.length === 0 ? [] : [`- ${label}: ${names.join(", ")}`];
  });
  const passed = run.checks.filter((check) => check.status === "success").length;
  if (passed > 0) lines.push(`- Passed: ${passed} ${passed === 1 ? "job" : "jobs"}`);
  return {
    text: [
      `The GitHub Actions ${runLabel(watch)}, which Supaterm was watching for you, ${verdict}.`,
      ...lines,
      "",
      "The watch has ended.",
    ].join("\n"),
    notification: {
      source: { kind: "monitor" },
      outcome:
        run.status === "success"
          ? "completed"
          : run.status === "failure" || run.status === "cancelled"
            ? "failed"
            : "updated",
      summary: `${watch.name} ${verdict}`,
    },
  };
}

/** The wake for a watch that ended before its run completed. */
export function workflowRunWatchStoppedMessage(
  watch: ThreadWorkflowRunWatch,
  reason: string,
): WorkflowRunWatchWake {
  return {
    text: `Supaterm stopped watching the GitHub Actions ${runLabel(watch)} because ${reason}. Check it yourself, and call watch_workflow_run to watch it again.`,
    notification: {
      source: { kind: "monitor" },
      outcome: "failed",
      summary: `${watch.name}: stopped watching`,
    },
  };
}
