import type {
  EnvironmentId,
  ScopedThreadRef,
  ThreadProgress,
  ThreadProgressUpdate,
} from "@supaterm/contracts";
import {
  CameraIcon,
  Columns2Icon,
  HistoryIcon,
  MessageCircleQuestionIcon,
  MessageSquareReplyIcon,
  PencilLineIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useAssetUrlState, useAssetUrls } from "../../assets/assetUrls";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "~/lib/utils";
import { threadProgress } from "../../state/threadProgress";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatDayAwareTimestamp, formatRelativeTimeLabel } from "../../timestampFormat";
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
import { ProgressMarkup } from "./ProgressMarkup";
import {
  type ComparePair,
  comparedUpdates,
  initialComparePair,
  pickForComparison,
} from "./progressCompare.logic";
import { addProgressImageToComposer, progressImageResource } from "./progressImage";

function displayUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

/** Viewing one image, marking it up for a reply, or comparing two side by side. */
type ViewerMode =
  | { readonly kind: "view" }
  | { readonly kind: "markup"; readonly attached: number }
  | { readonly kind: "compare"; readonly pair: ComparePair };

const VIEW: ViewerMode = { kind: "view" };

function QuestionList({ questions }: { questions: ReadonlyArray<string> }) {
  if (questions.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {questions.map((question) => (
        <li key={question} className="flex gap-1.5 text-sm text-warning-foreground">
          <MessageCircleQuestionIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {question}
        </li>
      ))}
    </ul>
  );
}

/** One side of a comparison: the image, when it was taken, and what the agent said about it. */
function ComparePane({
  update,
  url,
  title,
}: {
  update: ThreadProgressUpdate;
  url: string | null | undefined;
  title: string;
}) {
  const { timestampFormat } = useClientSettings();
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div className="overflow-hidden rounded-lg border bg-muted">
        {url ? (
          <img
            src={url}
            alt={update.note ?? `Progress of ${title}`}
            width={update.width}
            height={update.height}
            className="block h-auto max-h-[50vh] w-full object-contain object-top"
          />
        ) : (
          <div className="w-full" style={{ aspectRatio: `${update.width} / ${update.height}` }} />
        )}
      </div>
      <figcaption className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          <time dateTime={update.createdAt}>
            {formatDayAwareTimestamp(update.createdAt, timestampFormat)}
          </time>{" "}
          · {formatRelativeTimeLabel(update.createdAt)} · {captureSourceLabel(update.source)}
        </p>
        {update.note ? <p className="text-sm">{update.note}</p> : null}
        <QuestionList questions={update.questions} />
      </figcaption>
    </figure>
  );
}

/**
 * A card's progress images, newest first: the image, what the agent said about
 * it, and its questions. Reply puts the exact image into the thread's
 * composer; Mark up annotates it the way design mode annotates the preview;
 * Compare shows two of them side by side.
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
  const [mode, setMode] = useState<ViewerMode>(VIEW);
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
  const compared = mode.kind === "compare" ? comparedUpdates(progress.updates, mode.pair) : null;
  const urlFor = (update: ThreadProgressUpdate) =>
    thumbnailUrls[newestFirst.findIndex((entry) => entry.id === update.id)];

  const showComposer = () => {
    onOpenChange(false);
    onReplied?.();
  };

  const reply = async () => {
    if (imageState._tag !== "Success") return;
    setReplying(true);
    try {
      await addProgressImageToComposer(threadRef, imageState.url);
      showComposer();
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

  const startCompare = () => {
    const pair = initialComparePair(progress.updates, selected?.id);
    if (pair !== null) setMode({ kind: "compare", pair });
  };

  return (
    <Dialog
      open
      onOpenChange={(open, eventDetails) => {
        // Escape leaves markup or comparison first; marks already attached stay in the composer.
        if (!open && eventDetails.reason === "escape-key" && mode.kind !== "view") {
          eventDetails.cancel();
          setMode(VIEW);
          return;
        }
        onOpenChange(open);
      }}
    >
      <DialogPopup className={cn("sm:max-w-4xl", mode.kind === "compare" && "sm:max-w-6xl")}>
        <DialogHeader>
          <DialogTitle>
            {mode.kind === "markup"
              ? "Mark up progress"
              : mode.kind === "compare"
                ? "Compare progress"
                : "Progress"}
          </DialogTitle>
          <DialogDescription>
            {mode.kind === "compare" ? `${title} · pick any two images below` : title}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            {mode.kind === "view" && state?.kind === "stale" && selected === latest ? (
              <p className="flex items-center gap-1.5 text-xs text-warning-foreground">
                <HistoryIcon aria-hidden className="size-3.5 shrink-0" />
                The agent has worked since this image was taken.
              </p>
            ) : null}
            {mode.kind === "view" && state?.kind === "failed" ? (
              <p className="flex items-center gap-1.5 text-xs text-destructive-foreground">
                <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
                The last capture failed: {state.reason}
              </p>
            ) : null}
            {selected === undefined ? (
              <p className="text-sm text-muted-foreground">
                No images yet. Capture the running card, or wait for its agent to publish one.
              </p>
            ) : mode.kind === "markup" && imageState._tag === "Success" ? (
              <ProgressMarkup
                // A different image starts with no marks.
                key={selected.id}
                threadRef={threadRef}
                update={selected}
                imageUrl={imageState.url}
                onAttached={() =>
                  setMode((current) =>
                    current.kind === "markup"
                      ? { kind: "markup", attached: current.attached + 1 }
                      : current,
                  )
                }
              />
            ) : compared !== null ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {compared.map((update) => (
                  <ComparePane key={update.id} update={update} url={urlFor(update)} title={title} />
                ))}
              </div>
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
                  <QuestionList questions={selected.questions} />
                  <p className="text-xs text-muted-foreground">
                    {captureSourceLabel(selected.source)} ·{" "}
                    {formatRelativeTimeLabel(selected.createdAt)} · {displayUrl(selected.url)}
                  </p>
                </div>
              </>
            )}
            {newestFirst.length > 1 && mode.kind !== "markup" ? (
              <div
                role="listbox"
                aria-label={mode.kind === "compare" ? "Images to compare" : "Earlier images"}
                aria-multiselectable={mode.kind === "compare" || undefined}
                className="flex gap-2 overflow-x-auto pb-1"
              >
                {newestFirst.map((update, index) => {
                  const url = thumbnailUrls[index];
                  const isSelected =
                    mode.kind === "compare"
                      ? mode.pair.includes(update.id)
                      : update.id === selected?.id;
                  return (
                    <button
                      key={update.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      aria-label={`Image from ${formatRelativeTimeLabel(update.createdAt)}`}
                      onClick={() =>
                        mode.kind === "compare"
                          ? setMode({
                              kind: "compare",
                              pair: pickForComparison(mode.pair, update.id),
                            })
                          : setSelectedId(update.id)
                      }
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
          {mode.kind === "markup" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setMode(VIEW)}>
                Back
              </Button>
              {mode.attached > 0 ? (
                <Button size="sm" onClick={showComposer}>
                  <MessageSquareReplyIcon />
                  {mode.attached === 1 ? "Reply with 1 mark" : `Reply with ${mode.attached} marks`}
                </Button>
              ) : null}
            </>
          ) : mode.kind === "compare" ? (
            <Button variant="outline" size="sm" onClick={() => setMode(VIEW)}>
              Back
            </Button>
          ) : (
            <>
              {selected !== undefined ? (
                <Button
                  variant="ghost-destructive"
                  size="sm"
                  className="sm:me-auto"
                  onClick={() => {
                    const updateId = selected.id;
                    setSelectedId(null);
                    void remove({
                      environmentId,
                      input: { threadId: threadRef.threadId, updateId },
                    });
                  }}
                >
                  <Trash2Icon />
                  Remove image
                </Button>
              ) : null}
              {newestFirst.length > 1 ? (
                <Button variant="outline" size="sm" onClick={startCompare}>
                  <Columns2Icon />
                  Compare
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
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={imageState._tag !== "Success"}
                    onClick={() => setMode({ kind: "markup", attached: 0 })}
                  >
                    <PencilLineIcon />
                    Mark up
                  </Button>
                  <Button
                    size="sm"
                    disabled={replying || imageState._tag !== "Success"}
                    onClick={() => void reply()}
                  >
                    <MessageSquareReplyIcon />
                    Reply with this image
                  </Button>
                </>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
