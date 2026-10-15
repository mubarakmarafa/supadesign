import { describe, expect, it } from "vite-plus/test";
import { canMoveThreadToActive, threadDragAction, threadOrderAfterMove } from "./threadOrder";
import { threadDragGapOffset } from "./threadDragGap";

describe("live thread insertion gap", () => {
  // Header, pinned row, Active header, two active rows. Geometry stays fixed for hit testing.
  const offsets = [0, 48, 120, 168, 240];
  const shifts = (source: number, insertion: number) =>
    offsets.map((offset) => threadDragGapOffset(offset, source, 72, insertion));

  it("moves the Active header and intervening rows up when unpinning", () => {
    expect(shifts(48, 312)).toEqual([0, 0, -72, -72, -72]);
  });
  it("opens a full gap below the Pinned header when pinning", () => {
    expect(shifts(240, 48)).toEqual([0, 72, 72, 72, 0]);
  });
  it("leaves the source gap in place for cancellation or its current destination", () => {
    expect(shifts(168, 168)).toEqual([0, 0, 0, 0, 0]);
    expect(shifts(168, 240)).toEqual([0, 0, 0, 0, 0]);
  });
  it("moves only crossed rows for an adjacent reorder", () => {
    expect(shifts(168, 312)).toEqual([0, 0, 0, 0, -72]);
    expect(shifts(240, 168)).toEqual([0, 0, 0, 72, 0]);
  });
});

describe("moving into the time-ordered inbox", () => {
  it("accepts threads from other sections without a slot", () => {
    expect(canMoveThreadToActive("pinned", true)).toBe(true);
    expect(canMoveThreadToActive("done", true)).toBe(true);
    expect(canMoveThreadToActive("snoozed", true)).toBe(true);
    expect(canMoveThreadToActive("active", true)).toBe(false);
  });
});

describe("drag action labels", () => {
  it("names the action for each destination instead of its section", () => {
    expect(threadDragAction("active", "pinned")).toBe("Pin");
    expect(threadDragAction("pinned", "active")).toBe("Unpin");
    expect(threadDragAction("done", "active")).toBe("Reopen");
    expect(threadDragAction("snoozed", "active")).toBe("Unsnooze");
    expect(threadDragAction("active", "done")).toBe("Mark as done");
    expect(threadDragAction("pinned", "done")).toBe("Mark as done");
    expect(threadDragAction("active", "active")).toBe("Reorder");
  });
  it("does not offer a parked-section reorder or snooze without a wake time", () => {
    expect(threadDragAction("done", "done")).toBeNull();
    expect(threadDragAction("active", "snoozed")).toBeNull();
    expect(
      threadOrderAfterMove(["a", "b"], "a", {
        section: "done",
        targetId: null,
        placement: "before",
      }),
    ).toBeNull();
  });
});
