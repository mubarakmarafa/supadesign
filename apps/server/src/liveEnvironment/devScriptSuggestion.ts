import type { LiveEnvironmentDevScriptSuggestion, ProjectScript } from "@supaterm/contracts";
import * as Schema from "effect/Schema";

const PackageJson = Schema.Struct({
  scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const decodePackageJson = Schema.decodeUnknownOption(Schema.fromJsonString(PackageJson));

/** package.json scripts that usually start a dev server, best first. */
const DEV_SCRIPT_NAMES = ["dev", "start", "serve", "preview"] as const;

function packageRunner(files: ReadonlySet<string>): (script: string) => string {
  if (files.has("pnpm-lock.yaml")) return (script) => `pnpm run ${script}`;
  if (files.has("yarn.lock")) return (script) => `yarn ${script}`;
  if (files.has("bun.lock") || files.has("bun.lockb")) return (script) => `bun run ${script}`;
  return (script) => `npm run ${script}`;
}

/**
 * Guesses the command that starts a project's dev server, so the user only
 * has to confirm it. `files` holds the names present in the project root.
 */
export function suggestDevScript(input: {
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly packageJsonText: string | null;
  readonly files: ReadonlySet<string>;
}): LiveEnvironmentDevScriptSuggestion {
  const action =
    input.scripts.find(
      (script) => script.previewUrl !== undefined && !script.runOnWorktreeCreate,
    ) ??
    input.scripts.find(
      (script) => script.icon === "play" && !script.runOnWorktreeCreate && !script.runOnSettle,
    );
  if (action !== undefined) {
    return {
      command: action.command,
      previewUrl: action.previewUrl ?? null,
      source: `the “${action.name}” action`,
    };
  }
  const packageJson =
    input.packageJsonText === null ? undefined : decodePackageJson(input.packageJsonText);
  const packageScripts =
    packageJson !== undefined && packageJson._tag === "Some"
      ? packageJson.value.scripts
      : undefined;
  const scriptName = DEV_SCRIPT_NAMES.find((name) => packageScripts?.[name] !== undefined);
  if (scriptName !== undefined) {
    return {
      command: packageRunner(input.files)(scriptName),
      previewUrl: null,
      source: "package.json",
    };
  }
  if (input.files.has("index.html")) {
    return { command: "npx --yes serve .", previewUrl: null, source: "index.html" };
  }
  return { command: null, previewUrl: null, source: null };
}

/** The dev server's URL, keeping the path from a configured preview URL. */
export function liveEnvironmentUrl(discoveredUrl: string, previewUrl: string | undefined): string {
  if (previewUrl === undefined) return discoveredUrl;
  try {
    const preview = new URL(previewUrl);
    const discovered = new URL(discoveredUrl);
    discovered.pathname = preview.pathname;
    discovered.search = preview.search;
    discovered.hash = preview.hash;
    return discovered.toString();
  } catch {
    return discoveredUrl;
  }
}

/** Repo files that show the model how a project runs, read when present. */
export const DEV_SCRIPT_CONTEXT_FILES = [
  "package.json",
  "README.md",
  "readme.md",
  "Makefile",
  "justfile",
  "Procfile",
  "docker-compose.yml",
  "compose.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "astro.config.mjs",
  "pyproject.toml",
  "requirements.txt",
  "manage.py",
  "Gemfile",
  "go.mod",
  "Cargo.toml",
  "deno.json",
  "supaterm.json",
  "index.html",
] as const;

/** Each file's share of the prompt; a README's opening says how to run it. */
export const DEV_SCRIPT_CONTEXT_FILE_MAX_CHARS = 4_000;

const UNSAFE_COMMAND =
  /\b(sudo|rm\s+-[a-z]*[rf]|git\s+(push|reset|clean|checkout|commit)|npm\s+publish|shutdown|reboot|mkfs|dd\s+if=)\b|\|\s*(ba|z)?sh\b|>\s*\/(?!dev\/null)/;

/** Rejects a model-picked command that does more than start a server. */
export function isAcceptableDevCommand(command: string): boolean {
  const trimmed = command.trim();
  return (
    trimmed !== "" &&
    trimmed.length <= 500 &&
    !trimmed.includes("\n") &&
    !UNSAFE_COMMAND.test(trimmed)
  );
}
