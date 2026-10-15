// @effect-diagnostics nodeBuiltinImport:off - verifies the native control socket lifecycle.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeEvents from "node:events";
import { expect, it } from "vite-plus/test";
import WebSocket, { WebSocketServer } from "ws";
import {
  encodeBase64,
  relayEndpointId,
  relayPublicKey,
  signRelayChallenge,
  createClientHandshake,
} from "@supaterm/shared/relay/protocol";
import { createTunnelSession } from "@supaterm/shared/relay/tunnel";
import { startRelayTransport, type RelayHostState } from "./transport.ts";

async function relay() {
  const server = NodeHttp.createServer();
  const sockets = new WebSocketServer({ server });
  server.listen(0, "127.0.0.1");
  await NodeEvents.EventEmitter.once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return {
    url: `ws://127.0.0.1:${address.port}`,
    sockets,
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      server.close();
      await NodeEvents.EventEmitter.once(server, "close");
    },
  };
}

it("authenticates the control challenge and stays stopped after being superseded", async () => {
  const fixture = await relay();
  const secret = NodeCrypto.randomBytes(32);
  const nonce = encodeBase64(NodeCrypto.randomBytes(32));
  let scheduled = 0;
  const states: RelayHostState[] = [];
  const connected = new Promise<WebSocket>((resolve) =>
    fixture.sockets.once("connection", resolve),
  );
  let superseded!: () => void;
  const stopped = new Promise<void>((resolve) => {
    superseded = resolve;
  });
  const stop = startRelayTransport({
    secret,
    relayUrl: fixture.url,
    acceptStream: () => {},
    scheduleRetry: () => {
      scheduled++;
      return () => {};
    },
    onStatus: (state) => {
      states.push(state);
      if (state === "superseded") superseded();
    },
  });
  try {
    const socket = await connected;
    const message = NodeEvents.EventEmitter.once(socket, "message");
    socket.send(JSON.stringify({ type: "challenge", nonce }));
    expect(JSON.parse(String((await message)[0]))).toEqual({
      type: "authenticate",
      signature: signRelayChallenge(secret, nonce),
    });
    socket.send(
      JSON.stringify({ type: "registered", endpointId: relayEndpointId(relayPublicKey(secret)) }),
    );
    socket.close(4001, "replaced");
    await stopped;
    expect(states).toContain("registered");
    expect(scheduled).toBe(0);
  } finally {
    stop();
    await fixture.close();
  }
});

it("cancels the retry scheduled after control loss when access is disabled", async () => {
  const fixture = await relay();
  let retry!: () => void;
  let canceled = false;
  const connected = new Promise<WebSocket>((resolve) =>
    fixture.sockets.once("connection", resolve),
  );
  const scheduled = new Promise<void>((resolve) => {
    retry = resolve;
  });
  const stop = startRelayTransport({
    secret: NodeCrypto.randomBytes(32),
    relayUrl: fixture.url,
    acceptStream: () => {},
    scheduleRetry: () => {
      retry();
      return () => {
        canceled = true;
      };
    },
  });
  try {
    (await connected).close(1001, "draining");
    await scheduled;
    stop();
    expect(canceled).toBe(true);
  } finally {
    stop();
    await fixture.close();
  }
});

it("keeps an encrypted data session alive while the control socket re-registers", async () => {
  const fixture = await relay();
  const secret = NodeCrypto.randomBytes(32);
  const nextConnection = () =>
    new Promise<WebSocket>((resolve) => fixture.sockets.once("connection", resolve));
  const register = async (socket: WebSocket) => {
    const authenticated = NodeEvents.EventEmitter.once(socket, "message");
    socket.send(
      JSON.stringify({ type: "challenge", nonce: encodeBase64(NodeCrypto.randomBytes(32)) }),
    );
    await authenticated;
    socket.send(
      JSON.stringify({ type: "registered", endpointId: relayEndpointId(relayPublicKey(secret)) }),
    );
  };
  const first = nextConnection();
  const retry = Promise.withResolvers<void>();
  let reconnect: (() => void) | undefined;
  const stop = startRelayTransport({
    secret,
    relayUrl: fixture.url,
    scheduleRetry: (_delay, run) => {
      reconnect = run;
      retry.resolve();
      return () => {};
    },
    acceptStream: (stream) => {
      stream.onData = (bytes) => {
        stream.consumed(bytes.length);
        stream.write(bytes);
      };
    },
  });
  try {
    const control = await first;
    await register(control);
    const accepted = nextConnection();
    control.send(JSON.stringify({ type: "incoming", connectionId: "pair", token: "lease" }));
    const socket = await accepted;
    const handshake = createClientHandshake(relayPublicKey(secret), NodeCrypto.randomBytes);
    const welcome = NodeEvents.EventEmitter.once(socket, "message");
    socket.send(handshake.hello);
    const cipher = handshake.finish(String((await welcome)[0]));
    const client = createTunnelSession({
      cipher,
      initiator: true,
      send: (data) => socket.send(data),
    });
    socket.on("message", (data) => client.receive(new Uint8Array(data as Buffer)));
    socket.once("close", () => client.close());
    const stream = client.open();
    const echoed = Promise.withResolvers<string>();
    stream.onData = (data) => {
      stream.consumed(data.length);
      echoed.resolve(new TextDecoder().decode(data));
    };
    control.close(1001, "draining");
    await retry.promise;
    const second = nextConnection();
    reconnect?.();
    await register(await second);
    stream.write(new TextEncoder().encode("still connected"));
    expect(await echoed.promise).toBe("still connected");
    expect(client.closed).toBe(false);
    const closed = NodeEvents.EventEmitter.once(socket, "close");
    stop();
    await closed;
    expect(client.closed).toBe(true);
  } finally {
    stop();
    await fixture.close();
  }
});
