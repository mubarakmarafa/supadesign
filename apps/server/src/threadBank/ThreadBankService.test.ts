import { assert, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  ProjectId,
  ThreadBankError,
  ThreadId,
  type ChatAttachment,
  type ThreadBankList,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";

import * as ThreadBank from "./ThreadBankService.ts";

const projectId = ProjectId.make("project-1");
const card = ThreadId.make("thread-a");

const image = (id: string): ChatAttachment => ({
  type: "image",
  id: ChatAttachmentId.make(id),
  name: `${id}.png`,
  mimeType: "image/png",
  sizeBytes: 10,
});

const setup = (options?: {
  readonly stored?: ReadonlyArray<ThreadBank.StoredBank>;
  readonly sendFails?: boolean;
}) =>
  Effect.gen(function* () {
    const sent: Array<Parameters<ThreadBank.ThreadBankOps["send"]>[0]> = [];
    const saved: Array<ReadonlyArray<ThreadBank.StoredBank>> = [];
    let nextId = 0;
    const service = yield* ThreadBank.make({
      projectOf: () => Effect.succeed(projectId),
      // Claiming renames pending uploads into the thread.
      claim: ({ attachments, context }) =>
        Effect.succeed({
          attachments: attachments.map((attachment) => ({
            ...attachment,
            id: ChatAttachmentId.make(attachment.id.replace("pending", "claimed")),
          })),
          context,
        }),
      send: (input) =>
        options?.sendFails
          ? Effect.fail(new ThreadBankError({ message: "offline" }))
          : Effect.sync(() => void sent.push(input)),
      newEntryId: Effect.sync(() => `entry-${++nextId}`),
      now: Effect.succeed("2026-10-16T00:00:00.000Z"),
      load: Effect.succeed(options?.stored ?? []),
      save: (banks) => Effect.sync(() => void saved.push(banks)),
    });
    return { service, sent, saved };
  });

const entryTexts = (service: ThreadBank.ThreadBankService["Service"]) =>
  service.get(card).pipe(Effect.map((entries) => entries.map((entry) => entry.text)));

it.effect("banks messages without sending and claims their attachments", () =>
  Effect.gen(function* () {
    const { service, sent, saved } = yield* setup();
    yield* service.add({ threadId: card, text: "Make the header calmer", attachments: [] });
    const entry = yield* service.add({
      threadId: card,
      text: "",
      attachments: [image("pending-1")],
    });
    assert.deepStrictEqual(
      entry.attachments.map((attachment) => attachment.id),
      ["claimed-1"],
    );
    assert.deepStrictEqual(yield* entryTexts(service), ["Make the header calmer", ""]);
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(saved.at(-1)?.[0]?.entries.length, 2);
  }),
);

it.effect("refuses an empty entry", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    const result = yield* service
      .add({ threadId: card, text: "   ", attachments: [] })
      .pipe(Effect.flip);
    assert.strictEqual(result.message, "There's nothing to bank.");
  }),
);

it.effect("sends every entry as one message in order, then empties the bank", () =>
  Effect.gen(function* () {
    const { service, sent } = yield* setup();
    yield* service.add({ threadId: card, text: "First", attachments: [image("pending-1")] });
    yield* service.add({ threadId: card, text: "Second", attachments: [image("pending-2")] });
    assert.isTrue(yield* service.send(card));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0]?.text, "First\n\nSecond");
    assert.deepStrictEqual(
      sent[0]?.attachments.map((attachment) => attachment.id),
      ["claimed-1", "claimed-2"],
    );
    assert.deepStrictEqual(yield* service.get(card), []);
    assert.isFalse(yield* service.send(card));
  }),
);

it.effect("keeps the bank when sending fails", () =>
  Effect.gen(function* () {
    const { service } = yield* setup({ sendFails: true });
    yield* service.add({ threadId: card, text: "Keep me", attachments: [] });
    yield* service.send(card).pipe(Effect.flip);
    assert.deepStrictEqual(yield* entryTexts(service), ["Keep me"]);
  }),
);

it.effect("edits, reorders, and removes entries", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    const a = yield* service.add({ threadId: card, text: "A", attachments: [] });
    const b = yield* service.add({ threadId: card, text: "B", attachments: [] });
    const c = yield* service.add({ threadId: card, text: "C", attachments: [] });
    yield* service.reorder({ threadId: card, entryId: c.id, beforeEntryId: a.id });
    assert.deepStrictEqual(yield* entryTexts(service), ["C", "A", "B"]);
    yield* service.reorder({ threadId: card, entryId: c.id, beforeEntryId: null });
    assert.deepStrictEqual(yield* entryTexts(service), ["A", "B", "C"]);
    yield* service.update({ threadId: card, entryId: b.id, text: "B, revised", attachments: [] });
    yield* service.remove({ threadId: card, entryId: a.id });
    assert.deepStrictEqual(yield* entryTexts(service), ["B, revised", "C"]);
    // Clearing an entry's content removes it.
    yield* service.update({ threadId: card, entryId: c.id, text: "", attachments: [] });
    assert.deepStrictEqual(yield* entryTexts(service), ["B, revised"]);
  }),
);

it.effect("restores stored banks and tells subscribers about changes", () =>
  Effect.gen(function* () {
    const { service } = yield* setup({
      stored: [
        {
          threadId: card,
          projectId,
          entries: [
            {
              id: "stored-1" as never,
              text: "From before the restart",
              attachments: [],
              createdAt: "2026-10-15T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    const seen: Array<ThreadBankList> = [];
    const unsubscribe = yield* service.subscribe(projectId, (list) =>
      Effect.sync(() => void seen.push(list)),
    );
    yield* service.add({ threadId: card, text: "New thought", attachments: [] });
    unsubscribe();
    yield* service.send(card);
    assert.deepStrictEqual(
      seen.map((list) => list[0]?.entries.map((entry) => entry.text)),
      [["From before the restart"], ["From before the restart", "New thought"]],
    );
  }),
);
