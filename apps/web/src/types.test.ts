import { describe, expect, it } from "vite-plus/test";

import { terminalSplitLayoutMatches } from "./types";

describe("terminalSplitLayoutMatches", () => {
  it("applies a layout only while it sizes exactly the given terminals", () => {
    expect(terminalSplitLayoutMatches({ a: 60, b: 40 }, ["b", "a"])).toBe(true);
    expect(terminalSplitLayoutMatches(undefined, ["a", "b"])).toBe(false);
    expect(terminalSplitLayoutMatches({ a: 60, b: 40 }, ["a", "b", "c"])).toBe(false);
    expect(terminalSplitLayoutMatches({ a: 60, c: 40 }, ["a", "b"])).toBe(false);
  });

  it("rejects sizes that would break the split, such as NaN persisted as null", () => {
    expect(terminalSplitLayoutMatches({ a: 100, b: 0 }, ["a", "b"])).toBe(false);
    expect(terminalSplitLayoutMatches(JSON.parse('{"a":50,"b":null}'), ["a", "b"])).toBe(false);
  });
});
