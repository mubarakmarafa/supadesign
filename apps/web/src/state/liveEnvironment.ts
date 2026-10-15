import { createLiveEnvironmentAtoms } from "@supaterm/client-runtime/state/live-environment";

import { connectionAtomRuntime } from "../connection/runtime";

export const liveEnvironment = createLiveEnvironmentAtoms(connectionAtomRuntime);
