import {
  BoardAutomationError,
  type BoardColumnId,
  CommandId,
  DEFAULT_PROJECT_BOARD,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type ProjectBoard,
  type ProjectId,
  type ThreadId,
} from "@supaterm/contracts";
import { boardCardColumnId } from "@supaterm/shared/projectBoard";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadMessageIntake from "../orchestration-v2/ThreadMessageIntake.ts";
import * as Project from "../project/ProjectService.ts";
import * as CardWorkspace from "../projectBoard/cardWorkspace.ts";
import * as ProjectBoards from "../projectBoard/ProjectBoardService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ThreadBank from "../threadBank/ThreadBankService.ts";
import * as BoardAutomation from "./BoardAutomationService.ts";

/**
 * A card made on the board is created unplaced (the inbox) and placed a moment
 * later; that first placement is where it was made, not a move.
 */
const NEW_CARD_PLACEMENT_WINDOW_MS = 30_000;

const failure = (message: string) => new BoardAutomationError({ message });

const isTurnEnd = (event: OrchestrationV2DomainEvent) =>
  event.type === "run.updated" &&
  (event.payload.status === "completed" || event.payload.status === "interrupted");

interface TrackedCard {
  readonly projectId: ProjectId;
  readonly columnId: BoardColumnId;
  /** Until when its first placement counts as where it was made. */
  readonly newUntil: number | null;
}

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* Project.ProjectService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const banks = yield* ThreadBank.ThreadBankService;
  const boards = yield* ProjectBoards.ProjectBoardService;
  const crypto = yield* Crypto.Crypto;
  // Dispatch reads these per call, as client sends do.
  const services = yield* Effect.context<
    ServerConfig.ServerConfig | FileSystem.FileSystem | ThreadManagement.ThreadManagementService
  >();
  const uuid = crypto.randomUUIDv4().pipe(Effect.orDie);
  const cards = yield* CardWorkspace.make;

  const projectOf = (projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );

  const service = yield* BoardAutomation.make({
    boardOf: (projectId) => Effect.map(projectOf(projectId), (project) => project?.board ?? null),

    cardOf: (threadId) =>
      projections.getThreadShell(threadId).pipe(
        Effect.orElseSucceed(() => null),
        Effect.map((shell) =>
          shell === null || shell.deletedAt !== null
            ? null
            : {
                projectId: shell.projectId,
                title: shell.title,
                branch: shell.branch,
                archived: shell.archivedAt !== null,
              },
        ),
      ),

    send: ({ threadId, text, modelSelection }) =>
      Effect.gen(function* () {
        const message = {
          threadId,
          commandId: CommandId.make(yield* uuid),
          messageId: MessageId.make(yield* uuid),
          text,
          attachments: [],
          modelSelection,
          createdBy: "user",
          creationSource: "server",
        } as const;
        // A card that hasn't started gets its own worktree, as from the composer.
        if (Option.isSome(yield* cards.startInWorktree(message))) return;
        yield* ThreadMessageIntake.dispatchCommand({
          type: "message.dispatch",
          commandId: message.commandId,
          threadId,
          messageId: message.messageId,
          text,
          attachments: [],
          ...(modelSelection === undefined ? {} : { modelSelection }),
          dispatchMode: { type: "queue_after_active" },
          createdBy: "user",
          creationSource: "server",
        });
      }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Could not send a column automation", { error }),
        ),
        Effect.mapError((error) =>
          failure(
            error instanceof Error && error.message.length > 0
              ? error.message
              : "The prompt couldn't be sent to the card.",
          ),
        ),
        Effect.provide(services),
      ),

    sendBanked: ({ threadId, render, modelSelection }) =>
      banks
        .sendAs({ threadId, render, modelSelection })
        .pipe(Effect.mapError((error) => failure(error.message))),

    moveCard: ({ threadId, columnId }) =>
      boards.moveCard({ threadId, columnId }).pipe(
        Effect.mapError((error) => failure(error.message)),
        Effect.asVoid,
      ),
  });

  // ── Watching card moves ──
  // Every path that moves a card (a drag, the keyboard, the board agent)
  // ends in these events, so automations follow the card however it moved.
  const tracked = new Map<ThreadId, TrackedCard>();
  const boardContext = (projectId: ProjectId) =>
    Effect.map(projectOf(projectId), (project) => ({
      board: (project?.board ?? null) as ProjectBoard | null,
      boardAgentThreadId: project?.workspace?.boardAgentThreadId ?? null,
    }));

  const isCard = (thread: Pick<OrchestrationV2AppThread, "lineage">) =>
    thread.lineage.relationshipToParent !== "subagent";

  const seed = Effect.gen(function* () {
    const snapshot = yield* projections.getShellSnapshot();
    const boards = new Map<ProjectId, ProjectBoard | null>();
    for (const shell of snapshot.threads) {
      if (shell.deletedAt !== null || !isCard(shell)) continue;
      if (!boards.has(shell.projectId)) {
        boards.set(shell.projectId, (yield* boardContext(shell.projectId)).board);
      }
      tracked.set(shell.id, {
        projectId: shell.projectId,
        columnId: boardCardColumnId(boards.get(shell.projectId) ?? null, shell),
        newUntil: null,
      });
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not read the cards for column automations", { error }),
    ),
  );

  const onCardEvent = (event: OrchestrationV2DomainEvent) =>
    Effect.gen(function* () {
      if (event.type === "thread.deleted") {
        tracked.delete(event.threadId);
        return yield* service.forget(event.threadId);
      }
      if (
        event.type !== "thread.created" &&
        event.type !== "thread.board-placed" &&
        event.type !== "thread.archived" &&
        event.type !== "thread.unarchived"
      ) {
        return;
      }
      const thread = event.payload;
      if (!isCard(thread)) return;
      const { board, boardAgentThreadId } = yield* boardContext(thread.projectId);
      if (thread.id === boardAgentThreadId) return;
      const columnId = boardCardColumnId(board, thread);
      const previous = tracked.get(thread.id);
      const now = yield* Clock.currentTimeMillis;
      tracked.set(thread.id, {
        projectId: thread.projectId,
        columnId,
        newUntil:
          event.type === "thread.created"
            ? DateTime.toEpochMillis(thread.createdAt) + NEW_CARD_PLACEMENT_WINDOW_MS
            : null,
      });
      if (event.type === "thread.created") return;
      if (previous?.newUntil != null && event.type === "thread.board-placed") {
        if (now <= previous.newUntil) return;
      }
      // Archived cards aren't seeded; leaving Done always unarchives them.
      const fromColumnId =
        previous?.columnId ??
        (event.type === "thread.unarchived"
          ? (board ?? DEFAULT_PROJECT_BOARD).doneColumnId
          : undefined);
      if (fromColumnId === undefined || fromColumnId === columnId) return;
      yield* service.cardMoved({
        threadId: thread.id,
        projectId: thread.projectId,
        fromColumnId,
        toColumnId: columnId,
      });
    });

  /** A sent run shows until the card's agent has nothing left to do. */
  const onTurnEnd = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const shell = yield* projections.getThreadShell(threadId);
      const status = shell?.activityRunStatus ?? null;
      if (status === "preparing" || status === "starting" || status === "running") return;
      yield* service.settled(threadId);
    });

  yield* forkParked(
    seed.pipe(
      Effect.andThen(
        threads.streamDomainEvents.pipe(
          Stream.runForEach((event) =>
            (isTurnEnd(event) ? onTurnEnd(event.threadId) : onCardEvent(event)).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Column automations skipped an event", { cause }),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  return service;
});

export const layer = Layer.effect(BoardAutomation.BoardAutomationService, make);
