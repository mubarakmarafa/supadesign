import { describe, expect, it } from "vite-plus/test";

import { resolveMobileProjectGroupingSettings } from "./project-grouping.logic";

describe("mobile project grouping preferences", () => {
  it("groups by repository until a mode is chosen", () => {
    expect(resolveMobileProjectGroupingSettings({}).sidebarProjectGroupingMode).toBe("repository");
    expect(
      resolveMobileProjectGroupingSettings({ projectGroupingMode: "repository_path" })
        .sidebarProjectGroupingMode,
    ).toBe("repository_path");
  });
});
