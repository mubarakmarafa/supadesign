import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vite-plus/test";

import { decodeBase64, relayEndpointId, relayPublicKey, signRelayChallenge } from "./protocol.ts";

describe("signRelayChallenge", () => {
  it("signs the challenge message the deployed relay verifies", () => {
    const secret = new Uint8Array(32).fill(9);
    const publicKey = relayPublicKey(secret);
    const nonce = "nonce-123";
    const message = new TextEncoder().encode(
      `supaterm-relay-v1\n${relayEndpointId(publicKey)}\n${nonce}`,
    );
    const signature = decodeBase64(signRelayChallenge(secret, nonce));
    expect(ed25519.verify(signature, message, publicKey)).toBe(true);
  });
});
