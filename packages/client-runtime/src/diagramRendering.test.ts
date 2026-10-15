import { MERMAID_ASCII_LIMITS } from "@supaterm/mermaid-ascii/limits";
import { describe, expect, it, vi } from "vite-plus/test";

import { createDiagramRenderer } from "./diagramRendering.ts";

describe("createDiagramRenderer", () => {
  it("coalesces identical requests and renders different sources in order", async () => {
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();
    const render = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const renderer = createDiagramRenderer(render);
    const firstResult = renderer.render("first");
    const duplicateResult = renderer.render("first");
    const secondResult = renderer.render("second");
    expect(firstResult).toBe(duplicateResult);
    expect(render.mock.calls).toEqual([["first"]]);
    first.resolve("first diagram");
    expect(await firstResult).toBe("first diagram");
    expect(render.mock.calls).toEqual([["first"], ["second"]]);
    second.resolve("second diagram");
    expect(await secondResult).toBe("second diagram");
    expect(await renderer.render("first")).toBe("first diagram");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("remembers source rejection and continues processing the queue", async () => {
    const render = vi.fn(async (source: string) => {
      if (source === "unsupported") return null;
      return "diagram";
    });
    const renderer = createDiagramRenderer(render);
    const failed = renderer.render("unsupported");
    const good = renderer.render("supported");
    expect(await failed).toBeNull();
    expect(await good).toBe("diagram");
    expect(await renderer.render("unsupported")).toBeNull();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("allows the same source to retry after a transient adapter failure", async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error("Worker unavailable"))
      .mockResolvedValue("diagram");
    const renderer = createDiagramRenderer(render);
    expect(await renderer.render("source")).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
    expect(await renderer.render("source")).toBe("diagram");
    expect(await renderer.render("source")).toBe("diagram");
    expect(render.mock.calls).toEqual([["source"], ["source"]]);
  });

  it("bounds pending work without retaining temporary queue saturation", async () => {
    const first = Promise.withResolvers<string>();
    const render = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("diagram");
    const renderer = createDiagramRenderer(render, { maxPending: 1 });
    const firstResult = renderer.render("first");
    expect(await renderer.render("second")).toBeNull();
    expect(renderer.render("first")).toBe(firstResult);
    first.resolve("first diagram");
    await firstResult;
    expect(await renderer.render("second")).toBe("diagram");
    expect(render.mock.calls).toEqual([["first"], ["second"]]);
  });

  it("evicts the least recently read result when the entry limit is reached", async () => {
    const render = vi.fn(async (source: string) => source);
    const renderer = createDiagramRenderer(render, { maxCacheEntries: 2 });
    await renderer.render("first");
    await renderer.render("second");
    await renderer.render("first");
    await renderer.render("third");
    await renderer.render("first");
    expect(render).toHaveBeenCalledTimes(3);
    await renderer.render("second");
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("counts source keys and results against the cache memory limit", async () => {
    const render = vi.fn(async (source: string) => source);
    const renderer = createDiagramRenderer(render, { maxCacheBytes: 16 });
    await renderer.render("aa");
    await renderer.render("bb");
    await renderer.render("cc");
    await renderer.render("bb");
    expect(render).toHaveBeenCalledTimes(3);
    await renderer.render("aa");
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("rejects oversized source before retaining or dispatching it", async () => {
    const render = vi.fn(async () => "diagram");
    const renderer = createDiagramRenderer(render);
    expect(await renderer.render("x".repeat(MERMAID_ASCII_LIMITS.sourceChars + 1))).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
});
