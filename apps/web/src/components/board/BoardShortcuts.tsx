import { useAtomValue } from "@effect/atom-react";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { resolveShortcutCommand } from "../../keybindings";
import { isEditableFocused } from "../../lib/editableFocus";
import { isPreviewFocused } from "../../lib/previewFocus";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { BOARD_ROUTE, useOpenProjectBoard } from "./boardNavigation";

const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-open]',
  '[role="alertdialog"][data-open]',
  '[role="menu"][data-open]',
  '[role="listbox"][data-open]',
].join(",");
const COMPOSER_EDITOR_SELECTOR = '[data-testid="composer-editor"]';
const OVERLAY_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';

function isComposerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(COMPOSER_EDITOR_SELECTOR) !== null;
}

/**
 * Whether Escape is free to leave a thread for its board: nothing else is
 * open or focused that Escape belongs to, and the composer has no draft.
 */
function escapeIsFree(target: EventTarget | null, composerHasContent: boolean): boolean {
  if (isCommandPaletteOpen() || isModelPickerOpen()) return false;
  if (isTerminalFocused() || isPreviewFocused()) return false;
  if (document.querySelector(OPEN_OVERLAY_SELECTOR) !== null) return false;
  const element = target instanceof Element ? target : null;
  if (element?.closest(OVERLAY_SELECTOR)) return false;
  if (isEditableFocused(target)) {
    // An empty composer is where focus rests in a thread; any other field owns Escape.
    return isComposerTarget(target) && !composerHasContent;
  }
  return !composerHasContent;
}

/**
 * `board.open` from anywhere in the chat layout, and `board.back` for threads
 * opened from a board. Threads reached any other way never claim Escape.
 */
export function BoardShortcuts() {
  const router = useRouter();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openProjectBoard = useOpenProjectBoard();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      // ProseMirror marks every Escape it sees as handled, even in an empty
      // composer where nothing used it, so that one case still counts as free.
      if (event.defaultPrevented && !isComposerTarget(event.target)) return;
      const location = router.state.location;
      const origin = location.state.boardOrigin;
      const params = router.state.matches[router.state.matches.length - 1]?.params ?? {};
      const threadRef = resolveThreadRouteRef(params);
      // A card peeked on its board is a dialog, which handles Escape itself.
      const boardThread =
        origin !== undefined &&
        threadRef !== null &&
        threadRef.environmentId === origin.environmentId;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          previewFocus: isPreviewFocused(),
          editableFocus: isEditableFocused(event.target),
          boardThread,
        },
      });

      if (command === "board.open") {
        if (isCommandPaletteOpen()) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) openProjectBoard();
        return;
      }

      if (
        command !== "board.back" ||
        !boardThread ||
        origin === undefined ||
        threadRef === null ||
        event.repeat
      ) {
        return;
      }
      const draft = useComposerDraftStore.getState().getComposerDraft(threadRef);
      if (!escapeIsFree(event.target, composerDraftHasUserContent(draft))) return;
      const preventedBeforeUs = event.defaultPrevented;
      // Decide after every other listener has seen the key: find bars, popovers
      // and selection clear Escape themselves and mark it handled.
      setTimeout(() => {
        if (event.defaultPrevented && !preventedBeforeUs) return;
        if (router.state.location.href !== location.href) return;
        if (origin.index === location.state.__TSR_index - 1) {
          router.history.back();
          return;
        }
        void router.navigate({
          to: BOARD_ROUTE,
          params: { environmentId: origin.environmentId, projectId: origin.projectId },
        });
      }, 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, openProjectBoard, router]);

  return null;
}
