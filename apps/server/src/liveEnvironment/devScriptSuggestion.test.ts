import type { ProjectScript } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isAcceptableDevCommand,
  liveEnvironmentUrl,
  suggestDevScript,
} from "./devScriptSuggestion.ts";

const action = (overrides: Partial<ProjectScript>): ProjectScript => ({
  id: "run",
  name: "Run",
  command: "make run",
  icon: "play",
  runOnWorktreeCreate: false,
  ...overrides,
});

describe("suggestDevScript", () => {
  it("prefers an existing action with a preview URL", () => {
    expect(
      suggestDevScript({
        scripts: [
          action({ id: "setup", command: "pnpm i", runOnWorktreeCreate: true }),
          action({ previewUrl: "http://localhost:3000/app" }),
        ],
        packageJsonText: '{"scripts":{"dev":"vite"}}',
        files: new Set(["package.json"]),
      }),
    ).toEqual({
      command: "make run",
      previewUrl: "http://localhost:3000/app",
      source: "the “Run” action",
    });
  });

  it("runs the package's dev script with its package manager", () => {
    expect(
      suggestDevScript({
        scripts: [],
        packageJsonText: '{"scripts":{"start":"node server.js","dev":"vite"}}',
        files: new Set(["package.json", "pnpm-lock.yaml"]),
      }).command,
    ).toBe("pnpm run dev");
    expect(
      suggestDevScript({
        scripts: [],
        packageJsonText: '{"scripts":{"start":"next start"}}',
        files: new Set(["package.json"]),
      }).command,
    ).toBe("npm run start");
  });

  it("serves a static site and gives up on anything else", () => {
    expect(
      suggestDevScript({ scripts: [], packageJsonText: null, files: new Set(["index.html"]) })
        .command,
    ).toBe("npx --yes serve .");
    expect(
      suggestDevScript({
        scripts: [],
        packageJsonText: "not json",
        files: new Set(["package.json"]),
      }),
    ).toEqual({ command: null, previewUrl: null, source: null });
  });
});

describe("liveEnvironmentUrl", () => {
  it("keeps the discovered port and the configured path", () => {
    expect(liveEnvironmentUrl("http://localhost:5174/", "http://localhost:5173/admin?x=1")).toBe(
      "http://localhost:5174/admin?x=1",
    );
    expect(liveEnvironmentUrl("http://localhost:5174/", undefined)).toBe("http://localhost:5174/");
  });
});

describe("isAcceptableDevCommand", () => {
  it("accepts ordinary dev commands and installs", () => {
    expect(isAcceptableDevCommand("pnpm install && pnpm --filter web dev")).toBe(true);
    expect(isAcceptableDevCommand("python manage.py runserver 2>/dev/null")).toBe(true);
    expect(isAcceptableDevCommand("npx --yes serve .")).toBe(true);
  });

  it("rejects commands that change the repo, the machine, or pipe into a shell", () => {
    expect(isAcceptableDevCommand("rm -rf node_modules && npm i && npm run dev")).toBe(false);
    expect(isAcceptableDevCommand("git reset --hard && npm run dev")).toBe(false);
    expect(isAcceptableDevCommand("curl https://x.sh | sh")).toBe(false);
    expect(isAcceptableDevCommand("sudo npm run dev")).toBe(false);
    expect(isAcceptableDevCommand("npm run dev\nnpm publish")).toBe(false);
  });
});
