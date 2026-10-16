/**
 * Reads each project's kanban board and workspace from the project event log.
 *
 * Supadesign is a fork, and `board_json`/`workspace_json` columns on
 * `projection_projects` would need migration ids that upstream will eventually
 * take for its own migrations. Instead both ride on `project.meta-updated`
 * events (which compaction never prunes), and this store reads the latest one
 * that set each field. If upstream ever ships these columns, fold this into
 * ProjectStore.
 */
import {
  ProjectBoard,
  ProjectId,
  type ProjectWorkspace,
  ReceivedProjectWorkspace,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

export class ProjectBoardStoreError extends Schema.TaggedError<ProjectBoardStoreError>()(
  "ProjectBoardStoreError",
  {
    operation: Schema.Literals(["get", "getMany", "getWorkspace", "getManyWorkspaces"]),
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

const WorkspaceRow = Schema.Struct({
  projectId: ProjectId,
  workspace: Schema.NullOr(Schema.String),
});

/** A stored workspace this build cannot read shows the default rather than failing the project. */
const decodeWorkspace = Schema.decodeUnknownOption(Schema.fromJsonString(ReceivedProjectWorkspace));

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
    /** The latest workspace set for a project; null when none was ever set or it was cleared. */
    readonly getWorkspace: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectWorkspace | null, ProjectBoardStoreError>;
    /** Workspaces for many projects in one query; projects without one are absent. */
    readonly getManyWorkspaces: (
      projectIds: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<ReadonlyMap<ProjectId, ProjectWorkspace>, ProjectBoardStoreError>;
  }
>()("supaterm/project/ProjectBoardStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The inner query walks idx_orch_events_stream_sequence per project; a
  // field explicitly set to null still counts as the latest write.
  const selectLatestBoard = SqlSchema.findAll({
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

  // The workspace is read raw and decoded per row: see decodeWorkspace.
  const selectLatestWorkspace = SqlSchema.findAll({
    Request: Schema.Array(ProjectId),
    Result: WorkspaceRow,
    execute: (projectIds) => sql`
      SELECT
        event.stream_id AS "projectId",
        json_extract(event.payload_json, '$.workspace') AS "workspace"
      FROM orchestration_events AS event
      WHERE event.sequence IN (
        SELECT MAX(sequence)
        FROM orchestration_events
        WHERE aggregate_kind = 'project'
          AND ${sql.in("stream_id", projectIds)}
          AND event_type = 'project.meta-updated'
          AND json_type(payload_json, '$.workspace') IS NOT NULL
        GROUP BY stream_id
      )
    `,
  });

  const getMany: ProjectBoardStore["Service"]["getMany"] = Effect.fn("ProjectBoardStore.getMany")(
    function* (projectIds) {
      if (projectIds.length === 0) return new Map();
      const rows = yield* selectLatestBoard(projectIds).pipe(
        Effect.mapError((cause) => new ProjectBoardStoreError({ operation: "getMany", cause })),
      );
      return new Map(
        rows.flatMap((row) => (row.board === null ? [] : [[row.projectId, row.board]])),
      );
    },
  );

  const get: ProjectBoardStore["Service"]["get"] = (projectId) =>
    selectLatestBoard([projectId]).pipe(
      Effect.map((rows) => rows[0]?.board ?? null),
      Effect.mapError((cause) => new ProjectBoardStoreError({ operation: "get", cause })),
    );

  const workspaceOf = (row: typeof WorkspaceRow.Type): ProjectWorkspace | null =>
    row.workspace === null ? null : Option.getOrNull(decodeWorkspace(row.workspace));

  const getManyWorkspaces: ProjectBoardStore["Service"]["getManyWorkspaces"] = Effect.fn(
    "ProjectBoardStore.getManyWorkspaces",
  )(function* (projectIds) {
    if (projectIds.length === 0) return new Map();
    const rows = yield* selectLatestWorkspace(projectIds).pipe(
      Effect.mapError(
        (cause) => new ProjectBoardStoreError({ operation: "getManyWorkspaces", cause }),
      ),
    );
    return new Map(
      rows.flatMap((row) => {
        const workspace = workspaceOf(row);
        return workspace === null ? [] : [[row.projectId, workspace] as const];
      }),
    );
  });

  const getWorkspace: ProjectBoardStore["Service"]["getWorkspace"] = (projectId) =>
    selectLatestWorkspace([projectId]).pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : workspaceOf(rows[0]))),
      Effect.mapError((cause) => new ProjectBoardStoreError({ operation: "getWorkspace", cause })),
    );

  return ProjectBoardStore.of({ get, getMany, getWorkspace, getManyWorkspaces });
});

export const layer = Layer.effect(ProjectBoardStore, make);
