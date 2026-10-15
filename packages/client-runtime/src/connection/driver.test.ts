import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import { BearerConnectionProfile, type ConnectionRoute } from "./catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
} from "./model.ts";
import {
  connectOverRoutes,
  ROUTE_CHECK_TIMEOUT_MS,
  type EnvironmentConnectionLease,
} from "./driver.ts";

function route(id: string, host: string): ConnectionRoute {
  const httpBaseUrl = host.startsWith("https://") ? host : `http://${host}/`;
  const target = new BearerConnectionTarget({
    connectionId: id,
    environmentId: EnvironmentId.make("test"),
    label: "Test",
  });
  return {
    target,
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: id,
        environmentId: target.environmentId,
        label: target.label,
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      }),
    ),
  };
}
const lan = route("lan", "192.168.1.2:4389");
const tailnet = route("tailnet", "100.100.1.2:4389");
const relay = route(
  "relay",
  `https://${"11".repeat(16)}.${"22".repeat(16)}.relay.supaterm.invalid/`,
);
const entry = { ...lan, enabled: true, alternateRoutes: [tailnet] };
const lease = (route: ConnectionRoute) =>
  ({ prepared: { target: route.target } }) as EnvironmentConnectionLease;
const blocked = () =>
  new ConnectionBlockedError({ reason: "authentication", detail: "Token revoked" });
const transient = () =>
  new ConnectionTransientError({ reason: "transport", detail: "Network lost" });

describe("direct route connection attempts", () => {
  it.effect.each([[relay, lan] as const, [lan, relay, tailnet] as const])(
    "honors a saved relay preference ahead of a reachable direct route: %#",
    (routes) =>
      Effect.gen(function* () {
        const [first, ...rest] = routes;
        const attempted: ConnectionRoute[] = [];
        const result = yield* connectOverRoutes(
          { ...first, enabled: true, alternateRoutes: rest },
          (route) =>
            Effect.succeed(
              route.target === lan.target && first.target !== relay.target ? "silent" : "answered",
            ),
          (route) =>
            Effect.sync(() => {
              attempted.push(route);
              return lease(route);
            }),
        );
        expect(result.prepared.target).toEqual(relay.target);
        expect(attempted).toEqual([relay]);
      }),
  );

  it.effect("falls back from a manually preferred relay to a reachable direct route", () =>
    Effect.gen(function* () {
      const attempted: ConnectionRoute[] = [];
      const result = yield* connectOverRoutes(
        { ...relay, enabled: true, alternateRoutes: [lan] },
        () => Effect.succeed("answered"),
        (route) =>
          Effect.gen(function* () {
            attempted.push(route);
            if (route.target === relay.target) return yield* transient();
            return lease(route);
          }),
      );
      expect(result.prepared.target).toEqual(lan.target);
      expect(attempted).toEqual([relay, lan]);
    }),
  );

  it.effect.each([lan, tailnet])(
    "uses a preferred direct route without probing or opening relay: %#",
    (direct) =>
      Effect.gen(function* () {
        const checked: ConnectionRoute[] = [];
        const attempted: ConnectionRoute[] = [];
        const result = yield* connectOverRoutes(
          { ...direct, enabled: true, alternateRoutes: [relay] },
          (route) =>
            Effect.sync(() => {
              checked.push(route);
              return "answered" as const;
            }),
          (route) =>
            Effect.sync(() => {
              attempted.push(route);
              return lease(route);
            }),
        );
        expect(result.prepared.target).toEqual(direct.target);
        expect(checked).toEqual([direct]);
        expect(attempted).toEqual([direct]);
      }),
  );

  it.effect("does not let a silent direct check delay another direct answer before relay", () =>
    Effect.gen(function* () {
      const checked = yield* Deferred.make<void>();
      const attempted: ConnectionRoute[] = [];
      const publicRoute = route("public", "https://remote.example.test");
      const fiber = yield* connectOverRoutes(
        { ...lan, enabled: true, alternateRoutes: [tailnet, publicRoute, relay] },
        (route) => {
          if (route.target === lan.target)
            return Deferred.succeed(checked, undefined).pipe(Effect.as("answered" as const));
          if (route === tailnet) return Effect.never;
          return Effect.sleep(500).pipe(Effect.as("answered" as const));
        },
        (route) =>
          Effect.gen(function* () {
            attempted.push(route);
            if (route.target === lan.target) return yield* transient();
            return lease(route);
          }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(checked);
      yield* TestClock.adjust(500);
      expect(attempted).toEqual([lan, publicRoute]);
      expect((yield* Fiber.join(fiber)).prepared.target).toEqual(publicRoute.target);
    }),
  );

  it.effect("opens relay after the short direct check deadline", () =>
    Effect.gen(function* () {
      const checking = yield* Deferred.make<void>();
      const attempted: ConnectionRoute[] = [];
      const fiber = yield* connectOverRoutes(
        { ...lan, enabled: true, alternateRoutes: [relay] },
        () => Deferred.succeed(checking, undefined).pipe(Effect.andThen(Effect.never)),
        (route) =>
          Effect.sync(() => {
            attempted.push(route);
            return lease(route);
          }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(checking);
      yield* TestClock.adjust(ROUTE_CHECK_TIMEOUT_MS - 1);
      expect(attempted).toEqual([]);
      yield* TestClock.adjust(1);
      expect((yield* Fiber.join(fiber)).prepared.target).toEqual(relay.target);
      expect(attempted).toEqual([relay]);
    }),
  );

  it.effect("opens relay when direct routes are silent", () =>
    Effect.gen(function* () {
      const attempted: ConnectionRoute[] = [];
      const result = yield* connectOverRoutes(
        { ...lan, enabled: true, alternateRoutes: [tailnet, relay] },
        () => Effect.succeed("silent"),
        (route) =>
          Effect.sync(() => {
            attempted.push(route);
            return lease(route);
          }),
      );
      expect(result.prepared.target).toEqual(relay.target);
      expect(attempted).toEqual([relay]);
    }),
  );

  it.effect("still tries a silent direct route when relay fails", () =>
    Effect.gen(function* () {
      const attempted: ConnectionRoute[] = [];
      const result = yield* connectOverRoutes(
        { ...lan, enabled: true, alternateRoutes: [relay] },
        () => Effect.succeed("silent"),
        (route) =>
          Effect.gen(function* () {
            attempted.push(route);
            if (route.target === relay.target) return yield* transient();
            return lease(route);
          }),
      );
      expect(result.prepared.target).toEqual(lan.target);
      expect(attempted).toEqual([relay, lan]);
    }),
  );

  it.effect("closes failed direct resources before opening relay", () =>
    Effect.gen(function* () {
      const lifecycle: string[] = [];
      const result = yield* connectOverRoutes(
        { ...lan, enabled: true, alternateRoutes: [relay] },
        () => Effect.succeed("answered"),
        (route) =>
          Effect.gen(function* () {
            if (route.target === lan.target) {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  lifecycle.push("closed LAN");
                }),
              );
              return yield* blocked();
            }
            lifecycle.push("opened relay");
            return lease(route);
          }),
      );
      expect(result.prepared.target).toEqual(relay.target);
      expect(lifecycle).toEqual(["closed LAN", "opened relay"]);
    }),
  );

  it.effect("opens an answered fallback before a preferred route check times out", () =>
    Effect.gen(function* () {
      const checked = yield* Deferred.make<void>();
      const fiber = yield* connectOverRoutes(
        entry,
        (route) =>
          route.target === lan.target
            ? Effect.never
            : Deferred.succeed(checked, undefined).pipe(Effect.as("answered" as const)),
        (route) => Effect.succeed(lease(route)),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(checked);
      yield* TestClock.adjust(300);
      expect((yield* Fiber.join(fiber)).prepared.target).toEqual(tailnet.target);
    }),
  );

  it.effect(
    "keeps preference order when the preferred route answers shortly after a fallback",
    () =>
      Effect.gen(function* () {
        const checked = yield* Deferred.make<void>();
        const fiber = yield* connectOverRoutes(
          entry,
          (route) =>
            route.target === lan.target
              ? Effect.sleep(200).pipe(Effect.as("answered" as const))
              : Deferred.succeed(checked, undefined).pipe(Effect.as("answered" as const)),
          (route) => Effect.succeed(lease(route)),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(checked);
        yield* TestClock.adjust(200);
        expect((yield* Fiber.join(fiber)).prepared.target).toEqual(lan.target);
      }),
  );

  it.effect("skips an unreachable LAN and opens the reachable Tailscale route", () =>
    Effect.gen(function* () {
      const attempted: ConnectionRoute[] = [];
      const result = yield* connectOverRoutes(
        entry,
        (route) => Effect.succeed(route === tailnet ? "answered" : "silent"),
        (route) =>
          Effect.sync(() => {
            attempted.push(route);
            return lease(route);
          }),
      );
      expect(result.prepared.target).toEqual(tailnet.target);
      expect(attempted).toEqual([tailnet]);
    }),
  );

  it.effect("does not wait for a fallback probe after LAN connects", () =>
    Effect.gen(function* () {
      const result = yield* connectOverRoutes(
        entry,
        (route) => (route.target === lan.target ? Effect.succeed("answered") : Effect.never),
        (route) => Effect.succeed(lease(route)),
      );
      expect(result.prepared.target).toEqual(lan.target);
    }),
  );

  it.effect("closes failed route resources before trying the next route", () =>
    Effect.gen(function* () {
      const lifecycle: string[] = [];
      const result = yield* connectOverRoutes(
        entry,
        () => Effect.succeed("answered"),
        (route) =>
          Effect.gen(function* () {
            if (route.target === lan.target) {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  lifecycle.push("closed LAN");
                }),
              );
              return yield* blocked();
            }
            lifecycle.push("opened Tailscale");
            return lease(route);
          }),
      );
      expect(result.prepared.target).toEqual(tailnet.target);
      expect(lifecycle).toEqual(["closed LAN", "opened Tailscale"]);
    }),
  );

  it.effect("times out a stalled LAN setup and still reaches Tailscale", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const fiber = yield* connectOverRoutes(
        entry,
        () => Effect.succeed("answered"),
        (route) =>
          route.target === lan.target
            ? Effect.addFinalizer(() => Deferred.succeed(released, undefined)).pipe(
                Effect.andThen(Deferred.succeed(started, undefined)),
                Effect.andThen(Effect.never),
              )
            : Effect.succeed(lease(route)),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("15 seconds");
      expect((yield* Fiber.join(fiber)).prepared.target).toEqual(tailnet.target);
      yield* Deferred.await(released);
    }),
  );

  it.effect("tries a route that answers late before one that never answers", () =>
    Effect.gen(function* () {
      const attempted: ConnectionRoute[] = [];
      const checking = yield* Deferred.make<void>();
      const fiber = yield* connectOverRoutes(
        entry,
        (route) =>
          route === tailnet
            ? Effect.sleep("5 seconds").pipe(Effect.as("answered" as const))
            : Deferred.succeed(checking, undefined).pipe(Effect.andThen(Effect.never)),
        (route) =>
          Effect.sync(() => {
            attempted.push(route);
            return lease(route);
          }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(checking);
      yield* TestClock.adjust("5 seconds");
      expect((yield* Fiber.join(fiber)).prepared.target).toEqual(tailnet.target);
      expect(attempted).toEqual([tailnet]);
    }),
  );

  it.effect("retries silent routes after reachable routes reject authentication", () =>
    Effect.gen(function* () {
      const result = yield* connectOverRoutes(
        entry,
        (route) => Effect.succeed(route.target === lan.target ? "silent" : "answered"),
        (route) =>
          route.target === lan.target ? Effect.succeed(lease(route)) : Effect.fail(blocked()),
      );
      expect(result.prepared.target).toEqual(lan.target);
    }),
  );

  it.effect("reports transient failure when one path can recover", () =>
    Effect.gen(function* () {
      const result = yield* connectOverRoutes(
        entry,
        () => Effect.succeed("answered"),
        (route) => Effect.fail(route.target === lan.target ? transient() : blocked()),
      ).pipe(Effect.result);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ConnectionTransientError" },
      });
    }),
  );
});
