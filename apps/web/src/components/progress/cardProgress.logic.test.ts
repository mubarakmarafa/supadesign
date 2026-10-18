import { describe, expect, it } from "vite-plus/test";

import { cardSummaryText, coverState } from "./cardProgress.logic";

const cover = { createdAt: "2026-10-19T10:00:00.000Z" };

describe("coverState", () => {
  it("trusts a cover taken after the agent last started", () => {
    expect(coverState({ capture: null }, cover, "2026-10-19T09:00:00.000Z")).toEqual({
      kind: "current",
    });
    expect(coverState({ capture: null }, cover, null)).toEqual({ kind: "current" });
  });

  it("marks a cover stale once the agent works again", () => {
    expect(coverState({ capture: null }, cover, "2026-10-19T10:05:00.000Z")).toEqual({
      kind: "stale",
    });
  });

  it("shows a failure only when it is newer than the cover", () => {
    const failed = (failedAt: string) => ({
      capture: { _tag: "failed" as const, reason: "Nothing is running.", failedAt },
    });
    expect(coverState(failed("2026-10-19T10:01:00.000Z"), cover, null)).toEqual({
      kind: "failed",
      reason: "Nothing is running.",
    });
    expect(coverState(failed("2026-10-19T09:59:00.000Z"), cover, null)).toEqual({
      kind: "current",
    });
  });
});

describe("cardSummaryText", () => {
  const summary = (source: "designer" | "agent" | "brief", text: string) => ({
    summary: { text, source, updatedAt: cover.createdAt },
  });

  it("prefers a written summary over the goal", () => {
    expect(cardSummaryText(summary("agent", "Nav done"), "Ship settings")).toBe("Nav done");
    expect(cardSummaryText(summary("designer", "Calmer"), "Ship settings")).toBe("Calmer");
  });

  it("prefers the goal over the first-message brief", () => {
    expect(cardSummaryText(summary("brief", "hey can you"), "Ship settings")).toBe("Ship settings");
    expect(cardSummaryText(summary("brief", "hey can you"), null)).toBe("hey can you");
    expect(cardSummaryText(undefined, null)).toBeNull();
  });
});
