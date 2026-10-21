import { assert, it } from "@effect/vitest";
import {
  BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  ProjectBoardError,
  ProjectId,
  ThreadId,
  type ThreadBoardPlacement,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as ProjectBoard from "./ProjectBoardService.ts";

const projectId = ProjectId.make("project-1");
const col = BoardColumnId.make;
const board = { ...DEFAULT_PROJECT_BOARD, sendColumnId: col("ideas") };

const record = (
  id: string,
  placement: ThreadBoardPlacement | null,
  options: { readonly working?: boolean; readonly archived?: boolean } = {},
): ProjectBoard.BoardThreadRecord => ({
  id: ThreadId.make(id),
  title: id,
  createdAt: DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"),
  archivedAt: options.archived ? DateTime.makeUnsafe("2026-10-02T00:00:00.000Z") : null,
  board: placement,
  working: options.working ?? false,
});

const setup = (
  threads: Array<ProjectBoard.BoardThreadRecord>,
  boardAgentThreadId: ThreadId | null = null,
) =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    const service = yield* ProjectBoard.make({
      readProject: () => Effect.succeed({ board, threads, boardAgentThreadId }),
      projectOf: () => Effect.succeed(projectId),
      place: (input) =>
        Effect.sync(() => {
          calls.push(`place ${input.threadId} ${input.columnId}`);
          const index = threads.findIndex((thread) => thread.id === input.threadId);
          const current = threads[index];
          if (current !== undefined) {
            threads[index] = {
              ...current,
              board: {
                columnId: input.columnId,
                orderKey: input.orderKey,
                returnColumnId: input.returnColumnId,
              },
            };
          }
        }),
      setArchived: (threadId, archived) =>
        Effect.sync(() => void calls.push(`${archived ? "archive" : "unarchive"} ${threadId}`)),
      sendBank: (threadId) => Effect.sync(() => void calls.push(`send ${threadId}`)),
      stopLiveEnvironment: (threadId) => Effect.sync(() => void calls.push(`stop ${threadId}`)),
      sendToCard: ({ threadId }) =>
        Effect.sync(() => {
          calls.push(`hand off ${threadId}`);
          return { startedInWorktree: false };
        }),
    });
    return { service, calls };
  });

it.effect("moves a card the way a drag does, with each column's side effect", () =>
  Effect.gen(function* () {
    const { service, calls } = yield* setup([
      record("live", { columnId: col("testing"), orderKey: "m" }),
      record("other", { columnId: col("in-progress"), orderKey: "m" }),
    ]);
    // Out of the live column stops its dev server; into the send column sends its bank.
    const moved = yield* service.moveCard({
      threadId: ThreadId.make("live"),
      columnId: col("ideas"),
    });
    assert.deepStrictEqual(moved, { columnId: col("ideas"), index: 0 });
    assert.deepStrictEqual(calls, ["place live ideas", "send live", "stop live"]);

    calls.length = 0;
    yield* service.moveCard({ threadId: ThreadId.make("other"), columnId: col("done") });
    assert.deepStrictEqual(calls, ["place other done", "archive other"]);
  }),
);

it.effect("refuses Done for a working card and names the columns for an unknown one", () =>
  Effect.gen(function* () {
    const { service, calls } = yield* setup([
      record("busy", { columnId: col("in-progress"), orderKey: "m" }, { working: true }),
    ]);
    const busy = yield* service
      .moveCard({ threadId: ThreadId.make("busy"), columnId: col("done") })
      .pipe(Effect.flip);
    assert.instanceOf(busy, ProjectBoardError);
    assert.include(busy.message, "still working");
    const unknown = yield* service
      .moveCard({ threadId: ThreadId.make("busy"), columnId: col("later") })
      .pipe(Effect.flip);
    assert.include(unknown.message, "testing (Testing)");
    assert.deepStrictEqual(calls, []);
  }),
);

it.effect("puts a new card under the live card, so adding one never swaps what runs", () =>
  Effect.gen(function* () {
    const { service } = yield* setup([
      record("live", { columnId: col("testing"), orderKey: "m" }),
      record("new", null),
    ]);
    const placed = yield* service.placeNewCard({
      threadId: ThreadId.make("new"),
      columnId: col("testing"),
    });
    assert.deepStrictEqual(placed, { columnId: col("testing"), index: 1 });
    const columns = yield* service.read({ projectId });
    const testing = columns.find((column) => column.id === col("testing"));
    assert.deepStrictEqual(
      testing?.cards.map((card) => card.threadId),
      [ThreadId.make("live"), ThreadId.make("new")],
    );
    assert.isTrue(testing?.live);
  }),
);

it.effect("leaves the board agent's own thread off the board and out of moves", () =>
  Effect.gen(function* () {
    const agent = ThreadId.make("agent");
    const { service, calls } = yield* setup(
      [record("agent", null), record("card", { columnId: col("ideas"), orderKey: "m" })],
      agent,
    );
    const columns = yield* service.read({ projectId });
    assert.deepStrictEqual(
      columns.flatMap((column) => column.cards.map((card) => card.threadId)),
      [ThreadId.make("card")],
    );
    // An agent that omits threadId names itself; that must not put it on the board.
    const refused = yield* service
      .moveCard({ threadId: agent, columnId: col("testing") })
      .pipe(Effect.flip);
    assert.include(refused.message, "board agent");
    assert.deepStrictEqual(calls, []);
  }),
);

it.effect("hands a card its brief, but not the board agent or a card in Done", () =>
  Effect.gen(function* () {
    const agent = ThreadId.make("agent");
    const { service, calls } = yield* setup(
      [
        record("card", { columnId: col("ideas"), orderKey: "m" }),
        record("finished", { columnId: col("done"), orderKey: "m" }, { archived: true }),
        record("agent", null),
      ],
      agent,
    );
    const handed = yield* service.handOff({ threadId: ThreadId.make("card"), brief: " Do it " });
    assert.deepStrictEqual(handed, { startedInWorktree: false });
    assert.deepStrictEqual(calls, ["hand off card"]);

    const toAgent = yield* service.handOff({ threadId: agent, brief: "Do it" }).pipe(Effect.flip);
    assert.include(toAgent.message, "board agent");
    const toDone = yield* service
      .handOff({ threadId: ThreadId.make("finished"), brief: "Do it" })
      .pipe(Effect.flip);
    assert.include(toDone.message, "Done");
    assert.deepStrictEqual(calls, ["hand off card"]);
  }),
);
