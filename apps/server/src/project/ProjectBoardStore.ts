/**
 * Reads each project's kanban board from the project event log.
 *
 * Supadesign is a fork, and a `board_json` column on `projection_projects`
 * would need a migration id that upstream will eventually take for its own
 * migration. Instead the board rides on `project.meta-updated` events (which
 * compaction never prunes), and this store reads the latest one that set a
 * board. If upstream ever ships a board column, fold this into ProjectStore.
 */
import { ProjectBoard, ProjectId } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

export class ProjectBoardStoreError extends Schema.TaggedError<ProjectBoardStoreError>()(
  "ProjectBoardStoreError",
  {
    operation: Schema.Literals(["get", "getMany"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project board store operation '${this.operation}' failed.`;
  }
}

const BoardRow = Schema.Struct({
  projectId: ProjectId,
  board: Schema.NullOr(Schema.fromJsonString(ProjectBoard)),
});

export class ProjectBoardStore extends Context.Service<
  ProjectBoardStore,
  {
    /** The latest board set for a project; null when none was ever set or it was cleared. */
    readonly get: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectBoard | null, ProjectBoardStoreError>;
    /** Boards for many projects in one query; projects without a board are absent. */
    readonly getMany: (
      projectIds: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<ReadonlyMap<ProjectId, ProjectBoard>, ProjectBoardStoreError>;
  }
>()("supaterm/project/ProjectBoardStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The inner query walks idx_orch_events_stream_sequence per project; a
  // board explicitly set to null still counts as the latest write.
  const selectLatest = SqlSchema.findAll({
    Request: Schema.Array(ProjectId),
    Result: BoardRow,
    execute: (projectIds) => sql`
      SELECT
        event.stream_id AS "projectId",
        json_extract(event.payload_json, '$.board') AS "board"
      FROM orchestration_events AS event
      WHERE event.sequence IN (
        SELECT MAX(sequence)
        FROM orchestration_events
        WHERE aggregate_kind = 'project'
          AND ${sql.in("stream_id", projectIds)}
          AND event_type = 'project.meta-updated'
          AND json_type(payload_json, '$.board') IS NOT NULL
        GROUP BY stream_id
      )
    `,
  });

  const getMany: ProjectBoardStore["Service"]["getMany"] = Effect.fn("ProjectBoardStore.getMany")(
    function* (projectIds) {
      if (projectIds.length === 0) return new Map();
      const rows = yield* selectLatest(projectIds).pipe(
        Effect.mapError((cause) => new ProjectBoardStoreError({ operation: "getMany", cause })),
      );
      return new Map(
        rows.flatMap((row) => (row.board === null ? [] : [[row.projectId, row.board]])),
      );
    },
  );

  const get: ProjectBoardStore["Service"]["get"] = (projectId) =>
    selectLatest([projectId]).pipe(
      Effect.map((rows) => rows[0]?.board ?? null),
      Effect.mapError((cause) => new ProjectBoardStoreError({ operation: "get", cause })),
    );

  return ProjectBoardStore.of({ get, getMany });
});

export const layer = Layer.effect(ProjectBoardStore, make);
