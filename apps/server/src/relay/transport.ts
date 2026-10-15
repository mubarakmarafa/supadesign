// @effect-diagnostics nodeBuiltinImport:off - relay WebSocket adapter owns native socket events.
import * as NodeCrypto from "node:crypto";
import WebSocket from "ws";
import * as Schema from "effect/Schema";
import {
  acceptClientHandshake,
  decodeBase64,
  encodeBase64,
  relayEndpointId,
  relayPublicKey,
  signRelayChallenge,
} from "@supaterm/shared/relay/protocol";
import {
  createTunnelSession,
  TUNNEL_MAX_PLAIN_BYTES,
  type TunnelSession,
  type TunnelStream,
} from "@supaterm/shared/relay/tunnel";
import { after, every } from "@supaterm/shared/relay/timer";

const ControlEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("challenge"), nonce: Schema.String }),
  Schema.Struct({ type: Schema.Literal("registered"), endpointId: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("incoming"),
    connectionId: Schema.String,
    token: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("closed"), connectionId: Schema.String }),
]);
const decodeControl = Schema.decodeUnknownSync(ControlEvent);
export type RelayHostState = "connecting" | "registered" | "superseded" | "stopped";

export function startRelayTransport(input: {
  readonly secret: Uint8Array;
  readonly relayUrl: string;
  readonly acceptStream: (stream: TunnelStream) => void;
  readonly onStatus?: (state: RelayHostState) => void;
  readonly retryBaseMs?: number;
  readonly scheduleRetry?: typeof after;
}) {
  const publicKey = relayPublicKey(input.secret);
  const endpointId = relayEndpointId(publicKey);
  const pairs = new Map<string, () => void>();
  let stopped = false;
  let control: WebSocket | undefined;
  let retry: (() => void) | undefined;
  let attempts = 0;

  const accept = (connectionId: string, token: string) => {
    if (pairs.size >= 64 || pairs.has(connectionId)) return;
    const params = new URLSearchParams({ endpointId, connectionId, token });
    const socket = new WebSocket(`${input.relayUrl}/v1/accept?${params}`, {
      handshakeTimeout: 10_000,
      maxPayload: TUNNEL_MAX_PLAIN_BYTES + 24,
      perMessageDeflate: false,
    });
    let session: TunnelSession | undefined;
    let closed = false;
    const stop = () => {
      if (closed) return;
      closed = true;
      cancelHandshake();
      session?.close();
      socket.terminate();
      pairs.delete(connectionId);
    };
    const cancelHandshake = after(15_000, stop);
    pairs.set(connectionId, stop);
    socket.on("error", stop);
    socket.on("close", stop);
    socket.on("message", (data, binary) => {
      if (closed) return;
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : data;
        if (session) {
          if (!binary) throw new Error("Unencrypted relay record");
          session.receive(bytes);
          return;
        }
        if (binary || bytes.length > 4096) throw new Error("Invalid relay handshake");
        const handshake = acceptClientHandshake(
          bytes.toString("utf8"),
          input.secret,
          NodeCrypto.randomBytes,
        );
        session = createTunnelSession({
          cipher: handshake.cipher,
          initiator: false,
          onStream: input.acceptStream,
          send: (message) => socket.send(message),
          onClose: stop,
        });
        cancelHandshake();
        socket.send(handshake.welcome);
      } catch {
        stop();
      }
    });
  };

  const connect = () => {
    if (stopped) return;
    input.onStatus?.("connecting");
    const socket = new WebSocket(
      `${input.relayUrl}/v1/control?publicKey=${encodeBase64(publicKey)}`,
      {
        handshakeTimeout: 10_000,
        maxPayload: 16_384,
        perMessageDeflate: false,
      },
    );
    control = socket;
    let registered = false;
    let challenged = false;
    let alive = true;
    const cancelReady = after(15_000, () => socket.terminate());
    const cancelHeartbeat = every(15_000, () => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    });
    socket.on("pong", () => {
      alive = true;
    });
    socket.on("error", () => socket.terminate());
    socket.on("close", (code) => {
      cancelReady();
      cancelHeartbeat();
      if (control !== socket || stopped) return;
      control = undefined;
      if (code === 4001) {
        stopped = true;
        input.onStatus?.("superseded");
        return;
      }
      retry = (input.scheduleRetry ?? after)(
        Math.min(30_000, (input.retryBaseMs ?? 1000) * 2 ** Math.min(attempts++, 5)) *
          (0.8 + NodeCrypto.randomInt(401) / 1000),
        connect,
      );
      input.onStatus?.("connecting");
    });
    socket.on("message", (data, binary) => {
      if (control !== socket || stopped) return;
      try {
        if (binary) throw new Error("Invalid control message");
        const event = decodeControl(JSON.parse(data.toString()));
        if (event.type === "challenge" && !challenged) {
          if (decodeBase64(event.nonce).length !== 32) throw new Error("Invalid challenge");
          challenged = true;
          socket.send(
            JSON.stringify({
              type: "authenticate",
              signature: signRelayChallenge(input.secret, event.nonce),
            }),
          );
        } else if (
          event.type === "registered" &&
          challenged &&
          !registered &&
          event.endpointId === endpointId
        ) {
          registered = true;
          attempts = 0;
          cancelReady();
          input.onStatus?.("registered");
        } else if (event.type === "incoming" && registered) {
          accept(event.connectionId, event.token);
        } else if (event.type === "closed" && registered) {
          pairs.get(event.connectionId)?.();
        } else throw new Error("Invalid control event");
      } catch {
        socket.terminate();
      }
    });
  };
  connect();
  return () => {
    stopped = true;
    retry?.();
    control?.terminate();
    control = undefined;
    for (const stop of pairs.values()) stop();
    input.onStatus?.("stopped");
  };
}
