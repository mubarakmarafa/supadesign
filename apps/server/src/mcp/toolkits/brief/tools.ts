import {
  OrchestratorMcpFailure,
  THREAD_DECISION_MAX_LENGTH,
  THREAD_DECISION_SUGGESTIONS_MAX,
  ThreadBriefError,
  ThreadDecisionId,
  ThreadDecisionStatus,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadBrief from "../../../threadBrief/ThreadBriefService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: Schema.Union([OrchestratorMcpFailure, ThreadBriefError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ThreadBrief.ThreadBriefService,
  ],
};

const DecisionSummary = Schema.Struct({ id: ThreadDecisionId, text: Schema.String });

const BriefReadTool = Tool.make("supaterm_brief_read", {
  ...shared,
  description: `Read the designer's brief for this thread's card and the decisions they have settled. The brief is the direction the designer set in their own words; decisions are choices already made, so follow them and don't reopen them. Read it before starting work, and again when the direction feels unclear. Suggestions still waiting on the designer are listed separately; they are not decided yet. Only the designer writes the brief and settles decisions; use supaterm_decision_suggest to propose one.`,
  // No `parameters`: Tool.EmptyParams serializes to the object schema MCP requires.
  success: Schema.Struct({
    brief: Schema.NullOr(Schema.String).annotate({
      description: "The designer's brief, or null when they haven't written one.",
    }),
    decisions: Schema.Array(DecisionSummary).annotate({
      description: "Decisions the designer accepted, in their final wording, oldest first.",
    }),
    awaitingDesigner: Schema.Array(DecisionSummary).annotate({
      description: "Suggestions waiting for the designer to accept, edit, or reject.",
    }),
  }),
})
  .annotate(Tool.Title, "Read the card's brief")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const DecisionSuggestTool = Tool.make("supaterm_decision_suggest", {
  ...shared,
  description: `Suggest a decision for the designer to settle on this thread's card, such as a layout, colour, or interaction choice you made or need made. It appears under the card's brief, where the designer accepts it, rewords it, or rejects it; you can't accept it yourself. Suggest a decision when a choice will shape later work, not for every small step. Keep it to one plain sentence. At most ${THREAD_DECISION_SUGGESTIONS_MAX} suggestions wait at once, and one the designer rejected can't be suggested again.`,
  parameters: Schema.Struct({
    text: Schema.String.check(Schema.isMaxLength(THREAD_DECISION_MAX_LENGTH)).annotate({
      description:
        "The decision, one sentence, e.g. 'Settings uses a single scrolling page, not tabs.'",
    }),
  }),
  success: Schema.Struct({
    decisionId: ThreadDecisionId,
    status: ThreadDecisionStatus.annotate({
      description:
        "suggested while it waits; accepted or edited when the same decision was already settled.",
    }),
  }),
})
  .annotate(Tool.Title, "Suggest a decision")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const BriefToolkit = Toolkit.make(BriefReadTool, DecisionSuggestTool);
