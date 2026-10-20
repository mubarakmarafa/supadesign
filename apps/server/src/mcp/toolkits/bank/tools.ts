import {
  NonNegativeInt,
  OrchestratorMcpFailure,
  THREAD_BANK_ENTRY_TEXT_MAX_LENGTH,
  THREAD_BANK_MAX_ENTRIES,
  ThreadBankEntryId,
  ThreadBankError,
  ThreadId,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadBank from "../../../threadBank/ThreadBankService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { McpAttachmentInput } from "../attachment/input.ts";

const BankAddTool = Tool.make("supaterm_bank_add", {
  failure: Schema.Union([OrchestratorMcpFailure, ThreadBankError]),
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ThreadBank.ThreadBankService,
  ],
  description: `File a message onto a card's bank without starting its agent, as the designer's Option+Enter does. Banked messages wait above the card's composer until the designer sends them, or until the card moves into the send column or into a column whose automation uses them; then every entry reaches the card's agent as one message, in order. Use it to leave a card context, references or follow-ups for later; to start work now, use supaterm_thread_send instead. Omit threadId for this thread's own card. Attachments are pending uploads from supaterm_attachment_prepare_upload or attachments already in the card's thread. A card holds up to ${THREAD_BANK_MAX_ENTRIES} banked messages.`,
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    text: Schema.String.check(Schema.isMaxLength(THREAD_BANK_ENTRY_TEXT_MAX_LENGTH)).annotate({
      description: "The message to bank, written for the card's agent.",
    }),
    attachments: Schema.optional(
      Schema.Array(McpAttachmentInput)
        .check(Schema.isMaxLength(8))
        .annotate({ description: "Images or files to bank with the message." }),
    ),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    entryId: ThreadBankEntryId,
    bankedCount: NonNegativeInt.annotate({
      description: "How many messages the card's bank holds now.",
    }),
  }),
})
  .annotate(Tool.Title, "Bank a message on a card")
  .annotate(Tool.Destructive, false);

export const BankToolkit = Toolkit.make(BankAddTool);
