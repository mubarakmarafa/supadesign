// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import { APP_HOME_DIRECTORY_NAME } from "./appIdentity.ts";

export function resolveDefaultSupatermHome(
  homeDirectory: string,
  joinPath: (first: string, ...segments: string[]) => string = NodePath.join,
): string {
  return joinPath(homeDirectory, APP_HOME_DIRECTORY_NAME);
}
