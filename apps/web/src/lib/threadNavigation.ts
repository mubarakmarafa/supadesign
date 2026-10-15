import type { ScopedThreadRef } from "@supaterm/contracts";

export function createThreadNavigation<Location>(input: {
  readonly getLocation: () => Location;
  readonly isReady: (threadRef: ScopedThreadRef) => boolean;
  readonly waitForThread: (threadRef: ScopedThreadRef, signal: AbortSignal) => Promise<boolean>;
  readonly navigate: (threadRef: ScopedThreadRef) => Promise<void>;
}) {
  let request = 0;
  let pending: AbortController | null = null;

  return {
    navigate: async (threadRef: ScopedThreadRef) => {
      const current = ++request;
      pending?.abort();
      const location = input.getLocation();
      if (!input.isReady(threadRef)) {
        const controller = new AbortController();
        pending = controller;
        const ready = await input.waitForThread(threadRef, controller.signal);
        if (pending === controller) pending = null;
        if (!ready || current !== request || input.getLocation() !== location) return;
      }
      return input.navigate(threadRef);
    },
    cancel: () => {
      request++;
      pending?.abort();
      pending = null;
    },
  };
}
