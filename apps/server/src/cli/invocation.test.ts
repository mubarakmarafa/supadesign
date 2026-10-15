import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  formatCliCommand,
  resolveRootCliCommand,
  resolveServerInstallation,
} from "./invocation.ts";

it("formats package runner commands from their cache entry paths", () => {
  for (const [entryPath, expected] of [
    ["/home/theo/.npm/_npx/abc123/node_modules/supaterm/dist/bin.mjs", "npx supaterm serve"],
    [
      "C:\\Users\\theo\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\supaterm\\dist\\bin.mjs",
      "npx supaterm serve",
    ],
    [
      "/home/theo/.cache/pnpm/dlx/abc/node_modules/supaterm/dist/bin.mjs",
      "pnpm dlx supaterm serve",
    ],
    [
      "/home/theo/.local/share/pnpm/.pnpm/dlx/abc/node_modules/supaterm/dist/bin.mjs",
      "pnpm dlx supaterm serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\pnpm-cache\\dlx\\abc\\node_modules\\supaterm\\dist\\bin.mjs",
      "pnpm dlx supaterm serve",
    ],
    ["/home/theo/.bun/install/cache/supaterm@0.0.31/dist/bin.mjs", "bunx supaterm serve"],
    ["/tmp/bunx-1000-supaterm@latest/node_modules/supaterm/dist/bin.mjs", "bunx supaterm serve"],
    [
      "C:\\Users\\theo\\AppData\\Local\\Temp\\bunx-0-supaterm@latest\\node_modules\\supaterm\\dist\\bin.mjs",
      "bunx supaterm serve",
    ],
  ] as const) {
    assert.equal(formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }), expected);
  }
});

it("treats stable installs as direct invocations", () => {
  for (const entryPath of [
    "/usr/local/lib/node_modules/supaterm/dist/bin.mjs",
    "/home/theo/Code/work/supaterm/apps/server/dist/bin.mjs",
    "/home/theo/.supaterm/runtime/0.0.31/node_modules/supaterm/dist/bin.mjs",
    "",
  ]) {
    assert.equal(
      formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }),
      "supaterm serve",
    );
  }
});

it("re-suggests the prerelease channel only for prerelease builds", () => {
  for (const [version, expected] of [
    ["0.0.31-nightly.20260729", "npx supaterm@nightly serve"],
    ["0.0.31-preview.20260729.1", "npx supaterm@preview serve"],
    ["0.0.31-foo-preview.20260729.1", "npx supaterm serve"],
    ["0.0.31", "npx supaterm serve"],
  ] as const) {
    assert.equal(
      formatCliCommand({
        subcommand: "serve",
        entryPath: "/home/theo/.npm/_npx/abc123/node_modules/supaterm/dist/bin.mjs",
        version,
      }),
      expected,
    );
  }
});

it("formats serve suggestions to match the launching command", () => {
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/home/theo/.npm/_npx/abc/node_modules/supaterm/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "npx supaterm@nightly serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/tmp/bunx-1000-supaterm@latest/node_modules/supaterm/dist/bin.mjs",
      version: "0.0.31",
    }),
    "bunx supaterm serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/usr/local/lib/node_modules/supaterm/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "supaterm serve",
  );
});

it.layer(NodeServices.layer)("root CLI commands", (it) => {
  const rootCommand = (input: {
    readonly node: string;
    readonly entry: string;
    readonly path?: string;
    readonly env?: Record<string, string>;
    readonly executable?: boolean;
  }) =>
    resolveRootCliCommand("browser setup").pipe(
      Effect.provideService(HostProcess.ExecutablePath, input.node),
      Effect.provideService(HostProcess.Arguments, [input.node, input.entry]),
      Effect.provideService(HostProcess.IsExecutable, input.executable ?? false),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { PATH: input.path ?? "", ...input.env }),
    );

  const pathWithSupaterm = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const bin = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(path.join(bin, "supaterm"), "#!/bin/sh\n", { mode: 0o755 });
    return bin;
  });

  it.effect("keeps a user-installed Node reachable when the command runs under sudo", () =>
    Effect.gen(function* () {
      const npx = "/home/theo/.npm/_npx/abc/node_modules/supaterm/dist/bin.mjs";
      // sudo's secure_path already has a system Node.
      expect(yield* rootCommand({ node: "/usr/bin/node", entry: npx })).toBe(
        "sudo npx supaterm browser setup",
      );
      // nvm, fnm, and tarball installs are dropped by sudo's PATH reset.
      expect(
        yield* rootCommand({ node: "/home/theo/.nvm/versions/node/v24/bin/node", entry: npx }),
      ).toBe('sudo env "PATH=$PATH" npx supaterm browser setup');
      expect(
        yield* rootCommand({
          node: "/home/theo/.local/node/bin/node",
          entry: "/home/theo/.local/lib/node_modules/supaterm/dist/bin.mjs",
          path: yield* pathWithSupaterm,
        }),
      ).toBe('sudo env "PATH=$PATH" supaterm browser setup');
    }).pipe(Effect.scoped),
  );

  it.effect("runs the current script install when WSL has no global command or desktop shim", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const entry = path.join(root, "wsl runtime", "bin.mjs");
      yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
      yield* fs.writeFileString(entry, "");
      expect(yield* rootCommand({ node: "/opt/runtime/node", entry })).toBe(
        `sudo /opt/runtime/node '${entry}' browser setup`,
      );
      expect(
        yield* rootCommand({
          node: "/opt/runtime/electron",
          entry,
          env: { ELECTRON_RUN_AS_NODE: "1" },
        }),
      ).toBe(`sudo env ELECTRON_RUN_AS_NODE=1 /opt/runtime/electron '${entry}' browser setup`);
    }).pipe(Effect.scoped),
  );

  it.effect("names this install's launcher when supaterm is not on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const shim = path.join(home, ".local bin", "supaterm");
      yield* fs.makeDirectory(path.dirname(shim), { recursive: true });
      yield* fs.writeFileString(shim, "#!/bin/sh\n", { mode: 0o755 });
      const desktop = {
        node: "/tmp/.mount_Supatermabc/supaterm",
        entry: "/tmp/.mount_Supatermabc/resources/app.asar/apps/server/dist/bin.mjs",
        env: { SUPATERM_CLI_SHIM_PATH: shim },
      };

      expect(yield* rootCommand(desktop)).toBe(`sudo '${shim}' browser setup`);

      expect(yield* rootCommand({ ...desktop, path: yield* pathWithSupaterm })).toBe(
        'sudo env "PATH=$PATH" supaterm browser setup',
      );

      expect(
        yield* rootCommand({
          node: "/opt/supaterm/supaterm",
          entry: "/opt/supaterm/supaterm",
          executable: true,
        }),
      ).toBe("sudo /opt/supaterm/supaterm browser setup");

      expect(
        yield* rootCommand({
          ...desktop,
          env: { SUPATERM_CLI_SHIM_PATH: path.join(home, "gone") },
        }),
      ).toBe('sudo env "PATH=$PATH" supaterm browser setup');
    }).pipe(Effect.scoped),
  );
});

it.layer(NodeServices.layer)("manual server installation ownership", (it) => {
  it.effect("recognizes runner caches for both script and executable packages", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      for (const [relative, kind] of [
        ["npm/_npx/hash/node_modules/supaterm/dist/bin.mjs", "npx"],
        ["npm/_npx/hash/node_modules/@supabitapp/supaterm-linux-x64/supaterm", "npx"],
        ["pnpm/dlx/hash/node_modules/supaterm/dist/bin.mjs", "pnpm-dlx"],
        [".bun/install/cache/supaterm/dist/bin.mjs", "bunx"],
      ] as const) {
        const entry = path.join(root, relative);
        yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
        yield* fs.writeFileString(entry, "");
        const installation = yield* resolveServerInstallation.pipe(
          Effect.provideService(HostProcess.Arguments, ["node", entry]),
          Effect.provideService(HostProcess.ExecutablePath, entry),
          Effect.provideService(HostProcess.IsExecutable, entry.endsWith("/supaterm")),
        );
        expect(installation).toEqual({ kind });
      }
    }),
  );

  it.effect("requires the npm prefix's bin to point to the running package", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      const prefix = path.join(root, "bunx-tools");
      const packageRoot = path.join(prefix, "lib/node_modules/supaterm");
      const entry = path.join(packageRoot, "dist/bin.mjs");
      const globalBin = path.join(prefix, "bin/supaterm");
      yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
      yield* fs.makeDirectory(path.dirname(globalBin), { recursive: true });
      yield* fs.writeFileString(entry, "");
      yield* fs.writeFileString(
        path.join(packageRoot, "package.json"),
        '{"name":"supaterm","version":"0.0.45","bin":{"supaterm":"./dist/bin.mjs"}}',
      );
      const resolve = resolveServerInstallation.pipe(
        Effect.provideService(HostProcess.Arguments, ["node", entry]),
        Effect.provideService(HostProcess.IsExecutable, false),
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      expect(yield* resolve).toBeNull();
      yield* fs.symlink(entry, globalBin);
      expect(yield* resolve).toEqual({ kind: "npm-global", prefix });
      yield* fs.remove(globalBin);
      yield* fs.writeFileString(globalBin, "an unrelated supaterm command");
      expect(yield* resolve).toBeNull();
      expect(yield* resolve.pipe(Effect.provideService(HostProcess.Platform, "win32"))).toBeNull();
    }),
  );

  it.effect("proves the native executable belongs to the npm launcher", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      const prefix = path.join(root, "bunx-tools");
      const packageRoot = path.join(prefix, "lib/node_modules/supaterm");
      const launcher = path.join(packageRoot, "bin/supaterm.js");
      const entry = path.join(packageRoot, "node_modules/@supabitapp/supaterm-linux-x64/supaterm");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
      yield* fs.makeDirectory(path.join(prefix, "bin"));
      yield* fs.writeFileString(launcher, "");
      yield* fs.writeFileString(entry, "");
      yield* fs.writeFileString(
        path.join(packageRoot, "package.json"),
        '{"name":"supaterm","version":"0.0.45","bin":{"supaterm":"./bin/supaterm.js"},"optionalDependencies":{"@supabitapp/supaterm-linux-x64":"0.0.45"}}',
      );
      yield* fs.symlink(launcher, path.join(prefix, "bin/supaterm"));
      const resolve = resolveServerInstallation.pipe(
        Effect.provideService(HostProcess.ExecutablePath, entry),
        Effect.provideService(HostProcess.IsExecutable, true),
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      for (const [version, expected] of [
        ["0.0.44", null],
        ["0.0.45", { kind: "npm-global", prefix }],
      ]) {
        yield* fs.writeFileString(
          path.join(path.dirname(entry), "package.json"),
          `{"name":"@supabitapp/supaterm-linux-x64","version":"${version}"}`,
        );
        expect(yield* resolve).toEqual(expected);
      }
    }),
  );

  it.effect("leaves local, standalone, missing and unreadable installs unknown", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      for (const relative of [
        "project/node_modules/supaterm/dist/bin.mjs",
        "project/apps/server/dist/bin.mjs",
        ".supaterm/runtime/0.0.45/supaterm",
        "missing/dist/bin.mjs",
      ]) {
        const entry = path.join(root, relative);
        if (!relative.startsWith("missing")) {
          yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
          yield* fs.writeFileString(entry, "");
        }
        expect(
          yield* resolveServerInstallation.pipe(
            Effect.provideService(HostProcess.Arguments, ["node", entry]),
            Effect.provideService(HostProcess.IsExecutable, false),
          ),
        ).toBeNull();
      }
    }),
  );
});
