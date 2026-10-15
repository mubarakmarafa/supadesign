import { scopeThreadRef, scopedThreadKey } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { waitForAtomValue } from "../state/waitForAtomValue";
import { createThreadNavigation } from "./threadNavigation";

const first = scopeThreadRef(EnvironmentId.make("first-environment"), ThreadId.make("first"));
const second = scopeThreadRef(EnvironmentId.make("second-environment"), ThreadId.make("second"));
const registries: AtomRegistry.AtomRegistry[] = [];

afterEach(() => {
  for (const registry of registries) registry.dispose();
  registries.length = 0;
  vi.useRealTimers();
});

function makeHarness() {
  const registry = AtomRegistry.make();
  registries.push(registry);
  const state = Atom.family((_key: string) =>
    Atom.make<"pending" | "ready" | "missing">("pending"),
  );
  let location = { path: "/draft" };
  const navigate = vi.fn(async (ref: typeof first) => {
    location = { path: scopedThreadKey(ref) };
  });
  const navigation = createThreadNavigation({
    getLocation: () => location,
    isReady: (ref) => registry.get(state(scopedThreadKey(ref))) === "ready",
    waitForThread: async (ref, signal) => {
      const atom = state(scopedThreadKey(ref));
      const resolved = await waitForAtomValue({
        registry,
        atom,
        predicate: (value) => value !== "pending",
        signal,
      });
      return resolved && registry.get(atom) === "ready";
    },
    navigate,
  });
  return {
    navigation,
    navigate,
    setState: (ref: typeof first, value: "pending" | "ready" | "missing") =>
      registry.set(state(scopedThreadKey(ref)), value),
    navigateElsewhere: () => {
      location = { path: "/settings" };
    },
  };
}

describe("thread navigation", () => {
  it.each(["first", "second"])(
    "opens only the latest pending thread when %s becomes ready first",
    async (readyFirst) => {
      const h = makeHarness();
      const firstRequest = h.navigation.navigate(first);
      const secondRequest = h.navigation.navigate(second);
      if (readyFirst === "first") {
        h.setState(first, "ready");
        await firstRequest;
        expect(h.navigate).not.toHaveBeenCalled();
        h.setState(second, "ready");
      } else {
        h.setState(second, "ready");
        await secondRequest;
        h.setState(first, "ready");
      }
      await Promise.all([firstRequest, secondRequest]);
      expect(h.navigate).toHaveBeenCalledExactlyOnceWith(second);
    },
  );

  it("lets an existing thread replace an earlier pending navigation", async () => {
    const h = makeHarness();
    const firstRequest = h.navigation.navigate(first);
    h.setState(second, "ready");
    await h.navigation.navigate(second);
    h.setState(first, "ready");
    await firstRequest;
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith(second);
  });

  it("keeps the navigation pending through a slow launch", async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const result = h.navigation.navigate(first);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.navigate).not.toHaveBeenCalled();
    h.setState(first, "ready");
    await result;
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith(first);
  });

  it("does not navigate when the pending creation is rejected", async () => {
    const h = makeHarness();
    const result = h.navigation.navigate(first);
    h.setState(first, "missing");
    await result;
    h.setState(first, "ready");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("respects navigation outside the sidebar", async () => {
    const h = makeHarness();
    const result = h.navigation.navigate(first);
    h.navigateElsewhere();
    h.setState(first, "ready");
    await result;
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("cancels a pending navigation when its owner unmounts", async () => {
    const h = makeHarness();
    const result = h.navigation.navigate(first);
    h.navigation.cancel();
    await result;
    h.setState(first, "ready");
    expect(h.navigate).not.toHaveBeenCalled();
  });
});
