import { resolveThreadOutboxDispatchStep } from "@supaterm/client-runtime/thread-outbox";
import { createBrowserThreadOutbox, type ThreadOutboxEntry } from "./threadOutboxDelivery";
import { scopedThreadKey, scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { StartThreadTurnInput } from "@supaterm/client-runtime/operations";
import { runAtomCommand, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import {
  runAttachmentUploadCycle,
  verifyPersistedAttachmentUpload,
} from "@supaterm/client-runtime/state/attachments";
import {
  CommandId,
  MessageId,
  ChatAttachment,
  AttachmentCreateUploadUrlInput,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import { remapComposerContextAttachments } from "@supaterm/shared/composerContextReferences";
import { serializeLegacyContextMessage } from "@supaterm/shared/composerContextLegacySend";
import { resolveDefaultWorktreeBaseBranch } from "@supaterm/shared/git";
import { resolveAssetUrl } from "@supaterm/client-runtime/state/assets";
import * as Schema from "effect/Schema";
import { useCallback, useSyncExternalStore } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  DraftId,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  restoreFailedBackgroundDraftThread,
  useComposerDraftStore,
} from "../composerDraftStore";
import { readFileAsDataUrl } from "../lib/imageCompression";
import { attachmentEnvironment } from "./attachments";
import { environmentPresentations } from "./presentation";
import { environmentShell } from "./shell";
import { environmentServerConfigsAtom } from "./server";
import { directThreadEnvironment } from "./threadCommands";
import { readPreparedConnection } from "./session";
import { OutboxTurn, OutboxAttachment } from "./threadOutboxSchema";
import { browserThreadOutboxStorage } from "./threadOutboxStorage";
import { randomUUID, newThreadId } from "../lib/utils";
import { assetEnvironment } from "./assets";
import { fetchVcsRefs } from "./vcs";

const decodeUpload = Schema.decodeUnknownSync(AttachmentCreateUploadUrlInput);
const decodeAttachment = Schema.decodeSync(ChatAttachment);
const decodeTurn = Schema.decodeSync(OutboxTurn);

export type PendingThreadTurn = ThreadOutboxEntry<OutboxTurn>;

async function command<A, E, Input>(
  operation: import("@supaterm/client-runtime/state/runtime").AtomCommand<Input, A, E>,
  input: Input,
) {
  const result = await runAtomCommand(appAtomRegistry, operation, input, { reportFailure: false });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

async function uploadAttachment(
  environmentId: EnvironmentId,
  attachment: typeof OutboxAttachment.Type,
) {
  if (attachment.bytes === null)
    throw new Error(`Attach '${attachment.name}' again before sending.`);
  const result = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId,
    upload: decodeUpload({
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    }),
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) => {
      const controller = new AbortController();
      return {
        abort: () => controller.abort(),
        done: (async () => {
          let response: Response;
          try {
            response = await fetch(url, {
              method: "POST",
              body: attachment.bytes,
              headers: { "Content-Type": attachment.mimeType },
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]),
            });
          } catch (error) {
            throw new Error("Attachment upload disconnected.", { cause: error });
          }
          if (!response.ok)
            throw new Error(
              response.status >= 500 || response.status === 408 || response.status === 429
                ? `Attachment upload (${response.status}) disconnected.`
                : `Attachment upload failed (${response.status}).`,
            );
        })(),
      };
    },
  });
  if (result.status === "failed") throw result.error;
  if (result.status !== "uploaded") throw new Error("Attachment upload disconnected.");
  return decodeAttachment({
    type: attachment.type,
    id: result.attachmentId,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.source ? { source: attachment.source } : {}),
  });
}

export const webThreadOutbox = createBrowserThreadOutbox<OutboxTurn>({
  storage: browserThreadOutboxStorage,
  registry: appAtomRegistry,
  identify: (payload) => ({
    environmentId: payload.environmentId,
    threadId: payload.input.threadId,
  }),
  now: () => Date.now(),
  canRemoveDelivered: (entry) => {
    if (!entry.payload.input.bootstrap?.createThread) return true;
    const snapshot = appAtomRegistry.get(
      directThreadEnvironment.snapshotAtom(entry.payload.environmentId),
    );
    if (!snapshot) return false;
    return (
      snapshot.threads.some((thread) => thread.id === entry.payload.input.threadId) ||
      snapshot.archivedThreads.some((thread) => thread.id === entry.payload.input.threadId)
    );
  },
  canDeliver: (entry) => {
    const environmentId = entry.payload.environmentId;
    const presentation = appAtomRegistry.get(
      environmentPresentations.presentationAtom(environmentId),
    );
    return (
      presentation?.connection.phase === "connected" &&
      appAtomRegistry.get(environmentShell.stateValueAtom(environmentId)).status === "live" &&
      appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId)
    );
  },
  deliver: async (entry, savePayload) => {
    let payload = { ...entry.payload, localAttachments: [...entry.payload.localAttachments] };
    const { environmentId } = payload;
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
    if (!config) throw new Error("Environment is not connected.");
    if (payload.pendingWorktree) {
      const refs = await command(fetchVcsRefs, {
        environmentId,
        input: { cwd: payload.pendingWorktree.projectCwd, limit: 100, refresh: true },
      });
      const baseBranch = resolveDefaultWorktreeBaseBranch(refs.refs);
      if (!refs.isRepo || !baseBranch)
        throw new Error(
          refs.isRepo
            ? "No default or current branch is available. Choose a base branch for this worktree."
            : "This project is not a Git repository. Choose Current checkout to start the task.",
        );
      const { pendingWorktree, ...resolved } = payload;
      const bootstrap = payload.input.bootstrap;
      payload = {
        ...resolved,
        input: {
          ...payload.input,
          bootstrap: {
            ...bootstrap,
            ...(bootstrap?.createThread
              ? { createThread: { ...bootstrap.createThread, branch: baseBranch } }
              : {}),
            prepareWorktree: { ...pendingWorktree, baseBranch },
            runSetupScript: true,
          },
        },
      };
      await savePayload(payload);
    }
    const supportsUploads = config.environment.capabilities.attachmentUploads === true;
    for (let index = 0; index < payload.localAttachments.length; index++) {
      let attachment = payload.localAttachments[index]!;
      if (attachment.uploaded) {
        const verified = await verifyPersistedAttachmentUpload({
          registry: appAtomRegistry,
          createAssetUrl: assetEnvironment.createUrl,
          environmentId,
          attachmentId: attachment.uploaded.id,
        });
        if (verified.status === "failed") throw verified.error;
        if (verified.status === "verified") continue;
        const { uploaded: _, ...remaining } = attachment;
        attachment = remaining;
        payload.localAttachments[index] = attachment;
        await savePayload(payload);
      }
      if (!supportsUploads) continue;
      if (attachment.type === "file") {
        const step = resolveThreadOutboxDispatchStep({
          deliveryAction: "send",
          fileAttachments: [attachment],
          serverConfig: {
            maxFileUploadBytes: config.environment.capabilities.fileAttachments?.maxUploadBytes,
          },
        });
        if (step.step === "restore") throw new Error(step.reason);
      }
      const uploaded = await uploadAttachment(environmentId, attachment);
      payload.localAttachments[index] = { ...attachment, uploaded };
      await savePayload(payload);
    }
    const local = payload.localAttachments;
    const attachments =
      local.length === 0
        ? payload.input.message.attachments
        : await Promise.all(
            local.map(async (attachment) => {
              if (attachment.uploaded) return attachment.uploaded;
              if (attachment.type !== "image")
                throw new Error("This server does not support file attachments.");
              if (attachment.bytes === null)
                throw new Error(`Attach '${attachment.name}' again before sending.`);
              return {
                type: "image" as const,
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                dataUrl: await readFileAsDataUrl(
                  new File([attachment.bytes], attachment.name, { type: attachment.mimeType }),
                ),
                ...(attachment.source && !("_tag" in attachment.source)
                  ? { source: attachment.source }
                  : {}),
              };
            }),
          );
    const context =
      local.length === 0
        ? payload.input.message.context
        : remapComposerContextAttachments(
            payload.input.message.context,
            local.map((attachment) => ({
              type: attachment.type,
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            })),
            attachments.map((attachment, index) => ({ id: attachment.id ?? local[index]!.id })),
          );
    const thread = appAtomRegistry
      .get(directThreadEnvironment.snapshotAtom(environmentId))
      ?.threads.find((candidate) => candidate.id === payload.input.threadId);
    const target = { environmentId };
    if (thread && !payload.input.bootstrap?.createThread) {
      if (payload.branch !== undefined && payload.branch !== thread.branch) {
        await command(directThreadEnvironment.updateMetadata, {
          ...target,
          input: {
            threadId: thread.id,
            commandId: CommandId.make(`${payload.input.commandId}:branch`),
            branch: payload.branch,
          },
        });
      }
      if (thread.runtimeMode !== payload.input.runtimeMode) {
        await command(directThreadEnvironment.setRuntimeMode, {
          ...target,
          input: {
            threadId: thread.id,
            commandId: CommandId.make(`${payload.input.commandId}:runtime`),
            runtimeMode: payload.input.runtimeMode,
          },
        });
      }
      if (thread.interactionMode !== payload.input.interactionMode) {
        await command(directThreadEnvironment.setInteractionMode, {
          ...target,
          input: {
            threadId: thread.id,
            commandId: CommandId.make(`${payload.input.commandId}:interaction`),
            interactionMode: payload.input.interactionMode,
          },
        });
      }
    }
    const liveConfig = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
    if (!liveConfig) throw new Error("Environment is not connected.");
    const supportsContext = liveConfig.environment.capabilities.inlineMessageContext === true;
    const { context: _, ...message } = payload.input.message;
    if (payload.compactBeforeSend && payload.compactAccepted !== true) {
      // Both IDs survive reconnects and retries, so acknowledgement loss cannot compact twice.
      await command(directThreadEnvironment.startTurn, {
        ...target,
        input: {
          commandId: CommandId.make(`${payload.input.commandId}:compact`),
          threadId: payload.input.threadId,
          message: {
            messageId: MessageId.make(`${payload.input.message.messageId}:compact`),
            role: "user",
            text: "/compact",
            attachments: [],
          },
          ...(payload.input.modelSelection ? { modelSelection: payload.input.modelSelection } : {}),
          runtimeMode: payload.input.runtimeMode,
          interactionMode: payload.input.interactionMode,
          dispatchMode: "queue",
        },
      });
      // Once the compact command is acknowledged, a failed prompt retry must not compact again.
      // If its acknowledgement was lost, this save never happens and the stable command ID
      // replays the original compact receipt on reconnect.
      payload = { ...payload, compactAccepted: true };
      await savePayload(payload);
    }
    await command(directThreadEnvironment.startTurn, {
      ...target,
      input: {
        ...payload.input,
        ...(payload.compactBeforeSend ? { dispatchMode: "queue" as const } : {}),
        message: {
          ...message,
          attachments,
          text:
            context && !supportsContext
              ? serializeLegacyContextMessage({ text: message.text, records: context.records })
              : message.text,
          ...(context && supportsContext ? { context } : {}),
        },
      },
    });
    if (payload.draftId) {
      const ref = scopeThreadRef(environmentId, payload.input.threadId);
      markPromotedDraftThreadByRef(ref);
      if (payload.background) finalizePromotedDraftThreadByRef(ref);
    }
  },
});

function prepareThreadOutboxTurn(target: {
  readonly environmentId: EnvironmentId;
  readonly input: StartThreadTurnInput;
  readonly localAttachments?: ReadonlyArray<typeof OutboxAttachment.Type>;
  readonly pendingWorktree?: OutboxTurn["pendingWorktree"];
  readonly branch?: string;
  readonly draftId?: DraftId;
  readonly background?: boolean;
  readonly compactBeforeSend?: boolean;
}) {
  const commandId = target.input.commandId ?? CommandId.make(randomUUID());
  const payload = decodeTurn({
    environmentId: target.environmentId,
    input: { ...target.input, commandId },
    localAttachments: target.localAttachments ?? [],
    ...(target.pendingWorktree ? { pendingWorktree: target.pendingWorktree } : {}),
    ...(target.compactBeforeSend ? { compactBeforeSend: true } : {}),
    ...(target.branch === undefined ? {} : { branch: target.branch }),
    ...(target.draftId === undefined ? {} : { draftId: target.draftId }),
    ...(target.background === undefined ? {} : { background: target.background }),
  });
  return {
    id: payload.input.message.messageId,
    scope: scopedThreadKey(scopeThreadRef(target.environmentId, target.input.threadId)),
    createdAt: target.input.createdAt ?? new Date().toISOString(),
    payload,
  };
}

export function enqueueThreadOutboxTurn(target: Parameters<typeof prepareThreadOutboxTurn>[0]) {
  return webThreadOutbox.enqueue(prepareThreadOutboxTurn(target));
}

export function enqueueThreadOutboxTurns(
  targets: ReadonlyArray<Parameters<typeof prepareThreadOutboxTurn>[0]>,
) {
  return webThreadOutbox.enqueueMany(targets.map(prepareThreadOutboxTurn));
}

/** Rejected thread creation needs fresh identifiers; uncertain sends cannot be edited. */
export async function replaceThreadOutboxTurn(entry: PendingThreadTurn, payload: OutboxTurn) {
  const threadId =
    entry.status === "failed" && payload.input.bootstrap?.createThread
      ? newThreadId()
      : payload.input.threadId;
  const compactBeforeSend =
    payload.compactBeforeSend === true &&
    threadId === entry.payload.input.threadId &&
    payload.input.modelSelection?.instanceId === entry.payload.input.modelSelection?.instanceId &&
    payload.input.message.text.trim().toLowerCase() !== "/compact";
  const { compactAccepted, ...payloadWithoutCompactAccepted } = payload;
  const changed = await webThreadOutbox.edit(
    entry.id,
    decodeTurn({
      ...payloadWithoutCompactAccepted,
      compactBeforeSend,
      ...(compactBeforeSend && compactAccepted === true ? { compactAccepted: true } : {}),
      input: { ...payload.input, threadId, commandId: CommandId.make(randomUUID()) },
    }),
    scopedThreadKey(scopeThreadRef(payload.environmentId, threadId)),
  );
  if (!changed) throw new Error("Delivery has already started. Reconnect to confirm the message.");
  if (threadId !== entry.payload.input.threadId && payload.draftId) {
    const draftId = DraftId.make(payload.draftId);
    const draft = useComposerDraftStore.getState().getDraftSession(draftId);
    if (draft) restoreFailedBackgroundDraftThread(draftId, draft, threadId);
  }
  return threadId !== entry.payload.input.threadId
    ? scopeThreadRef(payload.environmentId, threadId)
    : null;
}

export function useThreadOutbox() {
  return useSyncExternalStore(webThreadOutbox.subscribe, webThreadOutbox.getSnapshot);
}

export function usePendingThreadCreation(ref: ScopedThreadRef | null) {
  const scope = ref ? scopedThreadKey(ref) : null;
  const snapshot = useCallback(
    () =>
      webThreadOutbox
        .getSnapshot()
        .find(
          (entry) =>
            entry.scope === scope && entry.payload.input.bootstrap?.createThread !== undefined,
        ) ?? null,
    [scope],
  );
  return useSyncExternalStore(webThreadOutbox.subscribe, snapshot);
}

export function readPendingThreadCreation(ref: ScopedThreadRef) {
  const scope = scopedThreadKey(ref);
  return (
    webThreadOutbox
      .getSnapshot()
      .find(
        (entry) =>
          entry.scope === scope && entry.payload.input.bootstrap?.createThread !== undefined,
      ) ?? null
  );
}

export function useThreadOutboxLoaded() {
  return useSyncExternalStore(webThreadOutbox.subscribe, webThreadOutbox.isLoaded);
}

export async function clearThreadOutboxEnvironment(environmentId: EnvironmentId) {
  await webThreadOutbox.clearEnvironment(environmentId);
}
