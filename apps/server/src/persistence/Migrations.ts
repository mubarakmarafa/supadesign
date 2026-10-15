/**
 * Migration runner with an inline loader.
 *
 * Uses Migrator.make with fromRecord to define migrations inline.
 * All migrations are statically imported - no dynamic file system loading.
 *
 * `runMigrations` is called by the SQLite persistence layer at startup, so the
 * schema is always up to date before the application starts.
 */

import * as Migrator from "effect/sql/Migrator";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import Migration0001 from "./Migrations/001_Baseline.ts";

/**
 * Add a schema change as a new entry with the next id. Never edit, renumber, or
 * remove a shipped entry: the migrator skips every id up to the highest one a
 * database recorded.
 */
const migrationEntries = [[1, "Baseline", Migration0001]] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

const loader = Migrator.fromRecord(
  Object.fromEntries(
    migrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration] as const),
  ),
);

/**
 * The migrator compares ids only, so a database whose ledger came from another
 * build would silently skip this build's schema at those ids. Refuse to run
 * against any recorded migration this build does not know.
 */
const assertKnownMigrationHistory = Effect.fn("assertKnownMigrationHistory")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;
  const recorded = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations`;
  const known = new Set(migrationManifest.map(([id, name]) => `${id}_${name}`));
  const unknown = recorded
    .map((row) => `${row.migration_id}_${row.name}`)
    .filter((migration) => !known.has(migration));
  if (unknown.length === 0) return;
  return yield* new Migrator.MigrationError({
    kind: "BadState",
    message: `This database was created by a build with a different migration history (${unknown.join(", ")}). Move it aside and restart to create a new one.`,
  });
});

const run = Migrator.make({});

/**
 * Run all pending migrations.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 */
export const runMigrations = Effect.fn("runMigrations")(function* () {
  yield* assertKnownMigrationHistory();
  const executedMigrations = yield* run({ loader });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});
