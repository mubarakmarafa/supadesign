import {
  CommandId,
  MessageId,
  ProjectId,
  ThreadBankEntry,
  ThreadBankError,
  ThreadId,
} from "@supaterm/contracts";
import { remapComposerContextAttachments } from "@supaterm/shared/composerContextReferences";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as AttachmentClaims from "../orchestration-v2/AttachmentClaims.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadMessageIntake from "../orchestration-v2/ThreadMessageIntake.ts";
import * as ThreadBank from "./ThreadBankService.ts";

/** Every non-empty bank, kept across restarts in the server's state directory. */
const StoredBanks = Schema.Array(
  Schema.Struct({
    threadId: ThreadId,
    projectId: ProjectId,
    entries: Schema.Array(ThreadBankEntry),
  }),
);
const decodeStoredBanks = Schema.decodeEffect(Schema.fromJsonString(StoredBanks));
const encodeStoredBanks = Schema.encodeEffect(Schema.fromJsonString(StoredBanks));

/** What an attachment-only bank says, since a message needs some text. */
const ATTACHMENT_ONLY_TEXT = "See the attached material.";

const failure = (message: string) => new ThreadBankError({ message });

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const banksPath = path.join((yield* ServerConfig.ServerConfig).stateDir, "thread-banks.json");
  // Claims and dispatch read these services per call, as client sends do.
  const services = yield* Effect.context<
    ServerConfig.ServerConfig | FileSystem.FileSystem | ThreadManagement.ThreadManagementService
  >();
  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);

  const ops: ThreadBank.ThreadBankOps = {
    projectOf: (threadId) =>
      projections.getThreadShell(threadId).pipe(
        Effect.mapError(() => failure("The card's thread could not be read.")),
        Effect.flatMap((shell) =>
          shell === null || shell.deletedAt !== null
            ? Effect.fail(failure("The card's thread no longer exists."))
            : Effect.succeed(shell.projectId),
        ),
      ),

    claim: ({ threadId, attachments, context }) =>
      AttachmentClaims.claimPendingAttachments({ threadId, attachments }).pipe(
        Effect.map((claimed) => ({
          attachments: claimed.attachments,
          context: remapComposerContextAttachments(context, attachments, claimed.attachments),
        })),
        Effect.mapError((error) => failure(error.message)),
        Effect.provide(services),
      ),

    send: ({ threadId, text, attachments, context }) =>
      Effect.gen(function* () {
        yield* ThreadMessageIntake.dispatchCommand({
          type: "message.dispatch",
          commandId: CommandId.make(yield* uuid),
          threadId,
          messageId: MessageId.make(yield* uuid),
          text: text.length > 0 ? text : ATTACHMENT_ONLY_TEXT,
          attachments,
          ...(context === undefined ? {} : { context }),
          dispatchMode: { type: "queue_after_active" },
          createdBy: "user",
          creationSource: "web",
        });
      }).pipe(
        Effect.tapError((error) => Effect.logWarning("Could not send a thread bank", { error })),
        Effect.mapError(() => failure("The banked messages couldn't be sent. Try again.")),
        Effect.provide(services),
      ),

    newEntryId: uuid,
    now: DateTime.now.pipe(Effect.map(DateTime.formatIso)),

    load: fs.readFileString(banksPath).pipe(
      Effect.flatMap(decodeStoredBanks),
      Effect.orElseSucceed(() => []),
    ),

    save: (banks) =>
      encodeStoredBanks(banks).pipe(
        Effect.flatMap((text) => fs.writeFileString(banksPath, text)),
        Effect.tapError((error) => Effect.logInfo("Could not save the thread banks", { error })),
        Effect.ignore,
      ),
  };

  return yield* ThreadBank.make(ops);
});

export const layer = Layer.effect(ThreadBank.ThreadBankService, make);
