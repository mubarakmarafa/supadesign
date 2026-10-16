import { describe, expect, it } from "vite-plus/test";

import { bankDropTarget } from "./ThreadBankControl";

const entries = [{ id: "a" }, { id: "b" }, { id: "c" }] as const;

describe("bankDropTarget", () => {
  it("moves an entry in front of the entry at the drop index", () => {
    expect(bankDropTarget(entries, "c", 0)).toEqual({ beforeEntryId: "a" });
    expect(bankDropTarget(entries, "a", 2)).toEqual({ beforeEntryId: "c" });
  });

  it("moves to the end past the last entry", () => {
    expect(bankDropTarget(entries, "a", 3)).toEqual({ beforeEntryId: null });
  });

  it("ignores drops on either side of the dragged entry", () => {
    expect(bankDropTarget(entries, "b", 1)).toBeNull();
    expect(bankDropTarget(entries, "b", 2)).toBeNull();
    expect(bankDropTarget(entries, "missing", 0)).toBeNull();
  });
});
