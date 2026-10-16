import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import type { EnvironmentId, LiveEnvironmentSnapshot } from "@supaterm/contracts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EllipsisIcon, PiggyBankIcon } from "lucide-react";
import { memo, type KeyboardEvent, type MouseEvent } from "react";

import { cn } from "~/lib/utils";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { LiveEnvironmentCardStatus } from "./LiveEnvironmentStatus";

export interface BoardCardHandlers {
  readonly onOpen: (threadId: string) => void;
  /** A single click: shows the card's thread in the side peek. */
  readonly onPeek: (threadId: string) => void;
  readonly onFocusCard: (threadId: string) => void;
  readonly onCardKeyDown: (threadId: string, event: KeyboardEvent<HTMLElement>) => void;
  readonly onCardMenu: (threadId: string, position: { x: number; y: number }) => void;
}

/** The short line under a card's title: the thread's goal when it has one. */
function cardIntent(thread: EnvironmentThreadShell): string | null {
  return thread.goal?.objective ?? null;
}

/** A card's face, shared by the sortable card and the drag overlay. */
export function BoardCardFace({ thread }: { thread: EnvironmentThreadShell }) {
  const status = resolveThreadStatusPill({ thread });
  const intent = cardIntent(thread);
  return (
    <>
      <span className="line-clamp-2 text-sm font-medium wrap-anywhere text-foreground">
        {thread.title}
      </span>
      {intent ? (
        <span className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground">{intent}</span>
      ) : null}
      {status ? (
        // The sidebar pulses live statuses; a board shows many at once, so it stays still.
        <span className={cn("flex items-center gap-1.5 text-xs", status.colorClass)}>
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)} />
          {status.label}
        </span>
      ) : null}
    </>
  );
}

const CARD_CLASS =
  "group/card relative flex w-full cursor-default flex-col gap-1.5 rounded-lg border bg-card p-2.5 pe-8 text-start shadow-xs outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export const BoardCard = memo(function BoardCard({
  thread,
  live,
  bankedCount,
  tabbable,
  peeked,
  canDrag,
  handlers,
}: {
  thread: EnvironmentThreadShell;
  /** The card's live environment, when it has one. */
  live: LiveEnvironmentSnapshot | undefined;
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
        // whose actions are Enter, double-click, and its menu.
        role="article"
        aria-roledescription="card"
        aria-label={thread.title}
        tabIndex={tabbable ? 0 : -1}
        aria-current={peeked ? "true" : undefined}
        data-board-card-id={thread.id}
        className={cn(CARD_CLASS, peeked && "border-primary/60 bg-accent/40")}
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
        <BoardCardFace thread={thread} />
        {bankedCount > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PiggyBankIcon aria-hidden className="size-3 shrink-0" />
            {bankedCount} banked
          </span>
        ) : null}
        {live ? (
          <LiveEnvironmentCardStatus
            environmentId={thread.environmentId as EnvironmentId}
            snapshot={live}
          />
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost-muted"
          tabIndex={-1}
          aria-label={`Actions for ${thread.title}`}
          className="absolute end-1.5 top-1.5"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={openMenuAt}
        >
          <EllipsisIcon />
        </Button>
      </article>
    </li>
  );
});

export function BoardCardOverlay({ thread }: { thread: EnvironmentThreadShell }) {
  return (
    <div className={cn(CARD_CLASS, "shadow-lg")}>
      <BoardCardFace thread={thread} />
    </div>
  );
}
