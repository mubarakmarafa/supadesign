import { createFileRoute } from "@tanstack/react-router";

import { ProjectsGridPage } from "../components/projects/ProjectsGrid";

export const Route = createFileRoute("/_chat/projects")({
  component: ProjectsGridPage,
});
