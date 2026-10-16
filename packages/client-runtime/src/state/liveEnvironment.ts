import { WS_METHODS } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Live environments run a board card's dev server; the server owns every process. */
export function createLiveEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Activations must reach the server in the order the user caused them.
  const activationScheduler = createAtomCommandScheduler();
  return {
    environments: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:live-environment:environments",
      tag: WS_METHODS.subscribeLiveEnvironments,
    }),
    activate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-environment:activate",
      tag: WS_METHODS.liveEnvironmentActivate,
      scheduler: activationScheduler,
      concurrency: {
        mode: "serial" as const,
        key: ({ environmentId, input }: { environmentId: string; input: { projectId: string } }) =>
          JSON.stringify([environmentId, input.projectId]),
      },
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-environment:stop",
      tag: WS_METHODS.liveEnvironmentStop,
    }),
    retry: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-environment:retry",
      tag: WS_METHODS.liveEnvironmentRetry,
    }),
    discard: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-environment:discard",
      tag: WS_METHODS.liveEnvironmentDiscard,
    }),
    saveDevScript: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:live-environment:save-dev-script",
      tag: WS_METHODS.liveEnvironmentSaveDevScript,
    }),
  };
}
