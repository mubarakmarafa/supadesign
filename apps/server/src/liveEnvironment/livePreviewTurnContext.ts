import type { LiveEnvironmentSnapshot } from "@supaterm/contracts";

import type { TurnContextEntry } from "../orchestration-v2/TurnContext.ts";

const wrap = (lines: ReadonlyArray<string>) =>
  ["<card_live_preview>", ...lines, "</card_live_preview>"].join("\n");

/**
 * What a card's agent is told about the card's live preview at turn start, so
 * it checks its work there and shows it to the designer instead of starting a
 * dev server of its own. Only the live card hears about it; the version leaves
 * out timestamps so the note is sent again only when the preview really moves.
 */
export function livePreviewTurnContext(
  environment: LiveEnvironmentSnapshot | undefined,
): TurnContextEntry | null {
  if (environment === undefined || !environment.active) return null;
  switch (environment.status) {
    case "ready": {
      if (environment.url === null) return null;
      const folder = environment.worktreePath === null ? "" : ` from ${environment.worktreePath}`;
      return {
        version: `ready|${environment.url}|${environment.worktreePath ?? ""}`,
        text: wrap([
          `Supadesign is running this card's live preview at ${environment.url}, serving the app${folder}. Check your changes there, reloading after you edit, instead of starting another dev server.`,
          "When a change is worth the designer's eye, call supaterm_progress_publish without url: it captures this preview and shows it on the card.",
        ]),
      };
    }
    case "preparing":
      return {
        version: "preparing",
        text: wrap([
          "Supadesign is starting this card's live preview. Don't start a dev server of your own: supaterm_live_environment_status gives its URL once it is ready, and supaterm_progress_publish without url captures it for the designer.",
        ]),
      };
    case "failed":
    case "stopped":
      return {
        version: "down",
        text: wrap([
          "This card's live preview isn't running right now. To check your work in a browser, call supaterm_live_environment_start and wait for supaterm_live_environment_status to say ready, rather than starting a dev server yourself.",
        ]),
      };
    default:
      return null;
  }
}
