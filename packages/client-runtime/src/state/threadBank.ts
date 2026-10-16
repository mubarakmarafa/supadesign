import { WS_METHODS } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Banked messages: material filed onto a card that is sent to its agent as one message. */
export function createThreadBankAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    banks: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:thread-bank:banks",
      tag: WS_METHODS.subscribeThreadBanks,
    }),
    add: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-bank:add",
      tag: WS_METHODS.threadBankAdd,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-bank:update",
      tag: WS_METHODS.threadBankUpdate,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-bank:remove",
      tag: WS_METHODS.threadBankRemove,
    }),
    reorder: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-bank:reorder",
      tag: WS_METHODS.threadBankReorder,
    }),
    send: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-bank:send",
      tag: WS_METHODS.threadBankSend,
    }),
  };
}
