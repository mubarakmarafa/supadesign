import type { EnvironmentId } from "@supaterm/contracts";
import type { RemoteEnvironmentAuthError } from "../authorization/remote.ts";
import type { RelayTunnelFailure } from "@supaterm/shared/relay/protocol";
import {
  ConnectionBlockedError,
  type ConnectionAttemptError,
  ConnectionTransientError,
} from "./model.ts";

export function profileMissingError(connectionId: string): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connection profile ${connectionId} is unavailable.`,
  });
}

export function credentialMissingError(connectionId: string): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "authentication",
    detail: `Connection credential ${connectionId} is unavailable.`,
  });
}

export function environmentMismatchError(input: {
  readonly expected: EnvironmentId;
  readonly actual: EnvironmentId;
}): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connected environment ${input.actual} does not match ${input.expected}.`,
  });
}

export function mapRemoteEnvironmentError(
  error: RemoteEnvironmentAuthError,
): ConnectionAttemptError {
  switch (error._tag) {
    case "EnvironmentAuthInvalidError":
      return new ConnectionBlockedError({
        reason: "authentication",
        detail: "The environment credential is invalid.",
        traceId: error.traceId,
      });
    case "EnvironmentScopeRequiredError":
    case "EnvironmentOperationForbiddenError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: "The environment credential does not grant the required access.",
        traceId: error.traceId,
      });
    case "EnvironmentRequestInvalidError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment rejected the authentication request.",
        traceId: error.traceId,
      });
    case "EnvironmentResourceNotFoundError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment endpoint could not be found.",
        traceId: error.traceId,
      });
    case "RemoteEnvironmentAuthTimeoutError":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: error.message,
      });
    case "RemoteEnvironmentAuthFetchError":
      return new ConnectionTransientError({
        reason: "network",
        detail: error.message,
      });
    case "EnvironmentInternalError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "The environment could not authorize the connection.",
        traceId: error.traceId,
      });
    case "RemoteEnvironmentAuthUndeclaredStatusError":
      if (error.relayFailure !== undefined) return relayTunnelError(error.relayFailure);
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
      });
    case "RemoteEnvironmentAuthInvalidJsonError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
      });
  }
}

function relayTunnelError(failure: RelayTunnelFailure): ConnectionTransientError {
  switch (failure) {
    case "host-offline":
      return new ConnectionTransientError({
        reason: "endpoint-unavailable",
        detail: "The environment is offline. Make sure Supaterm is running on that computer.",
      });
    case "relay-busy":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "The relay is busy right now.",
      });
    case "relay-timeout":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: "The relay did not respond in time.",
      });
    case "relay-unreachable":
      return new ConnectionTransientError({
        reason: "network",
        detail: "The relay could not be reached.",
      });
  }
}
