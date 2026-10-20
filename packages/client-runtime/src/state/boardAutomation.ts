import { WS_METHODS } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Column automations: prompts a board column sends to a card's agent when it moves. */
export function createBoardAutomationAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    runs: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:board-automation:runs",
      tag: WS_METHODS.subscribeBoardAutomations,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board-automation:cancel",
      tag: WS_METHODS.boardAutomationCancel,
    }),
    runNow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board-automation:run-now",
      tag: WS_METHODS.boardAutomationRunNow,
    }),
  };
}
