import {
  SUPATERM_PROJECT_FILE_NAME,
  type EnvironmentId,
  type SupatermProjectFile,
  type SupatermProjectFileScript,
} from "@supaterm/contracts";
import { parseSupatermProjectFile } from "@supaterm/shared/supatermProjectFile";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<SupatermProjectFileScript> = [];

export interface SupatermProjectFileState {
  /**
   * - `valid`: supaterm.json exists and decoded.
   * - `invalid`: supaterm.json exists but fails to decode (the server then ignores
   *   the whole file, including `iconPath` and every script).
   * - `missing`: no readable supaterm.json at the workspace root.
   * - `loading`: the file query has not settled yet.
   */
  status: "loading" | "missing" | "invalid" | "valid";
  /** The decoded file when status is `valid`, null otherwise. */
  file: SupatermProjectFile | null;
  scripts: ReadonlyArray<SupatermProjectFileScript>;
}

/**
 * Decoded state of the project's checked-in `supaterm.json`, including whether the
 * file exists but is broken — which the runtime otherwise swallows silently.
 */
export function useSupatermProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): SupatermProjectFileState {
  const query = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    SUPATERM_PROJECT_FILE_NAME,
    cwd !== null,
  );
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  return useMemo(() => {
    if (contents === null) {
      return {
        status: isPending ? "loading" : "missing",
        file: null,
        scripts: NO_SCRIPTS,
      } as const;
    }
    const file = parseSupatermProjectFile(contents);
    if (file === null) {
      return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
    }
    return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
  }, [contents, isPending]);
}

/**
 * Scripts declared in the project's checked-in `supaterm.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useSupatermProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<SupatermProjectFileScript> {
  return useSupatermProjectFileState(environmentId, cwd).scripts;
}
