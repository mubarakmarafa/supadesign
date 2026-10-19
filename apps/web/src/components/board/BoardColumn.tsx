import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import type {
  BoardColumnId,
  LiveEnvironmentSnapshot,
  ProjectBoardColumn,
  ThreadProgress,
} from "@supaterm/contracts";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArchiveIcon, EllipsisIcon, InboxIcon, MonitorPlayIcon, SendIcon } from "lucide-react";
import { memo, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardCard, type BoardCardHandlers } from "./BoardCard";

export const boardColumnDropId = (columnId: BoardColumnId) => `column:${columnId}`;

export interface BoardColumnFlags {
  readonly inbox: boolean;
  readonly live: boolean;
  readonly send: boolean;
  readonly done: boolean;
}

function ColumnTitleEditor({
  title,
  onCommit,
}: {
  title: string;
  onCommit: (title: string | null) => void;
}) {
  const [value, setValue] = useState(title);
  // Enter, Escape, and blur each end the edit; only the first one counts.
  const endedRef = useRef(false);
  const end = (next: string | null) => {
    if (endedRef.current) return;
    endedRef.current = true;
    onCommit(next);
  };
  return (
    <Input
      size="compact"
      autoFocus
      aria-label="Column name"
      value={value}
      maxLength={60}
      className="min-w-0 flex-1"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => end(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          end(value);
        } else if (event.key === "Escape") {
          // Escape here cancels the rename and must not reach page shortcuts.
          event.preventDefault();
          event.stopPropagation();
          end(null);
        }
      }}
    />
  );
}

function FlagMarker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground [&_svg]:size-3.5"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

export const BoardColumn = memo(function BoardColumn({
  column,
  flags,
  cards,
  cardCountLabel,
  liveEnvironments,
  bankedCounts,
  progressByThread,
  tabbableCardId,
  peekedCardId,
  canEdit,
  canDrag,
  renaming,
  collapsedBody,
  footer,
  handlers,
  onRenameCommit,
  onStartRename,
  onColumnMenu,
  onListScroll,
}: {
  column: ProjectBoardColumn;
  flags: BoardColumnFlags;
  /** Visible cards, top to bottom. */
  cards: ReadonlyArray<EnvironmentThreadShell>;
  cardCountLabel: string;
  liveEnvironments: ReadonlyMap<string, LiveEnvironmentSnapshot>;
  bankedCounts: ReadonlyMap<string, number>;
  progressByThread: ReadonlyMap<string, ThreadProgress>;
  tabbableCardId: string | null;
  /** The card open in the side peek, shown as selected. */
  peekedCardId: string | null;
  canEdit: boolean;
  canDrag: boolean;
  renaming: boolean;
  /** Replaces the card list while a column is collapsed (Done). */
  collapsedBody: ReactNode;
  footer: ReactNode;
  handlers: BoardCardHandlers;
  onRenameCommit: (columnId: BoardColumnId, title: string | null) => void;
  onStartRename: (columnId: BoardColumnId) => void;
  onColumnMenu: (columnId: BoardColumnId, position: { x: number; y: number }) => void;
  onListScroll: (columnId: BoardColumnId, scrollTop: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: boardColumnDropId(column.id) });
  const headingId = `board-column-${column.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex max-h-full w-[clamp(16.25rem,80vw,20rem)] shrink-0 snap-start flex-col rounded-xl bg-muted/40",
        isOver && "bg-muted/70",
      )}
    >
      <header className="flex min-h-10 items-center gap-1.5 ps-3 pe-1.5 pt-1.5">
        {renaming ? (
          <ColumnTitleEditor
            title={column.title}
            onCommit={(title) => onRenameCommit(column.id, title)}
          />
        ) : (
          <h2
            id={headingId}
            className="min-w-0 truncate text-sm font-medium"
            onDoubleClick={canEdit ? () => onStartRename(column.id) : undefined}
          >
            {column.title}
          </h2>
        )}
        {renaming ? null : (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {cardCountLabel}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        {flags.inbox ? (
          <FlagMarker label="Inbox: new threads land here">
            <InboxIcon />
          </FlagMarker>
        ) : null}
        {flags.live ? (
          <FlagMarker label="Live preview">
            <MonitorPlayIcon />
            <span className="hidden sm:inline">Live</span>
          </FlagMarker>
        ) : null}
        {flags.send ? (
          <FlagMarker label="Send: moving a card here sends its banked messages">
            <SendIcon />
          </FlagMarker>
        ) : null}
        {flags.done ? (
          <FlagMarker label="Done: moving a card here archives its thread">
            <ArchiveIcon />
          </FlagMarker>
        ) : null}
        {canEdit ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Column actions for ${column.title}`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onColumnMenu(column.id, { x: rect.left, y: rect.bottom });
            }}
          >
            <EllipsisIcon />
          </Button>
        ) : null}
      </header>
      <SortableContext
        id={column.id}
        items={cards.map((thread) => thread.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul
          ref={setNodeRef}
          data-board-column-list={column.id}
          aria-labelledby={headingId}
          className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2"
          onScroll={(event) => onListScroll(column.id, event.currentTarget.scrollTop)}
        >
          {cards.map((thread) => (
            <BoardCard
              key={thread.id}
              thread={thread}
              live={liveEnvironments.get(thread.id)}
              progress={progressByThread.get(thread.id)}
              bankedCount={bankedCounts.get(thread.id) ?? 0}
              tabbable={thread.id === tabbableCardId}
              peeked={thread.id === peekedCardId}
              canDrag={canDrag}
              handlers={handlers}
            />
          ))}
          {collapsedBody}
        </ul>
      </SortableContext>
      {footer}
    </section>
  );
});
