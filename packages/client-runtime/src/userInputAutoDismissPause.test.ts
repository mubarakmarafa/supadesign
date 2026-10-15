import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, RuntimeRequestId, ThreadId } from "@supaterm/contracts";
import { createUserInputAutoDismissPause } from "./userInputAutoDismissPause.ts";

const input = {
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make("thread"),
  requestId: RuntimeRequestId.make("question"),
};

describe("question interaction pause", () => {
  it("coalesces activity while pending and after acceptance, then allows another question", async () => {
    const pause = createUserInputAutoDismissPause();
    let accept!: (result: boolean) => void;
    const send = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const pending = pause(input, send);
    await pause(input, send);
    expect(send).toHaveBeenCalledTimes(1);
    accept(true);
    await pending;
    await pause(input, send);
    expect(send).toHaveBeenCalledTimes(1);
    const nextQuestion = vi.fn(async () => true);
    await pause({ ...input, requestId: RuntimeRequestId.make("next-question") }, nextQuestion);
    expect(nextQuestion).toHaveBeenCalledTimes(1);
  });
  it("retries activity after a failed or interrupted dispatch", async () => {
    const pause = createUserInputAutoDismissPause();
    const send = vi.fn(async () => false);
    await pause(input, send);
    await pause(input, send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
