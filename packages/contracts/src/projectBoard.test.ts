import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ApplicationProjectMetaUpdatedPayload } from "./applicationEvent.ts";
import { OrchestrationProjectShell } from "./orchestrationProject.ts";
import { OrchestrationV2Command } from "./orchestrationV2.ts";
import {
  BoardAutomationStepId,
  BoardColumnId,
  DEFAULT_PROJECT_BOARD,
  ProjectBoard,
  type ProjectBoard as ProjectBoardType,
  validateProjectBoard,
} from "./projectBoard.ts";

const decodeBoard = Schema.decodeUnknownSync(ProjectBoard);
const decodeShell = Schema.decodeUnknownSync(OrchestrationProjectShell);
const decodeMetaUpdated = Schema.decodeUnknownSync(ApplicationProjectMetaUpdatedPayload);
const decodeCommand = Schema.decodeUnknownSync(OrchestrationV2Command);

const id = BoardColumnId.make;

describe("validateProjectBoard", () => {
  it("accepts the default board", () => {
    expect(validateProjectBoard(DEFAULT_PROJECT_BOARD)).toEqual([]);
  });

  it("reports flags pointing at missing columns and done conflicts", () => {
    const board: ProjectBoardType = {
      ...DEFAULT_PROJECT_BOARD,
      inboxColumnId: id("done"),
      liveColumnId: id("gone"),
    };
    expect(validateProjectBoard(board)).toEqual([
      { code: "unknown-flag-column", flag: "live", columnId: "gone" },
      { code: "done-column-conflict", flag: "inbox" },
    ]);
  });

  it("allows a board without a live column", () => {
    expect(validateProjectBoard({ ...DEFAULT_PROJECT_BOARD, liveColumnId: null })).toEqual([]);
  });

  it("reports duplicate column ids", () => {
    const board: ProjectBoardType = {
      ...DEFAULT_PROJECT_BOARD,
      columns: [...DEFAULT_PROJECT_BOARD.columns, { id: id("ideas"), title: "More ideas" }],
    };
    expect(validateProjectBoard(board)).toEqual([
      { code: "duplicate-column-id", columnId: "ideas" },
    ]);
  });

  it("checks retired columns resolve to an active column", () => {
    const board: ProjectBoardType = {
      ...DEFAULT_PROJECT_BOARD,
      retiredColumns: [
        { id: id("ideas"), movedTo: id("done") },
        { id: id("old"), movedTo: id("older") },
        { id: id("older"), movedTo: id("testing") },
        { id: id("lost"), movedTo: id("nowhere") },
        { id: id("loop-a"), movedTo: id("loop-b") },
        { id: id("loop-b"), movedTo: id("loop-a") },
      ],
    };
    expect(validateProjectBoard(board)).toEqual([
      { code: "retired-column-active", columnId: "ideas" },
      { code: "unresolved-retired-column", columnId: "lost" },
      { code: "unresolved-retired-column", columnId: "loop-a" },
      { code: "unresolved-retired-column", columnId: "loop-b" },
    ]);
  });
});

describe("column automations", () => {
  const step = (stepId: string) => ({
    id: BoardAutomationStepId.make(stepId),
    name: "Merge into main",
    prompt: "Merge {branch} into main.",
  });

  it("keeps automations off Done and step ids unique within a column", () => {
    const board: ProjectBoardType = {
      ...DEFAULT_PROJECT_BOARD,
      columns: DEFAULT_PROJECT_BOARD.columns.map((column) =>
        column.id === "done"
          ? { ...column, onEnter: [step("a")] }
          : column.id === "testing"
            ? { ...column, onEnter: [step("b")], onLeave: [step("b")] }
            : column,
      ),
    };
    expect(validateProjectBoard(board)).toEqual([
      { code: "duplicate-step-id", columnId: "testing" },
      { code: "done-column-automation", columnId: "done" },
    ]);
  });

  it("only moves done cards on from a column with arrival steps, to another column", () => {
    const withMove = (columnId: string, moveWhenDone: string, steps = [step("a")]) => ({
      ...DEFAULT_PROJECT_BOARD,
      columns: DEFAULT_PROJECT_BOARD.columns.map((column) =>
        column.id === columnId
          ? { ...column, onEnter: steps, moveWhenDone: BoardColumnId.make(moveWhenDone) }
          : column,
      ),
    });
    expect(validateProjectBoard(withMove("testing", "done"))).toEqual([]);
    expect(validateProjectBoard(withMove("testing", "testing"))).toEqual([
      { code: "invalid-move-when-done", columnId: "testing" },
    ]);
    expect(validateProjectBoard(withMove("testing", "nowhere"))).toEqual([
      { code: "invalid-move-when-done", columnId: "testing" },
    ]);
    expect(validateProjectBoard(withMove("testing", "done", []))).toEqual([
      { code: "invalid-move-when-done", columnId: "testing" },
    ]);
  });

  it("decodes boards stored before automations and caps steps per trigger", () => {
    expect(decodeBoard(DEFAULT_PROJECT_BOARD).columns[0]?.onEnter).toBeUndefined();
    const crowded = {
      ...DEFAULT_PROJECT_BOARD,
      columns: DEFAULT_PROJECT_BOARD.columns.map((column) =>
        column.id === "testing"
          ? { ...column, onEnter: [step("a"), step("b"), step("c"), step("d")] }
          : column,
      ),
    };
    expect(() => decodeBoard(crowded)).toThrow();
  });
});

describe("ProjectBoard schema", () => {
  it("rejects too few columns and over-long titles", () => {
    expect(() =>
      decodeBoard({ ...DEFAULT_PROJECT_BOARD, columns: [{ id: "done", title: "Done" }] }),
    ).toThrow();
    expect(() =>
      decodeBoard({
        ...DEFAULT_PROJECT_BOARD,
        columns: [{ id: "a", title: "x".repeat(61) }, ...DEFAULT_PROJECT_BOARD.columns],
      }),
    ).toThrow();
  });

  it("decodes payloads from servers without boards", () => {
    const shell = decodeShell({
      id: "project-1",
      title: "Project",
      workspaceRoot: "/work/project",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(shell.board).toBeUndefined();
    const update = decodeMetaUpdated({
      projectId: "project-1",
      title: "Renamed",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(update.board).toBeUndefined();
  });

  it("decodes a board placement command", () => {
    const command = decodeCommand({
      type: "thread.board.place",
      commandId: "command-1",
      threadId: "thread-1",
      columnId: "done",
      orderKey: "n",
      returnColumnId: "testing",
    });
    expect(command).toMatchObject({ type: "thread.board.place", returnColumnId: "testing" });
  });
});
