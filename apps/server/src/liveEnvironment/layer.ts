import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  LIVE_ENVIRONMENT_DEV_SCRIPT_ID,
  LiveEnvironmentError,
  ProjectId,
  type ProjectScript,
  ThreadId,
} from "@supaterm/contracts";
import {
  projectSettingsOverridesForWrite,
  resolveProjectSettings,
} from "@supaterm/shared/projectSettings";
import { resolveProjectScripts } from "@supaterm/shared/projectScripts";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as GitManager from "../git/GitManager.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PortScanner from "../preview/PortScanner.ts";
import { forkParked } from "../serverActivation.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  liveEnvironmentUrl,
  suggestDevScript,
  suggestNestedDevScript,
} from "./devScriptSuggestion.ts";
import * as LiveEnvironment from "./LiveEnvironmentService.ts";

/** One dev server terminal per card; terminal ids are scoped to the thread. */
const DEV_SERVER_TERMINAL_ID = "live-dev";
const SERVER_READY_TIMEOUT = Duration.minutes(3);
/** Long enough for a first install; a script past it is usually waiting for input. */
const SETUP_SCRIPT_TIMEOUT = Duration.minutes(15);
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

const FOLDER_ACCESS_DENIED =
  "macOS isn't letting Supadesign read this project's folder. In System Settings > Privacy & Security > Files & Folders, allow Supadesign to access it, then press Try again.";

/**
 * macOS privacy controls refuse with EPERM, which the platform layer reports
 * as Unknown; plain file permissions arrive as PermissionDenied.
 */
function isAccessDenied(error: PlatformError.PlatformError): boolean {
  if (error.reason._tag === "PermissionDenied") return true;
  const cause = "cause" in error.reason ? error.reason.cause : undefined;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EPERM";
}

/** Folders never worth looking inside for an app. */
const IGNORED_FOLDERS = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor"]);
const MAX_CHILD_FOLDERS = 40;

/** How long a setup agent may explore before the card gives up on it. */
const SETUP_AGENT_TIMEOUT = Duration.minutes(8);

/** What the hidden setup agent is asked to do; it reports through an MCP tool. */
function setupAgentPrompt(
  failed: { readonly command: string; readonly output: string } | undefined,
): string {
  const lines = [
    "You are setting up a live preview so a designer can open this project in a browser.",
    "Find the one shell command that starts this checkout's local development server.",
    "",
    "- Explore the repo first: package.json scripts, README, Makefile, config files, and subfolders that hold the app.",
    "- You may install dependencies and briefly start the server to check it works. Stop everything you start before you finish.",
    "- Don't edit, commit, push, or deploy anything, and don't install anything globally.",
    "- The command runs from this checkout's root in a non-interactive shell and must stay in the foreground while it serves. For an app in a subfolder, use `cd <folder> && ...`. Include an install step with `&&` only if dependencies are missing.",
    "",
    "When you know the command, call the `supaterm_live_environment_report_dev_command` tool with `command`, and `previewUrl` if you know the page to open. If nothing here serves a page, call it with only `reason`. Then stop: Supadesign runs the command itself.",
  ];
  if (failed) {
    lines.push(
      "",
      `This command was tried and failed: ${failed.command}`,
      "Its last output:",
      failed.output.slice(-4_000) || "(no output)",
      "",
      "If the command is wrong, report a corrected one. If the command is right and the app's own code is broken, report only a `reason` that says what broke.",
    );
  }
  return lines.join("\n");
}

/**
 * Each project's live card and the preview checkouts made for cards, kept
 * across restarts in the server's state directory. Files written before
 * `state` and `checkout` existed list only live cards.
 */
const LiveCards = Schema.Array(
  Schema.Struct({
    projectId: ProjectId,
    threadId: ThreadId,
    state: Schema.optional(Schema.Literals(["live", "warm", "kept"])),
    checkout: Schema.optional(
      Schema.NullOr(Schema.Struct({ worktreePath: Schema.String, projectRoot: Schema.String })),
    ),
  }),
);
const decodeLiveCards = Schema.decodeEffect(Schema.fromJsonString(LiveCards));
const encodeLiveCards = Schema.encodeEffect(Schema.fromJsonString(LiveCards));

/** Checkouts made for live cards, so one reused after a restart is still cleaned up. */
const CreatedWorktrees = Schema.Array(Schema.String);
const decodeCreatedWorktrees = Schema.decodeEffect(Schema.fromJsonString(CreatedWorktrees));
const encodeCreatedWorktrees = Schema.encodeEffect(Schema.fromJsonString(CreatedWorktrees));

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
  const stateDir = (yield* ServerConfig.ServerConfig).stateDir;
  const liveCardsPath = path.join(stateDir, "live-cards.json");
  const createdWorktreesPath = path.join(stateDir, "live-worktrees.json");
  const threadLaunch = yield* ThreadLaunch.ThreadLaunchService;
  const threadManagement = yield* ThreadManagement.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  const newCommandId = crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(CommandId.make));

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

  const createdWorktrees = new Set(
    yield* fs.readFileString(createdWorktreesPath).pipe(
      Effect.flatMap(decodeCreatedWorktrees),
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    ),
  );
  const rememberCreated = (worktreePath: string, created: boolean) =>
    Effect.suspend(() => {
      const key = path.resolve(worktreePath);
      if (createdWorktrees.has(key) === created) return Effect.void;
      if (created) createdWorktrees.add(key);
      else createdWorktrees.delete(key);
      return encodeCreatedWorktrees([...createdWorktrees]).pipe(
        Effect.flatMap((text) => fs.writeFileString(createdWorktreesPath, text)),
        Effect.tapError((error) =>
          Effect.logInfo("Could not save the live preview checkouts", { error }),
        ),
        Effect.ignore,
      );
    });

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
        return { projectId: project.id, projectRoot: project.workspaceRoot, devScript };
      }),

    suggestDevScript: ({ projectId, directory }) =>
      Effect.gen(function* () {
        const project = yield* projects.getById(projectId).pipe(
          Effect.map(Option.getOrNull),
          Effect.orElseSucceed(() => null),
        );
        const current = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null));
        const scripts =
          project === null || current === null ? [] : resolveProjectScripts(current, project);
        return yield* suggestFor(directory, scripts);
      }),

    prepareWorkspace: ({ threadId, projectRoot }) =>
      Effect.gen(function* () {
        const shell = yield* readThread(threadId);
        const pullRequest = shell.linkedPullRequest ?? shell.branchPullRequest ?? null;
        if (shell.worktreePath !== null) {
          // The agent's own worktree has its latest work, pushed or not.
          if (yield* exists(shell.worktreePath)) {
            return { worktreePath: shell.worktreePath, created: false };
          }
          // Deleted outside the app: check its branch out again where the agent
          // expects it, as the next message would.
          const branch = shell.branch;
          const restored =
            branch !== null &&
            (yield* git.pruneWorktrees({ cwd: projectRoot }).pipe(
              Effect.andThen(
                git.createWorktree({ cwd: projectRoot, refName: branch, path: shell.worktreePath }),
              ),
              Effect.as(true),
              Effect.tapError((error) =>
                Effect.logInfo("Could not restore a live card's deleted worktree", {
                  worktreePath: shell.worktreePath,
                  error,
                }),
              ),
              Effect.orElseSucceed(() => false),
            ));
          if (restored) return { worktreePath: shell.worktreePath, created: false, restored: true };
          // Previewing the project folder instead would show some other branch's code.
          if (pullRequest === null) {
            if (branch === null) {
              return yield* failure(
                "The card's worktree folder was deleted, and it has no branch to check out again.",
              );
            }
            // A merge usually deletes the branch with its worktree; say so rather than guess.
            const branchExists = yield* git
              .resolveCommit({ cwd: projectRoot, revision: `refs/heads/${branch}` })
              .pipe(
                Effect.as(true),
                Effect.orElseSucceed(() => false),
              );
            return yield* failure(
              branchExists
                ? `The card's worktree folder was deleted and its branch “${branch}” couldn't be checked out again. It may be open in another worktree.`
                : `The card's worktree folder and its branch “${branch}” were both deleted, so there's nothing left to preview. If its work was merged, move the card to Done.`,
            );
          }
        }
        if (pullRequest === null) {
          const branch = shell.branch;
          const rootBranch = yield* git.statusDetailsLocal(projectRoot).pipe(
            Effect.map((details) => details.branch),
            Effect.orElseSucceed(() => null),
          );
          // The project folder already shows this branch, unsaved work included.
          if (branch === null || rootBranch === null || rootBranch === branch) {
            return { worktreePath: projectRoot, created: false };
          }
          // A worktree already on the branch, such as one left by a restart, is reused as is.
          const worktreePaths = yield* git
            .listWorktreePaths(projectRoot)
            .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
          for (const candidate of worktreePaths) {
            if (path.resolve(candidate) === path.resolve(projectRoot)) continue;
            const candidateBranch = yield* git.statusDetailsLocal(candidate).pipe(
              Effect.map((details) => details.branch),
              Effect.orElseSucceed(() => null),
            );
            if (candidateBranch === branch) {
              return {
                worktreePath: candidate,
                created: createdWorktrees.has(path.resolve(candidate)),
              };
            }
          }
          // Never switch the project folder's branch; check the card's out beside it.
          const checkout = yield* git
            .createWorktree({ cwd: projectRoot, refName: branch, path: null })
            .pipe(
              Effect.tapError((error) =>
                Effect.logInfo("Could not check out a live card's branch", { branch, error }),
              ),
              Effect.mapError(() =>
                failure(
                  `The card's branch “${branch}” couldn't be checked out. It may be open in another worktree.`,
                ),
              ),
            );
          yield* rememberCreated(checkout.worktree.path, true);
          return { worktreePath: checkout.worktree.path, created: true };
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
            Effect.tapError((error) =>
              Effect.logInfo("Could not check out a live card's pull request", {
                pullRequest: pullRequest.number,
                error,
              }),
            ),
            // Git's own reason, such as the branch being open elsewhere, says what to fix.
            Effect.mapError((error) =>
              failure(
                error._tag === "GitManagerError"
                  ? `Pull request #${pullRequest.number} could not be checked out. ${error.detail}`
                  : `Pull request #${pullRequest.number} could not be checked out.`,
              ),
            ),
          );
        const worktreePath = prepared.worktreePath ?? projectRoot;
        const known = new Set(before.map((entry) => path.resolve(entry)));
        const created =
          prepared.worktreePath !== null &&
          (!known.has(path.resolve(worktreePath)) ||
            createdWorktrees.has(path.resolve(worktreePath)));
        if (created) yield* rememberCreated(worktreePath, true);
        return { worktreePath, created };
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
        const stopSetup = terminals
          .close({ threadId, terminalId: result.terminalId })
          .pipe(Effect.ignore);
        // Stopping the card mid-setup ends the script too.
        const finished = yield* result.completion.pipe(
          Effect.timeoutOption(SETUP_SCRIPT_TIMEOUT),
          Effect.onInterrupt(() => stopSetup),
        );
        if (finished._tag === "None") {
          yield* stopSetup;
          return yield* failure(
            "The setup script was still running after 15 minutes, so it was stopped. It may be waiting for input.",
          );
        }
        const { exitCode } = finished.value;
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

    stopAgentServers: ({ threadId, worktreePath }) =>
      Effect.gen(function* () {
        const shell = yield* projections
          .getThreadShell(threadId)
          .pipe(Effect.orElseSucceed(() => null));
        const status = shell?.activityRunStatus ?? null;
        if (status === "preparing" || status === "starting" || status === "running") return;
        const root = path.resolve(worktreePath);
        const within = (cwd: string) => {
          const relative = path.relative(root, path.resolve(cwd));
          return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
        };
        // The scanner reports a cwd only for listeners outside the app's terminals.
        const pids = new Set(
          (yield* ports.scan()).flatMap((server) =>
            server.terminal === null &&
            server.pid !== null &&
            server.pid !== process.pid &&
            server.cwd != null &&
            within(server.cwd)
              ? [server.pid]
              : [],
          ),
        );
        for (const pid of pids) {
          yield* Effect.try(() => process.kill(pid, "SIGTERM")).pipe(
            Effect.tap(() =>
              Effect.logInfo("Stopped a server a live card's agent left running", {
                threadId,
                pid,
              }),
            ),
            Effect.ignore,
          );
        }
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

    launchSetupAgent: ({ cardThreadId, projectId, projectRoot, worktreePath, failed }) =>
      Effect.gen(function* () {
        const blocked = yield* fs.readDirectory(worktreePath).pipe(
          Effect.as(false),
          // The agent explores with its own tools; only a block macOS shows the user stops it.
          Effect.catchTags({
            PlatformError: (error) =>
              Effect.logWarning("Could not read a live preview checkout", {
                worktreePath,
                error,
              }).pipe(Effect.as(isAccessDenied(error))),
          }),
        );
        if (blocked) return yield* failure(FOLDER_ACCESS_DENIED);
        const current = yield* settings.getSettings.pipe(
          Effect.mapError(() => failure("Settings could not be read.")),
        );
        const launched = yield* threadLaunch
          .launch({
            commandId: yield* newCommandId,
            projectId,
            parentThreadId: cardThreadId,
            title: "Set up live preview",
            // The cheap model the app already uses for small jobs.
            modelSelection: resolveProjectSettings(current, projectId).settings
              .textGenerationModelSelection,
            // Nobody watches it, so it can't stop to ask before running commands.
            runtimeMode: "full-access",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            workspaceStrategy:
              worktreePath === projectRoot
                ? { type: "root" }
                : { type: "existing_worktree", worktreePath },
            initialMessage: { text: setupAgentPrompt(failed), attachments: [] },
            createdBy: "system",
            creationSource: "server",
          })
          .pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Could not start the live preview setup agent", { error }),
            ),
            Effect.mapError(() =>
              failure("Supadesign couldn't start an agent to set up the preview."),
            ),
          );
        return launched.threadId;
      }),

    awaitSetupAgent: ({ projectId, setupThreadId }) =>
      threadManagement
        .waitForThread({
          projectId,
          threadId: setupThreadId,
          timeoutMs: Duration.toMillis(SETUP_AGENT_TIMEOUT),
        })
        .pipe(Effect.ignore),

    removeSetupAgent: ({ projectId, setupThreadId }) =>
      Effect.gen(function* () {
        yield* threadManagement
          .interruptThread({
            projectId,
            commandId: yield* newCommandId,
            threadId: setupThreadId,
            reason: "The live preview setup is done.",
          })
          .pipe(Effect.ignore);
        // Deleting a thread never removes a worktree another thread uses.
        yield* threadManagement
          .dispatch({
            type: "thread.delete",
            commandId: yield* newCommandId,
            threadId: setupThreadId,
          })
          .pipe(
            Effect.tapError((error) =>
              Effect.logInfo("Could not remove the live preview setup agent", { error }),
            ),
            Effect.ignore,
          );
      }),

    removeWorkspace: ({ projectRoot, worktreePath }) =>
      // Without force, git keeps a worktree that has changes.
      git.removeWorktree({ cwd: projectRoot, path: worktreePath }).pipe(
        Effect.andThen(rememberCreated(worktreePath, false)),
        Effect.as(true),
        Effect.tapError((error) =>
          Effect.logInfo("Kept a live environment worktree", { worktreePath, error }),
        ),
        Effect.orElseSucceed(() => false),
      ),

    discardWorkspace: ({ projectRoot, worktreePath }) =>
      git.removeWorktree({ cwd: projectRoot, path: worktreePath, force: true }).pipe(
        Effect.mapError(() => failure("The preview checkout couldn't be removed.")),
        Effect.andThen(rememberCreated(worktreePath, false)),
      ),

    loadLiveCards: fs.readFileString(liveCardsPath).pipe(
      Effect.flatMap(decodeLiveCards),
      Effect.orElseSucceed(() => []),
      // A checkout deleted while the server was off has nothing left to clean up or keep.
      Effect.flatMap((cards) =>
        Effect.forEach(cards, (card) =>
          Effect.gen(function* () {
            const state = card.state ?? "live";
            const checkout =
              card.checkout != null && (yield* exists(card.checkout.worktreePath))
                ? card.checkout
                : null;
            return { projectId: card.projectId, threadId: card.threadId, state, checkout };
          }),
        ),
      ),
    ),

    saveLiveCards: (cards) =>
      encodeLiveCards(cards).pipe(
        Effect.flatMap((text) => fs.writeFileString(liveCardsPath, text)),
        Effect.tapError((error) => Effect.logInfo("Could not save the live cards", { error })),
        Effect.ignore,
      ),
  };

  const service = yield* LiveEnvironment.make(ops);
  // A card archived or deleted anywhere, not only dragged to Done, stops its
  // dev server now. A kept checkout stays, so its changes can still be discarded.
  yield* forkParked(
    threadManagement.streamDomainEvents.pipe(
      Stream.filter((event) => event.type === "thread.archived" || event.type === "thread.deleted"),
      Stream.runForEach((event) =>
        service
          .list()
          .pipe(
            Effect.flatMap((environments) =>
              environments.some(
                (environment) =>
                  environment.threadId === event.threadId && environment.status !== "kept",
              )
                ? service.stop(event.threadId)
                : Effect.void,
            ),
          ),
      ),
    ),
  );
  return service;
});

export const layer = Layer.effect(LiveEnvironment.LiveEnvironmentService, make);
