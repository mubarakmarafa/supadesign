import { describe, expect, it } from "vite-plus/test";

import { buildProjectsGrid } from "./projectsGrid.logic";

const project = (id: string, title: string, updatedAt = "2026-10-01T00:00:00.000Z") => ({
  environmentId: "env",
  id,
  title,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt,
});

const thread = (
  id: string,
  projectId: string,
  latestUserMessageAt: string,
  deletedAt: string | null = null,
) => ({
  id,
  environmentId: "env",
  projectId,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  latestUserMessageAt,
  deletedAt,
});

describe("buildProjectsGrid", () => {
  it("orders projects by their latest thread and names that thread", () => {
    const grid = buildProjectsGrid(
      [project("a", "Alpha"), project("b", "Beta"), project("c", "Gamma")],
      [
        thread("a1", "a", "2026-10-10T00:00:00.000Z"),
        thread("b1", "b", "2026-10-12T00:00:00.000Z"),
        thread("b2", "b", "2026-10-11T00:00:00.000Z"),
        thread("b3", "b", "2026-10-15T00:00:00.000Z", "2026-10-15T01:00:00.000Z"),
      ],
    );
    expect(
      grid.map((entry) => [entry.project.id, entry.lastThread?.id ?? null, entry.threadCount]),
    ).toEqual([
      ["b", "b1", 2],
      ["a", "a1", 1],
      ["c", null, 0],
    ]);
    expect(grid[2]?.lastActivityMs).toBe(Date.parse("2026-10-01T00:00:00.000Z"));
  });

  it("does not mix up projects with the same id in different environments", () => {
    const grid = buildProjectsGrid(
      [project("a", "Alpha")],
      [{ ...thread("x", "a", "2026-10-10T00:00:00.000Z"), environmentId: "other" }],
    );
    expect(grid[0]?.lastThread).toBeNull();
  });
});
