import { assert, it } from "@effect/vitest";
import {
  BOARD_AUTOMATION_DELAY_MS,
  BoardAutomationError,
  BoardAutomationStepId,
  BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  type BoardAutomationRunList,
  type ProjectBoard,
  ProjectId,
  ThreadId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import * as BoardAutomation from "./BoardAutomationService.ts";

const projectId = ProjectId.make("project-1");
const card = ThreadId.make("thread-a");
const col = BoardColumnId.make;

const step = (name: string, prompt = `${name} {branch} in {column}`) => ({
  id: BoardAutomationStepId.make(name),
  name,
  prompt,
});

// Ideas → In progress → Ship (merge on arrival) → Done; leaving In progress pushes.
const board: ProjectBoard = {
  ...DEFAULT_PROJECT_BOARD,
  columns: [
    { id: col("ideas"), title: "Ideas", onEnter: [step("plan", "Plan this: {banked}")] },
    { id: col("in-progress"), title: "In progress", onLeave: [step("push")] },
    { id: col("ship"), title: "Ship", onEnter: [step("merge")] },
    { id: col("done"), title: "Done" },
  ],
};

const setup = (options?: { readonly banked?: string; readonly sendFails?: boolean }) =>
  Effect.gen(function* () {
    const sent: Array<{ readonly text: string }> = [];
    const published: BoardAutomationRunList[] = [];
    let banked = options?.banked;
    const service = yield* BoardAutomation.make({
      boardOf: () => Effect.succeed(board),
      cardOf: () =>
        Effect.succeed({ projectId, title: "Hero", branch: "feat/hero", archived: false }),
      send: ({ text }) =>
        options?.sendFails
          ? Effect.fail(new BoardAutomationError({ message: "offline" }))
          : Effect.sync(() => void sent.push({ text })),
      sendBanked: ({ render }) =>
        Effect.sync(() => {
          if (banked === undefined) return false;
          sent.push({ text: render(banked) });
          banked = undefined;
          return true;
        }),
    });
    yield* service.subscribe(projectId, (list) => Effect.sync(() => void published.push(list)));
    const move = (from: string, to: string) =>
      service.cardMoved({
        threadId: card,
        projectId,
        fromColumnId: col(from),
        toColumnId: col(to),
      });
    return { service, sent, published, move, latest: () => published.at(-1) ?? [] };
  });

it.effect("waits out the delay, then sends leave steps before enter steps", () =>
  Effect.gen(function* () {
    const { sent, move, latest } = yield* setup();
    yield* move("in-progress", "ship");
    assert.deepStrictEqual(
      latest().map((run) => [run.status, run.stepNames]),
      [["scheduled", ["push", "merge"]]],
    );
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS - 1);
    assert.strictEqual(sent.length, 0);
    yield* TestClock.adjust(1);
    assert.deepStrictEqual(
      sent.map((entry) => entry.text),
      ["push feat/hero in Ship", "merge feat/hero in Ship"],
    );
    assert.strictEqual(latest()[0]?.status, "sent");
  }),
);

it.effect("treats moves inside the wait as one, from where the card started", () =>
  Effect.gen(function* () {
    const { sent, move, latest } = yield* setup();
    yield* move("in-progress", "ship");
    yield* TestClock.adjust(1_000);
    // Dragged back where it started: nothing runs.
    yield* move("ship", "in-progress");
    assert.deepStrictEqual(latest(), []);
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS * 2);
    assert.strictEqual(sent.length, 0);

    // Passing through Ship on the way to Ideas skips Ship's merge.
    yield* move("in-progress", "ship");
    yield* move("ship", "ideas");
    assert.deepStrictEqual(latest()[0]?.stepNames, ["push", "plan"]);
  }),
);

it.effect("runs nothing on a card moved into Done", () =>
  Effect.gen(function* () {
    const { sent, move, latest } = yield* setup();
    yield* move("in-progress", "done");
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    assert.deepStrictEqual(latest(), []);
    assert.strictEqual(sent.length, 0);
  }),
);

it.effect("folds banked messages into a step and skips it when nothing is banked", () =>
  Effect.gen(function* () {
    const withBank = yield* setup({ banked: "softer shadows" });
    yield* withBank.move("ship", "ideas");
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    assert.deepStrictEqual(
      withBank.sent.map((entry) => entry.text),
      ["Plan this: softer shadows"],
    );

    const empty = yield* setup();
    yield* empty.move("in-progress", "ideas");
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    assert.deepStrictEqual(
      empty.sent.map((entry) => entry.text),
      ["push feat/hero in Ideas"],
    );
    assert.deepStrictEqual(empty.latest()[0]?.note, "Skipped plan: nothing was banked.");
  }),
);

it.effect("cancels, runs now, and keeps a failure until dismissed", () =>
  Effect.gen(function* () {
    const { service, sent, move, latest } = yield* setup();
    yield* move("ideas", "ship");
    yield* service.cancel(card);
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    assert.strictEqual(sent.length, 0);
    assert.deepStrictEqual(latest(), []);

    yield* move("ideas", "ship");
    yield* service.runNow(card);
    assert.deepStrictEqual(
      sent.map((entry) => entry.text),
      ["merge feat/hero in Ship"],
    );
    // The original timer wakes later and finds nothing left to send.
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    assert.strictEqual(sent.length, 1);
    yield* service.settled(card);
    assert.deepStrictEqual(latest(), []);

    const failing = yield* setup({ sendFails: true });
    yield* failing.move("ideas", "ship");
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    assert.deepStrictEqual(
      failing.latest().map((run) => [run.status, run.note]),
      [["failed", "offline"]],
    );
    yield* failing.service.cancel(card);
    assert.deepStrictEqual(failing.latest(), []);
  }),
);
