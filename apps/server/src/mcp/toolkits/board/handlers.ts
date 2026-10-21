import {
  BOARD_AUTOMATION_REPORT_NOTE_MAX_LENGTH,
  OrchestratorMcpFailure,
  ThreadId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as BoardAutomation from "../../../boardAutomation/BoardAutomationService.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as ProjectBoard from "../../../projectBoard/ProjectBoardService.ts";
import * as ThreadBank from "../../../threadBank/ThreadBankService.ts";
import * as ThreadProgress from "../../../threadProgress/ThreadProgressService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  newCommandId,
  readCaller,
  readThread,
  resolveProjectId,
  resolveThreadId,
  unavailable,
} from "../../threadAccess.ts";
import { BoardToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(BoardToolkit, {
  supaterm_board_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const projectId = yield* resolveProjectId(yield* readCaller(), input.projectId);
      const board = yield* ProjectBoard.ProjectBoardService;
      return { projectId, columns: yield* board.read({ projectId, limit: input.limit }) };
    }),
  ),
  supaterm_board_move_card: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        const board = yield* ProjectBoard.ProjectBoardService;
        const placement = yield* board.moveCard({
          threadId: projection.thread.id,
          columnId: input.columnId,
          index: input.index,
        });
        return { threadId: projection.thread.id, ...placement };
      }),
  ),
  supaterm_board_step_report: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const threadId = yield* resolveThreadId(yield* readCaller(), input.threadId);
        const automations = yield* BoardAutomation.BoardAutomationService;
        yield* automations.report({
          threadId,
          outcome: input.outcome,
          note: input.note?.slice(0, BOARD_AUTOMATION_REPORT_NOTE_MAX_LENGTH),
        });
        return { threadId };
      }),
  ),
  supaterm_board_hand_off: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId);
        const caller = (yield* readCaller()).caller;
        const board = yield* ProjectBoard.ProjectBoardService;
        const { startedInWorktree } = yield* board.handOff({
          threadId: projection.thread.id,
          brief: input.brief,
          senderThreadId: caller?.id,
        });
        return { threadId: projection.thread.id, startedInWorktree };
      }),
  ),
  supaterm_board_add_card: McpToolAccess.startsThreads(
    () => ({}),
    (input, { runtimeMode, interactionMode }) =>
      Effect.gen(function* () {
        const context = yield* readCaller();
        const projectId = yield* resolveProjectId(context, input.projectId);
        const project = yield* Project.ProjectService.pipe(
          Effect.flatMap((projects) => projects.getById(projectId)),
          Effect.mapError(unavailable),
          Effect.map(Option.getOrUndefined),
        );
        if (project === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "The project was not found.",
          });
        }
        const modelSelection =
          input.modelSelection ??
          context.caller?.modelSelection ??
          project.defaultModelSelection ??
          undefined;
        if (modelSelection === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              "Pass modelSelection: the project has no default model. orchestrator_capabilities lists providers and models.",
          });
        }
        const board = yield* ProjectBoard.ProjectBoardService;
        // Checked before the thread exists, so a wrong column leaves no stray card.
        const columns = yield* board.read({ projectId, limit: 0 });
        if (
          input.columnId !== undefined &&
          !columns.some((column) => column.id === input.columnId)
        ) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: `There is no column ${input.columnId}. Columns: ${columns
              .map((column) => `${column.id} (${column.title})`)
              .join(", ")}.`,
          });
        }
        const commandId = yield* newCommandId();
        const threadId = ThreadId.make(commandId);
        // No first message, so the card waits for the designer and no agent starts.
        yield* ThreadLaunch.ThreadLaunchService.pipe(
          Effect.flatMap((launches) =>
            launches.launch({
              commandId,
              threadId,
              projectId,
              title: input.title,
              modelSelection,
              runtimeMode,
              interactionMode,
              workspaceStrategy: { type: "root" },
              createdBy: "agent",
              creationSource: "mcp",
            }),
          ),
          Effect.mapError((error) =>
            error._tag === "ThreadManagementProviderInstanceDisabledError"
              ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.message })
              : unavailable(),
          ),
        );
        const summary = input.summary?.trim() ?? "";
        if (summary.length > 0) {
          const progress = yield* ThreadProgress.ThreadProgressService;
          yield* progress.setSummary({ threadId, text: summary, source: "agent" });
        }
        const placement = yield* board.placeNewCard({ threadId, columnId: input.columnId });
        // The card's note waits in its bank, so moving it into the send column starts it.
        // Banked after placing, so a card added straight to the send column waits too.
        yield* ThreadBank.ThreadBankService.pipe(
          Effect.flatMap((bank) =>
            bank.add({
              threadId,
              text: summary.length > 0 ? `${input.title}\n${summary}` : input.title,
              attachments: [],
            }),
          ),
          Effect.catch((error) => Effect.logWarning("Could not bank a new card's note", { error })),
        );
        return { threadId, ...placement };
      }),
  ),
});
