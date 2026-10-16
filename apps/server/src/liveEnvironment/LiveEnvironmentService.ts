import {
  LIVE_ENVIRONMENT_GRACE_MS,
  LIVE_ENVIRONMENT_LOG_TAIL_LINES,
  LiveEnvironmentError,
  type LiveEnvironmentDevScriptSuggestion,
  type LiveEnvironmentList,
  type LiveEnvironmentPhase,
  type LiveEnvironmentSnapshot,
  type LiveEnvironmentStatus,
  type ProjectId,
  type ProjectScript,
  type ThreadId,
} from "@supaterm/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

/**
 * The steps one live environment goes through. Production wires them to git,
 * the setup runner, the terminal manager, and port discovery; tests fake them.
 */
export interface LiveEnvironmentOps {
  /** The card's project and the dev server script it would run. */
  readonly plan: (threadId: ThreadId) => Effect.Effect<
    {
      readonly projectId: ProjectId;
      readonly projectRoot: string;
      readonly devScript: ProjectScript | null;
      readonly suggestion: LiveEnvironmentDevScriptSuggestion;
    },
    LiveEnvironmentError
  >;
  /** Picks or creates the checkout to run. `created` means teardown may remove it. */
  readonly prepareWorkspace: (input: {
    readonly threadId: ThreadId;
    readonly projectRoot: string;
  }) => Effect.Effect<
    { readonly worktreePath: string; readonly created: boolean },
    LiveEnvironmentError
  >;
  readonly runSetup: (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly worktreePath: string;
    readonly onLine: (line: string) => Effect.Effect<void>;
  }) => Effect.Effect<void, LiveEnvironmentError>;
  /** Starts the dev server; `exited` resolves with its exit code when it stops on its own. */
  readonly startDevServer: (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly worktreePath: string;
    readonly script: ProjectScript;
    readonly onLine: (line: string) => Effect.Effect<void>;
  }) => Effect.Effect<
    { readonly terminalId: string; readonly exited: Effect.Effect<number | null> },
    LiveEnvironmentError
  >;
  /** Resolves with the URL once the dev server listens. */
  readonly waitForServer: (input: {
    readonly threadId: ThreadId;
    readonly terminalId: string;
    readonly script: ProjectScript;
  }) => Effect.Effect<string, LiveEnvironmentError>;
  readonly stopDevServer: (input: {
    readonly threadId: ThreadId;
    readonly terminalId: string;
  }) => Effect.Effect<void>;
  /** Saves the project's dev server script, replacing an earlier one. */
  readonly saveDevScript: (input: {
    readonly projectId: ProjectId;
    readonly command: string;
    readonly previewUrl: string | undefined;
  }) => Effect.Effect<void, LiveEnvironmentError>;
  /**
   * Works out the dev server command from the repo, or a corrected one after
   * `failed`. Fails with the reason, for the card, when it cannot: nothing
   * serves a page, or the failure is in the app's own code.
   */
  readonly detectDevScript: (input: {
    readonly projectId: ProjectId;
    readonly projectRoot: string;
    readonly failed?: { readonly command: string; readonly output: string } | undefined;
  }) => Effect.Effect<
    { readonly command: string; readonly previewUrl: string | undefined },
    LiveEnvironmentError
  >;
  /** Removes a worktree this service created, leaving it alone when it has changes. */
  readonly removeWorkspace: (input: {
    readonly projectRoot: string;
    readonly worktreePath: string;
  }) => Effect.Effect<void>;
}

export class LiveEnvironmentService extends Context.Service<
  LiveEnvironmentService,
  {
    /** Makes `threadId` the project's live card; the previous one goes warm. */
    readonly activate: (input: {
      readonly projectId: ProjectId;
      readonly threadId: ThreadId | null;
    }) => Effect.Effect<void, LiveEnvironmentError>;
    /** Stops a card's environment now, skipping the warm period. */
    readonly stop: (threadId: ThreadId) => Effect.Effect<void>;
    /**
     * Tears down and prepares the card again, keeping whether it is live. A
     * dev server that failed first gets its command checked by the model.
     */
    readonly retry: (threadId: ThreadId) => Effect.Effect<void, LiveEnvironmentError>;
    /** Saves the dev server script and retries the cards that were waiting for one. */
    readonly saveDevScript: (input: {
      readonly projectId: ProjectId;
      readonly command: string;
      readonly previewUrl?: string | undefined;
    }) => Effect.Effect<void, LiveEnvironmentError>;
    readonly list: (projectId?: ProjectId) => Effect.Effect<ReadonlyArray<LiveEnvironmentSnapshot>>;
    /** Calls `listener` with the project's environments now and after every change. */
    readonly subscribe: (
      projectId: ProjectId,
      listener: (list: LiveEnvironmentList) => Effect.Effect<void>,
    ) => Effect.Effect<() => void>;
  }
>()("supaterm/liveEnvironment/LiveEnvironmentService") {}

interface Entry {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  status: LiveEnvironmentStatus;
  phase: LiveEnvironmentPhase | null;
  active: boolean;
  warmUntil: number | null;
  url: string | null;
  worktreePath: string | null;
  terminalId: string | null;
  error: string | null;
  log: Array<string>;
  suggestion: LiveEnvironmentDevScriptSuggestion | null;
  updatedAt: number;
  projectRoot: string | null;
  createdWorktree: boolean;
  /** Set when the card is made live again while it is still stopping. */
  restartAfterStop: boolean;
  /** The dev server script this run started, once it has one. */
  script: ProjectScript | null;
  /** Whether this run's command was picked without the user. */
  autoChosen: boolean;
  /** Whether the model already tried to correct this card's command. */
  fixAttempted: boolean;
  /** Carries `fixAttempted` into the run a fix restarts, so a fix cannot loop. */
  restartFixAttempted: boolean;
  /** Whether the failure came from the dev server itself, which a fix may cure. */
  serverFailed: boolean;
  job: Fiber.Fiber<unknown, unknown> | null;
  timer: Fiber.Fiber<unknown, unknown> | null;
}

function snapshot(entry: Entry): LiveEnvironmentSnapshot {
  return {
    projectId: entry.projectId,
    threadId: entry.threadId,
    status: entry.status,
    phase: entry.phase,
    active: entry.active,
    warmUntil: entry.warmUntil,
    url: entry.url,
    worktreePath: entry.worktreePath,
    terminalId: entry.terminalId,
    error: entry.error,
    logTail: entry.status === "failed" ? [...entry.log] : [],
    suggestion: entry.suggestion,
    updatedAt: entry.updatedAt,
  };
}

export const make = (ops: LiveEnvironmentOps, options?: { readonly graceMs?: number }) =>
  Effect.gen(function* () {
    const graceMs = options?.graceMs ?? LIVE_ENVIRONMENT_GRACE_MS;
    const entries = new Map<ThreadId, Entry>();
    const listeners = new Set<{
      readonly projectId: ProjectId;
      readonly listener: (list: LiveEnvironmentList) => Effect.Effect<void>;
    }>();
    const lock = yield* Semaphore.make(1);
    const locked = Semaphore.withPermits(lock, 1);
    const scope = yield* Scope.make("parallel");
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));

    const listFor = (projectId: ProjectId): LiveEnvironmentList => ({
      projectId,
      environments: entries
        .values()
        .filter((entry) => entry.projectId === projectId)
        .map(snapshot)
        .toArray(),
    });

    const publish = (projectId: ProjectId) =>
      Effect.suspend(() => {
        const list = listFor(projectId);
        return Effect.forEach(
          [...listeners].filter((subscription) => subscription.projectId === projectId),
          (subscription) => subscription.listener(list),
          { discard: true },
        );
      });

    /** Applies a change only while `entry` is still the card's current run. */
    const update = (entry: Entry, change: (entry: Entry) => void) =>
      locked(
        Effect.gen(function* () {
          if (entries.get(entry.threadId) !== entry) return;
          change(entry);
          entry.updatedAt = yield* Clock.currentTimeMillis;
          yield* publish(entry.projectId);
        }),
      );

    const appendLog = (entry: Entry) => (line: string) =>
      Effect.sync(() => {
        entry.log.push(line);
        if (entry.log.length > LIVE_ENVIRONMENT_LOG_TAIL_LINES) entry.log.shift();
      });

    const fail = (entry: Entry, message: string) =>
      update(entry, (current) => {
        current.status = "failed";
        current.phase = null;
        current.url = null;
        current.error = message;
      });

    /**
     * The project's dev server script. Without one it picks one itself, from
     * the repo's own scripts or by asking the model, and saves it; null means
     * the user has to say how the project runs.
     */
    const resolveDevScript = (entry: Entry) =>
      Effect.gen(function* () {
        const plan = yield* ops.plan(entry.threadId);
        yield* update(entry, (current) => {
          current.projectRoot = plan.projectRoot;
        });
        if (plan.devScript !== null) return { plan, devScript: plan.devScript };
        let chosen: { command: string; previewUrl: string | undefined } | null =
          plan.suggestion.command === null
            ? null
            : {
                command: plan.suggestion.command,
                previewUrl: plan.suggestion.previewUrl ?? undefined,
              };
        let reason: string | null = null;
        if (chosen === null) {
          yield* update(entry, (current) => {
            current.phase = "detecting";
          });
          chosen = yield* ops
            .detectDevScript({ projectId: entry.projectId, projectRoot: plan.projectRoot })
            .pipe(
              Effect.catch((error: LiveEnvironmentError) => {
                reason = error.message;
                return Effect.succeed(null);
              }),
            );
        }
        const saved =
          chosen === null
            ? null
            : yield* ops.saveDevScript({ projectId: entry.projectId, ...chosen }).pipe(
                Effect.andThen(ops.plan(entry.threadId)),
                Effect.map((replanned) => replanned.devScript),
              );
        if (saved === null) {
          yield* update(entry, (current) => {
            current.status = "needs-dev-script";
            current.phase = null;
            current.suggestion = plan.suggestion;
            current.error = reason;
          });
          return null;
        }
        yield* update(entry, (current) => {
          current.autoChosen = true;
        });
        return { plan, devScript: saved };
      });

    /** A dev server that will not start; the model may correct a command it picked. */
    const serverFailed = (entry: Entry, message: string): Effect.Effect<void> =>
      Effect.suspend(() =>
        // The server's exit and its readiness timeout can both report one failure.
        entry.phase === "detecting"
          ? Effect.void
          : entry.autoChosen && !entry.fixAttempted && entry.script !== null
            ? startFix(entry, message, "fail")
            : update(entry, (current) => {
                current.status = "failed";
                current.phase = null;
                current.url = null;
                current.error = message;
                current.serverFailed = true;
              }),
      );

    /**
     * Shows the model the failed command and its output. A corrected command
     * is saved and the card restarts with it; otherwise the card fails with
     * `message`, or restarts as it was when the user asked for a retry.
     */
    const startFix = (
      entry: Entry,
      message: string,
      withoutFix: "fail" | "restart",
    ): Effect.Effect<void> =>
      locked(
        Effect.gen(function* () {
          const script = entry.script;
          if (entries.get(entry.threadId) !== entry || script === null) return;
          if (entry.status === "stopping" || entry.phase === "detecting") return;
          entry.fixAttempted = true;
          entry.status = "preparing";
          entry.phase = "detecting";
          entry.error = null;
          entry.url = null;
          entry.updatedAt = yield* Clock.currentTimeMillis;
          yield* publish(entry.projectId);
          const previous = entry.job;
          entry.job = yield* Effect.gen(function* () {
            let explanation: string | null = null;
            // The run that failed may still be finishing; this fix replaces it.
            if (previous) yield* Fiber.interrupt(previous);
            const fixed =
              entry.projectRoot === null
                ? null
                : yield* ops
                    .detectDevScript({
                      projectId: entry.projectId,
                      projectRoot: entry.projectRoot,
                      failed: { command: script.command, output: entry.log.join("\n") },
                    })
                    .pipe(
                      Effect.catch((error: LiveEnvironmentError) => {
                        // Usually what broke in the app, worth showing beside the failure.
                        explanation = error.message;
                        return Effect.succeed(null);
                      }),
                    );
            const corrected = fixed !== null && fixed.command.trim() !== script.command.trim();
            if (corrected) {
              yield* ops
                .saveDevScript({ projectId: entry.projectId, ...fixed })
                .pipe(Effect.orElseSucceed(() => undefined));
            }
            if (!corrected && withoutFix === "fail") {
              return yield* update(entry, (current) => {
                current.status = "failed";
                current.phase = null;
                current.error = explanation === null ? message : `${message} ${explanation}`;
                current.serverFailed = true;
              });
            }
            entry.restartAfterStop = true;
            entry.restartFixAttempted = true;
            yield* stopEntry(entry).pipe(Effect.forkIn(scope));
          }).pipe(Effect.forkIn(scope));
        }),
      );

    const runJob = (entry: Entry): Effect.Effect<void> =>
      Effect.gen(function* () {
        const resolved = yield* resolveDevScript(entry);
        if (resolved === null) return;
        const { plan, devScript } = resolved;
        yield* update(entry, (current) => {
          current.script = devScript;
        });
        const workspace = yield* ops.prepareWorkspace({
          threadId: entry.threadId,
          projectRoot: plan.projectRoot,
        });
        yield* update(entry, (current) => {
          current.worktreePath = workspace.worktreePath;
          current.createdWorktree = workspace.created;
        });
        if (workspace.created) {
          yield* update(entry, (current) => {
            current.phase = "setup";
          });
          yield* ops.runSetup({
            threadId: entry.threadId,
            projectId: entry.projectId,
            worktreePath: workspace.worktreePath,
            onLine: appendLog(entry),
          });
        }
        yield* update(entry, (current) => {
          current.phase = "starting";
        });
        const server = yield* ops.startDevServer({
          threadId: entry.threadId,
          projectId: entry.projectId,
          worktreePath: workspace.worktreePath,
          script: devScript,
          onLine: appendLog(entry),
        });
        yield* update(entry, (current) => {
          current.terminalId = server.terminalId;
        });
        // A dev server that quits on its own fails the card, unless we stopped it.
        yield* server.exited.pipe(
          Effect.flatMap((exitCode) =>
            Effect.suspend(() =>
              entries.get(entry.threadId) === entry && entry.status !== "stopping"
                ? serverFailed(
                    entry,
                    exitCode === null
                      ? "The dev server stopped."
                      : `The dev server exited with code ${exitCode}.`,
                  )
                : Effect.void,
            ),
          ),
          Effect.forkIn(scope),
        );
        const waited = yield* ops
          .waitForServer({
            threadId: entry.threadId,
            terminalId: server.terminalId,
            script: devScript,
          })
          .pipe(Effect.result);
        if (waited._tag === "Failure") {
          // Forked: a fix interrupts this run, which cannot wait on itself.
          yield* serverFailed(entry, waited.failure.message).pipe(Effect.forkIn(scope));
          return;
        }
        const url = waited.success;
        yield* update(entry, (current) => {
          if (current.status !== "preparing") return;
          current.status = "ready";
          current.phase = null;
          current.url = url;
        });
      }).pipe(
        Effect.catch((error: LiveEnvironmentError) => fail(entry, error.message)),
        Effect.catchDefect(() => fail(entry, "The live environment could not start.")),
      );

    /** Creates a run for the card and starts preparing it. Call with the lock held. */
    const startLocked = (
      projectId: ProjectId,
      threadId: ThreadId,
      active: boolean,
      fixAttempted = false,
    ) =>
      Effect.gen(function* () {
        const entry: Entry = {
          projectId,
          threadId,
          status: "preparing",
          phase: "worktree",
          active,
          warmUntil: null,
          url: null,
          worktreePath: null,
          terminalId: null,
          error: null,
          log: [],
          suggestion: null,
          updatedAt: yield* Clock.currentTimeMillis,
          projectRoot: null,
          createdWorktree: false,
          restartAfterStop: false,
          script: null,
          autoChosen: false,
          fixAttempted,
          restartFixAttempted: false,
          serverFailed: false,
          job: null,
          timer: null,
        };
        entries.set(threadId, entry);
        entry.job = yield* runJob(entry).pipe(Effect.forkIn(scope));
        return entry;
      });

    /**
     * Ends a run: interrupts its preparation, stops the dev server, and
     * removes a worktree this service created. Resolves once it is gone.
     */
    const stopEntry = (entry: Entry, options?: { readonly onlyIfWarm?: boolean }) =>
      Effect.gen(function* () {
        const proceed = yield* locked(
          Effect.gen(function* () {
            if (entries.get(entry.threadId) !== entry || entry.status === "stopping") return false;
            // The card went live again while the grace timer was firing.
            if (options?.onlyIfWarm === true && entry.active) return false;
            entry.status = "stopping";
            entry.phase = null;
            entry.warmUntil = null;
            entry.updatedAt = yield* Clock.currentTimeMillis;
            yield* publish(entry.projectId);
            return true;
          }),
        );
        if (!proceed) return;
        yield* teardown(entry);
      });

    /** Once a run is stopping it always finishes, so it never sticks in that state. */
    const teardown = (entry: Entry) =>
      Effect.gen(function* () {
        const job = entry.job;
        const timer = entry.timer;
        entry.job = null;
        entry.timer = null;
        if (job) yield* Fiber.interrupt(job);
        if (timer) yield* Fiber.interrupt(timer);
        if (entry.terminalId !== null) {
          yield* ops.stopDevServer({ threadId: entry.threadId, terminalId: entry.terminalId });
        }
        if (entry.createdWorktree && entry.worktreePath !== null && entry.projectRoot !== null) {
          yield* ops.removeWorkspace({
            projectRoot: entry.projectRoot,
            worktreePath: entry.worktreePath,
          });
        }
        yield* locked(
          Effect.gen(function* () {
            if (entries.get(entry.threadId) !== entry) return;
            entries.delete(entry.threadId);
            if (entry.restartAfterStop) {
              yield* startLocked(
                entry.projectId,
                entry.threadId,
                entry.active,
                entry.restartFixAttempted,
              );
            }
            yield* publish(entry.projectId);
          }),
        );
      }).pipe(Effect.uninterruptible);

    /** Stops the card after the grace period unless it goes live again first. */
    const warmLocked = (entry: Entry) =>
      Effect.gen(function* () {
        entry.active = false;
        if (entry.status !== "preparing" && entry.status !== "ready") {
          // Nothing worth keeping warm.
          yield* stopEntry(entry).pipe(Effect.forkIn(scope));
          return;
        }
        const now = yield* Clock.currentTimeMillis;
        entry.warmUntil = now + graceMs;
        entry.updatedAt = now;
        if (entry.timer) yield* Fiber.interrupt(entry.timer);
        entry.timer = yield* Effect.sleep(graceMs).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              // Past this point the timer is the stop, so nothing may interrupt it.
              entry.timer = null;
              return stopEntry(entry, { onlyIfWarm: true });
            }),
          ),
          Effect.forkIn(scope),
        );
      });

    const activate: LiveEnvironmentService["Service"]["activate"] = (input) =>
      locked(
        Effect.gen(function* () {
          for (const entry of entries.values()) {
            if (
              entry.projectId === input.projectId &&
              entry.active &&
              entry.threadId !== input.threadId
            ) {
              yield* warmLocked(entry);
            }
          }
          if (input.threadId !== null) {
            const existing = entries.get(input.threadId);
            if (existing === undefined) {
              yield* startLocked(input.projectId, input.threadId, true);
            } else if (!existing.active) {
              existing.active = true;
              existing.warmUntil = null;
              existing.updatedAt = yield* Clock.currentTimeMillis;
              if (existing.status === "stopping") {
                existing.restartAfterStop = true;
              } else if (existing.timer) {
                const timer = existing.timer;
                existing.timer = null;
                yield* Fiber.interrupt(timer);
              }
            }
          }
          yield* publish(input.projectId);
        }),
      );

    const stop: LiveEnvironmentService["Service"]["stop"] = (threadId) =>
      Effect.suspend(() => {
        const entry = entries.get(threadId);
        if (entry === undefined) return Effect.void;
        entry.restartAfterStop = false;
        return stopEntry(entry);
      });

    const retry: LiveEnvironmentService["Service"]["retry"] = (threadId) =>
      Effect.gen(function* () {
        const entry = entries.get(threadId);
        if (entry === undefined) {
          return yield* new LiveEnvironmentError({
            message: "This card has no live environment to retry.",
          });
        }
        if (entry.status === "failed" && entry.serverFailed && entry.script !== null) {
          return yield* startFix(entry, entry.error ?? "The dev server stopped.", "restart");
        }
        entry.restartAfterStop = true;
        entry.restartFixAttempted = false;
        yield* stopEntry(entry);
      });

    const saveDevScript: LiveEnvironmentService["Service"]["saveDevScript"] = (input) =>
      ops
        .saveDevScript({
          projectId: input.projectId,
          command: input.command,
          previewUrl: input.previewUrl,
        })
        .pipe(Effect.andThen(retryWaitingForDevScript(input.projectId)));

    const retryWaitingForDevScript = (projectId: ProjectId) =>
      Effect.forEach(
        [...entries.values()].filter(
          (entry) => entry.projectId === projectId && entry.status === "needs-dev-script",
        ),
        (entry) =>
          Effect.suspend(() => {
            entry.restartAfterStop = true;
            return stopEntry(entry);
          }),
        { discard: true },
      );

    const list: LiveEnvironmentService["Service"]["list"] = (projectId) =>
      Effect.sync(() =>
        entries
          .values()
          .filter((entry) => projectId === undefined || entry.projectId === projectId)
          .map(snapshot)
          .toArray(),
      );

    const subscribe: LiveEnvironmentService["Service"]["subscribe"] = (projectId, listener) =>
      locked(
        Effect.gen(function* () {
          const subscription = { projectId, listener };
          listeners.add(subscription);
          yield* listener(listFor(projectId));
          return () => {
            listeners.delete(subscription);
          };
        }),
      );

    return LiveEnvironmentService.of({
      activate,
      stop,
      retry,
      saveDevScript,
      list,
      subscribe,
    });
  });
