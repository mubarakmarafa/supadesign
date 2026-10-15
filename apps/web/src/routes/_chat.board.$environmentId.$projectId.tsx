import { createFileRoute } from "@tanstack/react-router";

import { ProjectBoardPage } from "../components/board/ProjectBoard";

export const Route = createFileRoute("/_chat/board/$environmentId/$projectId")({
  component: ProjectBoardPage,
});
