import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ComposerBannerStack } from "./ComposerBannerStack";

vi.mock("../ui/popover", () => ({
  Popover: "popover",
  PopoverTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, {}, children),
  PopoverPopup: "popup",
}));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/scroll-area", () => ({ ScrollArea: "div" }));

let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it("only offers notice details when the description cannot fit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resize = () => {};
  let mutate = () => {};
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        mutate = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: (entries: { target: unknown }[]) => void) {}
      observe(target: unknown) {
        resize = () => this.callback([{ target }]);
      }
      disconnect() {}
    },
  );
  let position = "static";
  vi.stubGlobal("getComputedStyle", () => ({ position }));
  let availableWidth = 200;
  const nested = { clientWidth: 100, scrollWidth: 80 };
  const text = {
    querySelectorAll: () => [nested],
    get clientWidth() {
      return (
        availableWidth -
        (renderer?.root.findAllByProps({ "aria-label": "Show notice details" }).length ? 28 : 0)
      );
    },
    scrollWidth: 80,
  };
  await act(() => {
    renderer = create(
      <ComposerBannerStack
        items={[
          {
            id: "usage",
            variant: "info",
            icon: null,
            title: "Usage limits",
            description: "OpenCode",
          },
        ]}
      />,
      {
        createNodeMock: (element) =>
          element.type === "span" ? text : element.type === "button" ? { offsetWidth: 24 } : null,
      },
    );
  });
  const details = () => renderer.root.findAllByProps({ "aria-label": "Show notice details" });
  expect(details()).toHaveLength(0);
  text.scrollWidth = 300;
  await act(() => resize());
  expect(details()).toHaveLength(1);
  availableWidth = 308;
  await act(() => resize());
  expect(details()).toHaveLength(0);
  text.scrollWidth = 80;
  await act(() => resize());
  expect(details()).toHaveLength(0);
  nested.scrollWidth = 500;
  await act(() => mutate());
  expect(details()).toHaveLength(1);
  nested.scrollWidth = 80;
  await act(() => mutate());
  expect(details()).toHaveLength(0);
  position = "absolute";
  await act(() => resize());
  expect(details()).toHaveLength(1);
  position = "static";
  await act(() => resize());
  expect(details()).toHaveLength(0);
});

describe("notice exits", () => {
  const notice = (id: string) => ({ id, variant: "info" as const, icon: null, title: id });
  const a = notice("a");
  const b = notice("b");
  const c = notice("c");
  let finishExits = () => {};

  async function mountStack(items: ComponentProps<typeof ComposerBannerStack>["items"]) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const finished = new Promise<void>((resolve) => {
      finishExits = resolve;
    });
    await act(() => {
      renderer = create(<ComposerBannerStack items={items} />, {
        createNodeMock: () => ({ getAnimations: () => [{ finished }] }),
      });
    });
  }

  const textOf = (node: ReactTestInstance): string =>
    node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
  const banners = () =>
    renderer.root
      .findAll((node) => node.type === "div" && node.props["data-slot"] === "composer-banner")
      .map((node) => [
        textOf(node),
        node.props["data-ending-style"] === ""
          ? "exiting"
          : node.props["data-enter"] === ""
            ? "entering"
            : "shown",
      ]);

  it("keeps a removed notice in its place until its exit finishes", async () => {
    await mountStack([a, b, c]);
    await act(() => renderer.update(<ComposerBannerStack items={[a, c]} />));
    expect(banners()).toEqual([
      ["b", "exiting"],
      ["c", "shown"],
      ["a", "shown"],
    ]);

    await act(async () => finishExits());
    expect(banners()).toEqual([
      ["c", "shown"],
      ["a", "shown"],
    ]);
  });

  it("raises the next notice only once the departing front has left", async () => {
    await mountStack([a, b]);
    await act(() => renderer.update(<ComposerBannerStack items={[b]} />));
    expect(banners()).toEqual([
      ["b", "shown"],
      ["a", "exiting"],
    ]);

    await act(async () => finishExits());
    expect(banners()).toEqual([["b", "entering"]]);
  });

  it("swaps the activity row without motion", async () => {
    const activity = {
      id: "activity",
      variant: "default" as const,
      priority: "activity" as const,
      content: "activity",
    };
    await mountStack([activity, a]);
    await act(() => renderer.update(<ComposerBannerStack items={[a]} />));
    expect(banners()).toEqual([["a", "shown"]]);
  });

  it("reports a dismissal at once and unmounts the notice after its exit", async () => {
    const onDismiss = vi.fn();
    await mountStack([{ ...notice("notice"), onDismiss }]);
    const dismiss = () =>
      renderer.root.find(
        (node) => node.type === "button" && node.props["aria-label"] === "Dismiss warning",
      );

    await act(() => dismiss().props.onClick());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(dismiss().props.disabled).toBe(true);

    await act(async () => finishExits());
    expect(renderer.toJSON()).toBeNull();
  });
});
