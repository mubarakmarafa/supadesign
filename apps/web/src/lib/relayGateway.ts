import { createRelayCompanionControl, isRelayCompanion } from "./relayCompanion";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RelayGateway from "@supaterm/client-runtime/relay";

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const companion = createRelayCompanionControl();
    yield* Effect.addFinalizer(() => Effect.sync(() => companion.close()));
    const desktop = typeof window === "undefined" ? undefined : window.desktopBridge;
    return RelayGateway.layer({
      available: Boolean(desktop?.startRelay && desktop.stopRelay) || isRelayCompanion(),
      fetch: (input, init) => globalThis.fetch(input, init),
      open: async (address, relayUrl) => {
        if (desktop?.startRelay && desktop.stopRelay) {
          const origin = await desktop.startRelay(address, relayUrl);
          return {
            prepare: async () => origin,
            close: () => desktop.stopRelay!(address),
          };
        }
        if (!isRelayCompanion())
          throw new Error(
            "Run supaterm relay-client locally to connect this browser through the relay.",
          );
        const prepare = async () => {
          const resolved = await companion.request("open", address, relayUrl);
          if (!resolved) throw new Error("The companion did not return a relay origin.");
          const origin = new URL(resolved);
          if (
            origin.protocol !== "http:" ||
            origin.hostname !== "127.0.0.1" ||
            !origin.port ||
            origin.username ||
            origin.password
          )
            throw new Error("Invalid relay companion origin");
          return origin.origin;
        };
        return {
          prepare,
          close: async () => {
            await companion.request("close", address);
          },
        };
      },
    });
  }),
);
