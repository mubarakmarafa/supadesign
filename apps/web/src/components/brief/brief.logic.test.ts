import { ThreadDecisionId, type ThreadDecision } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { briefSeedSource, decisionCounts, decisionPillLabel } from "./brief.logic";

const decision = (status: ThreadDecision["status"], index: number): ThreadDecision => ({
  id: ThreadDecisionId.make(`decision-${index}`),
  text: `Decision ${index}`,
  status,
  source: status === "accepted" ? "designer" : "agent",
  createdAt: "2026-10-21T10:00:00.000Z",
  updatedAt: "2026-10-21T10:00:00.000Z",
});

describe("decisionPillLabel", () => {
  it("counts edited decisions as decided and suggestions as to review", () => {
    const counts = decisionCounts({
      decisions: [decision("accepted", 1), decision("edited", 2), decision("suggested", 3)],
    });
    expect(counts).toEqual({ decided: 2, toReview: 1 });
    expect(decisionPillLabel(counts)).toBe("2 decided · 1 to review");
  });

  it("shows only the parts that have something in them", () => {
    expect(decisionPillLabel({ decided: 0, toReview: 3 })).toBe("3 to review");
    expect(decisionPillLabel({ decided: 1, toReview: 0 })).toBe("1 decided");
  });

  it("shows nothing for a card without decisions", () => {
    expect(decisionPillLabel(decisionCounts(undefined))).toBeNull();
  });
});

describe("briefSeedSource", () => {
  it("prefers the first message once the card has started", () => {
    expect(briefSeedSource({ hasSentMessage: true, bankedNote: true })).toBe("message");
  });

  it("uses the banked note on an unstarted card", () => {
    expect(briefSeedSource({ hasSentMessage: false, bankedNote: true })).toBe("note");
  });

  it("has nothing to start from on an empty card", () => {
    expect(briefSeedSource({ hasSentMessage: false, bankedNote: false })).toBeNull();
  });
});
