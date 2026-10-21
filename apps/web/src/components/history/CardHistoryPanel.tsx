import type {
  EnvironmentId,
  OrchestrationV2ThreadProjection,
  ScopedThreadRef,
  ThreadProgressUpdate,
  ThreadProgressUpdateId,
} from "@supaterm/contracts";
import { replaceComposerContextReferences } from "@supaterm/shared/composerContextReferences";
import * as DateTime from "effect/DateTime";
import { CheckIcon, HistoryIcon, PencilIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { useClientSettings } from "../../hooks/useSettings";
import { resolveUserMessageContext } from "../../lib/composerContextRecords";
import { cn } from "~/lib/utils";
import { useThreadProjection, useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { threadBrief } from "../../state/threadBrief";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { useProjectThreadBriefs, useThreadBriefSupported } from "../brief/briefState";
import { progressImageResource } from "../progress/progressImage";
import { useThreadProgress } from "../progress/progressState";
import { ProgressViewer } from "../progress/ProgressViewer";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  buildCardHistory,
  type FeedbackStatus,
  type HistoryEvent,
  type HistoryMessage,
  type HistoryReply,
  type HistoryRound,
} from "./cardHistory.logic";

type HistoryFilter = "all" | "images" | "decisions";

const millis = (value: DateTime.Utc) => DateTime.toEpochMillis(value);

/** The designer's messages and the agent's replies, as the history reads them. */
function historyConversation(projection: OrchestrationV2ThreadProjection | null) {
  const messages: HistoryMessage[] = [];
  const replies: HistoryReply[] = [];
  for (const message of projection?.messages ?? []) {
    if (message.role === "user") {
      const context = resolveUserMessageContext(message);
      messages.push({
        id: message.id,
        at: millis(message.createdAt),
        text: replaceComposerContextReferences(context.text, (reference) => reference.label).trim(),
        markCount: context.records.filter((record) => record.kind === "preview-annotation").length,
        imageCount: message.attachments.filter(
          (attachment) => attachment.type === "image" && !attachment.name.startsWith("preview-"),
        ).length,
      });
    } else if (message.role === "assistant" && message.runId !== null && !message.streaming) {
      replies.push({ runId: message.runId, at: millis(message.createdAt), text: message.text });
    }
  }
  const runs = (projection?.runs ?? []).map((run) => ({
    id: run.id,
    userMessageId: run.userMessageId,
    status: run.status,
    startedAt: run.startedAt === null ? null : millis(run.startedAt),
    completedAt: run.completedAt === null ? null : millis(run.completedAt),
  }));
  return { messages, replies, runs };
}

/**
 * A card's history, newest first: each message the designer sent, whether the
 * agent has acted on it, and the images, decisions and brief edits that came
 * back before the next one. Opens beside the chat from the brief's row.
 */
export function CardHistoryPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const thread = useThreadShell(threadRef);
  const projectId = thread?.projectId ?? null;
  const projection = useThreadProjection(threadRef)?.projection ?? null;
  const progress = useThreadProgress(environmentId, projectId, threadId);
  const briefSupported = useThreadBriefSupported(environmentId);
  const brief = useProjectThreadBriefs(environmentId, projectId).get(threadId);
  const versionsQuery = useEnvironmentQuery(
    briefSupported ? threadBrief.versions({ environmentId, input: { threadId } }) : null,
  );
  // Earlier briefs aren't streamed, so fetch them again whenever the brief changes.
  const briefVersion = brief?.brief?.version ?? 0;
  const refreshVersions = versionsQuery.refresh;
  useEffect(() => {
    if (briefVersion > 0) refreshVersions();
  }, [briefVersion, refreshVersions]);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [viewing, setViewing] = useState<ThreadProgressUpdateId | null>(null);

  const conversation = useMemo(() => historyConversation(projection), [projection]);
  const rounds = useMemo(
    () =>
      buildCardHistory({
        ...conversation,
        images: progress?.updates ?? [],
        decisions: brief?.decisions ?? [],
        briefVersions: versionsQuery.data ?? [],
      }),
    [conversation, progress?.updates, brief?.decisions, versionsQuery.data],
  );
  const visibleRounds = rounds.filter((round) =>
    filter === "images"
      ? round.images.length > 0
      : filter === "decisions"
        ? round.events.length > 0
        : true,
  );
  const numbered = rounds.filter((round) => round.message !== null).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <h2 className="flex-1 text-sm font-medium">History</h2>
        <ToggleGroup
          aria-label="Show in history"
          variant="segmented"
          value={[filter]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "all" || next === "images" || next === "decisions") setFilter(next);
          }}
        >
          <Toggle value="all">All</Toggle>
          <Toggle value="images">Images</Toggle>
          <Toggle value="decisions">Decisions</Toggle>
        </ToggleGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {visibleRounds.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <HistoryIcon aria-hidden className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium">Nothing here yet</p>
            <p className="max-w-64 text-xs text-muted-foreground">
              {filter === "all"
                ? "Your messages, the agent's images, and the decisions you make collect here as the card moves along."
                : filter === "images"
                  ? "No images yet. They appear as the agent captures its work."
                  : "No decisions or brief changes yet."}
            </p>
          </div>
        ) : (
          <ol className="flex flex-col">
            {visibleRounds.map((round) => (
              <RoundItem
                key={round.id}
                environmentId={environmentId}
                round={round}
                number={
                  round.message === null
                    ? null
                    : numbered - rounds.filter((other) => other.message !== null).indexOf(round)
                }
                newest={round === rounds[0]}
                filter={filter}
                onOpenImage={setViewing}
              />
            ))}
          </ol>
        )}
      </div>
      {viewing !== null && progress !== undefined && progress !== null ? (
        <ProgressViewer
          environmentId={environmentId}
          threadRef={threadRef}
          title={thread?.title ?? "This thread"}
          progress={progress}
          latestRunStartedAt={thread?.latestRun?.startedAt}
          canCapture={false}
          initialSelectedId={viewing}
          onOpenChange={(open) => {
            if (!open) setViewing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function RoundItem({
  environmentId,
  round,
  number,
  newest,
  filter,
  onOpenImage,
}: {
  environmentId: EnvironmentId;
  round: HistoryRound;
  number: number | null;
  newest: boolean;
  filter: HistoryFilter;
  onOpenImage: (id: ThreadProgressUpdateId) => void;
}) {
  const { timestampFormat } = useClientSettings();
  const when = (at: number) => formatDayAwareTimestamp(new Date(at).toISOString(), timestampFormat);
  const showConversation = filter === "all";
  const showImages = filter !== "decisions" && round.images.length > 0;
  const showEvents = filter !== "images" && round.events.length > 0;
  return (
    <li className="relative pb-5 ps-5 last:pb-1 before:absolute before:start-[5px] before:top-4 before:bottom-0 before:w-px before:bg-border last:before:hidden">
      <span
        aria-hidden
        className={cn(
          "absolute start-0 top-1 size-[11px] rounded-full border-2",
          newest ? "border-foreground bg-foreground" : "border-muted-foreground/60 bg-background",
        )}
      />
      <p className="mb-1.5 text-xs">
        <span className="font-medium">
          {number === null ? "Before your first message" : `Round ${number}`}
        </span>
        <span className="text-muted-foreground"> · {when(round.at)}</span>
      </p>
      <div className="flex flex-col gap-2.5">
        {showConversation && round.message !== null ? (
          <Entry who="you">
            <p className="line-clamp-4 text-sm wrap-anywhere whitespace-pre-wrap">
              {round.message.text.length > 0 ? round.message.text : "(No text)"}
            </p>
            {round.message.markCount > 0 || round.message.imageCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {[
                  round.message.markCount > 0
                    ? `${round.message.markCount} ${round.message.markCount === 1 ? "mark" : "marks"}`
                    : null,
                  round.message.imageCount > 0
                    ? `${round.message.imageCount} ${round.message.imageCount === 1 ? "image" : "images"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {round.status !== null ? <StatusTrail status={round.status} when={when} /> : null}
          </Entry>
        ) : null}
        {showConversation && round.reply !== null ? (
          <Entry who="agent">
            <p className="line-clamp-3 text-sm text-muted-foreground wrap-anywhere">
              {round.reply.text}
            </p>
          </Entry>
        ) : null}
        {showImages ? (
          <RoundImages environmentId={environmentId} images={round.images} onOpen={onOpenImage} />
        ) : null}
        {showEvents ? (
          <ul className="flex flex-col gap-1.5">
            {round.events.map((event) => (
              <EventRow key={`${event.kind}:${event.at}:${eventKey(event)}`} event={event} />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function Entry({ who, children }: { who: "you" | "agent"; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-4xs font-semibold",
          who === "you"
            ? "bg-secondary text-secondary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {who === "you" ? "Y" : "A"}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="sr-only">{who === "you" ? "You:" : "Agent:"}</span>
        {children}
      </div>
    </div>
  );
}

const STATUS_STEPS: Record<FeedbackStatus["kind"], number> = {
  waiting: 0,
  sent: 1,
  "picked-up": 2,
  answered: 3,
  done: 3,
  stopped: 3,
};

/** Where the message is with the agent, as the steps it has reached so far. */
function StatusTrail({ status, when }: { status: FeedbackStatus; when: (at: number) => string }) {
  if (status.kind === "waiting") {
    return (
      <span className="flex">
        <Badge variant="warning" size="sm">
          Waiting
        </Badge>
      </span>
    );
  }
  const reached = STATUS_STEPS[status.kind];
  const final =
    status.kind === "answered"
      ? { label: `Answered ${when(status.at)}`, variant: "success" as const }
      : status.kind === "done"
        ? { label: "Done · no new image", variant: "secondary" as const }
        : status.kind === "stopped"
          ? { label: "Stopped", variant: "error" as const }
          : null;
  return (
    <span className="flex flex-wrap items-center gap-1 text-3xs text-muted-foreground">
      <Badge variant="outline" size="sm">
        Sent
      </Badge>
      {reached >= 2 ? (
        <>
          <span aria-hidden>›</span>
          <Badge variant="outline" size="sm">
            {status.kind === "picked-up" ? `Picked up ${when(status.at)}` : "Picked up"}
          </Badge>
        </>
      ) : null}
      {final !== null ? (
        <>
          <span aria-hidden>›</span>
          <Badge variant={final.variant} size="sm">
            {final.label}
          </Badge>
        </>
      ) : null}
    </span>
  );
}

function RoundImages({
  environmentId,
  images,
  onOpen,
}: {
  environmentId: EnvironmentId;
  images: ReadonlyArray<ThreadProgressUpdate>;
  onOpen: (id: ThreadProgressUpdateId) => void;
}) {
  const resources = useMemo(() => images.map(progressImageResource), [images]);
  const urls = useAssetUrls(environmentId, resources);
  const note = images.findLast((image) => image.note !== null)?.note ?? null;
  return (
    <div className="flex flex-col gap-1.5 ps-6">
      <div className="flex flex-wrap gap-1.5">
        {images.map((image, index) => (
          <button
            key={image.id}
            type="button"
            aria-label="Open this image"
            className="relative h-14 w-22 overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => onOpen(image.id)}
          >
            {urls[index] ? (
              <img
                src={urls[index] ?? undefined}
                alt={image.note ?? "Progress image"}
                className="size-full object-cover object-top"
                draggable={false}
              />
            ) : null}
          </button>
        ))}
      </div>
      {note !== null ? (
        <p className="line-clamp-2 text-xs text-muted-foreground wrap-anywhere">{note}</p>
      ) : null}
    </div>
  );
}

const eventKey = (event: HistoryEvent) =>
  event.kind === "brief" ? String(event.at) : event.decision.id;

function EventRow({ event }: { event: HistoryEvent }) {
  const [expanded, setExpanded] = useState(false);
  if (event.kind === "brief") {
    const label =
      event.text.length === 0
        ? "Brief cleared"
        : event.previous === null || event.previous.length === 0
          ? "Brief written"
          : "Brief changed";
    return (
      <li className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 flex size-4 shrink-0 justify-center text-muted-foreground [&_svg]:size-3.5"
        >
          <PencilIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm">
            {label}
            {event.text.length > 0 ? (
              <Button
                size="xs"
                variant="ghost-muted"
                className="ms-1"
                aria-expanded={expanded}
                onClick={() => setExpanded((open) => !open)}
              >
                {expanded ? "Hide" : event.previous ? "Before / after" : "Show"}
              </Button>
            ) : null}
          </p>
          {expanded ? (
            <div className="flex flex-col gap-1.5 text-xs">
              {event.previous ? (
                <p className="whitespace-pre-wrap text-muted-foreground line-through decoration-muted-foreground/50 wrap-anywhere">
                  {event.previous}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap wrap-anywhere">{event.text}</p>
            </div>
          ) : null}
        </div>
      </li>
    );
  }
  const { decision } = event;
  const suggested = event.kind === "suggested";
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 justify-center [&_svg]:size-3.5",
          suggested ? "text-warning-foreground" : "text-success-foreground",
        )}
      >
        {suggested ? <SparklesIcon /> : <CheckIcon />}
      </span>
      <p className="min-w-0 flex-1 text-sm wrap-anywhere">
        <span className="text-muted-foreground">{suggested ? "Suggested: " : "Decided: "}</span>
        {decision.text}
        <span className="text-xs text-muted-foreground">
          {suggested
            ? " · waiting for you"
            : decision.status === "edited"
              ? " · edited from the agent's suggestion"
              : decision.source === "agent"
                ? " · accepted from the agent's suggestion"
                : null}
        </span>
      </p>
    </li>
  );
}
