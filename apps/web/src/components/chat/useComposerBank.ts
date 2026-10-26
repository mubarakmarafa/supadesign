import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import type { ChatAttachment, EnvironmentId } from "@supaterm/contracts";

import type { ComposerHandleRef } from "../../composerHandleContext";
import { type ComposerThreadTarget, useComposerDraftStore } from "../../composerDraftStore";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { buildMessageContext } from "../../lib/composerContextRecords";
import { threadBank } from "../../state/threadBank";
import { useAtomCommand } from "../../state/use-atom-command";
import { deriveComposerSendState, type makeThreadErrorSetter } from "../ChatView.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { draftSendState } from "./chatViewSend";
import { useThreadBankSupported } from "./threadBankState";
import type { useQueuedRunEditWithOutbox } from "./useQueuedRunEditWithOutbox";

/**
 * Banks the composer's contents on the thread's card instead of sending them. The card's
 * agent gets everything banked as one message when the card moves on. `onBank` is null where
 * the environment has no bank.
 */
export function useComposerBank(input: {
  readonly environmentId: EnvironmentId;
  readonly routeThreadKey: string;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly activeProject: EnvironmentProject | null;
  readonly isServerThread: boolean;
  readonly queuedRunEdit: ReturnType<typeof useQueuedRunEditWithOutbox>;
  readonly composerRef: ComposerHandleRef;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly promptRef: { current: string };
  readonly setThreadError: ReturnType<typeof makeThreadErrorSetter>;
  readonly scheduleComposerFocus: () => void;
}) {
  const {
    environmentId,
    routeThreadKey,
    activeThread,
    activeProject,
    isServerThread,
    queuedRunEdit,
    composerRef,
    composerDraftTarget,
    promptRef,
    setThreadError,
    scheduleComposerFocus,
  } = input;
  const bankThreadMessage = useAtomCommand(threadBank.add, { reportFailure: false });
  const threadBankSupported = useThreadBankSupported(environmentId);
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const { sendInFlight: sendInFlightRef } = draftSendState(routeThreadKey);

  const onBank = async () => {
    if (!activeThread || !isServerThread || !activeProject) {
      toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Send a first message before banking",
          description: "Banked messages belong to a thread that has started.",
        }),
      );
      return;
    }
    if (sendInFlightRef.current || queuedRunEdit.isEditing || queuedRunEdit.outbox.isEditing) {
      return;
    }
    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx) return;
    const attachments = [...sendCtx.images, ...sendCtx.files];
    const { trimmedPrompt, sendableTerminalContexts, hasSendableContent } = deriveComposerSendState(
      {
        prompt: promptRef.current,
        imageCount: attachments.length,
        terminalContexts: sendCtx.terminalContexts,
        elementContextCount:
          sendCtx.previewAnnotations.length +
          sendCtx.reviewComments.length +
          sendCtx.threadContexts.length,
      },
    );
    if (!hasSendableContent) return;
    const threadIdForBank = activeThread.id;
    const savedDraft = useComposerDraftStore.getState().getComposerDraft(composerDraftTarget);
    sendInFlightRef.current = true;
    try {
      let uploaded: ReadonlyArray<ChatAttachment> = [];
      if (attachments.length > 0) {
        for (const attachment of attachments) {
          startAttachmentUpload({
            environmentId,
            image: attachment,
            draftTarget: composerDraftTarget,
          });
        }
        await awaitAttachmentUploads(attachments.map((attachment) => attachment.id));
        const ready = getUploadedAttachments({ environmentId, images: attachments });
        if (ready === null) throw new Error("Retry or remove failed uploads before banking.");
        uploaded = ready;
      }
      const context = buildMessageContext({
        terminalContexts: sendableTerminalContexts,
        reviewComments: sendCtx.reviewComments,
        previewAnnotations: sendCtx.previewAnnotations,
        threadContexts: sendCtx.threadContexts,
        attachments: attachments.map((attachment, index) => ({
          attachment,
          attachmentId: uploaded[index]?.id ?? attachment.id,
        })),
      });
      const result = await bankThreadMessage({
        environmentId,
        input: {
          threadId: threadIdForBank,
          text: trimmedPrompt,
          ...(context ? { context } : {}),
          attachments: [...uploaded],
        },
      });
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        throw error instanceof Error ? error : new Error("Could not bank the message.");
      }
      if (useComposerDraftStore.getState().getComposerDraft(composerDraftTarget) === savedDraft) {
        promptRef.current = "";
        clearComposerDraftContent(composerDraftTarget);
        composerRef.current?.resetCursorState();
      }
      releaseDraftAttachments(attachments);
      setThreadError(threadIdForBank, null);
      scheduleComposerFocus();
    } catch (error) {
      setThreadError(
        threadIdForBank,
        error instanceof Error ? error.message : "Could not bank the message.",
      );
    } finally {
      sendInFlightRef.current = false;
    }
  };

  return { onBank: threadBankSupported ? onBank : null, threadBankSupported };
}
