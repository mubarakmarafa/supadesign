import {
  ChatAttachmentId,
  ProjectId,
  ThreadId,
  ThreadProgressError,
  ThreadProgressUpdate,
  ThreadSummary,
  ThreadProgressCaptureState,
  THREAD_PROGRESS_AGENT_INTERVAL_MS,
  type ChatImageAttachment,
  type OrchestrationV2DomainEvent,
} from "@supaterm/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { attachmentRelativePath, createAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as LiveEnvironment from "../liveEnvironment/LiveEnvironmentService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PreviewBrowser from "../preview/PreviewBrowser.ts";
import { forkParked } from "../serverActivation.ts";
import {
  describeScreenshotFailure,
  PROGRESS_VIEWPORT,
  screenshotPage,
} from "./progressScreenshot.ts";
import * as ThreadProgress from "./ThreadProgressService.ts";

/** Every thread's progress, kept across restarts in the server's state directory. */
const StoredProgress = Schema.Array(
  Schema.Struct({
    threadId: ThreadId,
    projectId: ProjectId,
    updates: Schema.Array(ThreadProgressUpdate),
    summary: Schema.NullOr(ThreadSummary),
    capture: Schema.NullOr(ThreadProgressCaptureState),
  }),
);
const decodeStoredProgress = Schema.decodeEffect(Schema.fromJsonString(StoredProgress));
const encodeStoredProgress = Schema.encodeEffect(Schema.fromJsonString(StoredProgress));

const failure = (message: string) => new ThreadProgressError({ message });

/** Pages the capture browser may open: web pages, never files or browser internals. */
const isWebUrl = (url: string) => {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const isTurnEnd = (event: OrchestrationV2DomainEvent) =>
  event.type === "run.updated" &&
  (event.payload.status === "completed" || event.payload.status === "interrupted");

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const liveEnvironments = yield* LiveEnvironment.LiveEnvironmentService;
  const previewBrowser = yield* PreviewBrowser.PreviewBrowser;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const progressPath = path.join(config.stateDir, "thread-progress.json");

  const projectOf = (threadId: ThreadId) =>
    projections.getThreadShell(threadId).pipe(
      Effect.mapError(() => failure("The card's thread could not be read.")),
      Effect.flatMap((shell) =>
        shell === null || shell.deletedAt !== null
          ? Effect.fail(failure("The card's thread no longer exists."))
          : Effect.succeed(shell.projectId),
      ),
    );

  const imagePath = (image: ChatImageAttachment) => {
    const relative = attachmentRelativePath(image);
    return relative === null ? null : path.join(config.attachmentsDir, relative);
  };

  const ops: ThreadProgress.ThreadProgressOps = {
    projectOf,

    pageOf: Effect.fn("ThreadProgress.pageOf")(function* (threadId: ThreadId) {
      const projectId = yield* projectOf(threadId);
      const live = (yield* liveEnvironments.list(projectId)).find(
        (snapshot) => snapshot.threadId === threadId,
      );
      if (live?.status === "ready" && live.url !== null) return live.url;
      return yield* failure(
        "This card has no running preview to capture. Make it the live card, or have its agent publish from its own dev server.",
      );
    }),

    screenshot: Effect.fn("ThreadProgress.screenshot")(function* (url: string) {
      if (!isWebUrl(url)) return yield* failure(`Only web pages can be captured, not ${url}.`);
      const executable = yield* previewBrowser.executable.pipe(
        Effect.mapError((error) =>
          failure(
            error._tag === "PreviewBrowserInstallingError"
              ? "Supadesign is still installing its capture browser. Try again in a minute."
              : "Supadesign's capture browser isn't available on this machine.",
          ),
        ),
      );
      const bytes = yield* Effect.tryPromise({
        try: () => screenshotPage(executable, url),
        catch: (cause) => failure(describeScreenshotFailure(url, cause)),
      }).pipe(
        Effect.timeoutOrElse({
          duration: "45 seconds",
          orElse: () => Effect.fail(failure(`${url} took too long to capture.`)),
        }),
      );
      return { bytes, mimeType: "image/jpeg", ...PROGRESS_VIEWPORT };
    }),

    storeImage: Effect.fn("ThreadProgress.storeImage")(function* ({
      threadId,
      screenshot,
    }: Parameters<ThreadProgress.ThreadProgressOps["storeImage"]>[0]) {
      const id = createAttachmentId(threadId);
      if (id === null) return yield* failure("The capture could not be saved.");
      const image: ChatImageAttachment = {
        type: "image",
        id: ChatAttachmentId.make(id),
        name: "progress.jpg",
        mimeType: screenshot.mimeType,
        sizeBytes: screenshot.bytes.byteLength,
      };
      const target = imagePath(image);
      if (target === null) return yield* failure("The capture could not be saved.");
      yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(
        Effect.andThen(fs.writeFile(target, screenshot.bytes)),
        Effect.mapError(() => failure("The capture could not be saved.")),
      );
      return image;
    }),

    deleteImage: (image) => {
      const target = imagePath(image);
      return target === null ? Effect.void : fs.remove(target).pipe(Effect.ignore);
    },

    newId: crypto.randomUUIDv4().pipe(Effect.orDie),
    nowMs: Clock.currentTimeMillis,

    load: fs.readFileString(progressPath).pipe(
      Effect.flatMap(decodeStoredProgress),
      Effect.orElseSucceed(() => []),
    ),

    save: (progress) =>
      encodeStoredProgress(progress).pipe(
        Effect.flatMap((text) => fs.writeFileString(progressPath, text)),
        Effect.tapError((error) => Effect.logInfo("Could not save thread progress", { error })),
        Effect.ignore,
      ),
  };

  const service = yield* ThreadProgress.make(ops);

  /** A card without a summary starts with its thread's first message as its brief. */
  const fillBrief = Effect.fn("ThreadProgress.fillBrief")(function* (threadId: ThreadId) {
    const current = yield* service.get(threadId);
    if (current?.summary != null) return;
    const records = yield* threads.getThreadRecords(threadId, ["messages"], {
      messageRoles: ["user"],
    });
    const first = records.messages.find(
      (message) => !message.streaming && message.text.trim().length > 0,
    );
    if (first === undefined) return;
    yield* service.setSummary({ threadId, text: first.text, source: "brief" });
  });

  /** After a turn on the live card, its cover follows the work, unless the agent just published. */
  const captureLiveCard = Effect.fn("ThreadProgress.captureLiveCard")(function* (
    threadId: ThreadId,
  ) {
    const projectId = yield* projectOf(threadId);
    const live = (yield* liveEnvironments.list(projectId)).find(
      (snapshot) => snapshot.threadId === threadId,
    );
    if (live?.status !== "ready" || live.url === null) return;
    const latest = (yield* service.get(threadId))?.updates.at(-1);
    const now = yield* Clock.currentTimeMillis;
    if (
      latest !== undefined &&
      now - Date.parse(latest.createdAt) < THREAD_PROGRESS_AGENT_INTERVAL_MS
    ) {
      return;
    }
    yield* service.capture({ threadId, source: "auto" });
  });

  const onTurnEnd = (threadId: ThreadId) =>
    Effect.all([fillBrief(threadId), captureLiveCard(threadId)], {
      concurrency: "unbounded",
      mode: "result",
    }).pipe(Effect.asVoid);

  yield* forkParked(
    threads.streamDomainEvents.pipe(
      Stream.filter(isTurnEnd),
      // A capture takes seconds; turns ending meanwhile queue behind it.
      Stream.runForEach((event) => onTurnEnd(event.threadId).pipe(Effect.ignore)),
    ),
  );

  return service;
});

export const layer = Layer.effect(ThreadProgress.ThreadProgressService, make);
