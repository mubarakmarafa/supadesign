import { createThreadProgressAtoms } from "@supaterm/client-runtime/state/thread-progress";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadProgress = createThreadProgressAtoms(connectionAtomRuntime);
