import { createBoardAutomationAtoms } from "@supaterm/client-runtime/state/board-automation";

import { connectionAtomRuntime } from "../connection/runtime";

export const boardAutomation = createBoardAutomationAtoms(connectionAtomRuntime);
