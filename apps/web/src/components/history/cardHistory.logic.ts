import type {
  OrchestrationV2RunStatus,
  ThreadBriefVersion,
  ThreadDecision,
  ThreadProgressUpdate,
} from "@supaterm/contracts";

/** A message the designer sent, as the history shows it. */
export interface HistoryMessage {
  readonly id: string;
  readonly at: number;
  /** Plain prose, with context chips read as their labels. */
  readonly text: string;
  readonly markCount: number;
  readonly imageCount: number;
}

/** An agent reply, keyed to the run it answered. */
export interface HistoryReply {
  readonly runId: string;
  readonly at: number;
  readonly text: string;
}

export interface HistoryRun {
  readonly id: string;
  readonly userMessageId: string;
  readonly status: OrchestrationV2RunStatus;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
}

/**
 * Where a message stands with the agent. `answered` means a newer image came
 * back after the agent took the message up; `done` means it finished without
 * one, so nothing visual changed.
 */
export type FeedbackStatus =
  | { readonly kind: "waiting" }
  | { readonly kind: "sent" }
  | { readonly kind: "picked-up"; readonly at: number }
  | { readonly kind: "answered"; readonly at: number }
  | { readonly kind: "done"; readonly at: number }
  | { readonly kind: "stopped"; readonly at: number | null };

export type HistoryEvent =
  | { readonly kind: "decided"; readonly at: number; readonly decision: ThreadDecision }
  | { readonly kind: "suggested"; readonly at: number; readonly decision: ThreadDecision }
  | {
      readonly kind: "brief";
      readonly at: number;
      readonly text: string;
      /** The brief this one replaced, or null for the first. */
      readonly previous: string | null;
    };

/** One message and everything that came back before the next. */
export interface HistoryRound {
  readonly id: string;
  /** When the round began: its message, or its earliest item when there is none. */
  readonly at: number;
  /** Null for what happened before the designer's first message. */
  readonly message: HistoryMessage | null;
  readonly status: FeedbackStatus | null;
  readonly reply: HistoryReply | null;
  /** Oldest first. */
  readonly images: ReadonlyArray<ThreadProgressUpdate>;
  /** Oldest first. */
  readonly events: ReadonlyArray<HistoryEvent>;
}

const timeOf = (iso: string) => {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
};

const STOPPED: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

/**
 * `images` count as an answer when the agent's work produced them (its own
 * captures, or the one taken after its turn), from when it took the message up
 * until the designer's next message. The designer's own captures never do.
 */
export function feedbackStatus(
  run: HistoryRun | undefined,
  images: ReadonlyArray<ThreadProgressUpdate>,
  nextMessageAt: number = Number.POSITIVE_INFINITY,
): FeedbackStatus {
  if (run === undefined || run.status === "preparing" || run.status === "queued") {
    return { kind: "waiting" };
  }
  if (run.startedAt === null || run.status === "starting") return { kind: "sent" };
  const startedAt = run.startedAt;
  const answer = images.find((image) => {
    const at = timeOf(image.createdAt);
    return image.source !== "designer" && at >= startedAt && at < nextMessageAt;
  });
  if (answer !== undefined) return { kind: "answered", at: timeOf(answer.createdAt) };
  if (run.status === "completed") return { kind: "done", at: run.completedAt ?? startedAt };
  if (STOPPED.has(run.status)) return { kind: "stopped", at: run.completedAt };
  return { kind: "picked-up", at: startedAt };
}

/**
 * A card's history as rounds, newest first: each message the designer sent,
 * then the images, decisions and brief edits that followed until the next.
 * Decisions count when they were settled, suggestions when they were made,
 * and the designer's own capture goes with the marked message it fed.
 */
export function buildCardHistory(input: {
  readonly messages: ReadonlyArray<HistoryMessage>;
  readonly replies: ReadonlyArray<HistoryReply>;
  readonly runs: ReadonlyArray<HistoryRun>;
  readonly images: ReadonlyArray<ThreadProgressUpdate>;
  readonly decisions: ReadonlyArray<ThreadDecision>;
  readonly briefVersions: ReadonlyArray<ThreadBriefVersion>;
}): ReadonlyArray<HistoryRound> {
  const messages = [...input.messages].toSorted((a, b) => a.at - b.at);
  const images = [...input.images].toSorted((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));
  const events: HistoryEvent[] = [
    ...input.decisions.map((decision): HistoryEvent =>
      decision.status === "suggested"
        ? { kind: "suggested", at: timeOf(decision.createdAt), decision }
        : { kind: "decided", at: timeOf(decision.updatedAt), decision },
    ),
    ...input.briefVersions.map((version, index): HistoryEvent => ({
      kind: "brief",
      at: timeOf(version.editedAt),
      text: version.text,
      previous: index === 0 ? null : (input.briefVersions[index - 1]?.text ?? null),
    })),
  ].toSorted((a, b) => a.at - b.at);

  // Index of the round an item at `at` belongs to; -1 is before the first message.
  const roundOf = (at: number) => messages.findLastIndex((message) => message.at <= at);
  const buckets = Array.from({ length: messages.length + 1 }, () => ({
    images: [] as ThreadProgressUpdate[],
    events: [] as HistoryEvent[],
  }));
  // The designer captures a screen to mark it up, so a capture taken just
  // before a message with marks belongs with that message, not the round before.
  const roundOfImage = (image: ThreadProgressUpdate) => {
    const round = roundOf(timeOf(image.createdAt));
    const next = messages[round + 1];
    return image.source === "designer" && next !== undefined && next.markCount > 0
      ? round + 1
      : round;
  };
  for (const image of images) buckets[roundOfImage(image) + 1]!.images.push(image);
  for (const event of events) buckets[roundOf(event.at) + 1]!.events.push(event);

  const rounds: HistoryRound[] = [];
  const before = buckets[0]!;
  if (before.images.length > 0 || before.events.length > 0) {
    rounds.push({
      id: "before-first-message",
      at: Math.min(
        ...before.images.map((image) => timeOf(image.createdAt)),
        ...before.events.map((event) => event.at),
      ),
      message: null,
      status: null,
      reply: null,
      ...before,
    });
  }
  messages.forEach((message, index) => {
    const run = input.runs.find((candidate) => candidate.userMessageId === message.id);
    const reply =
      run === undefined
        ? null
        : (input.replies
            .filter((candidate) => candidate.runId === run.id && candidate.text.trim() !== "")
            .toSorted((a, b) => a.at - b.at)
            .at(-1) ?? null);
    rounds.push({
      id: message.id,
      at: message.at,
      message,
      status: feedbackStatus(run, images, messages[index + 1]?.at),
      reply,
      ...buckets[index + 1]!,
    });
  });
  return rounds.toReversed();
}
