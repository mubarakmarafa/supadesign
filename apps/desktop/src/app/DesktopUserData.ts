import type * as Path from "effect/Path";
import { APP_SLUG } from "@supaterm/shared/appIdentity";

// Supadesign keeps its own Electron profile so it never shares one with the official app.
export const userDataPath = (input: {
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
  readonly path: Path.Path;
}) =>
  input.path.join(
    input.appDataDirectory,
    input.isDevelopment ? `${APP_SLUG}-dev` : `${APP_SLUG}-v2`,
  );
