import * as Effect from "effect/Effect";
import * as ThreadProgress from "../../../threadProgress/ThreadProgressService.ts";
import { McpInvocationContext, requireThreadScope } from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ProgressToolkit } from "./tools.ts";

const caller = (operation: string) =>
  Effect.gen(function* () {
    const scope = yield* requireThreadScope(yield* McpInvocationContext, operation);
    return {
      threadId: scope.thread.threadId,
      service: yield* ThreadProgress.ThreadProgressService,
    };
  });

export const layer = McpToolAccess.toLayer(ProgressToolkit, {
  supaterm_progress_publish: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { threadId, service } = yield* caller("publish progress");
      const update = yield* service.capture({
        threadId,
        source: "agent",
        note: input.note,
        questions: input.questions,
        url: input.url,
      });
      const summaryUpdated =
        input.summary === undefined
          ? false
          : yield* service.setSummary({ threadId, text: input.summary, source: "agent" });
      return { capturedUrl: update.url, summaryUpdated };
    }),
  ),
  supaterm_card_summary_set: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { threadId, service } = yield* caller("set the card summary");
      return {
        updated: yield* service.setSummary({ threadId, text: input.summary, source: "agent" }),
      };
    }),
  ),
});
