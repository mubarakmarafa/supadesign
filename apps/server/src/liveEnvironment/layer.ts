import {
  LIVE_ENVIRONMENT_DEV_SCRIPT_ID,
  LiveEnvironmentError,
  type ProjectScript,
  type ThreadId,
} from "@supaterm/contracts";
import {
  projectSettingsOverridesForWrite,
  resolveProjectSettings,
} from "@supaterm/shared/projectSettings";
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
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  DEV_SCRIPT_CONTEXT_FILE_MAX_CHARS,
  DEV_SCRIPT_CONTEXT_FILES,
  isAcceptableDevCommand,
  liveEnvironmentUrl,
  suggestDevScript,
  suggestNestedDevScript,
} from "./devScriptSuggestion.ts";
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

/** Folders never worth looking inside for an app. */
const IGNORED_FOLDERS = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor"]);
const MAX_CHILD_FOLDERS = 40;
/** Subfolders whose files the model also sees, for apps one level down. */
const MAX_NESTED_CONTEXT_FOLDERS = 6;

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
  const textGeneration = yield* TextGeneration.TextGeneration;

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

  /** Folders at the project root that could hold the app, skipping tooling and dependencies. */
  const childFolders = (root: string) =>
    fs.readDirectory(root).pipe(
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
      Effect.flatMap((names) =>
        Effect.filter(
          names
            .filter((name) => !name.startsWith(".") && !IGNORED_FOLDERS.has(name))
            .toSorted()
            .slice(0, MAX_CHILD_FOLDERS),
          (name) =>
            fs.stat(path.join(root, name)).pipe(
              Effect.map((info) => info.type === "Directory"),
              Effect.orElseSucceed(() => false),
            ),
        ),
      ),
    );

  /** What the root's files suggest, else the one app one folder down. */
  const suggestFor = (root: string, scripts: ReadonlyArray<ProjectScript>) =>
    Effect.gen(function* () {
      const inputs = yield* readSuggestionInputs(root);
      const atRoot = suggestDevScript({ scripts, ...inputs });
      if (atRoot.command !== null || inputs.packageJsonText !== null) return atRoot;
      const names = yield* childFolders(root);
      const folders = yield* Effect.forEach(names, (name) =>
        readSuggestionInputs(path.join(root, name)).pipe(
          Effect.map((found) => ({ name, ...found })),
        ),
      );
      return suggestNestedDevScript(folders) ?? atRoot;
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
            ? yield* suggestFor(project.workspaceRoot, scripts)
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

    detectDevScript: ({ projectId, projectRoot, failed }) =>
      Effect.gen(function* () {
        const current = yield* settings.getSettings.pipe(
          Effect.mapError(() => failure("Settings could not be read.")),
        );
        const { textGenerationModelSelection } = resolveProjectSettings(
          current,
          projectId,
        ).settings;
        /** One folder's entries, with a trailing slash on directories. */
        const listFolder = (folder: string, prefix: string) =>
          fs.readDirectory(folder).pipe(
            Effect.orElseSucceed((): ReadonlyArray<string> => []),
            Effect.flatMap((names) =>
              Effect.forEach(names.toSorted().slice(0, 200), (name) =>
                fs.stat(path.join(folder, name)).pipe(
                  Effect.map((info) =>
                    info.type === "Directory" ? `${prefix}${name}/` : `${prefix}${name}`,
                  ),
                  Effect.orElseSucceed(() => `${prefix}${name}`),
                ),
              ),
            ),
          );
        /** The context files present in one folder, trimmed for the prompt. */
        const readContext = (folder: string, prefix: string, names: ReadonlyArray<string>) =>
          Effect.forEach(
            DEV_SCRIPT_CONTEXT_FILES.filter((name) => names.includes(`${prefix}${name}`)),
            (name) =>
              fs.readFileString(path.join(folder, name)).pipe(
                Effect.map((contents) => ({
                  path: `${prefix}${name}`,
                  contents: contents.slice(0, DEV_SCRIPT_CONTEXT_FILE_MAX_CHARS),
                })),
                Effect.orElseSucceed(() => null),
              ),
          );
        const listing = [...(yield* listFolder(projectRoot, ""))];
        const files = [...(yield* readContext(projectRoot, "", listing))];
        // An app can sit one folder down, as in a workspace folder around a repo.
        if (!listing.includes("package.json")) {
          let added = 0;
          for (const name of yield* childFolders(projectRoot)) {
            if (added >= MAX_NESTED_CONTEXT_FOLDERS) break;
            const prefix = `${name}/`;
            const nested = yield* listFolder(path.join(projectRoot, name), prefix);
            if (!DEV_SCRIPT_CONTEXT_FILES.some((file) => nested.includes(`${prefix}${file}`))) {
              continue;
            }
            added += 1;
            listing.push(...nested);
            files.push(...(yield* readContext(path.join(projectRoot, name), prefix, nested)));
          }
        }
        const generated = yield* textGeneration
          .generateDevServerCommand({
            cwd: projectRoot,
            listing,
            files: files.filter((file) => file !== null),
            failedAttempt: failed,
            modelSelection: textGenerationModelSelection,
          })
          .pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Could not work out a dev server command", { error }),
            ),
            Effect.mapError((error) =>
              failure(`The text generation model couldn't answer: ${error.detail}`),
            ),
          );
        yield* Effect.logInfo("Picked a dev server command", {
          command: generated.command,
          reason: generated.reason,
        });
        // The reason reaches the card, so the user sees why it asks.
        if (generated.command === null) {
          return yield* failure(generated.reason || "Nothing in the repo looks like a dev server.");
        }
        if (!isAcceptableDevCommand(generated.command)) {
          return yield* failure(
            `Didn't run “${generated.command}”: it does more than start a server.`,
          );
        }
        return {
          command: generated.command,
          previewUrl: generated.previewUrl ?? undefined,
        };
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
