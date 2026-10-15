// @vitest-environment jsdom

import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@supaterm/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const watchCommand = vi.hoisted(() => vi.fn());

vi.mock("./ThreadDetailsPrRow", () => ({
  ThreadDetailsPrRow: ({
    number,
    onStopWatching,
  }: {
    number: number;
    onStopWatching?: () => void;
  }) => (
    <span
      data-row={String(number)}
      data-watched={onStopWatching ? "" : undefined}
      onClick={onStopWatching}
    />
  ),
}));
vi.mock("~/state/entities", () => ({ useProjects: () => [] }));
vi.mock("~/state/threads", () => ({ threadEnvironment: {} }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => watchCommand }));
vi.mock("~/lib/openPullRequestLink", () => ({
  parseChangeRequestUrl: () => null,
  findProjectOnChangeRequestHost: () => undefined,
}));

import { ThreadDetailsPrRows } from "./ThreadDetailsPrRows";

function link(
  number: number,
  headBranch: string,
  baseBranch: string,
  updatedAt: string,
): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "supabitapp/supacode-next",
    number,
    url: `https://github.com/supabitapp/supacode-next/pull/${number}`,
    source: "manual",
    linkedAt: updatedAt,
    snapshot: {
      state: "open",
      title: `Change ${number}`,
      headBranch,
      baseBranch,
      isDraft: false,
      updatedAt,
      syncedAt: updatedAt,
    },
    stack: null,
  };
}

const bottom = link(1, "layer-one", "main", "2026-01-01T00:00:10.000Z");
const top = link(2, "layer-two", "layer-one", "2026-01-01T00:00:20.000Z");
const other = link(3, "unrelated", "main", "2026-01-01T00:00:05.000Z");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(links: ReadonlyArray<ThreadPullRequestLink>, current: ThreadPullRequestLink) {
  act(() => {
    root.render(
      <ThreadDetailsPrRows
        threadRef={{
          environmentId: EnvironmentId.make("environment"),
          threadId: ThreadId.make("thread"),
        }}
        links={links}
        currentLink={current}
        onOpenLink={vi.fn()}
        environmentId={EnvironmentId.make("environment")}
        pr={null}
        number={current.number}
        reference={current}
        status={null}
        project={null}
        label={`#${current.number}`}
        openAriaLabel="Open pull request"
        onOpen={vi.fn()}
      />,
    );
  });
}

const rows = () =>
  Array.from(container.querySelectorAll("[data-row]"), (node) => node.getAttribute("data-row"));
const toggleButton = () => Array.from(container.querySelectorAll("button")).at(-1);
const toggleLabel = () => toggleButton()?.textContent;

async function toggle() {
  await act(async () => {
    toggleButton()!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

it("shows only the current pull request until the rest are asked for", async () => {
  render([other, bottom, top], top);
  expect(rows()).toEqual(["2"]);
  expect(toggleLabel()).toBe("Show 2 more");

  await toggle();
  expect(rows()).toEqual(["2", "1", "3"]);
  expect(toggleLabel()).toBe("Show less");

  await toggle();
  expect(rows()).toEqual(["2"]);
  expect(toggleLabel()).toBe("Show 2 more");
});

it("keeps the single row untouched when the thread links one pull request", () => {
  render([bottom], bottom);
  expect(rows()).toEqual(["1"]);
  expect(toggleLabel()).toBeUndefined();
});

it("lets only watched pull requests stop their watch", async () => {
  const watched: ThreadPullRequestLink = {
    ...bottom,
    watch: {
      startedAt: "2026-01-01T00:00:30.000Z",
      headSha: null,
      failedChecks: [],
      passed: false,
      passedChecks: [],
      remarksThrough: "2026-01-01T00:00:30.000Z",
      remarkIds: [],
      conflicting: false,
      wakes: 0,
    },
  };
  render([other, watched, top], top);
  await toggle();
  expect(
    Array.from(container.querySelectorAll("[data-watched]"), (node) =>
      node.getAttribute("data-row"),
    ),
  ).toEqual(["1"]);

  act(() => container.querySelector<HTMLElement>('[data-row="1"]')!.click());
  expect(watchCommand).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("environment"),
    input: {
      threadId: ThreadId.make("thread"),
      host: "github.com",
      repository: "supabitapp/supacode-next",
      number: 1,
      watching: false,
    },
  });
});
