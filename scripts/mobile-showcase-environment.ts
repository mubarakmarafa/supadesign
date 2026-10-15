// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - This host-side fixture creates an isolated local Supaterm environment.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export const SHOWCASE_PROJECT_ID = "supaterm";
export const SHOWCASE_THREAD_ID = "offline-reason";
export const SHOWCASE_TERMINAL_ID = "term-1";

export const SHOWCASE_SCENES = ["threads", "thread", "terminal", "review", "environments"] as const;
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number];

const PROJECTOR_NAMES = [
  "projection.projects",
  "projection.threads",
  "projection.thread-messages",
  "projection.thread-proposed-plans",
  "projection.thread-activities",
  "projection.thread-sessions",
  "projection.thread-turns",
  "projection.checkpoints",
  "projection.pending-approvals",
] as const;

const MODEL_SELECTION = JSON.stringify({ instanceId: "codex", model: "gpt-5.4" });
const PROJECT_SCRIPTS = JSON.stringify([
  {
    id: "dev",
    name: "Dev",
    command: "pnpm dev",
    icon: "play",
    runOnWorktreeCreate: false,
  },
  {
    id: "test",
    name: "Tests",
    command: "pnpm test",
    icon: "test",
    runOnWorktreeCreate: false,
  },
]);

const SHOWCASE_TERMINAL_PROMPT =
  "\u001b[1;36m~/supaterm\u001b[0m \u001b[1;34mfeat/offline-reason\u001b[0m \u001b[1;33m❯\u001b[0m ";

export const SHOWCASE_TERMINAL_BUFFER = [
  `${SHOWCASE_TERMINAL_PROMPT}vp test`,
  "",
  "  \u001b[1;32m✓ offlineReason.test.ts\u001b[0m (9 tests) \u001b[2m14ms\u001b[0m",
  "  \u001b[1;32m✓ OfflineReasonLabel.test.tsx\u001b[0m (4 tests) \u001b[2m38ms\u001b[0m",
  "  \u001b[1;32m✓ EnvironmentCard.test.tsx\u001b[0m (12 tests) \u001b[2m61ms\u001b[0m",
  "",
  "  \u001b[1mTest Files\u001b[0m 3 passed (3)",
  "  \u001b[1mTests\u001b[0m 25 passed (25)",
  "  \u001b[2mDuration\u001b[0m 1.82s",
  "",
  `${SHOWCASE_TERMINAL_PROMPT}git diff --stat`,
  "",
  "  offlineReason.ts | 15 +++++++++++---",
  "  OfflineReasonLabel.tsx | 14 ++++++++++++++",
  "  2 files changed, 26 insertions(+), 3 deletions(-)",
  "",
  SHOWCASE_TERMINAL_PROMPT,
].join("\r\n");

const BASE_ENVIRONMENT_PRESENCE = `export type OfflineReason = "asleep" | "unreachable" | "signed-out";

export function offlineReasonLabel(reason: OfflineReason): string {
  return reason;
}
`;

const UPDATED_ENVIRONMENT_PRESENCE = `export type OfflineReason = "asleep" | "unreachable" | "signed-out";

const LABELS: Record<OfflineReason, string> = {
  asleep: "Asleep",
  unreachable: "Unreachable",
  "signed-out": "Signed out",
};

export function offlineReasonLabel(reason: OfflineReason): string {
  return LABELS[reason];
}
`;

const OFFLINE_REASON_LABEL = `import { Text } from "react-native";

export function OfflineReasonLabel(props: { reason: string; nextStep: string }) {
  return (
    <Text className="text-secondary">
      {props.reason} · {props.nextStep}
    </Text>
  );
}
`;

const PROJECT_FAVICONS = {
  supaterm: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="10" fill="#000"/>
  <path d="M 69.3382 37.6 L 102.0857 37.6 L 102.0857 45.3 L 90.127 45.3 L 90.127 89.7 L 81.297 89.7 L 81.297 45.3 L 69.3382 45.3 Z M 43.0232 90.1176 C 39.5364 90.1176 36.489 89.5018 33.8809 88.2702 C 31.2728 87.0386 29.2568 85.2776 27.8329 82.9871 C 26.409 80.6967 25.6971 77.9949 25.6971 74.8816 L 34.3629 74.8816 C 34.3629 77.2015 35.1496 79.0355 36.7232 80.3836 C 38.2967 81.7318 40.3967 82.4059 43.0232 82.4059 C 45.5827 82.4059 47.6024 81.7309 49.0822 80.3809 C 50.562 79.0309 51.3018 77.2526 51.3018 75.046 C 51.3018 73.3334 50.8246 71.8226 49.8702 70.5134 C 48.9158 69.2042 47.5272 68.3224 45.7044 67.868 L 38.7779 66.0923 C 35.0625 65.1511 32.1239 63.3862 29.9621 60.7976 C 27.8004 58.209 26.7195 55.1302 26.7195 51.561 C 26.7195 48.639 27.3658 46.1013 28.6585 43.948 C 29.9511 41.7947 31.7926 40.1278 34.1831 38.9472 C 36.5735 37.7667 39.3695 37.1765 42.571 37.1765 C 45.8188 37.1765 48.6428 37.7667 51.0432 38.9472 C 53.4436 40.1278 55.3134 41.7897 56.6528 43.9331 C 57.9921 46.0765 58.6618 48.5857 58.6618 51.4607 L 49.9971 51.4607 C 49.9971 49.4379 49.321 47.823 47.9688 46.616 C 46.6165 45.409 44.8173 44.8055 42.571 44.8055 C 40.3518 44.8055 38.5897 45.4022 37.2846 46.5956 C 35.9794 47.789 35.3268 49.3555 35.3268 51.2952 C 35.3268 52.8746 35.7846 54.1904 36.7 55.2426 C 37.6154 56.2949 38.9081 57.0386 40.5779 57.4739 L 47.7162 59.2783 C 51.5096 60.1923 54.4969 62.0652 56.6781 64.8972 C 58.8594 67.7292 59.95 71.1121 59.95 75.046 C 59.95 78.0857 59.2616 80.739 57.8847 83.0059 C 56.5079 85.2728 54.5487 87.0248 52.0072 88.2619 C 49.4656 89.4991 46.471 90.1176 43.0232 90.1176 Z" fill="#fff"/>
</svg>`,
  tidepool: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#0e7490"/>
  <path d="M10 25c7-8 13 8 21 0s14 8 23 0M10 37c7-8 13 8 21 0s14 8 23 0M10 49c7-8 13 8 21 0s14 8 23 0" fill="none" stroke="white" stroke-linecap="round" stroke-width="4"/>
</svg>`,
  lattice: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#18181b"/>
  <g fill="#d4d4d8"><circle cx="18" cy="18" r="4"/><circle cx="32" cy="18" r="4"/><circle cx="46" cy="18" r="4"/><circle cx="18" cy="32" r="4"/><circle cx="46" cy="32" r="4"/><circle cx="18" cy="46" r="4"/><circle cx="32" cy="46" r="4"/><circle cx="46" cy="46" r="4"/></g>
  <circle cx="32" cy="32" r="5" fill="#f59e0b"/>
</svg>`,
} as const;

export const SHOWCASE_PROJECTS = [
  {
    id: "supaterm",
    title: "supaterm",
    directory: "supaterm",
    repositoryUrl: "https://github.com/supabitapp/supacode-next.git",
    favicon: PROJECT_FAVICONS.supaterm,
  },
  {
    id: "tidepool",
    title: "tidepool",
    directory: "tidepool",
    repositoryUrl: "https://github.com/supabitapp/tidepool.git",
    favicon: PROJECT_FAVICONS.tidepool,
  },
  {
    id: "lattice",
    title: "lattice",
    directory: "lattice",
    repositoryUrl: "https://github.com/supabitapp/lattice.git",
    favicon: PROJECT_FAVICONS.lattice,
  },
] as const;

export const SHOWCASE_ENVIRONMENTS = [
  {
    id: "studio-laptop",
    label: "Studio Laptop",
    projectIds: ["supaterm"],
  },
  {
    id: "basement-tower",
    label: "Basement Tower",
    projectIds: ["tidepool"],
  },
  {
    id: "helsinki-vps",
    label: "Helsinki VPS",
    projectIds: ["lattice"],
  },
] as const;

export const SHOWCASE_THREADS = [
  {
    id: SHOWCASE_THREAD_ID,
    projectId: "supaterm",
    title: "Explain why a machine is offline",
    branch: "feat/offline-reason",
    minutesAgo: 3,
    request:
      "When a paired machine drops, say why on its card (asleep, unreachable, or signed out) and what to do next. Keep it to one line.",
    response:
      "Each environment card now says why it's offline and what happens next.\n\n- Asleep: shows when it was last seen and retries on wake\n- Unreachable: names the failed route and tries the next one\n- Signed out: offers a fresh pairing code\n- Every label fits on one line at the default text size\n\nThe settings suite passes: **25 tests**, none skipped.",
  },
  {
    id: "resumable-uploads",
    projectId: "supaterm",
    title: "Resume uploads after a reconnect",
    branch: "feat/resumable-uploads",
    minutesAgo: 21,
    state: "approval" as const,
    request: "Resume a paused upload after the server reconnects without duplicating a chunk.",
    response:
      "The retry cursor now resumes from the last acknowledged chunk and keeps the transfer id stable. The recovery copy is ready for approval.",
  },
  {
    id: "tide-chart-shift",
    projectId: "tidepool",
    title: "Chart tides without layout shift",
    branch: "fix/tide-chart-shift",
    minutesAgo: 12,
    state: "working" as const,
    request: "Keep the tide chart from jumping when the hourly observations arrive.",
    response: null,
  },
  {
    id: "forecast-units",
    projectId: "tidepool",
    title: "Localize the forecast units",
    branch: "feat/forecast-units",
    minutesAgo: 44,
    request: "Let each location choose Celsius or Fahrenheit without changing the cached forecast.",
    response:
      "Forecast cards now read the location preference and format cached observations consistently. The migration is ready for a quiet rollout.",
    snoozeMinutes: 90,
  },
  {
    id: "compaction-strategy",
    projectId: "lattice",
    title: "Pick a compaction strategy",
    branch: "feat/sliced-compaction",
    minutesAgo: 34,
    state: "plan" as const,
    request:
      "Choose a compaction strategy that keeps long agent threads useful without hiding decisions.",
    response:
      "The plan keeps a short decision ledger, slices old tool output by turn, and leaves the full transcript available on demand.",
  },
  {
    id: "flaky-fsync",
    projectId: "lattice",
    title: "Bisect the flaky fsync test",
    branch: "test/flaky-fsync",
    minutesAgo: 52,
    request:
      "Find the first commit that makes the fsync integration test fail once every few runs.",
    response:
      "The bisect harness records the failing seed and replay command so the next run can stop at the first bad commit.",
    snoozeMinutes: 8 * 60,
  },
  // Finished work, settled by hand: the list keeps it as a receded tail so
  // the active block above reads as everything still in flight. The active
  // block stays small enough that the settled tail begins above the fold —
  // a store screenshot has to show that history exists, not just imply it.
  {
    id: "cold-start-bundle",
    projectId: "supaterm",
    title: "Trim the cold-start bundle",
    branch: "perf/cold-start-bundle",
    minutesAgo: 300,
    settled: true,
    request: "Remove the largest cold-start dependency without delaying the first useful screen.",
    response:
      "The startup path now loads the project shell first and defers the optional syntax catalog until the editor opens.",
  },
  {
    id: "offline-forecast-cache",
    projectId: "tidepool",
    title: "Cache forecasts for offline use",
    branch: "feat/offline-forecast-cache",
    minutesAgo: 1680,
    settled: true,
    request: "Keep the last forecast available when a field station loses its connection.",
    response:
      "The forecast cache now stores the observation timestamp and renders a quiet stale label until the station reconnects.",
  },
  {
    id: "slow-query-log",
    projectId: "lattice",
    title: "Explain slow queries in the log",
    branch: "feat/slow-query-log",
    minutesAgo: 2880,
    settled: true,
    request: "Show which part of a query waited when a request crosses the slow threshold.",
    response:
      "The structured log now includes planner, storage, and network wait buckets without changing the query response.",
  },
] as const;

function minutesBefore(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

async function runGit(workspaceRoot: string, args: ReadonlyArray<string>): Promise<void> {
  await execFile("git", [...args], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Alex Rivera",
      GIT_AUTHOR_EMAIL: "alex@lumen.test",
      GIT_COMMITTER_NAME: "Alex Rivera",
      GIT_COMMITTER_EMAIL: "alex@lumen.test",
    },
  });
}

async function initializeRepository(input: {
  readonly workspaceRoot: string;
  readonly repositoryUrl: string;
  readonly commitMessage: string;
}): Promise<void> {
  await runGit(input.workspaceRoot, ["init", "-b", "main"]);
  await runGit(input.workspaceRoot, ["remote", "add", "origin", input.repositoryUrl]);
  await runGit(input.workspaceRoot, ["add", "."]);
  await runGit(input.workspaceRoot, ["commit", "-m", input.commitMessage]);
}

async function seedSupatermWorkspace(workspaceRoot: string): Promise<void> {
  await NodeFSP.mkdir(NodePath.join(workspaceRoot, "apps/mobile/src/features/settings"), {
    recursive: true,
  });
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "package.json"),
    `${JSON.stringify({ name: "supaterm", private: true, scripts: { test: "vp test" } }, null, 2)}\n`,
  );
  await NodeFSP.writeFile(NodePath.join(workspaceRoot, "favicon.svg"), PROJECT_FAVICONS.supaterm);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/settings/offlineReason.ts"),
    BASE_ENVIRONMENT_PRESENCE,
  );
  await initializeRepository({
    workspaceRoot,
    repositoryUrl: "https://github.com/supabitapp/supacode-next.git",
    commitMessage: "Show connected environments",
  });
  await runGit(workspaceRoot, ["checkout", "-b", "feat/offline-reason"]);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/settings/offlineReason.ts"),
    UPDATED_ENVIRONMENT_PRESENCE,
  );
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/settings/OfflineReasonLabel.tsx"),
    OFFLINE_REASON_LABEL,
  );
}

async function seedCompanionWorkspace(input: {
  readonly workspaceRoot: string;
  readonly title: string;
  readonly repositoryUrl: string;
  readonly favicon: string;
}): Promise<void> {
  await NodeFSP.mkdir(input.workspaceRoot, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(input.workspaceRoot, "favicon.svg"), input.favicon);
  await NodeFSP.writeFile(
    NodePath.join(input.workspaceRoot, "README.md"),
    `# ${input.title}\n\nSeeded by the Supaterm mobile screenshot harness.\n`,
  );
  await initializeRepository({
    workspaceRoot: input.workspaceRoot,
    repositoryUrl: input.repositoryUrl,
    commitMessage: `Seed ${input.title} workspace`,
  });
}

function insertThread(
  database: NodeSqlite.DatabaseSync,
  now: number,
  input: {
    readonly id: string;
    readonly projectId: string;
    readonly title: string;
    readonly branch: string;
    readonly minutesAgo: number;
    readonly state?: "working" | "approval" | "plan";
    readonly settled?: boolean;
    readonly snoozeMinutes?: number;
    readonly workspaceRoot: string;
  },
): void {
  const turnId = `${input.id}-turn`;
  const updatedAt = minutesBefore(now, input.minutesAgo);
  const isWorking = input.state === "working";
  const snoozedUntil =
    input.snoozeMinutes === undefined
      ? null
      : new Date(now + input.snoozeMinutes * 60_000).toISOString();
  const snoozedAt =
    input.snoozeMinutes === undefined
      ? null
      : minutesBefore(now, Math.max(1, Math.floor(input.minutesAgo / 2)));
  database
    .prepare(
      `INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id, latest_user_message_at, pending_approval_count,
        pending_user_input_count, has_actionable_proposed_plan, created_at, updated_at,
        archived_at, deleted_at, settled_override, settled_at, snoozed_until, snoozed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.projectId,
      input.title,
      MODEL_SELECTION,
      "full-access",
      input.state === "plan" ? "plan" : "default",
      input.branch,
      input.workspaceRoot,
      turnId,
      minutesBefore(now, input.minutesAgo + 1),
      input.state === "approval" ? 1 : 0,
      input.state === "plan" ? 1 : 0,
      minutesBefore(now, input.minutesAgo + 120),
      updatedAt,
      input.settled ? "settled" : null,
      input.settled ? updatedAt : null,
      snoozedUntil,
      snoozedAt,
    );
  database
    .prepare(
      `INSERT INTO projection_turns (
        thread_id, turn_id, pending_message_id, assistant_message_id, state, requested_at,
        started_at, completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status,
        checkpoint_files_json, source_proposed_plan_thread_id, source_proposed_plan_id
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, '[]', NULL, NULL)`,
    )
    .run(
      input.id,
      turnId,
      isWorking ? null : `${input.id}-answer`,
      isWorking ? "running" : "completed",
      minutesBefore(now, input.minutesAgo + 2),
      minutesBefore(now, input.minutesAgo + 2),
      isWorking ? null : updatedAt,
    );
  database
    .prepare(
      `INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, provider_instance_id, provider_session_id,
        provider_thread_id, runtime_mode, active_turn_id, last_error, updated_at
      ) VALUES (?, ?, 'Codex', 'codex', NULL, NULL, 'full-access', ?, NULL, ?)`,
    )
    .run(input.id, isWorking ? "running" : "ready", isWorking ? turnId : null, updatedAt);
}

// V1 tables this seed owns. `projection_projects` is not listed: V2 still
// stores projects there, so the seed upserts its own rows instead. V2 clients
// do not read the V1 thread rows.
const SEEDED_V1_TABLES = [
  "projection_pending_approvals",
  "projection_thread_proposed_plans",
  "projection_thread_activities",
  "projection_thread_messages",
  "projection_thread_sessions",
  "projection_turns",
  "projection_threads",
  "projection_state",
] as const;

const SEEDED_PROJECTION_TABLES = [...SEEDED_V1_TABLES, "projection_projects"] as const;

const SEEDED_THREAD_COLUMNS = ["snoozed_until", "snoozed_at"] as const;

function hasSeedableSchema(dbPath: string): boolean {
  let database: NodeSqlite.DatabaseSync;
  try {
    database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return false;
  }
  try {
    const tableCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (${SEEDED_PROJECTION_TABLES.map(() => "?").join(", ")})`,
      )
      .get(...SEEDED_PROJECTION_TABLES) as { count: number };
    if (tableCount.count !== SEEDED_PROJECTION_TABLES.length) return false;

    const threadColumns = database.prepare("PRAGMA table_info(projection_threads)").all() as Array<{
      name: string;
    }>;
    const threadColumnNames = new Set(threadColumns.map((column) => column.name));
    return SEEDED_THREAD_COLUMNS.every((column) => threadColumnNames.has(column));
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export async function waitForSeedableSchema(dbPath: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasSeedableSchema(dbPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The environment server did not migrate ${dbPath} within ${timeoutMs}ms.`);
}

function seedDatabase(
  dbPath: string,
  workspaceRoots: ReadonlyMap<string, string>,
  projects: ReadonlyArray<(typeof SHOWCASE_PROJECTS)[number]>,
  threads: ReadonlyArray<(typeof SHOWCASE_THREADS)[number]>,
  now: number,
): void {
  const database = new NodeSqlite.DatabaseSync(dbPath, { timeout: 30_000 });
  try {
    database.exec("BEGIN IMMEDIATE");
    for (const table of SEEDED_V1_TABLES) {
      database.exec(`DELETE FROM ${table}`);
    }
    const insertProject = database.prepare(
      `INSERT OR REPLACE INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    for (const [index, project] of projects.entries()) {
      const workspaceRoot = workspaceRoots.get(project.id);
      if (!workspaceRoot) throw new Error(`Missing workspace root for ${project.id}.`);
      const latestThreadMinutes = Math.min(
        ...threads.flatMap((thread) =>
          thread.projectId === project.id ? [thread.minutesAgo] : [],
        ),
      );
      insertProject.run(
        project.id,
        project.title,
        workspaceRoot,
        MODEL_SELECTION,
        PROJECT_SCRIPTS,
        minutesBefore(now, 60 * 24 * (90 - index * 12)),
        minutesBefore(now, latestThreadMinutes),
      );
    }

    for (const thread of threads) {
      const workspaceRoot = workspaceRoots.get(thread.projectId);
      if (!workspaceRoot) throw new Error(`Missing workspace root for ${thread.projectId}.`);
      insertThread(database, now, {
        ...thread,
        ...("state" in thread ? { state: thread.state } : {}),
        workspaceRoot,
      });
    }

    const insertMessage = database.prepare(
      `INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, attachments_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    );
    for (const thread of threads) {
      const turnId = `${thread.id}-turn`;
      const requestTime = minutesBefore(now, thread.minutesAgo + 5);
      insertMessage.run(
        `${thread.id}-request`,
        thread.id,
        turnId,
        "user",
        thread.request,
        requestTime,
        requestTime,
      );
      if (thread.response !== null) {
        const responseTime = minutesBefore(now, thread.minutesAgo);
        insertMessage.run(
          `${thread.id}-answer`,
          thread.id,
          turnId,
          "assistant",
          thread.response,
          responseTime,
          responseTime,
        );
      }
    }

    const turnId = `${SHOWCASE_THREAD_ID}-turn`;
    const insertActivity = database.prepare(
      `INSERT INTO projection_thread_activities (
        activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
      ) VALUES (?, ?, ?, 'tool', 'tool.completed', ?, ?, ?, ?)`,
    );
    insertActivity.run(
      "read-connection-state",
      SHOWCASE_THREAD_ID,
      turnId,
      "Read the connection state machine",
      JSON.stringify({
        itemType: "command_execution",
        title: "Read the connection state machine",
        detail: "apps/mobile/src/connection · 6 files",
        status: "completed",
      }),
      1,
      minutesBefore(now, 8),
    );
    insertActivity.run(
      "edit-environment-card",
      SHOWCASE_THREAD_ID,
      turnId,
      "Edited the environment card",
      JSON.stringify({
        itemType: "file_change",
        title: "Edited the environment card",
        detail: "2 files changed · +26 −3",
        status: "completed",
      }),
      2,
      minutesBefore(now, 6),
    );
    insertActivity.run(
      "run-settings-tests",
      SHOWCASE_THREAD_ID,
      turnId,
      "Ran the settings tests",
      JSON.stringify({
        itemType: "command_execution",
        title: "Ran the settings tests",
        detail: "25 passed · 0 failed",
        status: "completed",
      }),
      3,
      minutesBefore(now, 4),
    );

    for (const [index, projector] of PROJECTOR_NAMES.entries()) {
      database
        .prepare(
          "INSERT INTO projection_state (projector, last_applied_sequence, updated_at) VALUES (?, ?, ?)",
        )
        .run(projector, index + 1, minutesBefore(now, 1));
    }
    database.exec("COMMIT");
  } catch (error) {
    // A failed BEGIN (or an error SQLite already auto-rolled back) leaves no
    // transaction, and the rollback's own "cannot rollback" error would then
    // replace the one that actually explains the failure.
    try {
      database.exec("ROLLBACK");
    } catch {
      // Nothing to roll back.
    }
    throw error;
  } finally {
    database.close();
  }
}

export async function seedShowcaseEnvironment(input: {
  readonly baseDir: string;
  readonly projectIds?: ReadonlyArray<string>;
  readonly now?: number;
}): Promise<{ readonly dbPath: string; readonly workspaceRoot: string }> {
  const now = input.now ?? Date.now();
  const selectedProjectIds = new Set(
    input.projectIds ?? SHOWCASE_PROJECTS.map((project) => project.id),
  );
  const projects = SHOWCASE_PROJECTS.filter((project) => selectedProjectIds.has(project.id));
  if (projects.length === 0) throw new Error("At least one showcase project must be selected.");
  const threads = SHOWCASE_THREADS.filter((thread) => selectedProjectIds.has(thread.projectId));
  const workspaceBase = NodePath.join(input.baseDir, "workspace");
  const workspaceRoots = new Map(
    projects.map(
      (project) => [project.id, NodePath.join(workspaceBase, project.directory)] as const,
    ),
  );
  const primaryProject =
    projects.find((project) => project.id === SHOWCASE_PROJECT_ID) ?? projects[0];
  if (!primaryProject) throw new Error("The primary showcase workspace is not configured.");
  const workspaceRoot = workspaceRoots.get(primaryProject.id);
  if (!workspaceRoot) throw new Error("The primary showcase workspace is not configured.");
  const dbPath = NodePath.join(input.baseDir, "userdata", "statev2.sqlite");
  if (primaryProject.id === SHOWCASE_PROJECT_ID) {
    await seedSupatermWorkspace(workspaceRoot);
  }
  await Promise.all(
    projects
      .flatMap((project) => (project.id === SHOWCASE_PROJECT_ID ? [] : [project]))
      .map(async (project) => {
        const projectWorkspaceRoot = workspaceRoots.get(project.id);
        if (!projectWorkspaceRoot) throw new Error(`Missing workspace root for ${project.id}.`);
        await seedCompanionWorkspace({
          workspaceRoot: projectWorkspaceRoot,
          title: project.title,
          repositoryUrl: project.repositoryUrl,
          favicon: project.favicon,
        });
      }),
  );
  // The environment server begins listening before it finishes migrating the
  // database, so wait for the schema before deleting from and reseeding it.
  await waitForSeedableSchema(dbPath);
  seedDatabase(dbPath, workspaceRoots, projects, threads, now);

  const terminalDirectory = NodePath.join(input.baseDir, "userdata", "logs", "terminals");
  if (selectedProjectIds.has(SHOWCASE_PROJECT_ID)) {
    const safeThreadId = Buffer.from(SHOWCASE_THREAD_ID).toString("base64url");
    await NodeFSP.mkdir(terminalDirectory, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(terminalDirectory, `terminal_${safeThreadId}.log`),
      SHOWCASE_TERMINAL_BUFFER,
    );
  }
  return { dbPath, workspaceRoot };
}
