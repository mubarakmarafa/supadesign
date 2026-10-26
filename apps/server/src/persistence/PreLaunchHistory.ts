import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The last entry of the migration history Supaterm replaced with a single
 * baseline. Every Supadesign release before that change ended its ledger here.
 */
const PRE_LAUNCH_LATEST = { id: 60, name: "PullRequestReviewGuides" } as const;
const PRE_LAUNCH_FIRST = { id: 1, name: "OrchestrationEvents" } as const;

const RENAMED_EVENT_TYPES = [
  ["thread.settled", "thread.marked-done"],
  ["thread.unsettled", "thread.reopened"],
  ["thread.auto-settle-set", "thread.auto-mark-done-set"],
] as const;

/**
 * Supadesign shipped on Supaterm's pre-launch migration history. Supaterm then
 * squashed that history into `1_Baseline` and renamed Settle to Done without
 * converting stored data, so a pre-launch database would refuse to open.
 *
 * A database whose ledger ends at the last pre-launch migration already has the
 * baseline's tables, so this records it as the baseline and renames the stored
 * lifecycle events and thread fields to the Done names. It runs once, before the
 * migrator, inside one transaction. Databases at an earlier pre-launch migration
 * are left for the migrator's own history check to refuse.
 */
export const adoptPreLaunchHistory = Effect.fn("adoptPreLaunchHistory")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return false;
  const recorded = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  const first = recorded[0];
  if (first?.migration_id !== PRE_LAUNCH_FIRST.id || first.name !== PRE_LAUNCH_FIRST.name) {
    return false;
  }
  const stores = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table'
      AND name IN ('orchestration_events', 'orchestration_v2_projection_threads')
  `;
  if (stores.length < 2) return false;
  const latest = recorded.at(-1);
  if (latest?.migration_id !== PRE_LAUNCH_LATEST.id || latest.name !== PRE_LAUNCH_LATEST.name) {
    return yield* new Migrator.MigrationError({
      kind: "BadState",
      message: `This database is from an older Supadesign (last migration ${latest?.migration_id}_${latest?.name}). Open it with the previous release first, then update.`,
    });
  }

  yield* Effect.gen(function* () {
    for (const [from, to] of RENAMED_EVENT_TYPES) {
      yield* sql`UPDATE orchestration_events SET event_type = ${to} WHERE event_type = ${from}`;
    }
    // Thread events and the thread projection carry the thread's lifecycle fields.
    for (const table of ["orchestration_events", "orchestration_v2_projection_threads"] as const) {
      const target = sql(table);
      yield* sql`
        UPDATE ${target} SET payload_json = json_remove(
          json_set(
            payload_json,
            '$.doneOverride',
            CASE json_extract(payload_json, '$.settledOverride')
              WHEN 'settled' THEN 'done'
              ELSE json_extract(payload_json, '$.settledOverride')
            END
          ),
          '$.settledOverride'
        )
        WHERE json_type(payload_json, '$.settledOverride') IS NOT NULL
      `;
      yield* sql`
        UPDATE ${target} SET payload_json = json_remove(
          json_set(payload_json, '$.doneAt', json_extract(payload_json, '$.settledAt')),
          '$.settledAt'
        )
        WHERE json_type(payload_json, '$.settledAt') IS NOT NULL
      `;
      yield* sql`
        UPDATE ${target} SET payload_json = json_remove(
          json_set(
            payload_json,
            '$.autoMarkDoneDisabledAt',
            json_extract(payload_json, '$.autoSettleDisabledAt')
          ),
          '$.autoSettleDisabledAt'
        )
        WHERE json_type(payload_json, '$.autoSettleDisabledAt') IS NOT NULL
      `;
      yield* sql`
        UPDATE ${target} SET payload_json = json_remove(payload_json, '$.unsettledAt')
        WHERE json_type(payload_json, '$.unsettledAt') IS NOT NULL
      `;
    }
    yield* sql`DELETE FROM effect_sql_migrations`;
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (1, 'Baseline')`;
  }).pipe(sql.withTransaction);

  yield* Effect.log("Adopted a pre-launch database as the Supaterm baseline");
  return true;
});
