// @effect-diagnostics nodeBuiltinImport:off - identifies the synthetic Node HTTP socket.
import type { TunnelStream } from "@supaterm/shared/relay/tunnel";
import { TunnelSocket } from "@supaterm/shared/relay/tunnelNode";
import * as Context from "effect/Context";
import * as Cookies from "effect/http/Cookies";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

export class RelayIngress extends Context.Service<
  RelayIngress,
  {
    readonly accept: (stream: TunnelStream) => void;
  }
>()("supaterm/relay/RelayIngress") {}

export const isRelayedRequest = (request: HttpServerRequest.HttpServerRequest) =>
  request.source instanceof Object &&
  "socket" in request.source &&
  request.source.socket instanceof TunnelSocket;

export const isRelayPath = (pathname: string) =>
  pathname === "/ws" ||
  pathname.startsWith("/api/") ||
  pathname === "/oauth/token" ||
  pathname === "/.well-known/supaterm/environment";

export const layerPathGuard = HttpRouter.middleware(
  (app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!isRelayedRequest(request)) return yield* app;
      if (!isRelayPath(new URL(request.url, "http://relay").pathname))
        return HttpServerResponse.empty({ status: 404 });
      return (yield* app).pipe(
        HttpServerResponse.removeHeader("set-cookie"),
        HttpServerResponse.updateCookies(() => Cookies.empty),
      );
    }),
  { global: true },
);
