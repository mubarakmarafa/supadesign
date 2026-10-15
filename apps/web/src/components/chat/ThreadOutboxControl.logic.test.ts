import { describe, expect, it } from "vite-plus/test";
import { resolveThreadOutboxStatus } from "./ThreadOutboxControl.logic";

const pending = { id: "a", status: "pending", error: null } as const;
const failed = { id: "a", status: "failed", error: "Thread is archived." } as const;
const backingOff = { id: "a", status: "pending", error: "Connection lost." } as const;
const notSending = () => false;

describe("resolveThreadOutboxStatus", () => {
  it("reports a failed message before anything else", () => {
    expect(
      resolveThreadOutboxStatus({
        head: failed,
        editingMessageId: failed.id,
        deliverable: false,
        isSending: () => true,
      }),
    ).toBe("failed");
  });

  it("reports editing over a lost connection, since the edit holds delivery", () => {
    expect(
      resolveThreadOutboxStatus({
        head: pending,
        editingMessageId: pending.id,
        deliverable: false,
        isSending: notSending,
      }),
    ).toBe("editing");
  });

  it("keeps reporting the first message while a later one is edited", () => {
    expect(
      resolveThreadOutboxStatus({
        head: pending,
        editingMessageId: "later",
        deliverable: true,
        isSending: (id) => id === pending.id,
      }),
    ).toBe("sending");
  });

  it("waits for the environment while it cannot deliver", () => {
    expect(
      resolveThreadOutboxStatus({
        head: backingOff,
        editingMessageId: null,
        deliverable: false,
        isSending: notSending,
      }),
    ).toBe("offline");
  });

  it("reports an attempt in flight, even when an earlier attempt failed", () => {
    expect(
      resolveThreadOutboxStatus({
        head: backingOff,
        editingMessageId: null,
        deliverable: true,
        isSending: (id) => id === backingOff.id,
      }),
    ).toBe("sending");
  });

  it("reports a retry backoff when the last attempt failed transiently", () => {
    expect(
      resolveThreadOutboxStatus({
        head: backingOff,
        editingMessageId: null,
        deliverable: true,
        isSending: notSending,
      }),
    ).toBe("retrying");
  });

  it("falls back to waiting for delivery to start", () => {
    expect(
      resolveThreadOutboxStatus({
        head: pending,
        editingMessageId: null,
        deliverable: true,
        isSending: notSending,
      }),
    ).toBe("waiting");
  });
});
