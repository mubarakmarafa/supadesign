import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import type {
  EnvironmentId,
  LiveEnvironmentSnapshot,
  ThreadProgress,
  ThreadProgressUpdate,
} from "@supaterm/contracts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  EllipsisIcon,
  HistoryIcon,
  LayersIcon,
  Maximize2Icon,
  MessageCircleQuestionIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { memo, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { cn } from "~/lib/utils";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { cardSummaryText, coverState, type CoverState } from "../progress/cardProgress.logic";
import { progressImageResource } from "../progress/progressImage";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { LiveEnvironmentCardStatus } from "./LiveEnvironmentStatus";

export interface BoardCardHandlers {
  readonly onOpen: (threadId: string) => void;
  /** A single click: shows the card's thread in the side peek. */
  readonly onPeek: (threadId: string) => void;
  readonly onFocusCard: (threadId: string) => void;
  readonly onCardKeyDown: (threadId: string, event: KeyboardEvent<HTMLElement>) => void;
  readonly onCardMenu: (threadId: string, position: { x: number; y: number }) => void;
  /** Opens the card's progress images. */
  readonly onViewProgress: (threadId: string) => void;
}

/** Keeps a press on a card's own controls from starting a drag. */
const stopDrag = (event: { stopPropagation: () => void }) => event.stopPropagation();

const COVER_BADGES: Record<
  Exclude<CoverState["kind"], "current">,
  { readonly icon: ReactNode; readonly label: string; readonly detail: string }
> = {
  stale: {
    icon: <HistoryIcon aria-hidden />,
    label: "Out of date",
    detail: "The agent has worked since this image was taken.",
  },
  capturing: { icon: null, label: "Capturing…", detail: "Taking a new image of the running app." },
  failed: { icon: <TriangleAlertIcon aria-hidden />, label: "Capture failed", detail: "" },
};

/** The card's latest progress image, marked when it no longer shows the latest work. */
function CardCover({
  environmentId,
  cover,
  state,
  onView,
}: {
  environmentId: EnvironmentId;
  cover: ThreadProgressUpdate;
  state: CoverState;
  onView: (() => void) | null;
}) {
  const image = useAssetUrlState(environmentId, progressImageResource(cover));
  const badge = state.kind === "current" ? null : COVER_BADGES[state.kind];
  return (
    <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden border-b bg-muted">
      {image._tag === "Success" ? (
        <img
          src={image.url}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="size-full object-cover object-top"
        />
      ) : null}
      {badge ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="absolute start-1.5 bottom-1.5 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-2xs font-medium text-white [&_svg]:size-3" />
            }
          >
            {badge.icon}
            {badge.label}
          </TooltipTrigger>
          <TooltipPopup side="top">
            {state.kind === "failed" ? state.reason : badge.detail}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {onView ? (
        <span className="absolute end-1.5 bottom-1.5 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-within/card:opacity-100 pointer-coarse:opacity-100">
          <Button
            size="icon-xs"
            variant="media-close"
            tabIndex={-1}
            aria-label="View progress images"
            onPointerDown={stopDrag}
            onDoubleClick={stopDrag}
            onClick={onView}
          >
            <Maximize2Icon />
          </Button>
        </span>
      ) : null}
    </div>
  );
}

/**
 * A card's face, shared by the sortable card and the drag overlay: its latest
 * progress image, title, summary, and state.
 */
function BoardCardFace({
  thread,
  progress,
  bankedCount,
  onViewProgress,
}: {
  thread: EnvironmentThreadShell;
  progress: ThreadProgress | undefined;
  bankedCount: number;
  onViewProgress: (() => void) | null;
}) {
  const status = resolveThreadStatusPill({ thread });
  // A card made on the board holds only its note until something is sent.
  const notStarted = thread.latestRun == null && thread.latestUserMessageAt == null;
  const summary = cardSummaryText(progress, thread.goal?.objective);
  const cover = progress?.updates.at(-1);
  const questions = cover?.questions.length ?? 0;
  return (
    <>
      {progress && cover ? (
        <CardCover
          environmentId={thread.environmentId as EnvironmentId}
          cover={cover}
          state={coverState(progress, cover, thread.latestRun?.startedAt)}
          onView={onViewProgress}
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-1.5 px-3 pt-2.5 pb-3">
        <span className="line-clamp-2 pe-6 text-sm leading-snug font-medium wrap-anywhere text-foreground">
          {thread.title}
        </span>
        {summary ? (
          <span className="line-clamp-3 text-xs leading-relaxed wrap-anywhere text-muted-foreground">
            {summary}
          </span>
        ) : null}
        {status || notStarted || bankedCount > 0 || questions > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs">
            {status ? (
              // The sidebar pulses live statuses; a board shows many at once, so it stays still.
              <span className={cn("flex items-center gap-1.5", status.colorClass)}>
                <span
                  aria-hidden
                  className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)}
                />
                {status.label}
              </span>
            ) : notStarted ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full border border-current"
                />
                Not started
              </span>
            ) : null}
            {questions > 0 ? (
              onViewProgress ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className="flex cursor-pointer items-center gap-1 rounded-sm text-warning-foreground underline-offset-2 hover:underline"
                  onPointerDown={stopDrag}
                  onDoubleClick={stopDrag}
                  onClick={onViewProgress}
                >
                  <MessageCircleQuestionIcon aria-hidden className="size-3 shrink-0" />
                  {questions === 1 ? "1 question" : `${questions} questions`}
                </button>
              ) : (
                <span className="flex items-center gap-1 text-warning-foreground">
                  <MessageCircleQuestionIcon aria-hidden className="size-3 shrink-0" />
                  {questions === 1 ? "1 question" : `${questions} questions`}
                </span>
              )
            ) : null}
            {bankedCount > 0 ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <LayersIcon aria-hidden className="size-3 shrink-0" />
                {bankedCount} banked
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

const CARD_CLASS =
  "group/card relative flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-start shadow-xs outline-none select-none transition-[translate,box-shadow,border-color] duration-150 ease-out hover:-translate-y-px hover:border-foreground/15 hover:shadow-md active:translate-y-0 active:shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none motion-reduce:hover:translate-y-0";

export const BoardCard = memo(function BoardCard({
  thread,
  live,
  progress,
  bankedCount,
  tabbable,
  peeked,
  canDrag,
  handlers,
}: {
  thread: EnvironmentThreadShell;
  /** The card's live environment, when it has one. */
  live: LiveEnvironmentSnapshot | undefined;
  /** The card's progress images and summary. */
  progress: ThreadProgress | undefined;
  /** Messages banked on the card, waiting to be sent together. */
  bankedCount: number;
  /** Roving tabindex: exactly one card on the board is in the tab order. */
  tabbable: boolean;
  peeked: boolean;
  canDrag: boolean;
  handlers: BoardCardHandlers;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: thread.id,
    disabled: !canDrag,
  });
  const openMenuAt = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    handlers.onCardMenu(thread.id, { x: rect.left, y: rect.bottom });
  };
  const hasCover = (progress?.updates.length ?? 0) > 0;

  return (
    <li
      ref={setNodeRef}
      // Runtime transform from dnd-kit while sorting.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("list-none", isDragging && "opacity-40")}
    >
      <article
        {...attributes}
        {...listeners}
        // dnd-kit's attributes make the node a button; the card is an article
        // whose actions are a click (peek), Enter or double-click (open), and its menu.
        role="article"
        aria-roledescription="card"
        aria-label={thread.title}
        tabIndex={tabbable ? 0 : -1}
        aria-current={peeked ? "true" : undefined}
        data-board-card-id={thread.id}
        className={cn(
          CARD_CLASS,
          peeked && "border-primary/60 ring-1 ring-primary/40 hover:border-primary/60",
        )}
        onClick={(event) => {
          // The card's own buttons and links act on their own.
          if (event.target instanceof Element && event.target.closest("button, a")) return;
          handlers.onPeek(thread.id);
        }}
        onFocus={(event) => {
          if (event.target === event.currentTarget) handlers.onFocusCard(thread.id);
        }}
        onDoubleClick={() => handlers.onOpen(thread.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          handlers.onCardKeyDown(thread.id, event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          handlers.onCardMenu(thread.id, { x: event.clientX, y: event.clientY });
        }}
      >
        <BoardCardFace
          thread={thread}
          progress={progress}
          bankedCount={bankedCount}
          onViewProgress={() => handlers.onViewProgress(thread.id)}
        />
        {live ? (
          <div className="px-3 pb-2.5">
            <LiveEnvironmentCardStatus
              environmentId={thread.environmentId as EnvironmentId}
              snapshot={live}
            />
          </div>
        ) : null}
        <span
          className={cn(
            "absolute end-1.5 top-1.5 rounded-md opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-within/card:opacity-100 pointer-coarse:opacity-100",
            // Over an image the button needs its own backing to stay readable.
            hasCover && "bg-background/90 shadow-xs",
          )}
        >
          <Button
            size="icon-xs"
            variant="ghost-muted"
            tabIndex={-1}
            aria-label={`Actions for ${thread.title}`}
            onPointerDown={stopDrag}
            onClick={openMenuAt}
          >
            <EllipsisIcon />
          </Button>
        </span>
      </article>
    </li>
  );
});

export function BoardCardOverlay({
  thread,
  progress,
  bankedCount,
}: {
  thread: EnvironmentThreadShell;
  progress: ThreadProgress | undefined;
  bankedCount: number;
}) {
  return (
    <div className={cn(CARD_CLASS, "-rotate-1 shadow-lg")}>
      <BoardCardFace
        thread={thread}
        progress={progress}
        bankedCount={bankedCount}
        onViewProgress={null}
      />
    </div>
  );
}
