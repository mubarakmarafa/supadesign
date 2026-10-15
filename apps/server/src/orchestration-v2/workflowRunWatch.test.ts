import type { PullRequestCheckStatus } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { workflowRunWatchMessage, workflowRunWatchStoppedMessage } from "./workflowRunWatch.ts";

const watch = {
  host: "github.com",
  repository: "acme/web",
  runId: 42,
  name: "Release",
  url: "https://github.com/acme/web/actions/runs/42",
  startedAt: "2026-10-15T00:00:00.000Z",
};

const run = (
  status: PullRequestCheckStatus,
  jobs: ReadonlyArray<[string, PullRequestCheckStatus]>,
) => ({
  host: "github.com",
  repository: "acme/web",
  name: "Release",
  url: watch.url,
  status,
  checks: jobs.map(([name, jobStatus]) => ({
    name,
    status: jobStatus,
    description: null,
    url: null,
  })),
});

describe("workflowRunWatchMessage", () => {
  it("names every job that did not pass, and counts the rest", () => {
    const message = workflowRunWatchMessage(
      watch,
      run("failure", [
        ["Build", "success"],
        ["Test", "success"],
        ["Mobile preview ios", "failure"],
        ["Publish", "cancelled"],
        ["Deploy", "skipped"],
      ]),
    );
    expect(message.text).toBe(
      [
        "The GitHub Actions Release run (https://github.com/acme/web/actions/runs/42), which Supaterm was watching for you, failed.",
        "- Failed: Mobile preview ios",
        "- Cancelled: Publish",
        "- Skipped: Deploy",
        "- Passed: 2 jobs",
        "",
        "The watch has ended.",
      ].join("\n"),
    );
    expect(message.notification).toEqual({
      source: { kind: "monitor" },
      outcome: "failed",
      summary: "Release failed",
    });
  });

  it("reports a run that passed as completed", () => {
    const message = workflowRunWatchMessage(watch, run("success", [["Build", "success"]]));
    expect(message.text).toContain(
      "which Supaterm was watching for you, succeeded.\n- Passed: 1 job",
    );
    expect(message.notification.outcome).toBe("completed");
  });

  it("names the run by repository and id when it has no URL", () => {
    const message = workflowRunWatchStoppedMessage({ ...watch, url: null }, "it could not");
    expect(message.text).toContain("Release run (acme/web run 42) because it could not.");
    expect(message.notification.outcome).toBe("failed");
  });
});
