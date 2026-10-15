import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

describe("runMigrations", () => {
  it.effect("creates a fresh database from the whole manifest once", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.deepStrictEqual(yield* runMigrations(), migrationManifest);
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.deepStrictEqual(yield* runMigrations(), []);
      const metadata = yield* sql<{ readonly last_sequence: number }>`
        SELECT last_sequence FROM orchestration_v2_projection_metadata
        WHERE projection_name = 'thread-projections'
      `;
      assert.deepStrictEqual(metadata, [{ last_sequence: 0 }]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses a database whose migration history came from another build", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TABLE effect_sql_migrations (
          migration_id INTEGER PRIMARY KEY NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          name VARCHAR(255) NOT NULL
        )
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (1, 'OrchestrationEvents'), (60, 'PullRequestReviewGuides')
      `;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "1_OrchestrationEvents, 60_PullRequestReviewGuides");
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_events'
      `;
      assert.strictEqual(tables.length, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
