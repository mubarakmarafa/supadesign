import type * as Path from "effect/Path";

/** Select Electron's profile independently of the server's Supaterm home. */
export const userDataPath = (input: {
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
  readonly path: Path.Path;
}) => input.path.join(input.appDataDirectory, input.isDevelopment ? "supaterm-dev" : "supaterm-v2");
