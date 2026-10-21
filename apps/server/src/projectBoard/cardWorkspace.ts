import {
  type ChatAttachment,
  type CommandId,
  type MessageId,
  type ModelSelection,
  type OrchestrationMessageContext,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  SUPATERM_PROJECT_FILE_NAME,
  type ThreadId,
} from "@supaterm/contracts";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { parseSupatermProjectFile } from "@supaterm/shared/supatermProjectFile";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadMessageIntake from "../orchestration-v2/ThreadMessageIntake.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Project from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/** A first message the server sends a card for the designer. */
export interface CardStartMessage {
  readonly threadId: ThreadId;
  readonly commandId: CommandId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly context?: OrchestrationMessageContext | undefined;
  readonly modelSelection?: ModelSelection | undefined;
  readonly senderThreadId?: ThreadId | undefined;
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
}

/**
 * Starts cards the server sends work to (the board agent handing a card its
 * brief, banked messages, column automations) in their own worktree, as the
 * composer does, so cards working at once never edit the same checkout.
 */
export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* Project.ProjectService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Launches claim attachments and read these services per call, as client sends do.
  const services = yield* Effect.context<
    | ServerConfig.ServerConfig
    | FileSystem.FileSystem
    | ThreadLaunch.ThreadLaunchService
    | ThreadManagement.ThreadManagementService
  >();

  /** The default branch, else the checked-out one; none outside a git repository. */
  const baseRefOf = (cwd: string) =>
    Effect.gen(function* () {
      const status = yield* git.statusDetailsLocal(cwd);
      if (!status.isRepo) return Option.none<string>();
      const remote = yield* git.resolvePrimaryRemoteName(cwd).pipe(Effect.option);
      const defaultBranch = Option.isNone(remote)
        ? null
        : yield* git
            .resolveDefaultBranchName(cwd, remote.value)
            .pipe(Effect.orElseSucceed(() => null));
      return Option.fromNullishOr(defaultBranch ?? status.branch);
    });

  /**
   * How a card that hasn't started should start: in a new worktree when its
   * project's new threads start in one. None leaves the message to the
   * thread's own checkout, as for a started card or the board agent.
   */
  const worktreeLaunchFor = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const shell = yield* projections.getThreadShell(threadId);
      if (
        shell === null ||
        shell.deletedAt !== null ||
        shell.archivedAt !== null ||
        shell.worktreePath !== null ||
        shell.lineage.relationshipToParent === "subagent" ||
        (yield* threads.getMessageCount(threadId)) > 0
      )
        return Option.none();
      const project = Option.getOrUndefined(yield* projects.getById(shell.projectId));
      if (project === undefined || project.workspace?.boardAgentThreadId === threadId)
        return Option.none();
      const projectFile = yield* fs
        .readFileString(path.join(project.workspaceRoot, SUPATERM_PROJECT_FILE_NAME))
        .pipe(
          Effect.map(parseSupatermProjectFile),
          Effect.orElseSucceed(() => null),
        );
      const projectSettings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        project.id,
        project,
        projectFile,
      );
      const siblings = yield* projections.getShellSnapshot({ projectId: project.id });
      const mode = resolveNewThreadEnvMode({
        projectSettings,
        workspaceRoot: project.workspaceRoot,
        newProjectsRoot: folders.namedProjectsRoot,
        projectHasThreads: [...siblings.threads, ...siblings.archivedThreads].some(
          (other) =>
            other.projectId === project.id &&
            other.id !== threadId &&
            other.id !== project.workspace?.boardAgentThreadId &&
            other.deletedAt === null,
        ),
      });
      if (mode !== "worktree") return Option.none();
      const baseRef = yield* baseRefOf(project.workspaceRoot);
      if (Option.isNone(baseRef)) return Option.none();
      return Option.some({
        shell,
        baseRef: baseRef.value,
        startFromOrigin: projectSettings.settings.newWorktreesStartFromOrigin,
      });
    }).pipe(
      // Anything unreadable leaves the card where it is, as before.
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not plan a card's worktree", { cause }).pipe(
          Effect.as(Option.none()),
        ),
      ),
    );

  /**
   * Sends a card that hasn't started its first message in a new worktree.
   * None means the card takes the message as usual, so the caller sends it.
   */
  const startInWorktree = (message: CardStartMessage) =>
    Effect.gen(function* () {
      const plan = yield* worktreeLaunchFor(message.threadId);
      if (Option.isNone(plan)) return Option.none<ThreadLaunch.ThreadLaunchResult>();
      const { shell, baseRef, startFromOrigin } = plan.value;
      const result = yield* ThreadMessageIntake.launchThread({
        commandId: message.commandId,
        threadId: message.threadId,
        reuseExistingThread: true,
        projectId: shell.projectId,
        title: shell.title,
        modelSelection: message.modelSelection ?? shell.modelSelection,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        workspaceStrategy: { type: "worktree", baseRef, startFromOrigin },
        initialMessage: {
          messageId: message.messageId,
          ...(message.senderThreadId === undefined
            ? {}
            : { senderThreadId: message.senderThreadId }),
          text: message.text,
          attachments: message.attachments,
          ...(message.context === undefined ? {} : { context: message.context }),
        },
        createdBy: message.createdBy,
        creationSource: message.creationSource,
      }).pipe(Effect.provide(services));
      return Option.some(result);
    });

  return { startInWorktree };
});

export type CardWorkspace = Effect.Success<typeof make>;
