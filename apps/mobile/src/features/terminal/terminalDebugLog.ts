import { createDebugLogger } from "../../lib/debugLog";

/**
 * Debug logging for the mobile terminal pipeline. Prefix: `[supaterm-terminal]`.
 *
 * Enabled when `__DEV__` is true, or set the shared `globalThis.__SUPATERM_DEBUG__`
 * filter in a JS debugger / Metro console to trace release/TestFlight builds.
 */
const logger = createDebugLogger("terminal", { enabledInDev: true });

export function terminalDebugLog(message: string, data?: Record<string, unknown>): void {
  logger.log(message, data);
}
