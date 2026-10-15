import { AuthAccessWriteScope, EnvironmentHttpApi } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as RelayAccess from "./RelayAccess.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "relay",
  Effect.fnUntraced(function* (handlers) {
    const relay = yield* RelayAccess.RelayAccess;
    return handlers.handle("prepare", () =>
      requireEnvironmentScope(AuthAccessWriteScope).pipe(Effect.andThen(relay.prepare)),
    );
  }),
);
