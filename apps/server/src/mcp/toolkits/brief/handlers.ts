import type { ThreadDecision } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as ThreadBrief from "../../../threadBrief/ThreadBriefService.ts";
import { McpInvocationContext, requireThreadScope } from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { BriefToolkit } from "./tools.ts";

const caller = (operation: string) =>
  Effect.gen(function* () {
    const scope = yield* requireThreadScope(yield* McpInvocationContext, operation);
    return {
      threadId: scope.thread.threadId,
      service: yield* ThreadBrief.ThreadBriefService,
    };
  });

const summary = ({ id, text }: ThreadDecision) => ({ id, text });

/** Agents read and suggest as themselves; the service refuses them everything else. */
export const layer = McpToolAccess.toLayer(BriefToolkit, {
  supaterm_brief_read: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { threadId, service } = yield* caller("read the card's brief");
      const current = yield* service.get(threadId);
      const decisions = current?.decisions ?? [];
      return {
        brief: current?.brief?.text ?? null,
        decisions: decisions.filter((decision) => decision.status !== "suggested").map(summary),
        awaitingDesigner: decisions
          .filter((decision) => decision.status === "suggested")
          .map(summary),
      };
    }),
  ),
  supaterm_decision_suggest: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { threadId, service } = yield* caller("suggest a decision");
      const decision = yield* service.addDecision({ threadId, text: input.text, by: "agent" });
      return { decisionId: decision.id, status: decision.status };
    }),
  ),
});
