import type { ThreadId } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** What a source wants the agent to know about a thread right now. */
export interface TurnContextEntry {
  /** Changes whenever `text` would; the agent is sent the text again only then. */
  readonly version: string;
  readonly text: string;
}

/**
 * A feature with standing direction for a thread's agent, such as a card's
 * brief. It is registered once and read at every turn start.
 */
export interface TurnContextSource {
  readonly key: string;
  readonly read: (threadId: ThreadId) => Effect.Effect<TurnContextEntry | null>;
}

export interface TurnContextForTurn {
  /** Placed ahead of the designer's message in what the provider receives. */
  readonly text: string;
  /** Call once the provider accepted the turn, so a failed start sends it again. */
  readonly markDelivered: Effect.Effect<void>;
}

/**
 * Sends standing context along with a thread's turns, for every provider. A
 * source's text goes to the agent when its version changes and again for a
 * fresh native session, so long-lived direction isn't repeated every turn and
 * the chat transcript stays as the designer wrote it. Delivery is tracked in
 * memory: after a restart each thread's context is sent once more.
 */
export class TurnContext extends Context.Service<
  TurnContext,
  {
    readonly register: (source: TurnContextSource) => Effect.Effect<void>;
    readonly forTurn: (input: {
      readonly threadId: ThreadId;
      /** The provider's session has no earlier turns, so it has seen nothing yet. */
      readonly freshNativeThread: boolean;
    }) => Effect.Effect<TurnContextForTurn | null>;
  }
>()("supaterm/orchestration-v2/TurnContext") {}

export const make = Effect.sync(() => {
  const sources = new Map<string, TurnContextSource>();
  const delivered = new Map<string, string>();
  const slotOf = (source: TurnContextSource, threadId: ThreadId) =>
    `${source.key}\u0000${threadId}`;

  return TurnContext.of({
    register: (source) =>
      Effect.sync(() => {
        sources.set(source.key, source);
      }),
    forTurn: ({ threadId, freshNativeThread }) =>
      Effect.gen(function* () {
        const pending: Array<{ readonly slot: string; readonly entry: TurnContextEntry }> = [];
        for (const source of sources.values()) {
          const entry = yield* source.read(threadId);
          if (entry === null) continue;
          const slot = slotOf(source, threadId);
          if (!freshNativeThread && delivered.get(slot) === entry.version) continue;
          pending.push({ slot, entry });
        }
        if (pending.length === 0) return null;
        return {
          text: pending.map(({ entry }) => entry.text).join("\n\n"),
          markDelivered: Effect.sync(() => {
            for (const { slot, entry } of pending) delivered.set(slot, entry.version);
          }),
        };
      }),
  });
});

export const layer = Layer.effect(TurnContext, make);
