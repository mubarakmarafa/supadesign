import { describe, expect, it } from "vite-plus/test";

import { comparedUpdates, initialComparePair, pickForComparison } from "./progressCompare.logic";

// Oldest first, as a card's progress stores them.
const updates = [
  { id: "a", createdAt: "2026-10-21T09:00:00.000Z" },
  { id: "b", createdAt: "2026-10-21T10:00:00.000Z" },
  { id: "c", createdAt: "2026-10-21T11:00:00.000Z" },
];

describe("initialComparePair", () => {
  it("pairs the image on screen with the capture before it", () => {
    expect(initialComparePair(updates, "c")).toEqual(["b", "c"]);
    expect(initialComparePair(updates, undefined)).toEqual(["b", "c"]);
  });

  it("pairs the oldest image with the one after it", () => {
    expect(initialComparePair(updates, "a")).toEqual(["b", "a"]);
  });

  it("needs two images", () => {
    expect(initialComparePair(updates.slice(0, 1), "a")).toBeNull();
  });
});

describe("pickForComparison", () => {
  it("replaces the image picked longer ago", () => {
    expect(pickForComparison(["b", "c"], "a")).toEqual(["c", "a"]);
  });

  it("keeps the pair when an image already shown is picked", () => {
    const pair = ["b", "c"] as const;
    expect(pickForComparison(pair, "b")).toBe(pair);
  });
});

describe("comparedUpdates", () => {
  it("shows the earlier image first whatever the pick order", () => {
    expect(comparedUpdates(updates, ["c", "a"])?.map((update) => update.id)).toEqual(["a", "c"]);
  });

  it("has nothing to show once a compared image is removed", () => {
    expect(comparedUpdates(updates, ["a", "gone"])).toBeNull();
  });
});
