import { WS_METHODS } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** The projects grid's per-repo description, read from the repo's files. */
export function createProjectSummaryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    summary: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:summary",
      tag: WS_METHODS.projectsSummary,
      // READMEs change rarely; reopening the grid within minutes reuses the answer.
      staleTimeMs: 5 * 60_000,
      idleTtlMs: 10 * 60_000,
    }),
  };
}
