import { describe, expect, it } from "vite-plus/test";

import { closeProjectTab, openProjectTab, pruneProjectTabs } from "./projectTabs.logic";

const tab = (projectId: string) => ({ environmentId: "env", projectId });

describe("project tabs", () => {
  it("opens a tab once, at the end", () => {
    const tabs = openProjectTab(openProjectTab([tab("a")], tab("b")), tab("a"));
    expect(tabs.map((entry) => entry.projectId)).toEqual(["a", "b"]);
  });

  it("closing shows the right neighbor, then the left, then the grid", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    expect(closeProjectTab(tabs, tab("b")).next?.projectId).toBe("c");
    expect(closeProjectTab(tabs, tab("c")).next?.projectId).toBe("b");
    expect(closeProjectTab([tab("a")], tab("a"))).toEqual({ tabs: [], next: null });
  });

  it("prunes removed projects", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    expect(pruneProjectTabs(tabs, (entry) => entry.projectId !== "b").length).toBe(2);
    expect(pruneProjectTabs(tabs, () => true)).toBe(tabs);
  });
});
