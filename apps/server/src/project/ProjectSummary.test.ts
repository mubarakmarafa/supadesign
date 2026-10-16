import { describe, expect, it } from "vite-plus/test";

import { summarizeProject } from "./ProjectSummary.ts";

describe("summarizeProject", () => {
  it("prefers the package description", () => {
    expect(
      summarizeProject({
        packageJsonText: '{"description":" A tiny Game Boy emulator. "}',
        readmeText: "# Moby\n\nSomething else.",
      }),
    ).toEqual({ description: "A tiny Game Boy emulator." });
  });

  it("falls back to the README's first prose paragraph", () => {
    const readme = [
      "# Moby",
      "",
      "[![CI](https://x/badge.svg)](https://x)",
      "",
      "```sh",
      "npm i",
      "```",
      "",
      "Moby is a **Game Boy** emulator",
      "built for [the web](https://example.com).",
      "",
      "Second paragraph.",
    ].join("\n");
    expect(summarizeProject({ packageJsonText: '{"name":"moby"}', readmeText: readme })).toEqual({
      description: "Moby is a Game Boy emulator built for the web.",
    });
  });

  it("shortens long text at a word and gives up without sources", () => {
    const description = summarizeProject({
      packageJsonText: JSON.stringify({ description: "word ".repeat(100) }),
      readmeText: null,
    }).description;
    expect(description?.endsWith("word…")).toBe(true);
    expect(description?.length).toBeLessThanOrEqual(240);
    expect(summarizeProject({ packageJsonText: "not json", readmeText: "# Title only" })).toEqual({
      description: null,
    });
  });
});
