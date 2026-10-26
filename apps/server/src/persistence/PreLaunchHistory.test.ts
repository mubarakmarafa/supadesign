import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/sql/SqlClient";

import Baseline from "./Migrations/001_Baseline.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";

/** A database as the last pre-launch Supadesign left it: baseline tables, the old ledger. */
const preLaunchDatabase = (latest: readonly [number, string]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Baseline;
    yield* sql`
      CREATE TABLE effect_sql_migrations (
        migration_id INTEGER PRIMARY KEY NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        name VARCHAR(255) NOT NULL
      )
    `;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (1, 'OrchestrationEvents')`;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${latest[0]}, ${latest[1]})`;
  });

const insertEvent = (sequence: number, eventType: string, payload: object) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO orchestration_events (
        sequence, event_id, aggregate_kind, stream_id, stream_version, event_type,
        occurred_at, actor_kind, payload_json, metadata_json, application_event_version
      ) VALUES (
        ${sequence}, ${`event-${sequence}`}, 'thread', 'thread-1', ${sequence}, ${eventType},
        '2026-10-20T00:00:00.000Z', 'client', ${JSON.stringify(payload)}, '{}', 2
      )
    `;
  });

describe("adoptPreLaunchHistory", () => {
  it.effect("records a last pre-launch database as the baseline and renames Settle to Done", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* preLaunchDatabase([60, "PullRequestReviewGuides"]);
      yield* insertEvent(1, "thread.settled", {
        settledOverride: "settled",
        settledAt: "2026-10-20T00:00:00.000Z",
        unsettledAt: null,
        autoSettleDisabledAt: null,
      });
      yield* insertEvent(2, "thread.unsettled", {
        settledOverride: "active",
        settledAt: null,
        unsettledAt: "2026-10-21T00:00:00.000Z",
      });
      yield* insertEvent(3, "thread.visited", { title: "No lifecycle fields" });
      yield* sql`
        INSERT INTO orchestration_v2_projection_threads (
          thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
          created_at, updated_at, payload_json
        ) VALUES (
          'thread-1', 'project-1', 'Card', 'codex', 'full-access', 'default',
          '2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z',
          ${JSON.stringify({ settledOverride: "settled", settledAt: "2026-10-20T00:00:00.000Z" })}
        )
      `;

      assert.deepStrictEqual(yield* runMigrations(), []);

      const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        ledger.map((row) => [row.migration_id, row.name] as const),
        migrationManifest,
      );
      const events = yield* sql<{ readonly event_type: string; readonly payload_json: string }>`
        SELECT event_type, payload_json FROM orchestration_events ORDER BY sequence
      `;
      assert.deepStrictEqual(
        events.map((row) => [row.event_type, JSON.parse(row.payload_json)]),
        [
          [
            "thread.marked-done",
            {
              doneOverride: "done",
              doneAt: "2026-10-20T00:00:00.000Z",
              autoMarkDoneDisabledAt: null,
            },
          ],
          ["thread.reopened", { doneOverride: "active", doneAt: null }],
          ["thread.visited", { title: "No lifecycle fields" }],
        ],
      );
      const [projection] = yield* sql<{ readonly payload_json: string }>`
        SELECT payload_json FROM orchestration_v2_projection_threads
      `;
      assert.deepStrictEqual(JSON.parse(projection!.payload_json), {
        doneOverride: "done",
        doneAt: "2026-10-20T00:00:00.000Z",
      });
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses a database from before the last pre-launch migration", () =>
    Effect.gen(function* () {
      yield* preLaunchDatabase([59, "ThreadSnapshotWindowIndexes"]);

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "older Supadesign");
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
