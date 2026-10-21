import { assert, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  ProjectId,
  THREAD_PROGRESS_AGENT_INTERVAL_MS,
  THREAD_PROGRESS_MAX_UPDATES,
  ThreadId,
  ThreadProgressError,
  type ThreadProgressList,
} from "@supaterm/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import * as ThreadProgress from "./ThreadProgressService.ts";

const projectId = ProjectId.make("project-1");
const card = ThreadId.make("thread-a");
const LIVE_URL = "http://localhost:5173/";

const setup = (options?: {
  readonly stored?: ReadonlyArray<ThreadProgress.StoredProgress>;
  readonly pageMissing?: boolean;
}) =>
  Effect.gen(function* () {
    let now = Date.parse("2026-10-19T10:00:00.000Z");
    let nextId = 0;
    const deleted: Array<string> = [];
    const captured: Array<string> = [];
    const stored: Array<ThreadProgress.ProgressScreenshot> = [];
    const published: Array<ThreadProgressList> = [];
    let failNext: string | null = null;
    let holdScreenshot: Deferred.Deferred<void> | null = null;
    const service = yield* ThreadProgress.make({
      projectOf: () => Effect.succeed(projectId),
      pageOf: () =>
        options?.pageMissing
          ? Effect.fail(new ThreadProgressError({ message: "no live preview" }))
          : Effect.succeed(LIVE_URL),
      screenshot: (url) =>
        Effect.gen(function* () {
          if (holdScreenshot !== null) yield* Deferred.await(holdScreenshot);
          if (failNext !== null) {
            const message = failNext;
            failNext = null;
            return yield* new ThreadProgressError({ message });
          }
          captured.push(url);
          return { bytes: new Uint8Array(4), mimeType: "image/jpeg", width: 1280, height: 800 };
        }),
      storeImage: ({ screenshot }) =>
        Effect.sync(() => {
          stored.push(screenshot);
          return {
            type: "image" as const,
            id: ChatAttachmentId.make(`image-${++nextId}`),
            name: "progress.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 4,
          };
        }),
      deleteImage: (image) => Effect.sync(() => void deleted.push(image.id)),
      newId: Effect.sync(() => `update-${++nextId}`),
      nowMs: Effect.sync(() => now),
      load: Effect.succeed(options?.stored ?? []),
      save: () => Effect.void,
    });
    yield* service.subscribe(projectId, (list) => Effect.sync(() => void published.push(list)));
    return {
      service,
      deleted,
      captured,
      stored,
      published,
      advance: (ms: number) => {
        now += ms;
      },
      failNextCapture: (message: string) => {
        failNext = message;
      },
      hold: (gate: Deferred.Deferred<void> | null) => {
        holdScreenshot = gate;
      },
    };
  });

it.effect("captures the live preview and makes it the card's cover", () =>
  Effect.gen(function* () {
    const { service, captured, published } = yield* setup();
    const update = yield* service.capture({
      threadId: card,
      source: "agent",
      note: "  First pass at the   settings layout ",
      questions: ["Cards or a list?", "  "],
    });
    assert.deepStrictEqual(captured, [LIVE_URL]);
    assert.strictEqual(update.note, "First pass at the settings layout");
    assert.deepStrictEqual(update.questions, ["Cards or a list?"]);
    const progress = yield* service.get(card);
    assert.strictEqual(progress?.updates.at(-1)?.id, update.id);
    assert.strictEqual(progress?.capture, null);
    // Subscribers saw the capture start, then finish.
    assert.strictEqual(published.at(-2)?.[0]?.capture?._tag, "capturing");
    assert.strictEqual(published.at(-1)?.[0]?.updates.length, 1);
  }),
);

it.effect("captures the page an agent names instead of the live preview", () =>
  Effect.gen(function* () {
    const { service, captured } = yield* setup({ pageMissing: true });
    yield* service.capture({
      threadId: card,
      source: "agent",
      note: "Own server",
      url: "http://localhost:3001/",
    });
    assert.deepStrictEqual(captured, ["http://localhost:3001/"]);
  }),
);

it.effect("keeps the screen the designer captured without opening the page again", () =>
  Effect.gen(function* () {
    const { service, captured, stored } = yield* setup({ pageMissing: true });
    const update = yield* service.capture({
      threadId: card,
      source: "designer",
      screen: {
        dataUrl: "data:image/png;base64,AQID",
        width: 390,
        height: 844,
        url: "http://localhost:4318/cartridges",
      },
    });
    assert.deepStrictEqual(captured, []);
    assert.deepStrictEqual([...(stored[0]?.bytes ?? [])], [1, 2, 3]);
    assert.strictEqual(stored[0]?.mimeType, "image/png");
    assert.strictEqual(update.url, "http://localhost:4318/cartridges");
    assert.deepStrictEqual([update.width, update.height], [390, 844]);

    const refused = yield* service
      .capture({
        threadId: card,
        source: "designer",
        screen: { dataUrl: "data:text/html;base64,AQID", width: 1, height: 1, url: LIVE_URL },
      })
      .pipe(Effect.flip);
    assert.strictEqual(refused.message, "The captured screen isn't an image Supadesign can keep.");
    assert.strictEqual((yield* service.get(card))?.updates.length, 1);
  }),
);

it.effect("paces agent publishing, but never the designer", () =>
  Effect.gen(function* () {
    const { service, advance } = yield* setup();
    yield* service.capture({ threadId: card, source: "agent", note: "One" });
    advance(5_000);
    const refused = yield* service
      .capture({ threadId: card, source: "agent", note: "Two" })
      .pipe(Effect.flip);
    assert.include(refused.message, "25 seconds");
    yield* service.capture({ threadId: card, source: "designer" });
    advance(THREAD_PROGRESS_AGENT_INTERVAL_MS);
    yield* service.capture({ threadId: card, source: "agent", note: "Three" });
    const notes = (yield* service.get(card))?.updates.map((update) => update.note);
    assert.deepStrictEqual(notes, ["One", null, "Three"]);
  }),
);

it.effect("keeps the last cover and says why when a capture fails", () =>
  Effect.gen(function* () {
    const { service, failNextCapture } = yield* setup();
    yield* service.capture({ threadId: card, source: "designer" });
    failNextCapture(`Nothing is running at ${LIVE_URL}.`);
    yield* service.capture({ threadId: card, source: "designer" }).pipe(Effect.flip);
    const failed = yield* service.get(card);
    assert.strictEqual(failed?.updates.length, 1);
    assert.deepStrictEqual(
      failed?.capture?._tag === "failed" ? failed.capture.reason : null,
      `Nothing is running at ${LIVE_URL}.`,
    );
    yield* service.capture({ threadId: card, source: "designer" });
    assert.strictEqual((yield* service.get(card))?.capture, null);
  }),
);

it.effect("reports a card without a running page as a failed capture", () =>
  Effect.gen(function* () {
    const { service } = yield* setup({ pageMissing: true });
    const error = yield* service.capture({ threadId: card, source: "designer" }).pipe(Effect.flip);
    assert.strictEqual(error.message, "no live preview");
    assert.strictEqual((yield* service.get(card))?.capture?._tag, "failed");
  }),
);

it.effect("runs one capture per card at a time", () =>
  Effect.gen(function* () {
    const { service, hold } = yield* setup();
    const gate = yield* Deferred.make<void>();
    hold(gate);
    const first = yield* service
      .capture({ threadId: card, source: "designer" })
      .pipe(Effect.forkChild({ startImmediately: true }));
    const second = yield* service.capture({ threadId: card, source: "designer" }).pipe(Effect.flip);
    assert.include(second.message, "already running");
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(first);
    assert.strictEqual((yield* service.get(card))?.updates.length, 1);
  }),
);

it.effect("drops the oldest images past the limit", () =>
  Effect.gen(function* () {
    const { service, deleted } = yield* setup();
    for (let index = 0; index < THREAD_PROGRESS_MAX_UPDATES + 2; index++) {
      yield* service.capture({ threadId: card, source: "designer" });
    }
    const progress = yield* service.get(card);
    assert.strictEqual(progress?.updates.length, THREAD_PROGRESS_MAX_UPDATES);
    assert.strictEqual(deleted.length, 2);
    assert.isFalse(progress?.updates.some((update) => update.image.id === deleted[0]));
  }),
);

it.effect("removes an image and its file", () =>
  Effect.gen(function* () {
    const { service, deleted } = yield* setup();
    const update = yield* service.capture({ threadId: card, source: "designer" });
    yield* service.remove({ threadId: card, updateId: update.id });
    assert.deepStrictEqual(deleted, [update.image.id]);
    assert.strictEqual(yield* service.get(card), null);
  }),
);

it.effect("keeps the designer's summary over the agent's, and the agent's over the brief", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    const summary = () => service.get(card).pipe(Effect.map((progress) => progress?.summary));

    assert.isTrue(
      yield* service.setSummary({ threadId: card, text: "Redo settings", source: "brief" }),
    );
    assert.isTrue(
      yield* service.setSummary({
        threadId: card,
        text: "Settings as cards; nav done",
        source: "agent",
      }),
    );
    assert.isFalse(
      yield* service.setSummary({ threadId: card, text: "Redo settings", source: "brief" }),
    );
    yield* service.setSummary({ threadId: card, text: "Calmer settings", source: "designer" });
    assert.isFalse(
      yield* service.setSummary({ threadId: card, text: "Agent rewrite", source: "agent" }),
    );
    assert.strictEqual((yield* summary())?.text, "Calmer settings");

    // An empty designer summary hands the card back to the agent.
    yield* service.setSummary({ threadId: card, text: " ", source: "designer" });
    assert.strictEqual(yield* summary(), undefined);
    yield* service.setSummary({ threadId: card, text: "Agent again", source: "agent" });
    assert.strictEqual((yield* summary())?.source, "agent");
  }),
);

it.effect("forgets a capture left running by a restart", () =>
  Effect.gen(function* () {
    const { service } = yield* setup({
      stored: [
        {
          threadId: card,
          projectId,
          updates: [],
          summary: { text: "Brief", source: "brief", updatedAt: "2026-10-19T09:00:00.000Z" },
          capture: { _tag: "capturing", startedAt: "2026-10-19T09:00:00.000Z" },
        },
      ],
    });
    assert.strictEqual((yield* service.get(card))?.capture, null);
  }),
);
