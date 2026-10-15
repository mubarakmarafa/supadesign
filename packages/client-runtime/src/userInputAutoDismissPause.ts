import type { EnvironmentId, RuntimeRequestId, ThreadId } from "@supaterm/contracts";

export function createUserInputAutoDismissPause() {
  let requestedKey: string | null = null;
  return async (
    input: {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      requestId: RuntimeRequestId;
    },
    pause: () => Promise<boolean>,
  ) => {
    const key = JSON.stringify([input.environmentId, input.threadId, input.requestId]);
    if (requestedKey === key) return;
    requestedKey = key;
    let accepted = false;
    try {
      accepted = await pause();
    } finally {
      if (!accepted && requestedKey === key) requestedKey = null;
    }
  };
}
