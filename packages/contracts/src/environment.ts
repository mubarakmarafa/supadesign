import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  ForwardCompatibleOptional,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** Wire version for orchestration snapshots, streams, commands, and RPC payloads. */
export const ORCHESTRATION_PROTOCOL_VERSION = 2;
export const ORCHESTRATION_PROTOCOL_VERSION_TEXT = "2";
export const ORCHESTRATION_PROTOCOL_QUERY_PARAM = "orchestrationProtocol";
export const ORCHESTRATION_PROTOCOL_HEADER = "x-supaterm-orchestration-protocol";

export const ExecutionEnvironmentPlatformOs = Schema.Literals([
  "darwin",
  "linux",
  "windows",
  "unknown",
]);
export type ExecutionEnvironmentPlatformOs = typeof ExecutionEnvironmentPlatformOs.Type;

export const ExecutionEnvironmentPlatformArch = Schema.Literals(["arm64", "x64", "other"]);
export type ExecutionEnvironmentPlatformArch = typeof ExecutionEnvironmentPlatformArch.Type;

/**
 * The curated set of machine shapes and OS identities an environment can wear as its icon.
 * Servers detect one from the hardware they run on (`platform.machine`), and
 * the `environmentIcon` server setting lets a user pick one instead.
 */
export const ENVIRONMENT_MACHINE_KINDS = [
  "server",
  "cloud",
  "linux",
  "desktop",
  "laptop",
  "mac-mini",
  "mac-studio",
] as const;
export const EnvironmentMachineKind = Schema.Literals(ENVIRONMENT_MACHINE_KINDS);
export type EnvironmentMachineKind = typeof EnvironmentMachineKind.Type;
export const isEnvironmentMachineKind = Schema.is(EnvironmentMachineKind);

export const ExecutionEnvironmentPlatform = Schema.Struct({
  os: ExecutionEnvironmentPlatformOs,
  arch: ExecutionEnvironmentPlatformArch,
  /** Hardware shape detected at startup. Absent when the host gives no usable
      signal (containers, Windows, unknown DMI), on servers that predate it, or
      when a newer server names a kind this build cannot draw. */
  machine: ForwardCompatibleOptional(EnvironmentMachineKind),
});

/**
 * Where a new thread runs: the project's current checkout ("local") or a
 * fresh git worktree ("worktree"). Lives here (not settings.ts) so
 * orchestration contracts can reference it without an import cycle.
 */
export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

/**
 * How a new worktree populates git submodules: every nested level, only the
 * ones this repository declares, or not at all.
 */
export const WorktreeSubmodules = Schema.Literals(["recursive", "top-level", "none"]);
export type WorktreeSubmodules = typeof WorktreeSubmodules.Type;
export type ExecutionEnvironmentPlatform = typeof ExecutionEnvironmentPlatform.Type;

/** How a server can replace itself with another version when asked over RPC.
    "boot-service" restarts through the launcher-backed boot service.
    "desktop-app" means the supervising desktop app updated and relaunched
    itself, bringing the server back with it. */
export const ServerSelfUpdateMethod = Schema.Literals(["boot-service", "desktop-app"]);
export type ServerSelfUpdateMethod = typeof ServerSelfUpdateMethod.Type;

/** Proven ownership for a manual update; unknown installs omit this descriptor. */
export const ServerInstallation = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["npx", "pnpm-dlx", "bunx"]) }),
  Schema.Struct({ kind: Schema.Literal("npm-global"), prefix: TrimmedNonEmptyString }),
]);
export type ServerInstallation = typeof ServerInstallation.Type;

/** What update path a client should offer for a server: one of the RPC
    self-update methods above, or "desktop-managed" when the backend's
    version belongs to the Supaterm desktop app supervising it — updating the
    app on that machine is the only way to update the server. */
export const ServerSelfUpdateCapability = Schema.Literals(["boot-service", "desktop-managed"]);
export type ServerSelfUpdateCapability = typeof ServerSelfUpdateCapability.Type;

export const ExecutionEnvironmentCapabilities = Schema.Struct({
  /** Largest file a client may upload for a turn. */
  fileAttachments: Schema.optionalKey(
    Schema.Struct({
      maxUploadBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
  ),
  /** The update path clients should offer for this server. Absent on
      servers that must be relaunched manually (dev checkouts, Windows
      foreground runs). */
  serverSelfUpdate: Schema.optionalKey(ServerSelfUpdateCapability),
  /** Manual commands must update this install, not the host's default global prefix. */
  serverInstallation: ForwardCompatibleOptional(ServerInstallation),
  /** Server can stream self-update progress before acknowledging the
      restart. Clients fall back to server.updateServer when absent. */
  serverSelfUpdateProgress: Schema.optionalKey(Schema.Boolean),
  /** The desktop app supervising this server can be driven over RPC:
      server.updateServer runs its check -> download -> relaunch. Absent on
      servers the desktop app does not supervise, where clients tell the user
      to update the app on that machine. */
  desktopAppUpdate: Schema.optionalKey(Schema.Boolean),
});
export type ExecutionEnvironmentCapabilities = typeof ExecutionEnvironmentCapabilities.Type;

export const ExecutionEnvironmentDescriptor = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  platform: ExecutionEnvironmentPlatform,
  serverVersion: TrimmedNonEmptyString,
  orchestrationProtocolVersion: Schema.Int,
  relayEndpoint: Schema.optionalKey(Schema.String),
  relayUrl: Schema.optionalKey(Schema.String),
  capabilities: ExecutionEnvironmentCapabilities,
});
export type ExecutionEnvironmentDescriptor = typeof ExecutionEnvironmentDescriptor.Type;

export const RepositoryIdentityLocator = Schema.Struct({
  source: Schema.Literal("git-remote"),
  remoteName: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
});
export type RepositoryIdentityLocator = typeof RepositoryIdentityLocator.Type;

/**
 * The checkout's own remote when it names a different repository than the canonical one, such as
 * a fork that tracks its upstream. Clients group and label by it so a fork stays distinct from the
 * repository it forked, while pull request features keep the canonical identity.
 */
export const RepositoryOrigin = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RepositoryOrigin = typeof RepositoryOrigin.Type;

export const RepositoryIdentity = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  locator: RepositoryIdentityLocator,
  /** Repository browser URL resolved from the server's configured hosting account. */
  webUrl: Schema.optionalKey(TrimmedNonEmptyString),
  rootPath: Schema.optionalKey(TrimmedNonEmptyString),
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
  provider: Schema.optionalKey(TrimmedNonEmptyString),
  owner: Schema.optionalKey(TrimmedNonEmptyString),
  name: Schema.optionalKey(TrimmedNonEmptyString),
  origin: Schema.optionalKey(RepositoryOrigin),
});
export type RepositoryIdentity = typeof RepositoryIdentity.Type;

/** Key clients group checkouts by: a fork's own remote, otherwise the canonical repository. */
export function repositoryGroupingKeyOf(identity: RepositoryIdentity): string {
  return identity.origin?.canonicalKey ?? identity.canonicalKey;
}

/** Label clients show for a checkout's repository, matching `repositoryGroupingKeyOf`. */
export function repositoryGroupingDisplayNameOf(identity: RepositoryIdentity): string | undefined {
  return identity.origin
    ? (identity.origin.displayName ?? identity.origin.canonicalKey)
    : identity.displayName;
}

export const ScopedProjectRef = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export type ScopedProjectRef = typeof ScopedProjectRef.Type;

export const ScopedThreadRef = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type ScopedThreadRef = typeof ScopedThreadRef.Type;
