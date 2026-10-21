import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  THREAD_DECISION_SUGGESTIONS_MAX,
  ThreadId,
  type ThreadBriefList,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";

import * as ThreadBrief from "./ThreadBriefService.ts";

const projectId = ProjectId.make("project-1");
const card = ThreadId.make("thread-a");

const setup = (options?: {
  readonly seed?: string | null;
  readonly stored?: ReadonlyArray<ThreadBrief.StoredBrief>;
}) =>
  Effect.gen(function* () {
    let minute = 0;
    let nextId = 0;
    const saved: Array<ReadonlyArray<ThreadBrief.StoredBrief>> = [];
    const published: Array<ThreadBriefList> = [];
    const service = yield* ThreadBrief.make({
      projectOf: () => Effect.succeed(projectId),
      seedText: () => Effect.succeed(options?.seed ?? null),
      newId: Effect.sync(() => `decision-${++nextId}`),
      now: Effect.sync(() => `2026-10-21T10:${String(minute++).padStart(2, "0")}:00.000Z`),
      load: Effect.succeed(options?.stored ?? []),
      save: (briefs) => Effect.sync(() => void saved.push(briefs)),
    });
    yield* service.subscribe(projectId, (list) => Effect.sync(() => void published.push(list)));
    return { service, saved, published };
  });

const suggest = (service: ThreadBrief.ThreadBriefService["Service"], text: string) =>
  service.addDecision({ threadId: card, text, by: "agent" });

it.effect("keeps every brief the designer writes, so a pivot doesn't erase the old direction", () =>
  Effect.gen(function* () {
    const { service, published } = yield* setup();
    assert.isTrue(
      yield* service.setBrief({ threadId: card, text: "  A calm settings page ", by: "designer" }),
    );
    assert.isTrue(
      yield* service.setBrief({ threadId: card, text: "A dense power-user page", by: "designer" }),
    );
    // Writing the same brief again is not a new version.
    assert.isFalse(
      yield* service.setBrief({ threadId: card, text: "A dense power-user page", by: "designer" }),
    );
    const brief = yield* service.get(card);
    assert.strictEqual(brief?.brief?.text, "A dense power-user page");
    assert.strictEqual(brief?.brief?.version, 2);
    assert.deepStrictEqual(
      (yield* service.versions(card)).map((version) => version.text),
      ["A calm settings page", "A dense power-user page"],
    );
    assert.strictEqual(published.at(-1)?.[0]?.brief?.text, "A dense power-user page");
  }),
);

it.effect("clearing the brief keeps the cleared one", () =>
  Effect.gen(function* () {
    const { service, published } = yield* setup();
    yield* service.setBrief({ threadId: card, text: "First direction", by: "designer" });
    yield* service.setBrief({ threadId: card, text: "   ", by: "designer" });
    assert.strictEqual((yield* service.get(card))?.brief, null);
    assert.deepStrictEqual(
      (yield* service.versions(card)).map((version) => version.text),
      ["First direction", ""],
    );
    // A card with nothing to show drops out of the project's list.
    assert.deepStrictEqual(published.at(-1), []);
  }),
);

it.effect("agents can't write the brief", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    const error = yield* service
      .setBrief({ threadId: card, text: "My own direction", by: "agent" })
      .pipe(Effect.flip);
    assert.strictEqual(error.message, "Only the designer can change the brief.");
    assert.strictEqual(yield* service.get(card), null);
  }),
);

it.effect("starts an empty brief from the card's note, and never over one", () =>
  Effect.gen(function* () {
    const { service } = yield* setup({ seed: "  Redo the onboarding flow\n\nKeep it short " });
    yield* service.seedBrief(card);
    assert.strictEqual(
      (yield* service.get(card))?.brief?.text,
      "Redo the onboarding flow\n\nKeep it short",
    );
    const error = yield* service.seedBrief(card).pipe(Effect.flip);
    assert.strictEqual(error.message, "This card already has a brief.");
  }),
);

it.effect("has nothing to start from on a card without a note or message", () =>
  Effect.gen(function* () {
    const { service } = yield* setup({ seed: null });
    const error = yield* service.seedBrief(card).pipe(Effect.flip);
    assert.match(error.message, /no note or first message/);
  }),
);

it.effect("an agent's decision waits as a suggestion, and the designer's own is accepted", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    const suggested = yield* suggest(service, "Use a  single scrolling page");
    const own = yield* service.addDecision({
      threadId: card,
      text: "Keep the brand blue",
      by: "designer",
    });
    assert.strictEqual(suggested.status, "suggested");
    assert.strictEqual(suggested.text, "Use a single scrolling page");
    assert.strictEqual(own.status, "accepted");
    assert.deepStrictEqual(
      (yield* service.get(card))?.decisions.map((decision) => [decision.text, decision.status]),
      [
        ["Use a single scrolling page", "suggested"],
        ["Keep the brand blue", "accepted"],
      ],
    );
  }),
);

it.effect("accepting as written marks it accepted; in the designer's words, edited", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    const first = yield* suggest(service, "Tabs for each settings group");
    const second = yield* suggest(service, "Cards on the dashboard");
    const accepted = yield* service.acceptDecision({
      threadId: card,
      decisionId: first.id,
      by: "designer",
    });
    const edited = yield* service.acceptDecision({
      threadId: card,
      decisionId: second.id,
      text: "A list on the dashboard, not cards",
      by: "designer",
    });
    assert.strictEqual(accepted.status, "accepted");
    assert.strictEqual(accepted.text, "Tabs for each settings group");
    assert.strictEqual(edited.status, "edited");
    assert.strictEqual(edited.text, "A list on the dashboard, not cards");
  }),
);

it.effect("rewording the designer's own decision keeps it accepted", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    const own = yield* service.addDecision({ threadId: card, text: "Dark first", by: "designer" });
    const reworded = yield* service.acceptDecision({
      threadId: card,
      decisionId: own.id,
      text: "Dark mode first, light later",
      by: "designer",
    });
    assert.strictEqual(reworded.status, "accepted");
    assert.strictEqual(reworded.text, "Dark mode first, light later");
  }),
);

it.effect("agents can't accept, reject, or reword their own suggestions", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    const suggested = yield* suggest(service, "Use serif headings");
    const accept = yield* service
      .acceptDecision({ threadId: card, decisionId: suggested.id, by: "agent" })
      .pipe(Effect.flip);
    const reword = yield* service
      .acceptDecision({ threadId: card, decisionId: suggested.id, text: "Serif", by: "agent" })
      .pipe(Effect.flip);
    const reject = yield* service
      .rejectDecision({ threadId: card, decisionId: suggested.id, by: "agent" })
      .pipe(Effect.flip);
    assert.match(accept.message, /Only the designer can accept/);
    assert.match(reword.message, /Only the designer can accept/);
    assert.match(reject.message, /Only the designer/);
    assert.strictEqual((yield* service.get(card))?.decisions[0]?.status, "suggested");
  }),
);

it.effect(
  "a rejected suggestion drops out, can be brought back, and can't be suggested again",
  () =>
    Effect.gen(function* () {
      const { service, saved } = yield* setup();
      const suggested = yield* suggest(service, "Autoplay the hero video");
      yield* service.rejectDecision({ threadId: card, decisionId: suggested.id, by: "designer" });
      assert.deepStrictEqual((yield* service.get(card))?.decisions, []);
      // It is kept, only hidden.
      assert.isNotNull(saved.at(-1)?.[0]?.decisions[0]?.rejectedAt);

      const again = yield* suggest(service, "autoplay the hero video").pipe(Effect.flip);
      assert.match(again.message, /already turned this decision down/);

      yield* service.restoreDecision({ threadId: card, decisionId: suggested.id, by: "designer" });
      assert.deepStrictEqual(
        (yield* service.get(card))?.decisions.map((decision) => decision.status),
        ["suggested"],
      );
    }),
);

it.effect("a repeated suggestion returns the one already waiting", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    const first = yield* suggest(service, "Round the corners");
    const repeat = yield* suggest(service, "round the  corners");
    assert.strictEqual(repeat.id, first.id);
    assert.strictEqual((yield* service.get(card))?.decisions.length, 1);
  }),
);

it.effect("limits how many suggestions wait on the designer at once", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    for (let index = 0; index < THREAD_DECISION_SUGGESTIONS_MAX; index++) {
      yield* suggest(service, `Suggestion ${index}`);
    }
    const error = yield* suggest(service, "One too many").pipe(Effect.flip);
    assert.match(error.message, /already waiting on the designer/);
    // The designer can still add their own.
    const own = yield* service.addDecision({ threadId: card, text: "Mine", by: "designer" });
    assert.strictEqual(own.status, "accepted");
  }),
);

it.effect("restores briefs and decisions saved before a restart", () =>
  Effect.gen(function* () {
    const { service } = yield* setup({
      stored: [
        {
          threadId: card,
          projectId,
          versions: [
            { text: "Old", editedAt: "2026-10-20T10:00:00.000Z" },
            { text: "New", editedAt: "2026-10-20T11:00:00.000Z" },
          ],
          decisions: [],
        },
      ],
    });
    const brief = yield* service.get(card);
    assert.strictEqual(brief?.brief?.text, "New");
    assert.strictEqual(brief?.brief?.version, 2);
  }),
);

it.effect("tells the agent the brief and settled decisions, not waiting suggestions", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    yield* suggest(service, "Try a carousel");
    // Suggestions alone give the agent nothing to follow.
    assert.isNull(yield* service.turnContext(card));

    yield* service.setBrief({ threadId: card, text: "A calm settings page", by: "designer" });
    yield* service.addDecision({ threadId: card, text: "Use the 12px radius", by: "designer" });
    const context = yield* service.turnContext(card);
    assert.include(context?.text, "Brief:\nA calm settings page");
    assert.include(context?.text, "Decided:\n- Use the 12px radius");
    assert.notInclude(context?.text, "carousel");

    // Accepting the suggestion changes what the agent should know.
    const waiting = (yield* service.get(card))?.decisions.find(
      (decision) => decision.status === "suggested",
    );
    yield* service.acceptDecision({ threadId: card, decisionId: waiting!.id, by: "designer" });
    const after = yield* service.turnContext(card);
    assert.notStrictEqual(after?.version, context?.version);
    assert.include(after?.text, "- Try a carousel");
  }),
);

it.effect("tells the agent when the designer clears the brief", () =>
  Effect.gen(function* () {
    const { service } = yield* setup();
    yield* service.setBrief({ threadId: card, text: "A calm settings page", by: "designer" });
    const before = yield* service.turnContext(card);
    yield* service.setBrief({ threadId: card, text: "", by: "designer" });
    const cleared = yield* service.turnContext(card);
    assert.notStrictEqual(cleared?.version, before?.version);
    assert.include(cleared?.text, "cleared this card's brief");
  }),
);
