import * as NodeFS from "node:fs";
import {
  createClientHandshake,
  acceptClientHandshake,
  relayPublicKey,
  relayHttpBaseUrl,
} from "../../../../../../../packages/shared/src/relay/protocol.ts";
const identitySecret = Uint8Array.from({ length: 32 }, (_, i) => i);
const clientSecret = Uint8Array.from({ length: 32 }, (_, i) => i + 32);
const hostSecret = Uint8Array.from({ length: 32 }, (_, i) => i + 64);
const identity = relayPublicKey(identitySecret);
const client = createClientHandshake(identity, () => clientSecret.slice(), 2);
const host = acceptClientHandshake(client.hello, identitySecret, () => hostSecret.slice());
const cipher = client.finish(host.welcome);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const plains = [
  new Uint8Array(),
  new TextEncoder().encode("Supaterm native tunnel"),
  Uint8Array.from({ length: 257 }, (_, i) => i % 251),
];
NodeFS.writeFileSync(
  new URL("vectors.json", import.meta.url),
  JSON.stringify(
    {
      identity: hex(identity),
      clientSecret: hex(clientSecret),
      address: relayHttpBaseUrl(identity),
      transcript: hex(
        Buffer.concat([
          Buffer.from("supaterm-tunnel-v2\n"),
          identity,
          Buffer.from(JSON.parse(client.hello).key, "base64url"),
          Buffer.from(JSON.parse(host.welcome).key, "base64url"),
        ]),
      ),
      hello: client.hello,
      welcome: host.welcome,
      records: plains.map((plain) => ({
        plain: hex(plain),
        client: hex(cipher.seal(plain)),
        host: hex(host.cipher.seal(plain)),
      })),
    },
    null,
    2,
  ) + "\n",
);
