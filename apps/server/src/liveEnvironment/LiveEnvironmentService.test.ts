import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  type LiveEnvironmentList,
  type LiveEnvironmentSnapshot,
  type ProjectScript,
} from "@supaterm/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";

import * as LiveEnvironment from "./LiveEnvironmentService.ts";

const projectId = ProjectId.make("project-1");
const cardA = ThreadId.make("thread-a");
const cardB = ThreadId.make("thread-b");
const GRACE = Duration.minutes(10);

const devScript = (command: string): ProjectScript => ({
  id: "dev-server",
  name: "Dev server",
  command,
  icon: "play",
  runOnWorktreeCreate: false,
});

const setup = (options?: {
  /** The saved dev server command; null when the project has none yet. */
  readonly savedCommand?: string | null;
  /** What the repo's own files suggest, without the model. */
  readonly suggested?: string | null;
  /** The model's answers, in order; null when it cannot tell. */
  readonly detected?: ReadonlyArray<string | null>;
}) =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    let savedCommand = options?.savedCommand === undefined ? "npm run dev" : options.savedCommand;
    const detected = [...(options?.detected ?? [])];
    const exits = new Map<ThreadId, Deferred.Deferred<number | null>>();
    const ops: LiveEnvironment.LiveEnvironmentOps = {
      plan: () =>
        Effect.sync(() => ({
          projectId,
          projectRoot: "/repo",
          devScript: savedCommand === null ? null : devScript(savedCommand),
          suggestion: {
            command: options?.suggested === undefined ? "npm run dev" : options.suggested,
            previewUrl: null,
            source: "package.json",
          },
        })),
      prepareWorkspace: ({ threadId }) =>
        Effect.sync(() => {
          calls.push(`prepare:${threadId}`);
          return { worktreePath: `/worktrees/${threadId}`, created: true };
        }),
      runSetup: ({ threadId }) => Effect.sync(() => void calls.push(`setup:${threadId}`)),
      startDevServer: ({ threadId, script, onLine }) =>
        Effect.gen(function* () {
          calls.push(`start:${threadId}:${script.command}`);
          yield* onLine("VITE ready");
          const exited = yield* Deferred.make<number | null>();
          exits.set(threadId, exited);
          return { terminalId: "live-dev", exited: Deferred.await(exited) };
        }),
      waitForServer: ({ threadId }) => Effect.succeed(`http://localhost:5173/?card=${threadId}`),
      stopDevServer: ({ threadId }) => Effect.sync(() => void calls.push(`stop:${threadId}`)),
      saveDevScript: ({ command }) =>
        Effect.sync(() => {
          calls.push(`save:${command}`);
          savedCommand = command;
        }),
      detectDevScript: ({ failed }) =>
        Effect.sync(() => {
          calls.push(failed ? `fix:${failed.command}` : "detect");
          const command = detected.shift() ?? null;
          return command === null ? null : { command, previewUrl: undefined };
        }),
      removeWorkspace: ({ worktreePath }) =>
        Effect.sync(() => void calls.push(`remove:${worktreePath}`)),
    };
    const service = yield* LiveEnvironment.make(ops, { graceMs: Duration.toMillis(GRACE) });
    const updates = yield* Queue.unbounded<LiveEnvironmentList>();
    yield* service.subscribe(projectId, (list) => Queue.offer(updates, list).pipe(Effect.asVoid));

    /** Waits for the published state the test expects instead of sleeping. */
    const waitFor = (
      predicate: (environments: ReadonlyArray<LiveEnvironmentSnapshot>) => boolean,
    ) =>
      Effect.gen(function* () {
        while (true) {
          const list = yield* Queue.take(updates);
          if (predicate(list.environments)) return list.environments;
        }
      });
    const find = (environments: ReadonlyArray<LiveEnvironmentSnapshot>, threadId: ThreadId) =>
      environments.find((environment) => environment.threadId === threadId);

    return { service, calls, exits, waitFor, find };
  });

it.effect("prepares, sets up, and serves the live card", () =>
  Effect.gen(function* () {
    const { service, calls, waitFor, find } = yield* setup();
    yield* service.activate({ projectId, threadId: cardA });
    const environments = yield* waitFor((list) => find(list, cardA)?.status === "ready");
    const card = find(environments, cardA);
    assert.strictEqual(card?.active, true);
    assert.strictEqual(card?.url, "http://localhost:5173/?card=thread-a");
    assert.strictEqual(card?.worktreePath, "/worktrees/thread-a");
    assert.deepStrictEqual(calls, [
      "prepare:thread-a",
      "setup:thread-a",
      "start:thread-a:npm run dev",
    ]);
  }).pipe(Effect.scoped),
);

it.effect("keeps the previous card warm and stops it after the grace period", () =>
  Effect.gen(function* () {
    const { service, calls, waitFor, find } = yield* setup();
    yield* service.activate({ projectId, threadId: cardA });
    yield* waitFor((list) => find(list, cardA)?.status === "ready");
    yield* service.activate({ projectId, threadId: cardB });
    const switched = yield* waitFor((list) => find(list, cardB)?.status === "ready");
    assert.strictEqual(find(switched, cardA)?.active, false);
    assert.strictEqual(find(switched, cardA)?.warmUntil, Duration.toMillis(GRACE));
    assert.notInclude(calls, "stop:thread-a");

    yield* TestClock.adjust(GRACE);
    const after = yield* waitFor((list) => find(list, cardA) === undefined);
    assert.strictEqual(find(after, cardB)?.status, "ready");
    assert.include(calls, "stop:thread-a");
    assert.include(calls, "remove:/worktrees/thread-a");
  }).pipe(Effect.scoped),
);

it.effect("going back to a warm card keeps its server running", () =>
  Effect.gen(function* () {
    const { service, calls, waitFor, find } = yield* setup();
    yield* service.activate({ projectId, threadId: cardA });
    yield* waitFor((list) => find(list, cardA)?.status === "ready");
    yield* service.activate({ projectId, threadId: cardB });
    yield* waitFor((list) => find(list, cardB)?.status === "ready");
    yield* TestClock.adjust(Duration.minutes(5));
    yield* service.activate({ projectId, threadId: cardA });
    const back = yield* waitFor((list) => find(list, cardA)?.active === true);
    assert.strictEqual(find(back, cardA)?.warmUntil, null);
    assert.strictEqual(find(back, cardB)?.active, false);

    yield* TestClock.adjust(GRACE);
    yield* waitFor((list) => find(list, cardB) === undefined);
    assert.notInclude(calls, "stop:thread-a");
    assert.strictEqual(calls.filter((call) => call === "start:thread-a:npm run dev").length, 1);
  }).pipe(Effect.scoped),
);

it.effect("stop skips the warm period", () =>
  Effect.gen(function* () {
    const { service, calls, waitFor, find } = yield* setup();
    yield* service.activate({ projectId, threadId: cardA });
    yield* waitFor((list) => find(list, cardA)?.status === "ready");
    yield* service.stop(cardA);
    assert.deepStrictEqual(yield* service.list(projectId), []);
    assert.include(calls, "stop:thread-a");
  }).pipe(Effect.scoped),
);

it.effect("a dev server that exits on its own fails the card with its output", () =>
  Effect.gen(function* () {
    const { service, exits, waitFor, find } = yield* setup();
    yield* service.activate({ projectId, threadId: cardA });
    yield* waitFor((list) => find(list, cardA)?.status === "ready");
    const exited = exits.get(cardA);
    assert.isDefined(exited);
    if (exited) yield* Deferred.succeed(exited, 1);
    const failed = yield* waitFor((list) => find(list, cardA)?.status === "failed");
    assert.strictEqual(find(failed, cardA)?.error, "The dev server exited with code 1.");
    assert.deepStrictEqual(find(failed, cardA)?.logTail, ["VITE ready"]);

    // Retry first asks whether the command is wrong; the model says it is fine.
    yield* service.retry(cardA);
    yield* waitFor((list) => find(list, cardA)?.status === "ready");
  }).pipe(Effect.scoped),
);

const exitServer = (exits: Map<ThreadId, Deferred.Deferred<number | null>>, code: number) =>
  Effect.suspend(() => {
    const exited = exits.get(cardA);
    exits.delete(cardA);
    return exited ? Deferred.succeed(exited, code) : Effect.die("no running dev server");
  });

it.effect("starts with the repo's own dev command without asking", () =>
  Effect.gen(function* () {
    const { service, calls, waitFor, find } = yield* setup({ savedCommand: null });
    yield* service.activate({ projectId, threadId: cardA });
    yield* waitFor((list) => find(list, cardA)?.status === "ready");
    assert.include(calls, "save:npm run dev");
    assert.notInclude(calls, "detect");
  }).pipe(Effect.scoped),
);

it.effect("asks the model when the repo shows no dev command", () =>
  Effect.gen(function* () {
    const { service, calls, waitFor, find } = yield* setup({
      savedCommand: null,
      suggested: null,
      detected: ["make serve"],
    });
    yield* service.activate({ projectId, threadId: cardA });
    yield* waitFor((list) => find(list, cardA)?.status === "ready");
    assert.includeMembers(calls, ["detect", "save:make serve", "start:thread-a:make serve"]);
  }).pipe(Effect.scoped),
);

it.effect("asks the user only when the model cannot tell either", () =>
  Effect.gen(function* () {
    const { service, calls, waitFor, find } = yield* setup({
      savedCommand: null,
      suggested: null,
      detected: [null],
    });
    yield* service.activate({ projectId, threadId: cardA });
    yield* waitFor((list) => find(list, cardA)?.status === "needs-dev-script");

    yield* service.saveDevScript({ projectId, command: "make serve" });
    yield* waitFor((list) => find(list, cardA)?.status === "ready");
    assert.include(calls, "start:thread-a:make serve");
  }).pipe(Effect.scoped),
);

it.effect("corrects a command it picked once, then reports the next failure", () =>
  Effect.gen(function* () {
    const { service, calls, exits, waitFor, find } = yield* setup({
      savedCommand: null,
      detected: ["pnpm dev"],
    });
    yield* service.activate({ projectId, threadId: cardA });
    yield* waitFor((list) => find(list, cardA)?.status === "ready");

    yield* exitServer(exits, 1);
    yield* waitFor((list) => find(list, cardA)?.phase === "detecting");
    const fixed = yield* waitFor((list) => find(list, cardA)?.status === "ready");
    assert.strictEqual(find(fixed, cardA)?.error, null);
    assert.includeMembers(calls, ["fix:npm run dev", "save:pnpm dev", "start:thread-a:pnpm dev"]);

    yield* exitServer(exits, 1);
    const failed = yield* waitFor((list) => find(list, cardA)?.status === "failed");
    assert.strictEqual(find(failed, cardA)?.error, "The dev server exited with code 1.");
    assert.strictEqual(calls.filter((call) => call.startsWith("fix:")).length, 1);
  }).pipe(Effect.scoped),
);
