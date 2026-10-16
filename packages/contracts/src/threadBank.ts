import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ChatAttachment } from "./chatAttachment.ts";
import { OrchestrationMessageContext } from "./composerContext.ts";

/**
 * A thread's bank holds messages the designer filed onto a card without
 * starting the agent: notes, references, annotated captures. Sending the bank
 * delivers every entry, in order, as one message. The server stores banks so
 * they follow the card across clients and board rules can send them.
 */

export const THREAD_BANK_MAX_ENTRIES = 50;
export const THREAD_BANK_ENTRY_TEXT_MAX_LENGTH = 100_000;

export const ThreadBankEntryId = TrimmedNonEmptyString.pipe(Schema.brand("ThreadBankEntryId"));
export type ThreadBankEntryId = typeof ThreadBankEntryId.Type;

export const ThreadBankEntry = Schema.Struct({
  id: ThreadBankEntryId,
  text: Schema.String.check(Schema.isMaxLength(THREAD_BANK_ENTRY_TEXT_MAX_LENGTH)),
  context: Schema.optional(OrchestrationMessageContext),
  attachments: Schema.Array(ChatAttachment),
  createdAt: Schema.String,
});
export type ThreadBankEntry = typeof ThreadBankEntry.Type;

export const ThreadBank = Schema.Struct({
  threadId: ThreadId,
  entries: Schema.Array(ThreadBankEntry),
});
export type ThreadBank = typeof ThreadBank.Type;

/** Every non-empty bank in a project. */
export const ThreadBankList = Schema.Array(ThreadBank);
export type ThreadBankList = typeof ThreadBankList.Type;

export const ThreadBankProjectInput = Schema.Struct({ projectId: ProjectId });
export type ThreadBankProjectInput = typeof ThreadBankProjectInput.Type;

export const ThreadBankThreadInput = Schema.Struct({ threadId: ThreadId });
export type ThreadBankThreadInput = typeof ThreadBankThreadInput.Type;

export const ThreadBankAddInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String.check(Schema.isMaxLength(THREAD_BANK_ENTRY_TEXT_MAX_LENGTH)),
  context: Schema.optional(OrchestrationMessageContext),
  /** Pending uploads are claimed into the thread when banked. */
  attachments: Schema.Array(ChatAttachment),
});
export type ThreadBankAddInput = typeof ThreadBankAddInput.Type;

export const ThreadBankUpdateInput = Schema.Struct({
  threadId: ThreadId,
  entryId: ThreadBankEntryId,
  text: Schema.String.check(Schema.isMaxLength(THREAD_BANK_ENTRY_TEXT_MAX_LENGTH)),
  context: Schema.optional(OrchestrationMessageContext),
  attachments: Schema.Array(ChatAttachment),
});
export type ThreadBankUpdateInput = typeof ThreadBankUpdateInput.Type;

export const ThreadBankEntryInput = Schema.Struct({
  threadId: ThreadId,
  entryId: ThreadBankEntryId,
});
export type ThreadBankEntryInput = typeof ThreadBankEntryInput.Type;

export const ThreadBankReorderInput = Schema.Struct({
  threadId: ThreadId,
  entryId: ThreadBankEntryId,
  /** The entry it moves in front of; null moves it to the end. */
  beforeEntryId: Schema.NullOr(ThreadBankEntryId),
});
export type ThreadBankReorderInput = typeof ThreadBankReorderInput.Type;

export class ThreadBankError extends Schema.TaggedError<ThreadBankError>()("ThreadBankError", {
  message: Schema.String,
}) {}

/** Joins banked entries into the one message a bank sends. */
export function combineThreadBankEntries(entries: ReadonlyArray<ThreadBankEntry>): {
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly context: OrchestrationMessageContext | undefined;
} {
  const text = entries
    .flatMap((entry) => {
      const part = entry.text.trim();
      return part.length > 0 ? [part] : [];
    })
    .join("\n\n");
  const attachmentIds = new Set<string>();
  const attachments: ChatAttachment[] = [];
  for (const entry of entries) {
    for (const attachment of entry.attachments) {
      if (attachmentIds.has(attachment.id)) continue;
      attachmentIds.add(attachment.id);
      attachments.push(attachment);
    }
  }
  const contextIds = new Set<string>();
  const records: Array<OrchestrationMessageContext["records"][number]> = [];
  for (const entry of entries) {
    for (const record of entry.context?.records ?? []) {
      if (contextIds.has(record.contextId)) continue;
      contextIds.add(record.contextId);
      records.push(record);
    }
  }
  return {
    text,
    attachments,
    context: records.length === 0 ? undefined : { version: 1, records },
  };
}
