import {
  LiveEnvironmentError,
  LiveEnvironmentSnapshot,
  OrchestratorMcpFailure,
  PreviewAutomationUnavailableError,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as LiveEnvironment from "../../../liveEnvironment/LiveEnvironmentService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: Schema.Union([
    OrchestratorMcpFailure,
    PreviewAutomationUnavailableError,
    LiveEnvironmentError,
  ]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    LiveEnvironment.LiveEnvironmentService,
  ],
};

const LiveEnvironmentStatusTool = Tool.make("supaterm_live_environment_status", {
  ...shared,
  description:
    "List the live environments of this thread's project. A live environment runs one board card's work locally: its worktree, the project's setup script, and the project's dev server. `url` is where the running dev server is reachable once status is ready. A card that is not active is warm and stops at warmUntil (epoch ms).",
  success: Schema.Struct({ environments: Schema.Array(LiveEnvironmentSnapshot) }),
})
  .annotate(Tool.Title, "Get live environment status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const LiveEnvironmentStartTool = Tool.make("supaterm_live_environment_start", {
  ...shared,
  description:
    "Make this thread its project's live card: check out its work, run setup, and start the project's dev server. The project's previous live card stays warm for a grace period. Returns right away; poll supaterm_live_environment_status until status is ready, failed, or needs-dev-script.",
  success: Schema.Struct({}),
})
  .annotate(Tool.Title, "Start live environment")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const LiveEnvironmentStopTool = Tool.make("supaterm_live_environment_stop", {
  ...shared,
  description:
    "Stop this thread's live environment now, skipping the warm period. Its dev server stops and a worktree created for it is removed when it has no changes.",
  success: Schema.Struct({}),
})
  .annotate(Tool.Title, "Stop live environment")
  .annotate(Tool.Destructive, true);

export const LiveEnvironmentToolkit = Toolkit.make(
  LiveEnvironmentStatusTool,
  LiveEnvironmentStartTool,
  LiveEnvironmentStopTool,
);
