import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { markDoneAndAdvance, registerMarkDoneAndAdvance } from "./markDoneAndAdvance";

const threadRef = scopeThreadRef(
  EnvironmentId.make("environment-local"),
  ThreadId.make("thread-1"),
);

describe("markDoneAndAdvance", () => {
  it("hands the open thread to the mounted sidebar so it can move forward", () => {
    const markedDone: ScopedThreadRef[] = [];
    const unregister = registerMarkDoneAndAdvance((ref) => markedDone.push(ref));

    expect(markDoneAndAdvance(threadRef)).toBe(true);
    expect(markedDone).toEqual([threadRef]);
    unregister();
  });

  it("asks the caller to mark done in place when no sidebar is mounted", () => {
    expect(markDoneAndAdvance(threadRef)).toBe(false);
  });

  it("keeps a remounted sidebar's handler when the old one unmounts late", () => {
    const markedDoneBy: string[] = [];
    const unregisterOld = registerMarkDoneAndAdvance(() => markedDoneBy.push("old"));
    const unregisterNew = registerMarkDoneAndAdvance(() => markedDoneBy.push("new"));
    unregisterOld();

    expect(markDoneAndAdvance(threadRef)).toBe(true);
    expect(markedDoneBy).toEqual(["new"]);
    unregisterNew();
    expect(markDoneAndAdvance(threadRef)).toBe(false);
  });
});
