import type { ServerConfig, ServerConfigStreamEvent } from "@supaterm/contracts";
import { withRelayAdvertisement } from "@supaterm/contracts";
import * as Option from "effect/Option";

export interface ServerConfigProjection {
  readonly config: ServerConfig;
  readonly latestEvent: ServerConfigStreamEvent;
  readonly source: "cache" | "live";
}

/**
 * Published themes and usage-limit sources are current machine state, so a
 * cache could restore a set the machine no longer reports.
 */
export function withoutEnvironmentThemes(config: ServerConfig): ServerConfig {
  if (config.environmentThemes === undefined && config.usageLimitSources === undefined) {
    return config;
  }
  const { environmentThemes: _themes, usageLimitSources: _sources, ...rest } = config;
  return rest;
}

export function applyServerConfigProjection(
  current: Option.Option<ServerConfigProjection>,
  event: ServerConfigStreamEvent,
): Option.Option<ServerConfigProjection> {
  switch (event.type) {
    case "snapshot": {
      // Wire snapshots never contain published themes or usage-limit sources.
      // Keep the previous sets until the server sends its authoritative events.
      const carriedThemes = Option.isSome(current)
        ? current.value.config.environmentThemes
        : undefined;
      const carriedSources = Option.isSome(current)
        ? current.value.config.usageLimitSources
        : undefined;
      return Option.some({
        config: {
          ...event.config,
          ...(carriedThemes === undefined ? {} : { environmentThemes: carriedThemes }),
          ...(carriedSources === undefined ? {} : { usageLimitSources: carriedSources }),
        },
        latestEvent: event,
        source: "live" as const,
      });
    }
    case "keybindingsUpdated":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          keybindings: event.payload.keybindings,
          issues: event.payload.issues,
        },
        latestEvent: event,
        source: "live",
      }));
    case "providerStatuses":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          providers: event.payload.providers,
        },
        latestEvent: event,
        source: "live",
      }));
    case "settingsUpdated":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          settings: event.payload.settings,
        },
        latestEvent: event,
        source: "live",
      }));
    case "relayAdvertisementUpdated":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          environment: withRelayAdvertisement(projection.config.environment, event.payload),
        },
        latestEvent: event,
        source: "live",
      }));
    case "environmentThemesUpdated":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          environmentThemes: event.payload.themes.length > 0 ? event.payload.themes : undefined,
        },
        latestEvent: event,
        source: "live",
      }));
    case "usageLimitSourcesUpdated":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          usageLimitSources: event.payload.sources.length > 0 ? event.payload.sources : undefined,
        },
        latestEvent: event,
        source: "live",
      }));
  }
}
