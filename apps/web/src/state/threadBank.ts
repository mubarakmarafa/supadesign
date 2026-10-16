import { createThreadBankAtoms } from "@supaterm/client-runtime/state/thread-bank";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadBank = createThreadBankAtoms(connectionAtomRuntime);
