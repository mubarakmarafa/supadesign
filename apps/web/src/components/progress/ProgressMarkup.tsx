import type {
  PreviewAnnotationPoint,
  PreviewAnnotationScreenshot,
  ScopedThreadRef,
  ThreadProgressUpdate,
} from "@supaterm/contracts";
import { normalizeRect } from "@supaterm/shared/annotationShapes";
import { CircleIcon, EraserIcon, MoveUpRightIcon, PencilIcon, SquareIcon } from "lucide-react";
import { type PointerEvent, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { previewAnnotationComposerItems } from "../../lib/previewAnnotation";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  commitDraft,
  draftStroke,
  eraseMarkAt,
  hasMarks,
  type ImageMarks,
  type MarkDraft,
  type MarkStyle,
  type MarkupTool,
  markupToolForKey,
  NO_MARKS,
  progressImageAnnotation,
} from "./progressMarkup.logic";
import { markStrokePath, renderMarkedCrop } from "./progressMarkupCrop";

/** Design mode's line widths, in screen pixels. */
const STROKE_WIDTH = 4;
const REGION_LINE_WIDTH = 2;

const TOOLS: ReadonlyArray<{
  readonly tool: MarkupTool;
  readonly label: string;
  readonly Icon: typeof SquareIcon;
}> = [
  { tool: "box", label: "Box an area (B)", Icon: SquareIcon },
  { tool: "circle", label: "Circle an area (O)", Icon: CircleIcon },
  { tool: "arrow", label: "Point with an arrow (A)", Icon: MoveUpRightIcon },
  { tool: "pen", label: "Draw freehand (P)", Icon: PencilIcon },
  { tool: "erase", label: "Erase a mark (E)", Icon: EraserIcon },
];

/** A mark being drawn and how it will look. */
interface Drawing {
  readonly draft: MarkDraft;
  readonly style: MarkStyle;
}

const isMarkupTool = (value: unknown): value is MarkupTool =>
  TOOLS.some((entry) => entry.tool === value);

/**
 * Design mode for a past progress image: box, circle, arrow and pen marks on
 * that exact capture, a comment, and Attach, which puts the marked crop and
 * comment into the thread's composer as one citation, as design mode does for
 * the live preview. The image is already frozen, so it works on every client.
 */
export function ProgressMarkup({
  threadRef,
  update,
  imageUrl,
  onAttached,
}: {
  threadRef: ScopedThreadRef;
  update: ThreadProgressUpdate;
  /** The image's signed URL, already loaded. */
  imageUrl: string;
  onAttached: () => void;
}) {
  const [tool, setTool] = useState<MarkupTool>("box");
  const [marks, setMarks] = useState<ImageMarks>(NO_MARKS);
  const [drawing, setDrawingState] = useState<Drawing | null>(null);
  // Pointer events can outrun renders, so handlers read the latest draft here.
  const drawingRef = useRef<Drawing | null>(null);
  const setDrawing = (next: Drawing | null) => {
    drawingRef.current = next;
    setDrawingState(next);
  };
  const [comment, setComment] = useState("");
  const [attaching, setAttaching] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  /** Image pixels per screen pixel right now. */
  const currentScale = () => {
    const width = svgRef.current?.getBoundingClientRect().width ?? 0;
    return width > 0 ? update.width / width : 1;
  };

  const toImagePoint = (event: PointerEvent<SVGSVGElement>): PreviewAnnotationPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width > 0 ? update.width / rect.width : 1;
    return {
      x: Math.min(update.width, Math.max(0, (event.clientX - rect.left) * scale)),
      y: Math.min(update.height, Math.max(0, (event.clientY - rect.top) * scale)),
    };
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || attaching) return;
    event.preventDefault();
    const point = toImagePoint(event);
    if (tool === "erase") {
      setMarks((current) => eraseMarkAt(current, point));
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const scale = currentScale();
    setDrawing({
      draft: tool === "pen" ? { tool, points: [point] } : { tool, start: point, end: point },
      style: {
        id: `mark_${randomUUID()}`,
        color: getComputedStyle(event.currentTarget).color,
        width: STROKE_WIDTH * scale,
        scale,
      },
    });
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = drawingRef.current;
    if (current === null) return;
    const point = toImagePoint(event);
    const { draft } = current;
    setDrawing({
      ...current,
      draft:
        draft.tool === "pen"
          ? { ...draft, points: [...draft.points, point] }
          : { ...draft, end: point },
    });
  };

  const finishDraft = () => {
    const finished = drawingRef.current;
    if (finished === null) return;
    setMarks((current) => commitDraft(current, finished.draft, finished.style));
    setDrawing(null);
    // Comment right after marking, as design mode does.
    commentRef.current?.focus({ preventScroll: true });
  };

  const attach = async () => {
    if (attaching || !hasMarks(marks)) return;
    const prepared = progressImageAnnotation({
      id: `annotation_${randomUUID()}`,
      update,
      marks,
      comment,
      createdAt: new Date().toISOString(),
    });
    if (prepared === null) return;
    setAttaching(true);
    let screenshot: PreviewAnnotationScreenshot | null = null;
    try {
      screenshot = await renderMarkedCrop({
        imageUrl,
        frame: update,
        marks,
        cropRect: prepared.cropRect,
        color: svgRef.current ? getComputedStyle(svgRef.current).color : "#2563eb",
        regionLineWidth: REGION_LINE_WIDTH * currentScale(),
      });
    } catch {
      screenshot = null;
    }
    const { annotation, image, captureFailed } = previewAnnotationComposerItems({
      ...prepared.annotation,
      screenshot,
    });
    const store = useComposerDraftStore.getState();
    const imageAdded = image !== null && store.addImage(threadRef, image);
    // Without its image the citation must not claim a screenshot.
    store.addPreviewAnnotation(
      threadRef,
      imageAdded ? annotation : { ...annotation, screenshot: null },
    );
    if (!imageAdded) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not capture the marked area",
          description:
            screenshot !== null && !captureFailed
              ? "The composer is full, so the annotation was kept without the screenshot."
              : "The annotation was kept without the screenshot.",
        }),
      );
    }
    setMarks(NO_MARKS);
    setComment("");
    setAttaching(false);
    onAttached();
    surfaceRef.current?.focus({ preventScroll: true });
  };

  const draft = drawing?.draft ?? null;
  const draftRegion = draft?.tool === "box" ? normalizeRect(draft.start, draft.end) : null;
  const draftLine = drawing === null ? null : draftStroke(drawing.draft, drawing.style);

  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      className="flex flex-col gap-2 outline-none"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const next = markupToolForKey(event.key);
        if (next === null) return;
        event.preventDefault();
        setTool(next);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          aria-label="Markup tool"
          variant="segmented"
          value={[tool]}
          onValueChange={(value) => {
            const next = value[0];
            if (isMarkupTool(next)) setTool(next);
          }}
        >
          {TOOLS.map(({ tool: entry, label, Icon }) => (
            <Toggle key={entry} value={entry} aria-label={label} title={label}>
              <Icon />
            </Toggle>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          Mark the image, describe the change, then attach it to your reply.
        </p>
      </div>
      <div className="flex justify-center overflow-hidden rounded-lg border bg-muted">
        {/* Sized from the capture's aspect ratio so the marks layer covers exactly the image. */}
        <div
          className="relative"
          style={{
            aspectRatio: `${update.width} / ${update.height}`,
            width: `min(100%, calc(55vh * ${update.width / update.height}))`,
          }}
        >
          <img
            src={imageUrl}
            alt={update.note ?? "Progress image"}
            width={update.width}
            height={update.height}
            draggable={false}
            className="absolute inset-0 size-full select-none"
          />
          <svg
            ref={svgRef}
            role="img"
            aria-label="Marks on the image"
            viewBox={`0 0 ${update.width} ${update.height}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full cursor-crosshair touch-none text-primary"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishDraft}
            onPointerCancel={finishDraft}
          >
            {marks.regions.map((region) => (
              <rect
                key={region.id}
                {...region.rect}
                fill="currentColor"
                fillOpacity={0.06}
                stroke="currentColor"
                strokeWidth={REGION_LINE_WIDTH}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {marks.strokes.map((stroke) => (
              <path
                key={stroke.id}
                d={markStrokePath(marks, stroke)}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {draftRegion ? (
              <rect
                {...draftRegion}
                fill="currentColor"
                fillOpacity={0.06}
                stroke="currentColor"
                strokeWidth={REGION_LINE_WIDTH}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {draftLine ? (
              <path
                d={markStrokePath(
                  {
                    ...NO_MARKS,
                    smoothStrokeIds: draft?.tool === "pen" ? [draftLine.id] : [],
                  },
                  draftLine,
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth={draftLine.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </svg>
        </div>
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          ref={commentRef}
          rows={1}
          size="sm"
          aria-label="Comment on the marks"
          placeholder="Describe the change…"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void attach();
          }}
        />
        <Button size="sm" disabled={attaching || !hasMarks(marks)} onClick={() => void attach()}>
          {attaching ? "Attaching…" : "Attach"}
        </Button>
      </div>
    </div>
  );
}
