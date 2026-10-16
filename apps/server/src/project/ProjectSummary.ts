import {
  PROJECT_SUMMARY_DESCRIPTION_MAX_LENGTH,
  type ProjectId,
  type ProjectSummary as ProjectSummaryValue,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectService from "./ProjectService.ts";

const README_NAMES = ["README.md", "readme.md", "Readme.md", "README"] as const;

function truncate(text: string): string {
  const max = PROJECT_SUMMARY_DESCRIPTION_MAX_LENGTH;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function plainMarkdown(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The README's first prose paragraph, skipping headings, badges, HTML and code. */
function firstReadmeParagraph(readme: string): string | null {
  const paragraph: string[] = [];
  let inFence = false;
  for (const raw of readme.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      if (paragraph.length > 0) break;
      continue;
    }
    if (inFence) continue;
    const prose =
      line === "" ||
      line.startsWith("#") ||
      line.startsWith("|") ||
      line.startsWith("---") ||
      line.startsWith("===") ||
      line.startsWith(">") ||
      /^[-*+] |^\d+\. /.test(line)
        ? ""
        : plainMarkdown(line);
    if (prose === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(prose);
  }
  return paragraph.length > 0 ? paragraph.join(" ") : null;
}

/** Prefers package.json's description, then the README's first paragraph. */
export function summarizeProject(input: {
  readonly packageJsonText: string | null;
  readonly readmeText: string | null;
}): ProjectSummaryValue {
  if (input.packageJsonText !== null) {
    try {
      const parsed: unknown = JSON.parse(input.packageJsonText);
      const description =
        typeof parsed === "object" && parsed !== null && "description" in parsed
          ? parsed.description
          : null;
      if (typeof description === "string" && description.trim() !== "") {
        return { description: truncate(description.trim()) };
      }
    } catch {
      // A broken package.json still leaves the README.
    }
  }
  const paragraph = input.readmeText === null ? null : firstReadmeParagraph(input.readmeText);
  return { description: paragraph === null ? null : truncate(paragraph) };
}

export class ProjectSummary extends Context.Service<
  ProjectSummary,
  {
    /** Never fails: a project without readable files has no description. */
    readonly describe: (projectId: ProjectId) => Effect.Effect<ProjectSummaryValue>;
  }
>()("supaterm/project/ProjectSummary") {}

export const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const read = (target: string) => fs.readFileString(target).pipe(Effect.orElseSucceed(() => null));

  const describe = Effect.fn("ProjectSummary.describe")(function* (projectId: ProjectId) {
    const project = yield* projects
      .getById(projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project)) return { description: null };
    const root = project.value.workspaceRoot;
    const packageJsonText = yield* read(path.join(root, "package.json"));
    let readmeText: string | null = null;
    for (const name of README_NAMES) {
      readmeText = yield* read(path.join(root, name));
      if (readmeText !== null) break;
    }
    return summarizeProject({ packageJsonText, readmeText });
  });

  return ProjectSummary.of({ describe });
});

export const layer = Layer.effect(ProjectSummary, make);
