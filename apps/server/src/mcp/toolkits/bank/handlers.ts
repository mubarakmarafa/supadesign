import * as Effect from "effect/Effect";
import * as ThreadBank from "../../../threadBank/ThreadBankService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread } from "../../threadAccess.ts";
import { resolveAttachmentReferences } from "../attachment/handlers.ts";
import { BankToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(BankToolkit, {
  supaterm_bank_add: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const requested = input.attachments ?? [];
        // Messages are read only to recognise attachments the thread already owns.
        const { projection } = yield* readThread(
          input.threadId,
          requested.length > 0 ? ["messages"] : [],
        );
        const threadId = projection.thread.id;
        const attachments =
          requested.length === 0
            ? []
            : yield* resolveAttachmentReferences(
                requested,
                projection.messages.flatMap((message) => message.attachments),
              );
        const bank = yield* ThreadBank.ThreadBankService;
        const entry = yield* bank.add({ threadId, text: input.text, attachments });
        const entries = yield* bank.get(threadId);
        return { threadId, entryId: entry.id, bankedCount: entries.length };
      }),
  ),
});
