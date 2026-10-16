import type * as Path from "effect/Path";

export const userDataPath = (input: {
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
  readonly path: Path.Path;
}) => input.path.join(input.appDataDirectory, input.isDevelopment ? "supaterm-dev" : "supaterm-v2");
