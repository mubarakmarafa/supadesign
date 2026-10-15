import { assert, it } from "@effect/vitest";
import {
  BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  EventId,
  type ProjectBoard,
  ProjectId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectBoardStore from "./ProjectBoardStore.ts";

const layerTest = Layer.mergeAll(ProjectBoardStore.layer, OrchestrationEventStore.layer).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const renamedBoard: ProjectBoard = {
  ...DEFAULT_PROJECT_BOARD,
  columns: DEFAULT_PROJECT_BOARD.columns.map((column) =>
    column.id === "ideas" ? { ...column, title: "Backlog" } : column,
  ),
  liveColumnId: null,
  retiredColumns: [{ id: BoardColumnId.make("review"), movedTo: BoardColumnId.make("testing") }],
};

let eventCounter = 0;
const appendMetaUpdate = (
  projectId: ProjectId,
  fields: { readonly board?: ProjectBoard | null; readonly title?: string },
) =>
  Effect.flatMap(OrchestrationEventStore.OrchestrationEventStore, (events) => {
    eventCounter += 1;
    return events.appendProjectEvent({
      eventId: EventId.make(`event-board-${eventCounter}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: "2026-10-01T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.meta-updated",
      payload: { projectId, ...fields, updatedAt: "2026-10-01T00:00:00.000Z" },
    });
  });

it.layer(layerTest)("ProjectBoardStore", (it) => {
  it.effect("reads the latest board write and ignores updates that leave the board alone", () =>
    Effect.gen(function* () {
      const boards = yield* ProjectBoardStore.ProjectBoardStore;
      const first = ProjectId.make("project-board-first");
      const second = ProjectId.make("project-board-second");
      const untouched = ProjectId.make("project-board-untouched");

      assert.isNull(yield* boards.get(first));

      const stored = yield* appendMetaUpdate(first, { board: DEFAULT_PROJECT_BOARD });
      assert.deepStrictEqual(
        stored.type === "project.meta-updated" ? stored.payload.board : undefined,
        DEFAULT_PROJECT_BOARD,
      );
      yield* appendMetaUpdate(first, { board: renamedBoard });
      yield* appendMetaUpdate(first, { title: "Renamed project" });
      yield* appendMetaUpdate(second, { board: DEFAULT_PROJECT_BOARD });
      yield* appendMetaUpdate(second, { board: null });
      yield* appendMetaUpdate(untouched, { title: "No board" });

      assert.deepStrictEqual(yield* boards.get(first), renamedBoard);
      assert.isNull(yield* boards.get(second));
      assert.isNull(yield* boards.get(untouched));
      const many = yield* boards.getMany([first, second, untouched]);
      assert.deepStrictEqual([...many], [[first, renamedBoard]]);
      assert.strictEqual((yield* boards.getMany([])).size, 0);
    }),
  );
});
