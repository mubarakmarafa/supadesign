import {
  BOARD_AUTOMATION_REPORT_NOTE_MAX_LENGTH,
  BoardAutomationError,
  BoardColumnId,
  ModelSelection,
  NonNegativeInt,
  OrchestratorMcpFailure,
  ProjectBoardError,
  ProjectId,
  THREAD_SUMMARY_MAX_LENGTH,
  ThreadId,
  ThreadProgressError,
  TrimmedNonEmptyString,
} from "@supaterm/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as BoardAutomation from "../../../boardAutomation/BoardAutomationService.ts";
import * as ThreadLaunchService from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ProjectBoard from "../../../projectBoard/ProjectBoardService.ts";
import * as ThreadProgress from "../../../threadProgress/ThreadProgressService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: Schema.Union([OrchestratorMcpFailure, ProjectBoardError, ThreadProgressError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectBoard.ProjectBoardService,
    Crypto.Crypto,
  ],
};

const Placement = Schema.Struct({
  threadId: ThreadId,
  columnId: BoardColumnId,
  index: NonNegativeInt.annotate({ description: "Position in the column, 0 is the top." }),
});

const BoardReadTool = Tool.make("supaterm_board_read", {
  ...shared,
  description:
    "Read a project's board: its columns left to right, each with its cards top to bottom. Each card is one thread. Flags: inbox (new cards land here), live (the top card's dev server runs in the live preview), send (moving a card here sends its banked messages), done (moving a card here archives it). onEnter and onLeave name the column's automations: prompts sent to a card's own agent a few seconds after it moves in or out. Omit projectId for this thread's project.",
  parameters: Schema.Struct({
    projectId: Schema.optional(ProjectId),
    limit: Schema.optional(
      NonNegativeInt.annotate({ description: "Cards listed per column; 50 by default." }),
    ),
  }),
  success: Schema.Struct({
    projectId: ProjectId,
    columns: Schema.Array(
      Schema.Struct({
        id: BoardColumnId,
        title: Schema.String,
        inbox: Schema.Boolean,
        live: Schema.Boolean,
        send: Schema.Boolean,
        done: Schema.Boolean,
        onEnter: Schema.Array(Schema.String),
        onLeave: Schema.Array(Schema.String),
        moveWhenDone: Schema.NullOr(BoardColumnId),
        cardCount: NonNegativeInt,
        cards: Schema.Array(
          Schema.Struct({ threadId: ThreadId, title: Schema.String, archived: Schema.Boolean }),
        ),
      }),
    ),
  }),
})
  .annotate(Tool.Title, "Read the board")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const BoardMoveCardTool = Tool.make("supaterm_board_move_card", {
  ...shared,
  description:
    "Move a card on its project's board, as the designer's drag does. Moving it to the done column archives its thread, which fails while that thread is working; moving it out of done unarchives it. Moving it to the send column sends its banked messages. Moving it out of the live column stops its dev server, and the top card of the live column is the one the live preview runs. Moving it in or out of a column with automations (onEnter, onLeave) sends those prompts to the card's agent after a few seconds, so only make moves the designer asked for. Omit threadId for this thread's own card. Column ids come from supaterm_board_read.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    columnId: BoardColumnId,
    index: Schema.optional(
      NonNegativeInt.annotate({
        description: "Position in the column, counted without the card; 0 (the top) by default.",
      }),
    ),
  }),
  success: Placement,
})
  .annotate(Tool.Title, "Move a board card")
  .annotate(Tool.Destructive, true);

const BoardAddCardTool = Tool.make("supaterm_board_add_card", {
  ...shared,
  description: `Add a card to a project's board for work to do later, as the designer's "+" on a column does. The card is a new thread that has not started: nothing is sent to an agent until the designer opens it and sends a message. It goes to the top of columnId (the inbox when omitted), or under the live card in the live column. Use one card per idea; to start work right away use supaterm_thread_launch instead. Omit projectId for this thread's project, and modelSelection for this thread's model or the project's default.`,
  parameters: Schema.Struct({
    projectId: Schema.optional(ProjectId),
    columnId: Schema.optional(BoardColumnId),
    title: TrimmedNonEmptyString.annotate({ description: "The card's name, a few words." }),
    summary: Schema.optional(
      Schema.String.annotate({
        description: `What the card is about, in at most ${THREAD_SUMMARY_MAX_LENGTH} characters.`,
      }),
    ),
    modelSelection: Schema.optional(ModelSelection),
  }),
  success: Placement,
  dependencies: [
    ...shared.dependencies,
    ProjectService.ProjectService,
    ThreadLaunchService.ThreadLaunchService,
    ThreadProgress.ThreadProgressService,
  ],
})
  .annotate(Tool.Title, "Add a board card")
  .annotate(Tool.Destructive, false);

const BoardStepReportTool = Tool.make("supaterm_board_step_report", {
  failure: Schema.Union([OrchestratorMcpFailure, BoardAutomationError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    BoardAutomation.BoardAutomationService,
  ],
  description:
    'Report how a board column\'s step went, when a message says it was "Sent by the … column\'s … step". Call it once you have finished that work: outcome "done" with a short note of what you did (the board may then move the card on, for example to Done), or "needs_you" with what is blocking you (a conflict, a failing check, a question), which flags the card for the designer. Omit threadId for this thread\'s own card.',
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    outcome: Schema.Literals(["done", "needs_you"]),
    note: Schema.optional(
      Schema.String.annotate({
        description: `One line for the designer, at most ${BOARD_AUTOMATION_REPORT_NOTE_MAX_LENGTH} characters.`,
      }),
    ),
  }),
  success: Schema.Struct({ threadId: ThreadId }),
})
  .annotate(Tool.Title, "Report a board step")
  .annotate(Tool.Destructive, false);

export const BoardToolkit = Toolkit.make(
  BoardReadTool,
  BoardMoveCardTool,
  BoardAddCardTool,
  BoardStepReportTool,
);
