import type { LiveEnvironmentSnapshot } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { livePreviewTurnContext } from "./livePreviewTurnContext.ts";

const environment = (overrides: Partial<LiveEnvironmentSnapshot>) =>
  ({
    status: "ready",
    active: true,
    url: "http://localhost:3000/",
    worktreePath: "/work/card",
    updatedAt: 1,
    warmUntil: null,
    ...overrides,
  }) as LiveEnvironmentSnapshot;

describe("livePreviewTurnContext", () => {
  it("tells the live card's agent where its preview runs", () => {
    const entry = livePreviewTurnContext(environment({}));
    expect(entry?.text).toContain("http://localhost:3000/");
    expect(entry?.text).toContain("/work/card");
    expect(entry?.text).toContain("supaterm_progress_publish without url");
  });

  it("is sent again only when the preview moves, not when it is touched", () => {
    const first = livePreviewTurnContext(environment({}));
    expect(livePreviewTurnContext(environment({ updatedAt: 99 }))?.version).toBe(first?.version);
    expect(
      livePreviewTurnContext(environment({ url: "http://localhost:8000/" }))?.version,
    ).not.toBe(first?.version);
    expect(livePreviewTurnContext(environment({ status: "failed" }))?.version).not.toBe(
      first?.version,
    );
  });

  it("says a preview is on its way, or down, so the agent doesn't start its own", () => {
    expect(livePreviewTurnContext(environment({ status: "preparing", url: null }))?.text).toContain(
      "Don't start a dev server of your own",
    );
    expect(livePreviewTurnContext(environment({ status: "stopped" }))?.text).toContain(
      "supaterm_live_environment_start",
    );
  });

  it("says nothing to cards that aren't live", () => {
    expect(livePreviewTurnContext(undefined)).toBeNull();
    expect(livePreviewTurnContext(environment({ active: false }))).toBeNull();
    expect(livePreviewTurnContext(environment({ status: "kept" }))).toBeNull();
  });
});
