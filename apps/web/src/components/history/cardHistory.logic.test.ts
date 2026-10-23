import type { ThreadDecision, ThreadProgressUpdate } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildCardHistory,
  feedbackStatus,
  type HistoryMessage,
  type HistoryRun,
} from "./cardHistory.logic";

const at = (minute: number) => Date.parse(`2026-10-22T10:${String(minute).padStart(2, "0")}:00Z`);
const iso = (minute: number) => new Date(at(minute)).toISOString();

const image = (id: string, minute: number, source: ThreadProgressUpdate["source"] = "agent") =>
  ({ id, createdAt: iso(minute), source }) as unknown as ThreadProgressUpdate;

const message = (id: string, minute: number, text = id): HistoryMessage => ({
  id,
  at: at(minute),
  text,
  markCount: 0,
  imageCount: 0,
});

const run = (
  userMessageId: string,
  status: HistoryRun["status"],
  started: number | null,
  completed: number | null = null,
): HistoryRun => ({
  id: `run-${userMessageId}`,
  userMessageId,
  status,
  startedAt: started === null ? null : at(started),
  completedAt: completed === null ? null : at(completed),
});

const decision = (
  id: string,
  status: ThreadDecision["status"],
  created: number,
  updated = created,
): ThreadDecision =>
  ({
    id,
    text: id,
    status,
    source: status === "accepted" ? "designer" : "agent",
    createdAt: iso(created),
    updatedAt: iso(updated),
  }) as ThreadDecision;

describe("feedbackStatus", () => {
  it("follows a message from waiting to answered", () => {
    expect(feedbackStatus(undefined, [])).toEqual({ kind: "waiting" });
    expect(feedbackStatus(run("m", "queued", null), [])).toEqual({ kind: "waiting" });
    expect(feedbackStatus(run("m", "starting", null), [])).toEqual({ kind: "sent" });
    expect(feedbackStatus(run("m", "running", 5), [])).toEqual({ kind: "picked-up", at: at(5) });
    expect(feedbackStatus(run("m", "running", 5), [image("i", 7)])).toEqual({
      kind: "answered",
      at: at(7),
    });
  });

  it("only counts an image that came after the agent took the message up", () => {
    expect(feedbackStatus(run("m", "completed", 5, 9), [image("old", 3)])).toEqual({
      kind: "done",
      at: at(9),
    });
  });

  it("doesn't count the designer's own captures, or images after their next message", () => {
    expect(feedbackStatus(run("m", "completed", 5, 9), [image("mine", 7, "designer")])).toEqual({
      kind: "done",
      at: at(9),
    });
    expect(feedbackStatus(run("m", "completed", 5, 9), [image("later", 30)], at(20))).toEqual({
      kind: "done",
      at: at(9),
    });
    expect(
      feedbackStatus(run("m", "completed", 5, 9), [image("after", 10, "auto")], at(20)),
    ).toEqual({ kind: "answered", at: at(10) });
  });

  it("says when a run stopped without an image", () => {
    expect(feedbackStatus(run("m", "interrupted", 5, 6), [])).toEqual({
      kind: "stopped",
      at: at(6),
    });
  });
});

describe("buildCardHistory", () => {
  it("groups what came back under each message, newest round first", () => {
    const rounds = buildCardHistory({
      messages: [message("first", 0), message("second", 10)],
      replies: [
        { runId: "run-first", at: at(2), text: "Working on it" },
        { runId: "run-first", at: at(4), text: "Here's the new header" },
      ],
      runs: [run("first", "completed", 1, 5), run("second", "running", 11)],
      images: [image("header", 4), image("footer", 12)],
      decisions: [
        decision("Use euros", "accepted", 3),
        decision("Two columns", "suggested", 11),
        decision("Gold accents", "edited", 6, 13),
      ],
      briefVersions: [],
    });

    expect(rounds.map((round) => round.id)).toEqual(["second", "first"]);
    const [second, first] = rounds;
    expect(first?.images.map((update) => update.id)).toEqual(["header"]);
    expect(first?.reply?.text).toBe("Here's the new header");
    expect(first?.events.map((event) => event.kind)).toEqual(["decided"]);
    expect(first?.status).toEqual({ kind: "answered", at: at(4) });
    // Settled decisions land when they were settled, not when first suggested.
    expect(
      second?.events.map((event) => (event.kind === "brief" ? "brief" : event.decision.id)),
    ).toEqual(["Two columns", "Gold accents"]);
    expect(second?.status).toEqual({ kind: "answered", at: at(12) });
  });

  it("keeps what happened before the first message in its own round", () => {
    const rounds = buildCardHistory({
      messages: [message("first", 10)],
      replies: [],
      runs: [],
      images: [],
      decisions: [],
      briefVersions: [
        { text: "A calm page", editedAt: iso(1) },
        { text: "A dense page", editedAt: iso(12) },
      ],
    });
    expect(rounds.map((round) => round.id)).toEqual(["first", "before-first-message"]);
    expect(rounds[1]?.events).toEqual([
      { kind: "brief", at: at(1), text: "A calm page", previous: null },
    ]);
    expect(rounds[0]?.events).toEqual([
      { kind: "brief", at: at(12), text: "A dense page", previous: "A calm page" },
    ]);
    expect(rounds[0]?.status).toEqual({ kind: "waiting" });
  });

  it("files the designer's capture with the marked message it was sent with", () => {
    const marked = { ...message("marked", 10), markCount: 1 };
    const rounds = buildCardHistory({
      messages: [message("first", 0), marked, message("plain", 20)],
      replies: [],
      runs: [run("first", "completed", 1, 5)],
      images: [image("shot", 8, "designer"), image("note", 18, "designer")],
      decisions: [],
      briefVersions: [],
    });
    const byId = new Map(rounds.map((round) => [round.id, round]));
    expect(byId.get("marked")?.images.map((update) => update.id)).toEqual(["shot", "note"]);
    expect(byId.get("first")?.images).toEqual([]);
    // Its own capture never answers the designer's earlier message.
    expect(byId.get("first")?.status).toEqual({ kind: "done", at: at(5) });
  });

  it("has no rounds for a card with nothing in it", () => {
    expect(
      buildCardHistory({
        messages: [],
        replies: [],
        runs: [],
        images: [],
        decisions: [],
        briefVersions: [],
      }),
    ).toEqual([]);
  });
});
