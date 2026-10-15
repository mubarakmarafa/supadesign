import type { ProviderDriverKind, ProviderInstanceId, ServerProvider } from "@supaterm/contracts";
import type * as Stream from "effect/Stream";
import type { ManagedServerProvider } from "@supaterm/provider-core/server/snapshot";

export type ProviderSnapshotSource = {
  readonly supportsReviewGuides?: boolean;
  /**
   * Routing key — uniquely identifies this instance in the aggregated
   * snapshot list. Two different snapshot sources may share the same
   * driver kind (multiple instances of the same driver).
   */
  readonly instanceId: ProviderInstanceId;
  /** Driver implementation kind. */
  readonly driverKind: ProviderDriverKind;
  readonly getSnapshot: ManagedServerProvider["getSnapshot"];
  readonly refresh: ManagedServerProvider["refresh"];
  readonly streamChanges: Stream.Stream<ServerProvider>;
};
