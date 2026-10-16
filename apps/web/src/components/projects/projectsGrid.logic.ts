import {
  getThreadSortTimestamp,
  type ThreadSortInput,
} from "@supaterm/client-runtime/state/thread-sort";

interface GridProject {
  readonly environmentId: string;
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface GridThread extends ThreadSortInput {
  readonly environmentId: string;
  readonly projectId: string;
  readonly deletedAt: string | null;
}

export interface ProjectGridEntry<P, T> {
  readonly project: P;
  /** The thread the user last sent a message in, or last changed. */
  readonly lastThread: T | null;
  /** When the project was last worked on, in epoch ms. */
  readonly lastActivityMs: number | null;
  readonly threadCount: number;
}

const projectKey = (environmentId: string, projectId: string) => `${environmentId}\n${projectId}`;

/** One grid card per project, most recently worked on first. */
export function buildProjectsGrid<P extends GridProject, T extends GridThread>(
  projects: ReadonlyArray<P>,
  threads: ReadonlyArray<T>,
): ReadonlyArray<ProjectGridEntry<P, T>> {
  const byProject = new Map<string, { thread: T; at: number; count: number }>();
  for (const thread of threads) {
    if (thread.deletedAt !== null) continue;
    const key = projectKey(thread.environmentId, thread.projectId);
    const at = getThreadSortTimestamp(thread, "updated_at");
    const current = byProject.get(key);
    if (current === undefined) {
      byProject.set(key, { thread, at, count: 1 });
    } else {
      current.count += 1;
      if (at > current.at) {
        current.thread = thread;
        current.at = at;
      }
    }
  }
  const entries = projects.map((project) => {
    const latest = byProject.get(projectKey(project.environmentId, project.id));
    const fallback = Date.parse(project.updatedAt || project.createdAt);
    const at = latest !== undefined && Number.isFinite(latest.at) ? latest.at : fallback;
    return {
      project,
      lastThread: latest?.thread ?? null,
      lastActivityMs: Number.isFinite(at) ? at : null,
      threadCount: latest?.count ?? 0,
    };
  });
  return entries.toSorted(
    (a, b) =>
      (b.lastActivityMs ?? Number.NEGATIVE_INFINITY) -
        (a.lastActivityMs ?? Number.NEGATIVE_INFINITY) ||
      a.project.title.localeCompare(b.project.title),
  );
}
