import {
  LIVE_ENVIRONMENT_DEV_SCRIPT_ID,
  LiveEnvironmentError,
  type ProjectScript,
  type ThreadId,
} from "@supaterm/contracts";
import { projectSettingsOverridesForWrite } from "@supaterm/shared/projectSettings";
import { resolveProjectScripts } from "@supaterm/shared/projectScripts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";

import * as GitManager from "../git/GitManager.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as PortScanner from "../preview/PortScanner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { liveEnvironmentUrl, suggestDevScript } from "./devScriptSuggestion.ts";
import * as LiveEnvironment from "./LiveEnvironmentService.ts";

/** One dev server terminal per card; terminal ids are scoped to the thread. */
const DEV_SERVER_TERMINAL_ID = "live-dev";
const SERVER_READY_TIMEOUT = Duration.minutes(3);
const SERVER_POLL_INTERVAL = Duration.seconds(2);
/** Time a dev server gets to exit on Ctrl-C before its terminal is closed. */
const INTERRUPT_GRACE = Duration.millis(1500);

const SUGGESTION_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "index.html",
] as const;

const failure = (message: string) => new LiveEnvironmentError({ message });

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const gitManager = yield* GitManager.GitManager;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const setupRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const terminals = yield* TerminalManager.TerminalManager;
  const ports = yield* PortScanner.PortDiscovery;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readThread = (threadId: ThreadId) =>
    projections.getThreadShell(threadId).pipe(
      Effect.mapError(() => failure("The card's thread could not be read.")),
      Effect.flatMap((shell) =>
        shell === null || shell.deletedAt !== null
          ? Effect.fail(failure("The card's thread no longer exists."))
          : Effect.succeed(shell),
      ),
    );

  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false));

  const readSuggestionInputs = (root: string) =>
    Effect.gen(function* () {
      const present = yield* Effect.filter(SUGGESTION_FILES, (name) =>
        exists(path.join(root, name)),
      );
      const files = new Set<string>(present);
      const packageJsonText = files.has("package.json")
        ? yield* fs
            .readFileString(path.join(root, "package.json"))
            .pipe(Effect.orElseSucceed(() => null))
        : null;
      return { files, packageJsonText };
    });

  const ops: LiveEnvironment.LiveEnvironmentOps = {
    plan: (threadId) =>
      Effect.gen(function* () {
        const shell = yield* readThread(threadId);
        const project = yield* projects.getById(shell.projectId).pipe(
          Effect.mapError(() => failure("The card's project could not be read.")),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(failure("The card's project no longer exists.")),
              onSome: Effect.succeed,
            }),
          ),
        );
        const current = yield* settings.getSettings.pipe(
          Effect.mapError(() => failure("Settings could not be read.")),
        );
        const scripts = resolveProjectScripts(current, project);
        const devScript =
          scripts.find((script) => script.id === LIVE_ENVIRONMENT_DEV_SCRIPT_ID) ?? null;
        const suggestion =
          devScript === null
            ? suggestDevScript({ scripts, ...(yield* readSuggestionInputs(project.workspaceRoot)) })
            : { command: null, previewUrl: null, source: null };
        return {
          projectId: project.id,
          projectRoot: project.workspaceRoot,
          devScript,
          suggestion,
        };
      }),

    prepareWorkspace: ({ threadId, projectRoot }) =>
      Effect.gen(function* () {
        const shell = yield* readThread(threadId);
        // The agent's own worktree has its latest work, pushed or not.
        if (shell.worktreePath !== null && (yield* exists(shell.worktreePath))) {
          return { worktreePath: shell.worktreePath, created: false };
        }
        const pullRequest = shell.linkedPullRequest ?? shell.branchPullRequest ?? null;
        if (pullRequest === null) {
          return { worktreePath: projectRoot, created: false };
        }
        const before = yield* git
          .listWorktreePaths(projectRoot)
          .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
        const prepared = yield* gitManager
          .preparePullRequestThread({
            cwd: projectRoot,
            reference: pullRequest.url,
            mode: "worktree",
          })
          .pipe(
            Effect.mapError(() =>
              failure(`Pull request #${pullRequest.number} could not be checked out.`),
            ),
          );
        const worktreePath = prepared.worktreePath ?? projectRoot;
        const known = new Set(before.map((entry) => path.resolve(entry)));
        return {
          worktreePath,
          created: prepared.worktreePath !== null && !known.has(path.resolve(worktreePath)),
        };
      }),

    runSetup: ({ threadId, projectId, worktreePath, onLine }) =>
      Effect.gen(function* () {
        const result = yield* setupRunner
          .runForThread({
            threadId,
            projectId,
            worktreePath,
            observeCompletion: { onOutputLine: onLine },
          })
          .pipe(Effect.mapError(() => failure("The setup script could not start.")));
        if (result.status !== "started" || result.completion === undefined) return;
        const { exitCode } = yield* result.completion;
        if (exitCode !== 0) {
          return yield* failure(
            exitCode === null
              ? "The setup script stopped before it finished."
              : `The setup script failed with code ${exitCode}.`,
          );
        }
      }),

    startDevServer: ({ threadId, projectId, worktreePath, onLine }) =>
      Effect.gen(function* () {
        // A dev server left from an earlier run would read the new command as input.
        yield* terminals
          .close({ threadId, terminalId: DEV_SERVER_TERMINAL_ID })
          .pipe(Effect.ignore);
        const result = yield* setupRunner
          .runForThread({
            threadId,
            projectId,
            worktreePath,
            scriptId: LIVE_ENVIRONMENT_DEV_SCRIPT_ID,
            preferredTerminalId: DEV_SERVER_TERMINAL_ID,
            observeCompletion: { onOutputLine: onLine },
          })
          .pipe(Effect.mapError(() => failure("The dev server could not start.")));
        if (result.status !== "started") {
          return yield* failure("The project has no dev server script.");
        }
        return {
          terminalId: result.terminalId,
          exited:
            result.completion === undefined
              ? Effect.never
              : result.completion.pipe(Effect.map((completion) => completion.exitCode)),
        };
      }),

    waitForServer: ({ threadId, terminalId, script }) =>
      ports.scan().pipe(
        Effect.map((servers) =>
          servers.find(
            (server) =>
              server.terminal?.threadId === threadId && server.terminal.terminalId === terminalId,
          ),
        ),
        Effect.repeat({
          until: (server) => server !== undefined,
          schedule: Schedule.spaced(SERVER_POLL_INTERVAL),
        }),
        Effect.timeoutOption(SERVER_READY_TIMEOUT),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(failure("The dev server didn't start listening within 3 minutes.")),
            onSome: (server) =>
              server === undefined
                ? Effect.fail(failure("The dev server didn't start listening."))
                : Effect.succeed(liveEnvironmentUrl(server.url, script.previewUrl)),
          }),
        ),
      ),

    stopDevServer: ({ threadId, terminalId }) =>
      Effect.gen(function* () {
        // Ctrl-C lets the dev server shut down cleanly before its shell goes.
        yield* terminals.write({ threadId, terminalId, data: "\u0003" }).pipe(Effect.ignore);
        yield* Effect.sleep(INTERRUPT_GRACE);
        yield* terminals.close({ threadId, terminalId }).pipe(Effect.ignore);
      }),

    saveDevScript: ({ projectId, command, previewUrl }) =>
      Effect.gen(function* () {
        const project = yield* projects.getById(projectId).pipe(
          Effect.mapError(() => failure("The project could not be read.")),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(failure("The project no longer exists.")),
              onSome: Effect.succeed,
            }),
          ),
        );
        const current = yield* settings.getSettings.pipe(
          Effect.mapError(() => failure("Settings could not be read.")),
        );
        const devScript: ProjectScript = {
          id: LIVE_ENVIRONMENT_DEV_SCRIPT_ID,
          name: "Dev server",
          command,
          icon: "play",
          runOnWorktreeCreate: false,
          ...(previewUrl === undefined ? {} : { previewUrl, autoOpenPreview: false }),
        };
        const scripts = resolveProjectScripts(current, project);
        const nextScripts = scripts.some((script) => script.id === devScript.id)
          ? scripts.map((script) => (script.id === devScript.id ? devScript : script))
          : [...scripts, devScript];
        // Same write the project actions settings make, so the script shows there too.
        yield* settings
          .updateSettings({
            projectSettingsOverrides: {
              [projectId]: {
                ...projectSettingsOverridesForWrite(current, projectId),
                defaultProjectScripts: nextScripts,
              },
            },
          })
          .pipe(Effect.mapError(() => failure("The dev server script could not be saved.")));
      }),

    removeWorkspace: ({ projectRoot, worktreePath }) =>
      // Without force, git keeps a worktree that has changes.
      git.removeWorktree({ cwd: projectRoot, path: worktreePath }).pipe(
        Effect.tapError((error) =>
          Effect.logInfo("Kept a live environment worktree", { worktreePath, error }),
        ),
        Effect.ignore,
      ),
  };

  return yield* LiveEnvironment.make(ops);
});

export const layer = Layer.effect(LiveEnvironment.LiveEnvironmentService, make);
