import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@react-navigation/native", () => ({}));
vi.mock("../../state/projects", () => ({}));
vi.mock("../../state/use-composer-drafts", () => ({}));

import { resolveStartNewTaskTarget } from "./use-start-new-task";

const project = {
  environmentId: EnvironmentId.make("environment-1"),
  id: ProjectId.make("project-1"),
  title: "supaterm",
} as EnvironmentProject;
const stickyProject = { environmentId: project.environmentId, projectId: project.id };

describe("resolveStartNewTaskTarget", () => {
  it("opens a draft in the remembered project", () => {
    expect(
      resolveStartNewTaskTarget({ topRouteName: "Home", stickyProject, projects: [project] }),
    ).toEqual({
      screen: "NewTaskDraft",
      params: { environmentId: "environment-1", projectId: "project-1", title: "supaterm" },
    });
  });

  it("opens the picker when the remembered project is not listed", () => {
    // Removed projects and projects on disabled environments both drop out of the catalog.
    expect(
      resolveStartNewTaskTarget({ topRouteName: "Home", stickyProject, projects: [] }),
    ).toEqual({ screen: "NewTask" });
  });

  it("opens the picker when nothing is remembered", () => {
    expect(
      resolveStartNewTaskTarget({ topRouteName: "Home", stickyProject: null, projects: [project] }),
    ).toEqual({ screen: "NewTask" });
  });

  it("leaves an open new task alone", () => {
    expect(
      resolveStartNewTaskTarget({
        topRouteName: "NewTaskSheet",
        stickyProject,
        projects: [project],
      }),
    ).toBeNull();
  });
});
