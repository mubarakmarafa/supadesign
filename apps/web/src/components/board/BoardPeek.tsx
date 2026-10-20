import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { ProjectId, ScopedThreadRef } from "@supaterm/contracts";
import { Maximize2Icon, XIcon } from "lucide-react";

import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogPopup } from "../ui/dialog";
import { useOpenThreadFromBoard } from "./boardNavigation";

/**
 * A card's thread in a window over its board: send a quick message, then click
 * outside or press Escape to return to the board. The expand button opens the
 * full thread. Escape keeps the window open while the composer holds a draft.
 */
export function BoardPeek({
  threadRef,
  projectId,
  title,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  title: string;
  onClose: () => void;
}) {
  const openThread = useOpenThreadFromBoard();
  return (
    <Dialog
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        if (eventDetails.reason === "escape-key") {
          const draft = useComposerDraftStore.getState().getComposerDraft(threadRef);
          if (composerDraftHasUserContent(draft)) {
            eventDetails.cancel();
            return;
          }
        }
        onClose();
      }}
    >
      <DialogPopup
        aria-label={`${title} thread`}
        data-board-peek=""
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="h-[min(60rem,calc(100dvh-4rem))] max-w-[min(72rem,calc(100vw-4rem))] overflow-hidden"
      >
        {/* The thread pins its panel controls to this window's top-right corner. */}
        <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
          <DialogClose
            aria-label="Back to the board"
            render={<Button size="icon-sm" variant="ghost" />}
          >
            <XIcon />
          </DialogClose>
          <Button size="sm" variant="ghost" onClick={() => openThread(threadRef, projectId)}>
            <Maximize2Icon />
            Open full thread
          </Button>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ChatView
            key={scopedThreadKey(threadRef)}
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            routeKind="server"
            reserveTitleBarControlInset={false}
          />
        </div>
      </DialogPopup>
    </Dialog>
  );
}
