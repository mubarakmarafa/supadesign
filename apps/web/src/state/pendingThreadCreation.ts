import {
  buildPendingThreadShell,
  type PendingThreadCreation,
} from "@supaterm/client-runtime/pending-thread-creation";
import type { PendingThreadTurn } from "./threadOutbox";

export function pendingThreadCreation(entry: PendingThreadTurn) {
  const { input, environmentId } = entry.payload;
  const creation = input.bootstrap?.createThread;
  if (!creation) return null;
  const message = {
    environmentId,
    threadId: input.threadId,
    messageId: input.message.messageId,
    text: input.message.text,
    context: input.message.context,
    createdAt: entry.createdAt,
    entry,
    shell: buildPendingThreadShell({
      ...creation,
      environmentId,
      threadId: input.threadId,
      modelSelection: input.modelSelection ?? creation.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      creationSource: input.creationSource ?? "web",
    }),
  };
  return {
    message,
    outcome:
      entry.status === "failed"
        ? { kind: "failed", message, reason: entry.error ?? "Could not start the thread." }
        : entry.status === "delivered"
          ? { kind: "delivered", message }
          : null,
  } satisfies PendingThreadCreation<typeof message>;
}

export type WebPendingThreadCreation = NonNullable<ReturnType<typeof pendingThreadCreation>>;
