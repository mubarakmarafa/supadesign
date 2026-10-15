import { relayHttpBaseUrl, relayPublicKey } from "@supaterm/shared/relay/protocol";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

export class RelayIdentity extends Context.Service<
  RelayIdentity,
  {
    readonly get: Effect.Effect<
      { readonly secret: Uint8Array; readonly address: string },
      ServerSecretStore.SecretStoreError
    >;
    readonly existing: Effect.Effect<
      Option.Option<{ readonly secret: Uint8Array; readonly address: string }>,
      ServerSecretStore.SecretStoreError
    >;
  }
>()("supaterm/relay/RelayIdentity") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const fromSecret = (secret: Uint8Array) => ({
    secret,
    address: relayHttpBaseUrl(relayPublicKey(secret)),
  });
  const get = yield* Effect.cached(
    secrets.getOrCreateRandom("relay-identity", 32).pipe(Effect.map(fromSecret)),
  );
  const existing = secrets.get("relay-identity").pipe(Effect.map(Option.map(fromSecret)));
  return RelayIdentity.of({ get, existing });
});

export const layer = Layer.effect(RelayIdentity, make);
