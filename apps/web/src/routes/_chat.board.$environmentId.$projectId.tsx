import { createFileRoute } from "@tanstack/react-router";

import { ProjectBoardPage } from "../components/board/ProjectBoard";

export interface BoardSearch {
  /** The card open in the side peek beside the board. */
  readonly peek?: string;
}

export const Route = createFileRoute("/_chat/board/$environmentId/$projectId")({
  validateSearch: (raw: Record<string, unknown>): BoardSearch =>
    typeof raw.peek === "string" && raw.peek !== "" ? { peek: raw.peek } : {},
  component: ProjectBoardPage,
});
