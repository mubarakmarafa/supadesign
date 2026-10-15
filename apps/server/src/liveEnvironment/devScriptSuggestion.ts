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
