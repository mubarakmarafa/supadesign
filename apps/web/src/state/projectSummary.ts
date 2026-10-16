import { createProjectSummaryAtoms } from "@supaterm/client-runtime/state/project-summary";

import { connectionAtomRuntime } from "../connection/runtime";

export const projectSummary = createProjectSummaryAtoms(connectionAtomRuntime);
