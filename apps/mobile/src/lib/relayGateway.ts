import * as RelayGateway from "@supaterm/client-runtime/relay";

export const layer = RelayGateway.layer({
  fetch: (input, init) => globalThis.fetch(input, init),
  open: async (address, relayUrl) => {
    const { default: NativeRelay } = await import("../../modules/supaterm-relay-tunnel");
    return {
      prepare: async () => (await NativeRelay.start({ hostAddress: address, relayUrl })).origin,
      close: () => NativeRelay.stop(address),
    };
  },
});
