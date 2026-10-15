// @effect-diagnostics nodeBuiltinImport:off - Integration test exercises HTTP redirect behavior.
import * as NodeHttp from "node:http";
import { describe, expect, it } from "@effect/vitest";
import { ConnectionOnboarding } from "@supaterm/client-runtime/connection";
import { ClientCapabilities } from "@supaterm/client-runtime/platform";
import { layerRemoteHttpClient } from "@supaterm/client-runtime/rpc";
import { EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@supaterm/contracts";
import { buildPairingUrl } from "@supaterm/shared/remote";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

describe("pairing redirects", () => {
  it.effect("rejects a token-exchange redirect before another endpoint receives the token", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("redirect-test-environment");
      const requests: Array<string> = [];
      const server = yield* Effect.acquireRelease(
        Effect.callback<NodeHttp.Server>((resume) => {
          const listener = NodeHttp.createServer((request, response) => {
            const path = request.url ?? "/";
            requests.push(path);
            if (path === "/oauth/token") {
              response.writeHead(307, { location: "/capture" });
              response.end();
              return;
            }
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                environmentId,
                label: "Redirect test environment",
                platform: { os: "linux", arch: "x64" },
                serverVersion: "0.0.0-test",
                orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
                capabilities: { repositoryIdentity: true },
              }),
            );
          });
          listener.listen(0, "127.0.0.1", () => resume(Effect.succeed(listener)));
        }),
        (listener) =>
          Effect.promise(() => {
            listener.closeAllConnections();
            return new Promise<void>((resolve, reject) =>
              listener.close((error) => (error ? reject(error) : resolve())),
            );
          }),
      );
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing listener address");
      const error = yield* ConnectionOnboarding.preparePairingRegistration(
        {
          pairingUrl: buildPairingUrl(`http://127.0.0.1:${address.port}`, "code", {
            environmentId,
          }),
        },
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(ClientCapabilities.ClientPresentation, {
              metadata: { label: "Supaterm Test", deviceType: "desktop", os: "Test OS" },
            }),
            layerRemoteHttpClient(fetch),
          ),
        ),
        Effect.flip,
      );
      expect(error).toMatchObject({ _tag: "ConnectionTransientError" });
      expect(requests).toEqual(["/.well-known/supaterm/environment", "/oauth/token"]);
    }),
  );
});
