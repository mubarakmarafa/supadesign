import type { EnvironmentId, ProjectId, ThreadBankEntry, ThreadId } from "@supaterm/contracts";
import { replaceComposerContextReferences } from "@supaterm/shared/composerContextReferences";
import {
  CheckIcon,
  GripVerticalIcon,
  PencilIcon,
  PiggyBankIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { cn } from "~/lib/utils";
import { threadBank } from "../../state/threadBank";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel } from "../ui/collapsible";
import { ComposerBanner } from "./ComposerBanner";
import { useThreadBankEntries } from "./threadBankState";

const BANK_DRAG_TYPE = "application/x-supadesign-bank-entry";

/** Where an entry dropped at `insertIndex` lands: the id it moves in front of, or null for the end. */
export function bankDropTarget(
  entries: ReadonlyArray<{ readonly id: string }>,
  draggedId: string,
  insertIndex: number,
): { readonly beforeEntryId: string | null } | null {
  const draggedIndex = entries.findIndex((entry) => entry.id === draggedId);
  if (draggedIndex === -1) return null;
  if (insertIndex === draggedIndex || insertIndex === draggedIndex + 1) return null;
  return { beforeEntryId: entries[insertIndex]?.id ?? null };
}

/**
 * The card's bank above the composer: messages filed with the bank shortcut,
 * readable and editable before they go to the agent together.
 */
export function ThreadBankControl(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly bankShortcutLabel: string | null;
}) {
  const entries = useThreadBankEntries(props.environmentId, props.projectId, props.threadId);
  const send = useAtomCommand(threadBank.send);
  const remove = useAtomCommand(threadBank.remove);
  const reorder = useAtomCommand(threadBank.reorder);
  const update = useAtomCommand(threadBank.update);
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ readonly id: string; readonly text: string } | null>(
    null,
  );
  const [drag, setDrag] = useState<{ readonly id: string; readonly insertIndex: number | null }>();
  const dragArmedIdRef = useRef<string | null>(null);
  const listId = useId();

  const imageIds = useMemo(
    () =>
      entries.flatMap((entry) =>
        entry.attachments.filter((attachment) => attachment.type === "image").map((a) => a.id),
      ),
    [entries],
  );
  const imageResources = useMemo(
    () => imageIds.map((attachmentId) => ({ _tag: "attachment" as const, attachmentId })),
    [imageIds],
  );
  const imageUrls = useAssetUrls(props.environmentId, imageResources);
  const imageUrlById = useMemo(
    () =>
      new Map(imageIds.flatMap((id, index) => (imageUrls[index] ? [[id, imageUrls[index]]] : []))),
    [imageIds, imageUrls],
  );

  const target = { environmentId: props.environmentId };
  const run = async (action: () => Promise<{ readonly _tag: string }>, failure: string) => {
    setBusy(true);
    try {
      const result = await action();
      if (result._tag === "Failure") toastManager.add({ type: "error", title: failure });
      return result._tag !== "Failure";
    } finally {
      setBusy(false);
    }
  };

  const sendAll = () =>
    void run(
      () => send({ ...target, input: { threadId: props.threadId } }),
      "Couldn't send the banked messages",
    );
  const move = (entryId: string, beforeEntryId: string | null) =>
    void run(
      () =>
        reorder({
          ...target,
          input: {
            threadId: props.threadId,
            entryId: entryId as ThreadBankEntry["id"],
            beforeEntryId: beforeEntryId as ThreadBankEntry["id"] | null,
          },
        }),
      "Couldn't reorder the banked messages",
    );
  const saveEdit = async (entry: ThreadBankEntry, text: string) => {
    const saved = await run(
      () =>
        update({
          ...target,
          input: {
            threadId: props.threadId,
            entryId: entry.id,
            text,
            ...(entry.context === undefined ? {} : { context: entry.context }),
            attachments: entry.attachments,
          },
        }),
      "Couldn't save the banked message",
    );
    if (saved) setEditing(null);
  };

  const finishDrag = () => {
    const current = drag;
    setDrag(undefined);
    dragArmedIdRef.current = null;
    if (current === undefined || current.insertIndex === null) return;
    const drop = bankDropTarget(entries, current.id, current.insertIndex);
    if (drop !== null) move(current.id, drop.beforeEntryId);
  };

  const count = entries.length;
  return (
    <ComposerBanner.Drawer key={props.threadId} open={count > 0}>
      <ComposerBanner.Root
        role="region"
        aria-label={`${count} banked message${count === 1 ? "" : "s"}`}
        aria-live="polite"
        data-chat-composer-collapsed-controls="true"
        className="relative z-0"
      >
        <ComposerBanner.Row>
          <button
            type="button"
            aria-label={expanded ? "Collapse banked messages" : "Expand banked messages"}
            aria-expanded={expanded}
            aria-controls={listId}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setExpanded((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-2 text-start outline-none"
          >
            <ComposerBanner.Icon>
              <PiggyBankIcon />
            </ComposerBanner.Icon>
            <ComposerBanner.Content className="text-muted-foreground">
              Banked
              {props.bankShortcutLabel ? (
                <span className="text-muted-foreground/60">
                  {" "}
                  · {props.bankShortcutLabel} adds the composer
                </span>
              ) : null}
            </ComposerBanner.Content>
            <ComposerBanner.Count>{count}</ComposerBanner.Count>
            <ComposerBanner.ToggleIcon expanded={expanded} />
          </button>
          <ComposerBanner.Actions>
            <Button size="xs" variant="outline" disabled={busy || count === 0} onClick={sendAll}>
              <SendIcon />
              Send all
            </Button>
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        <Collapsible open={expanded}>
          <CollapsiblePanel keepMounted>
            <ComposerBanner.Scroll className="max-h-64">
              <ComposerBanner.Children render={<ol />} id={listId}>
                {entries.map((entry, index) => {
                  const thumbnails = entry.attachments.filter(
                    (attachment) => attachment.type === "image",
                  );
                  const files = entry.attachments.filter(
                    (attachment) => attachment.type !== "image",
                  );
                  const text = replaceComposerContextReferences(entry.text, (reference) =>
                    reference.kind === "image" && thumbnails.length > 0 ? "" : reference.label,
                  ).trim();
                  const isEditing = editing?.id === entry.id;
                  return (
                    <ComposerBanner.Row
                      render={<li />}
                      key={entry.id}
                      className={cn(
                        "relative items-start rounded-sm py-1",
                        drag?.id === entry.id && "opacity-50",
                      )}
                      draggable={!busy && !isEditing}
                      onDragStart={(event) => {
                        if (dragArmedIdRef.current !== entry.id) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.setData(BANK_DRAG_TYPE, entry.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDrag({ id: entry.id, insertIndex: null });
                      }}
                      onDragEnd={() => {
                        dragArmedIdRef.current = null;
                        setDrag(undefined);
                      }}
                      onDragOver={(event) => {
                        if (drag === undefined) return;
                        event.preventDefault();
                        const rect = event.currentTarget.getBoundingClientRect();
                        const insertIndex =
                          event.clientY < rect.top + rect.height / 2 ? index : index + 1;
                        if (drag.insertIndex !== insertIndex) setDrag({ ...drag, insertIndex });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        finishDrag();
                      }}
                    >
                      {drag?.insertIndex === index ? (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded bg-primary/70"
                        />
                      ) : null}
                      {index === count - 1 && drag?.insertIndex === count ? (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded bg-primary/70"
                        />
                      ) : null}
                      <ComposerBanner.Icon aria-hidden={false}>
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label="Reorder banked message (drag, or press the arrow keys)"
                          className="cursor-grab active:cursor-grabbing disabled:cursor-default"
                          disabled={busy}
                          onPointerDown={() => {
                            dragArmedIdRef.current = entry.id;
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowUp" && index > 0) {
                              event.preventDefault();
                              move(entry.id, entries[index - 1]!.id);
                            }
                            if (event.key === "ArrowDown" && index < count - 1) {
                              event.preventDefault();
                              move(entry.id, entries[index + 2]?.id ?? null);
                            }
                          }}
                        >
                          <GripVerticalIcon />
                        </Button>
                      </ComposerBanner.Icon>
                      <ComposerBanner.Content className="flex-col items-stretch gap-1 text-foreground/80">
                        {thumbnails.length > 0 || files.length > 0 ? (
                          <span className="flex flex-wrap items-center gap-1">
                            {thumbnails.map((attachment) => {
                              const url = imageUrlById.get(attachment.id);
                              return (
                                <span
                                  key={attachment.id}
                                  className="h-12 w-16 overflow-hidden rounded border border-border/70 bg-muted/60"
                                >
                                  {url ? (
                                    <img
                                      src={url}
                                      alt={attachment.name}
                                      className="size-full object-cover"
                                    />
                                  ) : null}
                                </span>
                              );
                            })}
                            {files.map((attachment) => (
                              <span
                                key={attachment.id}
                                className="max-w-40 truncate rounded border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground"
                              >
                                {attachment.name}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        {isEditing ? (
                          <textarea
                            aria-label="Edit banked message"
                            value={editing.text}
                            rows={3}
                            autoFocus
                            onChange={(event) =>
                              setEditing({ id: entry.id, text: event.target.value })
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                event.stopPropagation();
                                setEditing(null);
                              }
                              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                event.preventDefault();
                                void saveEdit(entry, editing.text);
                              }
                            }}
                            className="w-full resize-y rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:border-ring"
                          />
                        ) : text.length > 0 ? (
                          <span className="line-clamp-4 whitespace-pre-wrap break-words">
                            {text}
                          </span>
                        ) : null}
                      </ComposerBanner.Content>
                      <ComposerBanner.Actions>
                        {isEditing ? (
                          <>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Save banked message"
                              disabled={busy}
                              onClick={() => void saveEdit(entry, editing.text)}
                            >
                              <CheckIcon />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Cancel editing"
                              onClick={() => setEditing(null)}
                            >
                              <XIcon />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Edit banked message"
                              disabled={busy}
                              onClick={() => setEditing({ id: entry.id, text: entry.text })}
                            >
                              <PencilIcon />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Remove banked message"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    remove({
                                      ...target,
                                      input: { threadId: props.threadId, entryId: entry.id },
                                    }),
                                  "Couldn't remove the banked message",
                                )
                              }
                            >
                              <XIcon />
                            </Button>
                          </>
                        )}
                      </ComposerBanner.Actions>
                    </ComposerBanner.Row>
                  );
                })}
              </ComposerBanner.Children>
            </ComposerBanner.Scroll>
          </CollapsiblePanel>
        </Collapsible>
      </ComposerBanner.Root>
    </ComposerBanner.Drawer>
  );
}
