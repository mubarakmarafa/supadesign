import { WS_METHODS } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Card progress: screenshots of the running work and a one-glance summary per thread. */
export function createThreadProgressAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    progress: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:thread-progress:progress",
      tag: WS_METHODS.subscribeThreadProgress,
    }),
    capture: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-progress:capture",
      tag: WS_METHODS.threadProgressCapture,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-progress:remove",
      tag: WS_METHODS.threadProgressRemove,
    }),
    setSummary: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-progress:set-summary",
      tag: WS_METHODS.threadSummarySet,
    }),
  };
}
