import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { ProjectId, ScopedThreadRef } from "@supaterm/contracts";
import { Maximize2Icon, XIcon } from "lucide-react";

import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { useOpenThreadFromBoard } from "./boardNavigation";

/**
 * A card's thread beside its board, like a side peek: send a quick message and
 * keep the board in view. Escape or the close button returns to the board alone;
 * the expand button opens the full thread.
 */
export function BoardPeek({
  threadRef,
  projectId,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  onClose: () => void;
}) {
  const openThread = useOpenThreadFromBoard();
  return (
    <aside
      aria-label="Thread side peek"
      data-board-peek=""
      // The thread's header pins its controls to the window corner; layout
      // containment pins them to the peek's corner instead.
      className="flex min-h-0 w-[min(42rem,50vw)] min-w-80 shrink-0 flex-col border-s bg-background [contain:layout]"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <Button size="icon-sm" variant="ghost" aria-label="Close side peek" onClick={onClose}>
          <XIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Open full page"
          onClick={() => openThread(threadRef, projectId)}
        >
          <Maximize2Icon />
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
    </aside>
  );
}
