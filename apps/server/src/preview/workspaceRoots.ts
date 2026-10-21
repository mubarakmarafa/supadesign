import type { ProjectId } from "@supaterm/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import { type PortDiscoveryWorkspaceRoot, PortDiscoveryWorkspaceRoots } from "./PortScanner.ts";

const GIT_WORKTREE_LIST_TIMEOUT = Duration.seconds(2);

/** Checkouts and their branches from `git worktree list --porcelain`; bare repositories are left out. */
export const parseWorktreeListPorcelain = (
  raw: string,
): ReadonlyArray<{ readonly path: string; readonly branch: string | null }> =>
  raw.split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split("\n");
    const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (path === undefined || path.length === 0 || lines.includes("bare")) return [];
    const ref = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length);
    const branch = ref?.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
    return [{ path, branch: branch === null || branch.length === 0 ? null : branch }];
  });

/**
 * Every project folder and live thread worktree, plus every other worktree of
 * a project's repository (such as one another app made), as written and as
 * resolved, since process working directories report real paths.
 */
export const layer = Layer.effect(
  PortDiscoveryWorkspaceRoots,
  Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const fs = yield* FileSystem.FileSystem;

    const repositoryWorktrees = (workspaceRoot: string) =>
      processRunner
        .run({
          command: "git",
          args: ["worktree", "list", "--porcelain"],
          cwd: workspaceRoot,
          timeout: GIT_WORKTREE_LIST_TIMEOUT,
          maxOutputBytes: 256 * 1024,
        })
        .pipe(
          Effect.map((result) =>
            result.code === 0 ? parseWorktreeListPorcelain(result.stdout) : [],
          ),
          Effect.orElseSucceed(() => []),
        );

    return Effect.gen(function* () {
      const shells = yield* projects.listShells();
      const snapshot = yield* projections.getShellSnapshot();
      const roots = new Map<string, PortDiscoveryWorkspaceRoot>();
      const add = (path: string, projectId: ProjectId | null, branch: string | null) => {
        if (!roots.has(path)) roots.set(path, { path, projectId, branch });
      };
      // Thread worktrees first, so their branch wins over the repository's listing.
      for (const thread of snapshot.threads) {
        if (thread.worktreePath !== null) add(thread.worktreePath, thread.projectId, thread.branch);
      }
      const checkouts = yield* Effect.forEach(
        shells,
        (project) =>
          Effect.map(repositoryWorktrees(project.workspaceRoot), (worktrees) => ({
            project,
            worktrees,
          })),
        { concurrency: 4 },
      );
      for (const { project, worktrees } of checkouts) {
        const own = worktrees.find((entry) => entry.path === project.workspaceRoot);
        add(project.workspaceRoot, project.id, own?.branch ?? null);
        for (const worktree of worktrees) add(worktree.path, project.id, worktree.branch);
      }
      const resolved = yield* Effect.forEach(
        [...roots.values()],
        (root) =>
          fs.realPath(root.path).pipe(
            Effect.map((path) => ({ ...root, path })),
            Effect.orElseSucceed(() => root),
          ),
        { concurrency: 8 },
      );
      for (const root of resolved) add(root.path, root.projectId, root.branch);
      return [...roots.values()];
    }).pipe(
      Effect.tapError((error) =>
        Effect.logDebug("preview port scan could not read workspace roots", { error }),
      ),
      Effect.orElseSucceed((): ReadonlyArray<PortDiscoveryWorkspaceRoot> => []),
    );
  }),
);
