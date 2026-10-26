import { ProjectId, ThreadBriefError, ThreadDecision, ThreadId } from "@supaterm/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as TurnContext from "../orchestration-v2/TurnContext.ts";
import * as ThreadBank from "../threadBank/ThreadBankService.ts";
import * as ThreadBrief from "./ThreadBriefService.ts";

/**
 * Every card's brief history and decisions, kept across restarts in the
 * server's state directory. Rejected decisions and earlier briefs stay here
 * so a change of direction never erases the one before it.
 */
const StoredBriefs = Schema.Array(
  Schema.Struct({
    threadId: ThreadId,
    projectId: ProjectId,
    versions: Schema.Array(Schema.Struct({ text: Schema.String, editedAt: Schema.String })),
    decisions: Schema.Array(
      Schema.Struct({ ...ThreadDecision.fields, rejectedAt: Schema.NullOr(Schema.String) }),
    ),
  }),
);
const decodeStoredBriefs = Schema.decodeEffect(Schema.fromJsonString(StoredBriefs));
const encodeStoredBriefs = Schema.encodeEffect(Schema.fromJsonString(StoredBriefs));

const failure = (message: string) => new ThreadBriefError({ message });

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const banks = yield* ThreadBank.ThreadBankService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const briefsPath = path.join((yield* ServerConfig.ServerConfig).stateDir, "thread-briefs.json");

  const ops: ThreadBrief.ThreadBriefOps = {
    projectOf: (threadId) =>
      projections.getThreadShell(threadId).pipe(
        Effect.mapError(() => failure("The card's thread could not be read.")),
        Effect.flatMap((shell) =>
          shell === null || shell.deletedAt !== null
            ? Effect.fail(failure("The card's thread no longer exists."))
            : Effect.succeed(shell.projectId),
        ),
      ),

    // A started card's note was sent as its first message, so that comes first.
    seedText: Effect.fn("ThreadBrief.seedText")(function* (threadId: ThreadId) {
      const records = yield* threads
        .getThreadRecords(threadId, ["messages"], { messageRoles: ["user"] })
        .pipe(Effect.mapError(() => failure("The card's thread could not be read.")));
      const first = records.messages.find(
        (message) => !message.streaming && message.text.trim().length > 0,
      );
      if (first !== undefined) return first.text;
      const note = (yield* banks.get(threadId)).find((entry) => entry.text.trim().length > 0);
      return note?.text ?? null;
    }),

    newId: crypto.randomUUIDv4().pipe(Effect.orDie),
    now: Clock.currentTimeMillis.pipe(
      Effect.map((ms) => DateTime.formatIso(DateTime.makeUnsafe(ms))),
    ),

    load: fs.readFileString(briefsPath).pipe(
      Effect.flatMap(decodeStoredBriefs),
      Effect.orElseSucceed(() => []),
    ),

    save: (briefs) =>
      encodeStoredBriefs(briefs).pipe(
        Effect.flatMap((text) => fs.writeFileString(briefsPath, text)),
        Effect.tapError((error) => Effect.logInfo("Could not save card briefs", { error })),
        Effect.ignore,
      ),
  };

  return yield* ThreadBrief.make(ops);
});

/** A card's brief rides along with its agent's turns whenever it changes. */
export const layer = Layer.effect(
  ThreadBrief.ThreadBriefService,
  Effect.gen(function* () {
    const service = yield* make;
    const turnContext = yield* TurnContext.TurnContext;
    yield* turnContext.register({ key: "card-brief", read: service.turnContext });
    return service;
  }),
);
