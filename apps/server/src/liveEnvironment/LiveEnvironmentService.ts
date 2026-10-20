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
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import { isAcceptableDevCommand } from "./devScriptSuggestion.ts";

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
    },
    LiveEnvironmentError
  >;
  /** What the files in `directory`, the checkout the card runs, say starts it. */
  readonly suggestDevScript: (input: {
    readonly projectId: ProjectId;
    readonly directory: string;
  }) => Effect.Effect<LiveEnvironmentDevScriptSuggestion>;
  /** Picks or creates the checkout to run. `created` means teardown may remove it. */
  readonly prepareWorkspace: (input: {
    readonly threadId: ThreadId;
    readonly projectRoot: string;
  }) => Effect.Effect<
    {
      readonly worktreePath: string;
      /** Made for this run, so teardown removes it when it is clean. */
      readonly created: boolean;
      /** The card's own worktree, checked out again after it was deleted; it needs setup. */
      readonly restored?: boolean;
    },
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
  /**
   * Stops servers the card's agent started itself in the card's own checkout,
   * outside the app's terminals, unless the agent is mid-turn and may still use them.
   */
  readonly stopAgentServers: (input: {
    readonly threadId: ThreadId;
    readonly worktreePath: string;
  }) => Effect.Effect<void>;
  /** Saves the project's dev server script, replacing an earlier one. */
  readonly saveDevScript: (input: {
    readonly projectId: ProjectId;
    readonly command: string;
    readonly previewUrl: string | undefined;
  }) => Effect.Effect<void, LiveEnvironmentError>;
  /**
   * Starts a hidden helper agent in the card's checkout that finds the dev
   * server command, or corrects `failed`, and reports it through
   * `reportSetup`. Returns the helper's thread.
   */
  readonly launchSetupAgent: (input: {
    readonly cardThreadId: ThreadId;
    readonly projectId: ProjectId;
    readonly projectRoot: string;
    readonly worktreePath: string;
    readonly failed?: { readonly command: string; readonly output: string } | undefined;
  }) => Effect.Effect<ThreadId, LiveEnvironmentError>;
  /** Resolves once the helper's turn ends, or after a time limit. */
  readonly awaitSetupAgent: (input: {
    readonly projectId: ProjectId;
    readonly setupThreadId: ThreadId;
  }) => Effect.Effect<void>;
  /** Stops the helper and deletes its thread; the card's checkout is untouched. */
  readonly removeSetupAgent: (input: {
    readonly projectId: ProjectId;
    readonly setupThreadId: ThreadId;
  }) => Effect.Effect<void>;
  /**
   * Removes a worktree this service created, leaving it alone when it has
   * changes. False means it was kept.
   */
  readonly removeWorkspace: (input: {
    readonly projectRoot: string;
    readonly worktreePath: string;
  }) => Effect.Effect<boolean>;
  /** Removes a kept worktree and its changes, because the user asked. */
  readonly discardWorkspace: (input: {
    readonly projectRoot: string;
    readonly worktreePath: string;
  }) => Effect.Effect<void, LiveEnvironmentError>;
  /** The cards this service held when the server last ran. */
  readonly loadLiveCards: Effect.Effect<ReadonlyArray<LiveCardRecord>>;
  readonly saveLiveCards: (cards: ReadonlyArray<LiveCardRecord>) => Effect.Effect<void>;
}

/**
 * A card remembered across restarts. A restart forgets running servers, but
 * not which card was live or the preview checkouts this service made, so
 * those are still cleaned up, or kept for their changes, afterwards.
 */
export interface LiveCardRecord {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  /**
   * `live` was the project's live card and waits for Start, `warm` was only
   * kept warm and is torn down, `kept` holds a checkout with changes.
   */
  readonly state: "live" | "warm" | "kept";
  /** A checkout this service made for the card; teardown removes it when clean. */
  readonly checkout: { readonly worktreePath: string; readonly projectRoot: string } | null;
}

export class LiveEnvironmentService extends Context.Service<
  LiveEnvironmentService,
  {
    /** Makes `threadId` the project's live card; the previous one goes warm. */
    readonly activate: (input: {
      readonly projectId: ProjectId;
      readonly threadId: ThreadId | null;
    }) => Effect.Effect<void, LiveEnvironmentError>;
    /**
     * Makes `threadId` the project's live card, as `activate` does, and also
     * starts it when it waits for Start after a restart or failed to start.
     */
    readonly start: (input: {
      readonly projectId: ProjectId;
      readonly threadId: ThreadId;
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
    /** Removes a kept card's preview checkout, changes and all. */
    readonly discard: (threadId: ThreadId) => Effect.Effect<void, LiveEnvironmentError>;
    /** A setup helper's answer: the command, or why there is none. */
    readonly reportSetup: (input: {
      readonly setupThreadId: ThreadId;
      readonly command?: string | undefined;
      readonly previewUrl?: string | undefined;
      readonly reason?: string | undefined;
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
  /** The hidden helper agent working out the command, while it runs. */
  setupThreadId: ThreadId | null;
  /** Whether a helper already tried to correct this card's command. */
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
    setupThreadId: entry.setupThreadId,
    updatedAt: entry.updatedAt,
  };
}

interface SetupReport {
  readonly command?: string | undefined;
  readonly previewUrl?: string | undefined;
  readonly reason?: string | undefined;
}

const SETUP_REPORT_GRACE = Duration.seconds(2);
const KEPT_MESSAGE = "Its preview checkout has changes, so it was kept.";

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
    // Shutting down stops dev servers, and those exits must not be saved as the last state.
    let closing = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closing = true;
      }).pipe(Effect.andThen(Scope.close(scope, Exit.void))),
    );
    let savedLiveCards = "";

    const listFor = (projectId: ProjectId): LiveEnvironmentList => ({
      projectId,
      environments: entries
        .values()
        .filter((entry) => entry.projectId === projectId)
        .map(snapshot)
        .toArray(),
    });

    /**
     * Remembers each project's live card, so a restart can show it as
     * stopped, and every checkout made here, so a restart can still clean it up.
     */
    const persistLiveCards = Effect.suspend(() => {
      if (closing) return Effect.void;
      const cards: Array<LiveCardRecord> = [];
      for (const entry of entries.values()) {
        const { projectId, threadId } = entry;
        const checkout =
          entry.worktreePath !== null && entry.projectRoot !== null
            ? { worktreePath: entry.worktreePath, projectRoot: entry.projectRoot }
            : null;
        const made = entry.createdWorktree ? checkout : null;
        if (entry.status === "kept") {
          if (checkout !== null) cards.push({ projectId, threadId, state: "kept", checkout });
        } else if (entry.active || entry.status === "stopped") {
          // A card waiting for Start since a restart is still the project's live card.
          cards.push({ projectId, threadId, state: "live", checkout: made });
        } else if (made !== null) {
          cards.push({ projectId, threadId, state: "warm", checkout: made });
        }
      }
      const serialized = cards
        .map((card) =>
          [
            card.projectId,
            card.threadId,
            card.state,
            card.checkout?.worktreePath ?? "",
            card.checkout?.projectRoot ?? "",
          ].join("\t"),
        )
        .join("\n");
      if (serialized === savedLiveCards) return Effect.void;
      savedLiveCards = serialized;
      return ops.saveLiveCards(cards);
    });

    const publish = (projectId: ProjectId) =>
      Effect.suspend(() => {
        const list = listFor(projectId);
        return Effect.forEach(
          [...listeners].filter((subscription) => subscription.projectId === projectId),
          (subscription) => subscription.listener(list),
          { discard: true },
        ).pipe(Effect.andThen(persistLiveCards));
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

    /** Helpers waiting to report, by their thread. */
    const setupReports = new Map<ThreadId, Deferred.Deferred<SetupReport>>();

    /**
     * Runs a hidden helper agent in the card's checkout until it reports a
     * command, and always stops and deletes it afterwards. Fails with the
     * helper's reason, or why it gave none.
     */
    const askSetupAgent = (
      entry: Entry,
      worktreePath: string,
      failed?: { readonly command: string; readonly output: string },
    ) =>
      Effect.gen(function* () {
        const projectRoot = entry.projectRoot ?? worktreePath;
        const report = yield* Deferred.make<SetupReport>();
        const answer = yield* Effect.acquireUseRelease(
          ops
            .launchSetupAgent({
              cardThreadId: entry.threadId,
              projectId: entry.projectId,
              projectRoot,
              worktreePath,
              failed,
            })
            .pipe(
              Effect.tap((setupThreadId) =>
                Effect.sync(() => setupReports.set(setupThreadId, report)).pipe(
                  Effect.andThen(
                    update(entry, (current) => {
                      current.setupThreadId = setupThreadId;
                    }),
                  ),
                ),
              ),
            ),
          (setupThreadId) =>
            Effect.raceFirst(
              Deferred.await(report),
              // A report made in the helper's last moments may land just after its turn.
              ops.awaitSetupAgent({ projectId: entry.projectId, setupThreadId }).pipe(
                Effect.andThen(
                  Deferred.await(report).pipe(Effect.timeoutOption(SETUP_REPORT_GRACE)),
                ),
                Effect.flatMap((reported) =>
                  reported._tag === "Some"
                    ? Effect.succeed(reported.value)
                    : Effect.fail(
                        new LiveEnvironmentError({
                          message: "The setup agent finished without finding how to start it.",
                        }),
                      ),
                ),
              ),
            ),
          (setupThreadId) =>
            Effect.sync(() => setupReports.delete(setupThreadId)).pipe(
              Effect.andThen(ops.removeSetupAgent({ projectId: entry.projectId, setupThreadId })),
              Effect.andThen(
                update(entry, (current) => {
                  current.setupThreadId = null;
                }),
              ),
            ),
        );
        const command = answer.command?.trim() ?? "";
        if (command === "") {
          return yield* new LiveEnvironmentError({
            message:
              answer.reason?.trim() || "The setup agent found nothing here that serves a page.",
          });
        }
        if (!isAcceptableDevCommand(command)) {
          return yield* new LiveEnvironmentError({
            message: `Didn't run “${command}”: it does more than start a server.`,
          });
        }
        return { command, previewUrl: answer.previewUrl?.trim() || undefined };
      });

    /**
     * The project's dev server script. Without one it picks one itself, from
     * the checkout's own scripts or by asking a helper agent, and saves it;
     * null means the user has to say how the project runs.
     */
    const resolveDevScript = (
      entry: Entry,
      plan: { readonly devScript: ProjectScript | null },
      worktreePath: string,
    ) =>
      Effect.gen(function* () {
        if (plan.devScript !== null) return plan.devScript;
        const suggestion = yield* ops.suggestDevScript({
          projectId: entry.projectId,
          directory: worktreePath,
        });
        let chosen: { command: string; previewUrl: string | undefined } | null =
          suggestion.command === null
            ? null
            : { command: suggestion.command, previewUrl: suggestion.previewUrl ?? undefined };
        let reason: string | null = null;
        if (chosen === null) {
          yield* update(entry, (current) => {
            current.phase = "detecting";
          });
          chosen = yield* askSetupAgent(entry, worktreePath).pipe(
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
            current.suggestion = suggestion;
            current.error = reason;
          });
          return null;
        }
        yield* update(entry, (current) => {
          current.autoChosen = true;
        });
        return saved;
      });

    /** A dev server that will not start; the model may correct a command it picked. */
    const serverFailed = (entry: Entry, message: string): Effect.Effect<void> =>
      Effect.suspend(() =>
        // The server's exit and its readiness timeout can both report one failure;
        // the first one is the real reason.
        entry.phase === "detecting" || entry.status === "failed"
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
              entry.worktreePath === null
                ? null
                : yield* askSetupAgent(entry, entry.worktreePath, {
                    command: script.command,
                    output: entry.log.join("\n"),
                  }).pipe(
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
        const plan = yield* ops.plan(entry.threadId);
        yield* update(entry, (current) => {
          current.projectRoot = plan.projectRoot;
        });
        const workspace = yield* ops.prepareWorkspace({
          threadId: entry.threadId,
          projectRoot: plan.projectRoot,
        });
        yield* update(entry, (current) => {
          current.worktreePath = workspace.worktreePath;
          current.createdWorktree = workspace.created;
        });
        // Work out the command where it runs: a card's worktree can hold an
        // app its project folder doesn't have yet.
        const devScript = yield* resolveDevScript(entry, plan, workspace.worktreePath);
        if (devScript === null) return;
        yield* update(entry, (current) => {
          current.script = devScript;
        });
        if (workspace.created || workspace.restored === true) {
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

    const newEntry = (
      projectId: ProjectId,
      threadId: ThreadId,
      active: boolean,
      now: number,
      fields?: Partial<Entry>,
    ): Entry => ({
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
      updatedAt: now,
      projectRoot: null,
      createdWorktree: false,
      restartAfterStop: false,
      script: null,
      autoChosen: false,
      fixAttempted: false,
      restartFixAttempted: false,
      serverFailed: false,
      setupThreadId: null,
      job: null,
      timer: null,
      ...fields,
    });

    // A restart forgets running servers; the cards that were live wait for
    // Start, kept checkouts stay on their cards, and warm ones are torn down.
    const restoredWarm: Array<Entry> = [];
    {
      const now = yield* Clock.currentTimeMillis;
      for (const card of yield* ops.loadLiveCards) {
        const checkout = card.checkout;
        if (checkout === null) {
          if (card.state === "live") {
            entries.set(
              card.threadId,
              newEntry(card.projectId, card.threadId, false, now, {
                status: "stopped",
                phase: null,
              }),
            );
          }
          continue;
        }
        const entry = newEntry(card.projectId, card.threadId, false, now, {
          status: card.state === "kept" ? "kept" : "stopped",
          phase: null,
          worktreePath: checkout.worktreePath,
          projectRoot: checkout.projectRoot,
          createdWorktree: card.state !== "kept",
          error: card.state === "kept" ? KEPT_MESSAGE : null,
        });
        entries.set(card.threadId, entry);
        if (card.state === "warm") restoredWarm.push(entry);
      }
    }

    /** Creates a run for the card and starts preparing it. Call with the lock held. */
    const startLocked = (
      projectId: ProjectId,
      threadId: ThreadId,
      active: boolean,
      fixAttempted = false,
    ) =>
      Effect.gen(function* () {
        const entry = newEntry(projectId, threadId, active, yield* Clock.currentTimeMillis, {
          fixAttempted,
        });
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
        // The project folder is shared by every card, so only a card's own checkout is swept.
        if (
          entry.worktreePath !== null &&
          entry.projectRoot !== null &&
          entry.worktreePath !== entry.projectRoot
        ) {
          yield* ops.stopAgentServers({
            threadId: entry.threadId,
            worktreePath: entry.worktreePath,
          });
        }
        const kept =
          entry.createdWorktree && entry.worktreePath !== null && entry.projectRoot !== null
            ? !(yield* ops.removeWorkspace({
                projectRoot: entry.projectRoot,
                worktreePath: entry.worktreePath,
              }))
            : false;
        yield* locked(
          Effect.gen(function* () {
            if (entries.get(entry.threadId) !== entry) return;
            entries.delete(entry.threadId);
            if (kept && !entry.restartAfterStop) {
              // Never delete work silently: the card shows the checkout until it is discarded.
              entries.set(
                entry.threadId,
                newEntry(entry.projectId, entry.threadId, false, yield* Clock.currentTimeMillis, {
                  status: "kept",
                  phase: null,
                  worktreePath: entry.worktreePath,
                  projectRoot: entry.projectRoot,
                  error: KEPT_MESSAGE,
                }),
              );
            } else if (entry.restartAfterStop) {
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
          // Deleting a visited entry while iterating a Map is safe.
          for (const entry of entries.values()) {
            if (entry.projectId !== input.projectId || entry.threadId === input.threadId) continue;
            // Another card is live now, so a card waiting since a restart no
            // longer is. A checkout made for it goes too, or is kept for its changes.
            if (entry.status === "stopped") {
              if (entry.createdWorktree) yield* stopEntry(entry).pipe(Effect.forkIn(scope));
              else entries.delete(entry.threadId);
            } else if (entry.active) {
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
              } else if (existing.status === "kept") {
                // Going live again reuses the kept checkout, changes included.
                existing.restartAfterStop = true;
                yield* stopEntry(existing).pipe(Effect.forkIn(scope));
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
        // Nothing runs for a kept checkout, and forgetting it would hide its
        // changes; only Discard or going live again ends it.
        if (entry === undefined || entry.status === "kept") return Effect.void;
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
        // Starting a card that isn't live makes it the live one, so the project
        // still runs a single environment and the previous card goes warm.
        if (!entry.active && (entry.status === "kept" || entry.status === "stopped")) {
          const kept = entry.status === "kept";
          yield* activate({ projectId: entry.projectId, threadId });
          // Going live restarts a kept checkout; a stopped card still needs starting.
          if (kept) return;
        }
        // Nothing runs since the restart; start in the checkout it had.
        if (entry.status === "stopped") {
          return yield* locked(
            Effect.gen(function* () {
              if (entries.get(threadId) !== entry) return;
              yield* startLocked(entry.projectId, threadId, entry.active);
              yield* publish(entry.projectId);
            }),
          );
        }
        if (entry.status === "failed" && entry.serverFailed && entry.script !== null) {
          return yield* startFix(entry, entry.error ?? "The dev server stopped.", "restart");
        }
        entry.restartAfterStop = true;
        entry.restartFixAttempted = false;
        yield* stopEntry(entry);
      });

    const start: LiveEnvironmentService["Service"]["start"] = (input) =>
      Effect.gen(function* () {
        yield* activate(input);
        const status = entries.get(input.threadId)?.status;
        if (status === "stopped" || status === "failed") yield* retry(input.threadId);
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

    const discard: LiveEnvironmentService["Service"]["discard"] = (threadId) =>
      Effect.gen(function* () {
        const entry = entries.get(threadId);
        if (
          entry === undefined ||
          entry.status !== "kept" ||
          entry.worktreePath === null ||
          entry.projectRoot === null
        ) {
          return yield* new LiveEnvironmentError({
            message: "This card has no kept preview checkout to discard.",
          });
        }
        yield* ops.discardWorkspace({
          projectRoot: entry.projectRoot,
          worktreePath: entry.worktreePath,
        });
        yield* locked(
          Effect.gen(function* () {
            if (entries.get(threadId) !== entry) return;
            entries.delete(threadId);
            yield* publish(entry.projectId);
          }),
        );
      });

    const reportSetup: LiveEnvironmentService["Service"]["reportSetup"] = (input) =>
      Effect.suspend(() => {
        const report = setupReports.get(input.setupThreadId);
        if (report === undefined) {
          return Effect.fail(
            new LiveEnvironmentError({
              message: "Only a live preview's setup agent can report its dev command.",
            }),
          );
        }
        return Deferred.succeed(report, {
          command: input.command,
          previewUrl: input.previewUrl,
          reason: input.reason,
        }).pipe(Effect.asVoid);
      });

    // Checkouts of cards that were only warm when the server stopped are
    // removed when clean, or kept for their changes.
    for (const entry of restoredWarm) {
      yield* stopEntry(entry).pipe(Effect.forkIn(scope));
    }

    return LiveEnvironmentService.of({
      discard,
      reportSetup,
      activate,
      start,
      stop,
      retry,
      saveDevScript,
      list,
      subscribe,
    });
  });
