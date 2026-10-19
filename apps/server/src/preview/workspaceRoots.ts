import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { PortDiscoveryWorkspaceRoots } from "./PortScanner.ts";

/**
 * Every project folder and live thread worktree, as written and as resolved,
 * since process working directories report real paths.
 */
export const layer = Layer.effect(
  PortDiscoveryWorkspaceRoots,
  Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const fs = yield* FileSystem.FileSystem;
    return Effect.gen(function* () {
      const shells = yield* projects.listShells();
      const snapshot = yield* projections.getShellSnapshot();
      const paths = new Set([
        ...shells.map((project) => project.workspaceRoot),
        ...snapshot.threads.flatMap((thread) =>
          thread.worktreePath === null ? [] : [thread.worktreePath],
        ),
      ]);
      const resolved = yield* Effect.forEach(
        paths,
        (path) => fs.realPath(path).pipe(Effect.orElseSucceed(() => path)),
        { concurrency: 8 },
      );
      return [...new Set([...paths, ...resolved])];
    }).pipe(
      Effect.tapError((error) =>
        Effect.logDebug("preview port scan could not read workspace roots", { error }),
      ),
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    );
  }),
);
