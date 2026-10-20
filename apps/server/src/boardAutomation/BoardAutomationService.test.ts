import { assert, it } from "@effect/vitest";
import {
  BOARD_AUTOMATION_DELAY_MS,
  BOARD_AUTOMATION_MAX_CHAINED_MOVES,
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

// Ideas → In progress → Ship (merge on arrival, then Done) → Done; leaving In progress pushes.
const board: ProjectBoard = {
  ...DEFAULT_PROJECT_BOARD,
  columns: [
    { id: col("ideas"), title: "Ideas", onEnter: [step("plan", "Plan this: {banked}")] },
    { id: col("in-progress"), title: "In progress", onLeave: [step("push")] },
    {
      id: col("ship"),
      title: "Ship",
      onEnter: [step("merge")],
      moveWhenDone: col("done"),
    },
    { id: col("done"), title: "Done" },
  ],
};

/** The prompt a step sent, without the footer that says where it came from. */
const promptOf = (text: string) => text.split("\n\n---\n")[0];

const setup = (options?: {
  readonly banked?: string;
  readonly sendFails?: boolean;
  readonly board?: ProjectBoard;
}) =>
  Effect.gen(function* () {
    const sent: Array<{ readonly text: string }> = [];
    const moves: Array<string> = [];
    const published: BoardAutomationRunList[] = [];
    let banked = options?.banked;
    const service: BoardAutomation.BoardAutomationService["Service"] = yield* BoardAutomation.make({
      boardOf: () => Effect.succeed(options?.board ?? board),
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
      // The real board's move event arrives back as cardMoved.
      moveCard: ({ threadId, columnId }) =>
        Effect.gen(function* () {
          moves.push(columnId);
          const from = (published.at(-1) ?? []).find((run) => run.threadId === threadId);
          yield* service.cardMoved({
            threadId,
            projectId,
            fromColumnId: from?.toColumnId ?? col("ideas"),
            toColumnId: columnId,
          });
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
    const prompts = () => sent.map((entry) => promptOf(entry.text));
    return { service, sent, prompts, moves, published, move, latest: () => published.at(-1) ?? [] };
  });

it.effect("waits out the delay, then sends leave steps before enter steps", () =>
  Effect.gen(function* () {
    const { sent, prompts, move, latest } = yield* setup();
    yield* move("in-progress", "ship");
    assert.deepStrictEqual(
      latest().map((run) => [run.status, run.stepNames]),
      [["scheduled", ["push", "merge"]]],
    );
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS - 1);
    assert.strictEqual(sent.length, 0);
    yield* TestClock.adjust(1);
    assert.deepStrictEqual(prompts(), ["push feat/hero in Ship", "merge feat/hero in Ship"]);
    assert.include(sent[1]!.text, "Sent by the Ship column's “merge” step.");
    assert.include(sent[0]!.text, "Sent by the In progress column's “push” step.");
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
    assert.deepStrictEqual(withBank.prompts(), ["Plan this: softer shadows"]);

    const empty = yield* setup();
    yield* empty.move("in-progress", "ideas");
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    assert.deepStrictEqual(empty.prompts(), ["push feat/hero in Ideas"]);
    assert.deepStrictEqual(empty.latest()[0]?.note, "Skipped plan: nothing was banked.");
  }),
);

it.effect("cancels, runs now, and keeps a failure until dismissed", () =>
  Effect.gen(function* () {
    const { service, sent, prompts, move, latest } = yield* setup();
    yield* move("ideas", "ship");
    yield* service.cancel(card);
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    assert.strictEqual(sent.length, 0);
    assert.deepStrictEqual(latest(), []);

    yield* move("ideas", "ship");
    yield* service.runNow(card);
    assert.deepStrictEqual(prompts(), ["merge feat/hero in Ship"]);
    // The original timer wakes later and finds nothing left to send.
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    assert.strictEqual(sent.length, 1);
    // Idle without a report: shown as finished until dismissed.
    yield* service.settled(card);
    assert.deepStrictEqual(
      latest().map((run) => [run.status, run.moveTo]),
      [["finished", "done"]],
    );
    yield* service.cancel(card);
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

it.effect("moves a card on once its agent reports the steps done", () =>
  Effect.gen(function* () {
    const { service, moves, move, latest } = yield* setup();
    yield* move("ideas", "ship");
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    yield* service.report({ threadId: card, outcome: "done", note: "Merged as abc123" });
    assert.strictEqual(latest()[0]?.status, "sent");
    yield* service.settled(card);
    assert.deepStrictEqual(moves, ["done"]);
    // Done runs nothing, so the card's run is gone.
    assert.deepStrictEqual(latest(), []);
  }),
);

it.effect("flags a card when its agent is blocked, and keeps a done note in place", () =>
  Effect.gen(function* () {
    const { service, moves, move, latest } = yield* setup();
    yield* move("ideas", "ship");
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    yield* service.report({ threadId: card, outcome: "needs_you", note: "Conflict in header.tsx" });
    assert.deepStrictEqual(
      latest().map((run) => [run.status, run.note]),
      [["needs-you", "Conflict in header.tsx"]],
    );
    yield* service.settled(card);
    assert.deepStrictEqual(moves, []);
    assert.strictEqual(latest()[0]?.status, "needs-you");

    // A column that doesn't move cards on shows done with the agent's note.
    yield* move("ship", "in-progress");
    yield* move("in-progress", "ideas");
    yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
    yield* service.report({ threadId: card, outcome: "done", note: "Planned" });
    yield* service.settled(card);
    assert.deepStrictEqual(
      latest().map((run) => [run.status, run.note]),
      [["done", "Planned"]],
    );
    const stray = yield* Effect.flip(
      (yield* setup()).service.report({ threadId: card, outcome: "done", note: undefined }),
    );
    assert.include(stray.message, "No column step");
  }),
);

it.effect("runs a column's arrival steps again on request, without the wait", () =>
  Effect.gen(function* () {
    const { service, prompts } = yield* setup();
    yield* service.rerun({ threadId: card, columnId: col("ship") });
    assert.deepStrictEqual(prompts(), ["merge feat/hero in Ship"]);
    const none = yield* Effect.flip(service.rerun({ threadId: card, columnId: col("done") }));
    assert.include(none.message, "no arrival steps");
  }),
);

it.effect("stops a board that keeps passing a card along", () =>
  Effect.gen(function* () {
    // A and B each send the card to the other once done.
    const loop: ProjectBoard = {
      ...DEFAULT_PROJECT_BOARD,
      columns: [
        { id: col("a"), title: "A", onEnter: [step("x")], moveWhenDone: col("b") },
        { id: col("b"), title: "B", onEnter: [step("y")], moveWhenDone: col("a") },
        { id: col("done"), title: "Done" },
      ],
      inboxColumnId: col("a"),
      liveColumnId: null,
    };
    const { service, moves, move, latest } = yield* setup({ board: loop });
    yield* move("done", "a");
    for (let round = 0; round < BOARD_AUTOMATION_MAX_CHAINED_MOVES + 2; round++) {
      yield* TestClock.adjust(BOARD_AUTOMATION_DELAY_MS);
      if (latest()[0]?.status !== "sent") break;
      yield* service.report({ threadId: card, outcome: "done", note: undefined });
      yield* service.settled(card);
    }
    assert.strictEqual(moves.length, BOARD_AUTOMATION_MAX_CHAINED_MOVES + 1);
    assert.strictEqual(latest()[0]?.status, "needs-you");
    assert.include(latest()[0]?.note ?? "", "automatic moves in a row");
  }),
);
