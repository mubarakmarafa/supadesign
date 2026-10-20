import { scopeProjectRef, scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  LIVE_ENVIRONMENT_GRACE_MS,
  type EnvironmentId,
  type LiveEnvironmentDevScriptSuggestion,
  type LiveEnvironmentSnapshot,
  type ProjectId,
  type ScopedThreadRef,
} from "@supaterm/contracts";
import {
  BotIcon,
  ExternalLinkIcon,
  MonitorPlayIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { openUrlInPreview } from "../../browser/openFileInPreview";
import { isPreviewAvailableFor } from "../../browser/previewRuntime";
import { previewEnvironment } from "../../state/preview";
import { cn } from "~/lib/utils";
import { readLocalApi } from "../../localApi";
import { liveEnvironment } from "../../state/liveEnvironment";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { useOpenThreadFromBoard } from "./boardNavigation";
import { displayLiveUrl, useNow, useProjectLiveEnvironments } from "./liveEnvironmentState";

const PHASE_LABELS = {
  worktree: "Checking out…",
  detecting: "An agent is setting up the preview…",
  setup: "Running setup…",
  starting: "Starting dev server…",
} as const;

const TONE_CLASSES = {
  live: { text: "text-emerald-600 dark:text-emerald-300/90", dot: "bg-emerald-500" },
  busy: { text: "text-sky-600 dark:text-sky-300/80", dot: "bg-sky-500 dark:bg-sky-300/80" },
  warm: { text: "text-amber-600 dark:text-amber-300/90", dot: "bg-amber-500" },
  failed: { text: "text-destructive-foreground", dot: "bg-destructive" },
  idle: { text: "text-muted-foreground", dot: "bg-muted-foreground" },
} as const;

type Tone = keyof typeof TONE_CLASSES;

function describe(
  snapshot: LiveEnvironmentSnapshot,
  now: number,
): { readonly tone: Tone; readonly label: string } {
  switch (snapshot.status) {
    case "needs-dev-script":
      return { tone: "idle", label: "Couldn't tell how to start it" };
    case "preparing":
      return {
        tone: "busy",
        label: snapshot.phase === null ? "Starting…" : PHASE_LABELS[snapshot.phase],
      };
    case "stopping":
      return { tone: "idle", label: "Stopping…" };
    case "stopped":
      return { tone: "idle", label: "Stopped" };
    case "kept":
      return { tone: "idle", label: "Not live · checkout kept" };
    case "failed":
      return { tone: "failed", label: "Couldn't start" };
    case "ready": {
      if (snapshot.active || snapshot.warmUntil === null) return { tone: "live", label: "Live" };
      // `now` can lag behind by one tick, so never claim more than the grace period.
      const minutes = Math.min(
        LIVE_ENVIRONMENT_GRACE_MS / 60_000,
        Math.max(1, Math.ceil((snapshot.warmUntil - now) / 60_000)),
      );
      return { tone: "warm", label: `Warm · stops in ${minutes} min` };
    }
  }
}

/**
 * Shows a live link in the thread's in-app preview, beside its chat, so a
 * designer can review and mark it up without leaving the app. Clients without
 * the in-app preview open it in the system browser.
 */
function useShowLivePreview() {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  return async (threadRef: ScopedThreadRef, url: string) => {
    if (!isPreviewAvailableFor(threadRef.environmentId)) {
      openExternally(url);
      return;
    }
    await openUrlInPreview({ threadRef, url, openPreview });
  };
}

function openExternally(url: string) {
  const api = readLocalApi();
  if (api) {
    void api.shell.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Keeps clicks and keys on the status buttons from dragging or opening the
 * card. The rest of the status row still behaves like the card.
 */
export function stopCardGestures(event: {
  stopPropagation: () => void;
  target: EventTarget;
  key?: string;
}) {
  if (!(event.target instanceof Element) || event.target.closest("button") === null) return;
  if (event.key === undefined || event.key === "Enter" || event.key === " ") {
    event.stopPropagation();
  }
}

function LogsButton({ snapshot }: { snapshot: LiveEnvironmentSnapshot }) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="compact" variant="ghost-muted" aria-label="Show dev server output" />}
      >
        <TerminalIcon />
        Output
      </PopoverTrigger>
      <PopoverPopup align="start" aria-label="Dev server output" className="w-96 max-w-[90vw]">
        <div className="flex flex-col gap-2">
          {snapshot.logTail.length > 0 ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere">
              {snapshot.logTail.join("\n")}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">The dev server printed nothing.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Open the card to see its full output in the terminal.
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function DevScriptDialog({
  open,
  onOpenChange,
  environmentId,
  projectId,
  suggestion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  suggestion: LiveEnvironmentDevScriptSuggestion | null;
}) {
  const id = useId();
  const saveDevScript = useAtomCommand(liveEnvironment.saveDevScript);
  const [command, setCommand] = useState(suggestion?.command ?? "");
  const [previewUrl, setPreviewUrl] = useState(suggestion?.previewUrl ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmedCommand = command.trim();
            if (trimmedCommand.length === 0) return;
            const trimmedUrl = previewUrl.trim();
            setSaving(true);
            void saveDevScript({
              environmentId,
              input: {
                projectId,
                command: trimmedCommand,
                ...(trimmedUrl.length > 0 ? { previewUrl: trimmedUrl } : {}),
              },
            }).then((result) => {
              setSaving(false);
              if (result._tag === "Success") onOpenChange(false);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>How does this project start?</DialogTitle>
            <DialogDescription>
              Supadesign couldn't work it out from the repo. Enter the command you'd run in a
              terminal to start it locally.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <Label className="flex flex-col items-stretch" htmlFor={`${id}-command`}>
                Command
                <Input
                  nativeInput
                  id={`${id}-command`}
                  autoFocus
                  required
                  placeholder="npm run dev"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
                {suggestion?.source ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    Suggested from {suggestion.source}.
                  </span>
                ) : null}
              </Label>
              <Label className="flex flex-col items-stretch" htmlFor={`${id}-url`}>
                Page to open (optional)
                <Input
                  nativeInput
                  id={`${id}-url`}
                  placeholder="http://localhost:5173/"
                  value={previewUrl}
                  onChange={(event) => setPreviewUrl(event.target.value)}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Only the path is used; the port comes from the running server.
                </span>
              </Label>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || command.trim().length === 0}>
              Save and start
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function StatusLine({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", TONE_CLASSES[tone].text)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASSES[tone].dot)} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** A board card's live environment: its state, link, and the action it needs. */
export function LiveEnvironmentCardStatus({
  environmentId,
  snapshot,
}: {
  environmentId: EnvironmentId;
  snapshot: LiveEnvironmentSnapshot;
}) {
  const warm = snapshot.status === "ready" && !snapshot.active && snapshot.warmUntil !== null;
  const now = useNow(30_000, warm);
  const { tone, label } = describe(snapshot, now);
  const stop = useAtomCommand(liveEnvironment.stop);
  const retry = useAtomCommand(liveEnvironment.retry);
  const discard = useAtomCommand(liveEnvironment.discard);
  const [setupOpen, setSetupOpen] = useState(false);
  const openThread = useOpenThreadFromBoard();
  const showLivePreview = useShowLivePreview();
  const threadInput = { environmentId, input: { threadId: snapshot.threadId } };
  const setupThreadId = snapshot.setupThreadId ?? null;

  return (
    <div
      className="flex flex-col gap-1 border-t pt-1.5"
      onPointerDown={stopCardGestures}
      onDoubleClick={stopCardGestures}
      onKeyDown={stopCardGestures}
    >
      <StatusLine tone={tone}>{label}</StatusLine>
      {(snapshot.status === "failed" ||
        snapshot.status === "needs-dev-script" ||
        snapshot.status === "kept") &&
      snapshot.error !== null ? (
        // Why it stopped, in full: the model's reason or the server's exit.
        <p className="line-clamp-3 text-xs wrap-anywhere text-muted-foreground">{snapshot.error}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {snapshot.status === "ready" && snapshot.url !== null ? (
          <>
            <Button
              size="compact"
              variant="ghost"
              aria-label={`Preview ${displayLiveUrl(snapshot.url)} beside the chat`}
              onClick={() => {
                const url = snapshot.url;
                if (url === null) return;
                const threadRef = scopeThreadRef(environmentId, snapshot.threadId);
                openThread(threadRef, snapshot.projectId);
                void showLivePreview(threadRef, url);
              }}
            >
              <MonitorPlayIcon />
              {displayLiveUrl(snapshot.url)}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={`Open ${displayLiveUrl(snapshot.url)} in the browser`}
              onClick={() => snapshot.url !== null && openExternally(snapshot.url)}
            >
              <ExternalLinkIcon />
            </Button>
          </>
        ) : null}
        {setupThreadId !== null ? (
          <Button
            size="compact"
            variant="ghost"
            onClick={() =>
              openThread(scopeThreadRef(environmentId, setupThreadId), snapshot.projectId)
            }
          >
            <BotIcon />
            Watch
          </Button>
        ) : null}
        {warm ? (
          <Button size="compact" variant="ghost-muted" onClick={() => void stop(threadInput)}>
            <SquareIcon />
            Stop now
          </Button>
        ) : null}
        {snapshot.status === "preparing" &&
        (snapshot.phase === "setup" || snapshot.phase === "starting") ? (
          // A setup script or server can hang; this is the way out short of moving the card.
          <Button size="compact" variant="ghost-muted" onClick={() => void retry(threadInput)}>
            <RotateCcwIcon />
            Start over
          </Button>
        ) : null}
        {snapshot.status === "failed" ? (
          <>
            <Button size="compact" variant="ghost" onClick={() => void retry(threadInput)}>
              <RotateCcwIcon />
              Retry
            </Button>
            <LogsButton snapshot={snapshot} />
          </>
        ) : null}
        {snapshot.status === "stopped" || snapshot.status === "kept" ? (
          <Button size="compact" variant="ghost" onClick={() => void retry(threadInput)}>
            <PlayIcon />
            Start
          </Button>
        ) : null}
        {snapshot.status === "kept" ? (
          <Button
            size="compact"
            variant="ghost-muted"
            onClick={async () => {
              const confirmed = await readLocalApi()?.dialogs.confirm(
                "Discard the changes in this card's preview checkout? This can't be undone.",
                { variant: "destructive" },
              );
              if (confirmed) void discard(threadInput);
            }}
          >
            <Trash2Icon />
            Discard changes
          </Button>
        ) : null}
        {snapshot.status === "needs-dev-script" ? (
          <>
            <Button size="compact" variant="ghost" onClick={() => void retry(threadInput)}>
              <RotateCcwIcon />
              Try again
            </Button>
            <Button size="compact" variant="outline" onClick={() => setSetupOpen(true)}>
              Choose command
            </Button>
          </>
        ) : null}
      </div>
      {setupOpen ? (
        <DevScriptDialog
          open
          onOpenChange={setSetupOpen}
          environmentId={environmentId}
          projectId={snapshot.projectId}
          suggestion={snapshot.suggestion}
        />
      ) : null}
    </div>
  );
}

/** The opened thread's live environment, shown in its header. */
export function LiveEnvironmentChip({
  threadRef,
  snapshot,
}: {
  threadRef: ScopedThreadRef;
  snapshot: LiveEnvironmentSnapshot;
}) {
  const showLivePreview = useShowLivePreview();
  const retry = useAtomCommand(liveEnvironment.retry);
  const [setupOpen, setSetupOpen] = useState(false);
  const { tone, label } = describe(snapshot, 0);
  const url = snapshot.status === "ready" ? snapshot.url : null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {url !== null ? (
        <Button
          size="compact"
          variant="ghost"
          aria-label={`Open live preview at ${displayLiveUrl(url)}`}
          onClick={() => void showLivePreview(threadRef, url)}
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", TONE_CLASSES[tone].dot)} />
          {displayLiveUrl(url)}
        </Button>
      ) : (
        <StatusLine tone={tone}>
          {snapshot.status === "failed" ? "Live preview failed" : label}
        </StatusLine>
      )}
      {snapshot.status === "failed" ? (
        <Button
          size="compact"
          variant="ghost"
          onClick={() =>
            void retry({
              environmentId: threadRef.environmentId,
              input: { threadId: snapshot.threadId },
            })
          }
        >
          <RotateCcwIcon />
          Retry
        </Button>
      ) : null}
      {snapshot.status === "needs-dev-script" ? (
        <Button size="compact" variant="outline" onClick={() => setSetupOpen(true)}>
          Choose command
        </Button>
      ) : null}
      {setupOpen ? (
        <DevScriptDialog
          open
          onOpenChange={setSetupOpen}
          environmentId={threadRef.environmentId}
          projectId={snapshot.projectId}
          suggestion={snapshot.suggestion}
        />
      ) : null}
    </div>
  );
}

/** Shows the thread's live environment in its header when it has one. */
export function ThreadLiveEnvironmentChip({
  threadRef,
  projectId,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
}) {
  const projectRef = useMemo(
    () => scopeProjectRef(threadRef.environmentId, projectId),
    [projectId, threadRef.environmentId],
  );
  const snapshot = useProjectLiveEnvironments(projectRef).byThreadId.get(threadRef.threadId);
  return snapshot ? <LiveEnvironmentChip threadRef={threadRef} snapshot={snapshot} /> : null;
}
