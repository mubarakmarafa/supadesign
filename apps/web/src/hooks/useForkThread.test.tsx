import { EnvironmentId, RunId, ThreadId } from "@supaterm/contracts";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useForkThread } from "./useForkThread";

const state = vi.hoisted(() => ({
  connected: true,
  permitted: true,
  fork: vi.fn(async (_input: unknown) => ({ _tag: "Success" })),
  ready: vi.fn(async (_ref: unknown) => true),
  navigate: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: state.connected ? "connected" : "disconnected" } }),
}));
vi.mock("../state/session", () => ({ useEnvironmentScope: () => state.permitted }));
vi.mock("../state/threads", () => ({ threadEnvironment: { forkFromRun: {} } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.fork }));
vi.mock("../state/entities", () => ({ waitForThreadShell: state.ready }));
vi.mock("../lib/utils", () => ({ newThreadId: () => "target" }));

const thread = {
  environmentId: EnvironmentId.make("ssh-environment"),
  id: ThreadId.make("current-fork"),
  title: "A conversation",
};
const source = { sourceThreadId: ThreadId.make("inherited-source"), runId: RunId.make("run") };
let renderer: ReactTestRenderer | null = null;
let action: ReturnType<typeof useForkThread>;

function Probe({ disabled }: { disabled: boolean }) {
  const result = useForkThread(thread, disabled);
  useEffect(() => {
    action = result;
  });
  return null;
}

async function render(disabled = false) {
  await act(() => {
    if (renderer) renderer.update(<Probe disabled={disabled} />);
    else renderer = create(<Probe disabled={disabled} />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.connected = true;
  state.permitted = true;
  state.fork.mockClear();
  state.ready.mockReset().mockResolvedValue(true);
  state.navigate.mockClear();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it("forks inherited history in the viewed environment and waits before navigation", async () => {
  await render();
  let resolveReady: (value: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
  });
  state.ready.mockReturnValueOnce(ready);
  await act(async () => {
    const pending = action.onForkFromRun(source);
    await action.onForkFromRun(source);
    expect(state.fork).toHaveBeenCalledTimes(1);
    expect(state.fork).toHaveBeenCalledWith({
      environmentId: thread.environmentId,
      input: { ...source, targetThreadId: "target", title: "A conversation fork" },
    });
    expect(state.navigate).not.toHaveBeenCalled();
    resolveReady(true);
    await pending;
  });
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: thread.environmentId, threadId: "target" },
  });
  expect(action.disabled).toBe(false);
});

it("does not submit when rewinding, disconnected, or without permission", async () => {
  for (const [disabled, connected, permitted] of [
    [true, true, true],
    [false, false, true],
    [false, true, false],
  ] as const) {
    state.connected = connected;
    state.permitted = permitted;
    await render(disabled);
    expect(action.disabled).toBe(true);
    await act(() => action.onForkFromRun(source));
  }
  expect(state.fork).not.toHaveBeenCalled();
});

it("reports a missing thread shell and lets the user retry after failure", async () => {
  await render();
  state.ready.mockResolvedValueOnce(false);
  await act(async () => {
    await expect(action.onForkFromRun(source)).rejects.toThrow("The fork was created");
  });
  expect(state.navigate).not.toHaveBeenCalled();
  expect(action.disabled).toBe(false);
  await act(() => action.onForkFromRun(source));
  expect(state.fork).toHaveBeenCalledTimes(2);
  expect(state.navigate).toHaveBeenCalledTimes(1);
});
