import {
  OrchestratorMcpFailure,
  THREAD_PROGRESS_MAX_QUESTIONS,
  THREAD_SUMMARY_MAX_LENGTH,
  ThreadProgressError,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadProgress from "../../../threadProgress/ThreadProgressService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: Schema.Union([OrchestratorMcpFailure, ThreadProgressError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ThreadProgress.ThreadProgressService,
  ],
};

const ProgressPublishTool = Tool.make("supaterm_progress_publish", {
  ...shared,
  description: `Show the designer your work in progress. Supadesign screenshots the running app and makes it the cover of this thread's board card, with your note. Publish when an early layout is reviewable, after a consequential visual choice, after addressing feedback, or when you need the designer's judgment before investing further, not only at the end. Without url it captures this card's live preview, which is where to check your work; pass url only for a page the live preview doesn't serve. Ask questions only when a decision is genuinely the designer's.`,
  parameters: Schema.Struct({
    note: Schema.String.annotate({
      description:
        "What the image shows and what changed, in a sentence or two the designer reads on the card.",
    }),
    questions: Schema.optional(
      Schema.Array(Schema.String).annotate({
        description: `Up to ${THREAD_PROGRESS_MAX_QUESTIONS} short questions needing the designer's judgment.`,
      }),
    ),
    url: Schema.optional(
      Schema.String.annotate({
        description: "The page to capture, e.g. http://localhost:5173/settings.",
      }),
    ),
    summary: Schema.optional(
      Schema.String.annotate({
        description: "Also update the card's summary; see supaterm_card_summary_set.",
      }),
    ),
  }),
  success: Schema.Struct({ capturedUrl: Schema.String, summaryUpdated: Schema.Boolean }),
})
  .annotate(Tool.Title, "Publish progress")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const CardSummarySetTool = Tool.make("supaterm_card_summary_set", {
  ...shared,
  description: `Set the short summary on this thread's board card: what it is building and where it stands, in at most ${THREAD_SUMMARY_MAX_LENGTH} characters of plain text. Keep it current when the direction or state changes. A summary the designer wrote themselves is kept; updated is false then.`,
  parameters: Schema.Struct({
    summary: Schema.String.annotate({ description: "The summary, one or two sentences." }),
  }),
  success: Schema.Struct({ updated: Schema.Boolean }),
})
  .annotate(Tool.Title, "Set card summary")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const ProgressToolkit = Toolkit.make(ProgressPublishTool, CardSummarySetTool);
