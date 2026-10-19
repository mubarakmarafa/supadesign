import type { ThreadProgress, ThreadProgressUpdate } from "@supaterm/contracts";

/**
 * How far to trust a card's cover: current, older than the agent's latest
 * work, being replaced right now, or kept after a capture failed.
 */
export type CoverState =
  | { readonly kind: "current" }
  | { readonly kind: "stale" }
  | { readonly kind: "capturing" }
  | { readonly kind: "failed"; readonly reason: string };

const after = (later: string | null | undefined, earlier: string) =>
  later != null && Date.parse(later) > Date.parse(earlier);

/** `latestRunStartedAt` is when the thread's agent last started working. */
export function coverState(
  progress: Pick<ThreadProgress, "capture">,
  cover: Pick<ThreadProgressUpdate, "createdAt">,
  latestRunStartedAt: string | null | undefined,
): CoverState {
  if (progress.capture?._tag === "capturing") return { kind: "capturing" };
  if (progress.capture?._tag === "failed" && after(progress.capture.failedAt, cover.createdAt)) {
    return { kind: "failed", reason: progress.capture.reason };
  }
  if (after(latestRunStartedAt, cover.createdAt)) return { kind: "stale" };
  return { kind: "current" };
}

/**
 * The line under a card's title. A summary someone wrote wins; the thread's
 * goal beats the brief taken from its first message.
 */
export function cardSummaryText(
  progress: Pick<ThreadProgress, "summary"> | undefined,
  goalObjective: string | null | undefined,
): string | null {
  const summary = progress?.summary ?? null;
  if (summary !== null && summary.source !== "brief") return summary.text;
  return goalObjective ?? summary?.text ?? null;
}

/** Who took a capture, as the viewer says it. */
export function captureSourceLabel(source: ThreadProgressUpdate["source"]): string {
  switch (source) {
    case "agent":
      return "Published by the agent";
    case "designer":
      return "Captured by you";
    case "auto":
      return "Captured after the agent's turn";
  }
}
