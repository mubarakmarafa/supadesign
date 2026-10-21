import { createThreadBriefAtoms } from "@supaterm/client-runtime/state/thread-brief";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadBrief = createThreadBriefAtoms(connectionAtomRuntime);
