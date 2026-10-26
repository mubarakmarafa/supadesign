// @effect-diagnostics nodeBuiltinImport:off - runs as a plain Node project script.
import * as NodeChildProcess from "node:child_process";

const preservedPaths = [
  "**/node_modules/",
  "**/node_modules/**",
  "**/.pnpm-store/",
  "**/.pnpm-store/**",
  "**/.env",
  "**/.env.*",
  "**/.supaterm/",
  "**/.supaterm/**",
  "**/.supacode/",
  "**/.supacode/**",
  "**/*.pem",
  "**/*.local",
  "**/.dev.vars*",
  "**/.mise/ports.env*",
  "**/fnox.local.toml",
  "**/fnox.*.local.toml",
];

const args = ["clean", "-fdX", ...preservedPaths.flatMap((path) => ["-e", `!${path}`])];

NodeChildProcess.execFileSync("git", args, { stdio: "inherit" });
