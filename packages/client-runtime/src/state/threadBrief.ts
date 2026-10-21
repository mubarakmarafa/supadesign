import { WS_METHODS } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Each card's brief and the decisions made on it. */
export function createThreadBriefAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    briefs: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:thread-brief:briefs",
      tag: WS_METHODS.subscribeThreadBriefs,
    }),
    /** Every brief the card has had, for its history. */
    versions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:thread-brief:versions",
      tag: WS_METHODS.threadBriefVersions,
    }),
    setBrief: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-brief:set",
      tag: WS_METHODS.threadBriefSet,
    }),
    seedBrief: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-brief:seed",
      tag: WS_METHODS.threadBriefSeed,
    }),
    addDecision: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-brief:add-decision",
      tag: WS_METHODS.threadDecisionAdd,
    }),
    acceptDecision: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-brief:accept-decision",
      tag: WS_METHODS.threadDecisionAccept,
    }),
    rejectDecision: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-brief:reject-decision",
      tag: WS_METHODS.threadDecisionReject,
    }),
    restoreDecision: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-brief:restore-decision",
      tag: WS_METHODS.threadDecisionRestore,
    }),
  };
}
