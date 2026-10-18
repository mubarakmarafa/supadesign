import type {
  EnvironmentId,
  ScopedThreadRef,
  ThreadProgress,
  ThreadProgressUpdate,
} from "@supaterm/contracts";
import {
  CameraIcon,
  HistoryIcon,
  MessageCircleQuestionIcon,
  MessageSquareReplyIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useAssetUrlState, useAssetUrls } from "../../assets/assetUrls";
import { cn } from "~/lib/utils";
import { threadProgress } from "../../state/threadProgress";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { captureSourceLabel, coverState } from "./cardProgress.logic";
import { addProgressImageToComposer, progressImageResource } from "./progressImage";

function displayUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * A card's progress images, newest first: the image, what the agent said about
 * it, and its questions. Reply puts the exact image into the thread's composer.
 */
export function ProgressViewer({
  environmentId,
  threadRef,
  title,
  progress,
  latestRunStartedAt,
  canCapture,
  onOpenChange,
  onReplied,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  title: string;
  progress: ThreadProgress;
  latestRunStartedAt: string | null | undefined;
  /** Whether the card has a running page to capture right now. */
  canCapture: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shows the composer the image went into, when it isn't on screen already. */
  onReplied?: () => void;
}) {
  const newestFirst = useMemo(() => progress.updates.toReversed(), [progress.updates]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: ThreadProgressUpdate | undefined =
    newestFirst.find((update) => update.id === selectedId) ?? newestFirst[0];
  const latest = newestFirst[0];
  const capture = useAtomCommand(threadProgress.capture);
  const remove = useAtomCommand(threadProgress.remove);
  const imageState = useAssetUrlState(
    environmentId,
    selected === undefined ? null : progressImageResource(selected),
  );
  const thumbnailResources = useMemo(() => newestFirst.map(progressImageResource), [newestFirst]);
  const thumbnailUrls = useAssetUrls(environmentId, thumbnailResources);
  const [replying, setReplying] = useState(false);
  const state = latest === undefined ? null : coverState(progress, latest, latestRunStartedAt);
  const capturing = progress.capture?._tag === "capturing";
  const threadInput = { environmentId, input: { threadId: threadRef.threadId } };

  const reply = async () => {
    if (imageState._tag !== "Success") return;
    setReplying(true);
    try {
      await addProgressImageToComposer(threadRef, imageState.url);
      onOpenChange(false);
      onReplied?.();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn't add the image",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    } finally {
      setReplying(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Progress</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            {state?.kind === "stale" && selected === latest ? (
              <p className="flex items-center gap-1.5 text-xs text-warning-foreground">
                <HistoryIcon aria-hidden className="size-3.5 shrink-0" />
                The agent has worked since this image was taken.
              </p>
            ) : null}
            {state?.kind === "failed" ? (
              <p className="flex items-center gap-1.5 text-xs text-destructive-foreground">
                <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
                The last capture failed: {state.reason}
              </p>
            ) : null}
            {selected === undefined ? (
              <p className="text-sm text-muted-foreground">
                No images yet. Capture the running card, or wait for its agent to publish one.
              </p>
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border bg-muted">
                  {imageState._tag === "Success" ? (
                    <img
                      src={imageState.url}
                      alt={selected.note ?? `Progress of ${title}`}
                      width={selected.width}
                      height={selected.height}
                      className="block h-auto max-h-[60vh] w-full object-contain object-top"
                    />
                  ) : (
                    <div
                      className="w-full"
                      style={{ aspectRatio: `${selected.width} / ${selected.height}` }}
                    />
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {selected.note ? <p className="text-sm">{selected.note}</p> : null}
                  {selected.questions.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {selected.questions.map((question) => (
                        <li key={question} className="flex gap-1.5 text-sm text-warning-foreground">
                          <MessageCircleQuestionIcon
                            aria-hidden
                            className="mt-0.5 size-3.5 shrink-0"
                          />
                          {question}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {captureSourceLabel(selected.source)} ·{" "}
                    {formatRelativeTimeLabel(selected.createdAt)} · {displayUrl(selected.url)}
                  </p>
                </div>
              </>
            )}
            {newestFirst.length > 1 ? (
              <div
                role="listbox"
                aria-label="Earlier images"
                className="flex gap-2 overflow-x-auto pb-1"
              >
                {newestFirst.map((update, index) => {
                  const url = thumbnailUrls[index];
                  const isSelected = update.id === selected?.id;
                  return (
                    <button
                      key={update.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      aria-label={`Image from ${formatRelativeTimeLabel(update.createdAt)}`}
                      onClick={() => setSelectedId(update.id)}
                      className={cn(
                        "relative aspect-[16/10] w-28 shrink-0 cursor-pointer overflow-hidden rounded-md border bg-muted outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        isSelected && "border-primary ring-1 ring-primary",
                      )}
                    >
                      {url ? (
                        <img
                          src={url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover object-top"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          {selected !== undefined ? (
            <Button
              variant="ghost-destructive"
              size="sm"
              className="sm:me-auto"
              onClick={() => {
                const updateId = selected.id;
                setSelectedId(null);
                void remove({ environmentId, input: { threadId: threadRef.threadId, updateId } });
              }}
            >
              <Trash2Icon />
              Remove image
            </Button>
          ) : null}
          {canCapture ? (
            <Button
              variant="outline"
              size="sm"
              disabled={capturing}
              onClick={() => {
                setSelectedId(null);
                void capture(threadInput);
              }}
            >
              <CameraIcon />
              {capturing ? "Capturing…" : "Capture now"}
            </Button>
          ) : null}
          {selected !== undefined ? (
            <Button
              size="sm"
              disabled={replying || imageState._tag !== "Success"}
              onClick={() => void reply()}
            >
              <MessageSquareReplyIcon />
              Reply with this image
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
