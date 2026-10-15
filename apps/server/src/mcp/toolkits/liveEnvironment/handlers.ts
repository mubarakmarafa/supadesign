import { OrchestratorMcpFailure } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as LiveEnvironment from "../../../liveEnvironment/LiveEnvironmentService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import { requireThreadMcpCapability } from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { LiveEnvironmentToolkit } from "./tools.ts";

/** Live environments open a dev server, so they ride on the browser capability. */
const access = Effect.gen(function* () {
  const scope = yield* requireThreadMcpCapability("preview");
  const threads = yield* ThreadManagement.ThreadManagementService;
  const shell = yield* threads
    .getThreadShell(scope.thread.threadId)
    .pipe(Effect.mapError(unavailable));
  if (shell === null) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_not_found",
      message: "The thread was not found.",
    });
  }
  return {
    threadId: scope.thread.threadId,
    projectId: shell.projectId,
    service: yield* LiveEnvironment.LiveEnvironmentService,
  };
});

export const layer = McpToolAccess.toLayer(LiveEnvironmentToolkit, {
  supaterm_live_environment_status: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { projectId, service } = yield* access;
      return { environments: yield* service.list(projectId) };
    }),
  ),
  supaterm_live_environment_start: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const { projectId, threadId, service } = yield* access;
      yield* service.activate({ projectId, threadId });
      return {};
    }),
  ),
  supaterm_live_environment_stop: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const { threadId, service } = yield* access;
      yield* service.stop(threadId);
      return {};
    }),
  ),
});
