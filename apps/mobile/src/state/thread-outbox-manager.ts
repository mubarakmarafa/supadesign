import { createThreadOutboxManager as createSharedThreadOutboxManager } from "@supaterm/client-runtime/thread-outbox";
import type { AtomRegistry } from "effect/reactivity";

import type { QueuedThreadMessage } from "./thread-outbox-model";
import type { ThreadOutboxStorage } from "./thread-outbox-storage";

export { ThreadOutboxManagerError } from "@supaterm/client-runtime/thread-outbox";

export function createThreadOutboxManager(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly storage: ThreadOutboxStorage;
  readonly warn?: (message: string, error: unknown) => void;
}) {
  return createSharedThreadOutboxManager<QueuedThreadMessage>({
    ...options,
    identify: (message) => message,
  });
}
