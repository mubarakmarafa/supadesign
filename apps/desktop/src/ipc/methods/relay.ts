import { RelayServerUrl } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DesktopRelayGateway } from "../../relay/DesktopRelayGateway.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";

export const startRelay = DesktopIpc.makeIpcMethod({
  channel: Channels.START_RELAY_CHANNEL,
  payload: Schema.Struct({ address: Schema.String, relayUrl: RelayServerUrl }),
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.relay.start")(function* ({ address, relayUrl }) {
    return yield* (yield* DesktopRelayGateway).start(address, relayUrl);
  }),
});
export const stopRelay = DesktopIpc.makeIpcMethod({
  channel: Channels.STOP_RELAY_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.relay.stop")(function* (address) {
    yield* (yield* DesktopRelayGateway).stop(address);
  }),
});
