import type { ThreadBrief } from "@supaterm/contracts";

export interface DecisionCounts {
  /** Accepted as written or in the designer's words. */
  readonly decided: number;
  /** Agent suggestions waiting on the designer. */
  readonly toReview: number;
}

export function decisionCounts(brief: Pick<ThreadBrief, "decisions"> | undefined): DecisionCounts {
  let decided = 0;
  let toReview = 0;
  for (const decision of brief?.decisions ?? []) {
    if (decision.status === "suggested") toReview++;
    else decided++;
  }
  return { decided, toReview };
}

/** The card's decisions in a few words, such as "2 decided · 1 to review". Null when there are none. */
export function decisionPillLabel(counts: DecisionCounts): string | null {
  const parts = [
    counts.decided > 0 ? `${counts.decided} decided` : null,
    counts.toReview > 0 ? `${counts.toReview} to review` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * What an empty brief can start from. A started card's note went out as its
 * first message; an unstarted one still holds it in its bank.
 */
export function briefSeedSource(input: {
  readonly hasSentMessage: boolean;
  readonly bankedNote: boolean;
}): "message" | "note" | null {
  if (input.hasSentMessage) return "message";
  if (input.bankedNote) return "note";
  return null;
}
