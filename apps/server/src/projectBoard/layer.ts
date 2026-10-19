import { CommandId, ProjectBoardError, type OrchestrationV2ThreadShell } from "@supaterm/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as LiveEnvironment from "../liveEnvironment/LiveEnvironmentService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Project from "../project/ProjectService.ts";
import * as ThreadBank from "../threadBank/ThreadBankService.ts";
import * as ProjectBoard from "./ProjectBoardService.ts";

const failure = (message: string) => new ProjectBoardError({ message });

const isWorking = (shell: OrchestrationV2ThreadShell) =>
  shell.activityRunStatus === "preparing" ||
  shell.activityRunStatus === "starting" ||
  shell.activityRunStatus === "running";

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* Project.ProjectService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const banks = yield* ThreadBank.ThreadBankService;
  const liveEnvironments = yield* LiveEnvironment.LiveEnvironmentService;
  const crypto = yield* Crypto.Crypto;
  const commandId = crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(CommandId.make));

  const dispatch = (command: Parameters<typeof threads.dispatch>[0]) =>
    threads.dispatch(command).pipe(
      Effect.tapError((error) => Effect.logWarning("Could not move a board card", { error })),
      Effect.mapError((error) =>
        failure(
          error instanceof Error && error.message.length > 0
            ? error.message
            : "The card couldn't be moved. Try again.",
        ),
      ),
      Effect.asVoid,
    );

  const ops: ProjectBoard.ProjectBoardOps = {
    readProject: (projectId) =>
      Effect.gen(function* () {
        const project = yield* projects.getById(projectId).pipe(
          Effect.mapError(() => failure("The project could not be read.")),
          Effect.map(Option.getOrUndefined),
        );
        if (project === undefined) return yield* failure("The project was not found.");
        const snapshot = yield* projections
          .getShellSnapshot({ projectId })
          .pipe(Effect.mapError(() => failure("The project's cards could not be read.")));
        const shells = [...snapshot.threads, ...snapshot.archivedThreads].filter(
          (shell) =>
            shell.projectId === projectId &&
            shell.deletedAt === null &&
            shell.lineage.relationshipToParent !== "subagent",
        );
        return {
          board: project.board ?? null,
          threads: shells.map((shell) => ({
            id: shell.id,
            title: shell.title,
            createdAt: shell.createdAt,
            archivedAt: shell.archivedAt,
            board: shell.board ?? null,
            working: isWorking(shell),
          })),
        };
      }),

    projectOf: (threadId) =>
      projections.getThreadShell(threadId).pipe(
        Effect.mapError(() => failure("The card's thread could not be read.")),
        Effect.flatMap((shell) =>
          shell === null || shell.deletedAt !== null
            ? Effect.fail(failure("The card's thread no longer exists."))
            : Effect.succeed(shell.projectId),
        ),
      ),

    place: (input) =>
      Effect.flatMap(commandId, (id) =>
        dispatch({
          type: "thread.board.place",
          commandId: id,
          threadId: input.threadId,
          columnId: input.columnId,
          orderKey: input.orderKey,
          returnColumnId: input.returnColumnId,
        }),
      ),

    setArchived: (threadId, archived) =>
      Effect.flatMap(commandId, (id) =>
        dispatch({
          type: archived ? "thread.archive" : "thread.unarchive",
          commandId: id,
          threadId,
        }),
      ),

    sendBank: (threadId) =>
      banks.send(threadId).pipe(
        Effect.mapError((error) => failure(error.message)),
        Effect.asVoid,
      ),

    stopLiveEnvironment: (threadId) => liveEnvironments.stop(threadId),
  };

  return yield* ProjectBoard.make(ops);
});

export const layer = Layer.effect(ProjectBoard.ProjectBoardService, make);
