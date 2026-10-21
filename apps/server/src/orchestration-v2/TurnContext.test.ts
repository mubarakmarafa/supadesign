import { assert, it } from "@effect/vitest";
import { ThreadId } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import * as TurnContext from "./TurnContext.ts";

const threadId = ThreadId.make("thread:turn-context");

const withSource = Effect.gen(function* () {
  const service = yield* TurnContext.make;
  const version = yield* Ref.make<string | null>("v1");
  yield* service.register({
    key: "card-brief",
    read: () =>
      Ref.get(version).pipe(
        Effect.map((current) => (current === null ? null : { version: current, text: current })),
      ),
  });
  const turn = (freshNativeThread = false) => service.forTurn({ threadId, freshNativeThread });
  return { version, turn };
});

it.effect("sends context once it's delivered, and again only after it changes", () =>
  Effect.gen(function* () {
    const { version, turn } = yield* withSource;
    const first = yield* turn();
    assert.equal(first?.text, "v1");
    yield* first!.markDelivered;
    assert.isNull(yield* turn());
    yield* Ref.set(version, "v2");
    assert.equal((yield* turn())?.text, "v2");
  }),
);

it.effect("sends it again when the turn never started", () =>
  Effect.gen(function* () {
    const { turn } = yield* withSource;
    assert.equal((yield* turn())?.text, "v1");
    // No markDelivered: the provider never took the turn.
    assert.equal((yield* turn())?.text, "v1");
  }),
);

it.effect("sends it to a fresh provider session, which has seen nothing", () =>
  Effect.gen(function* () {
    const { turn } = yield* withSource;
    yield* (yield* turn())!.markDelivered;
    assert.equal((yield* turn(true))?.text, "v1");
  }),
);

it.effect("sends nothing for a thread without context", () =>
  Effect.gen(function* () {
    const { version, turn } = yield* withSource;
    yield* Ref.set(version, null);
    assert.isNull(yield* turn());
  }),
);
