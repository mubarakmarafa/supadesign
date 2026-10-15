import { describe, expect, it } from "vite-plus/test";

import {
  SUPATERM_MCP_TOOL_NAMES,
  resolveSupatermMcpToolPresentation,
} from "./supatermMcpToolPresentation.ts";

describe("resolveSupatermMcpToolPresentation", () => {
  it("recognizes every tool across provider prefixes and completion suffixes", () => {
    for (const tool of SUPATERM_MCP_TOOL_NAMES) {
      const presentation = resolveSupatermMcpToolPresentation(tool);
      expect(presentation, tool).not.toBeNull();
      for (const prefix of [
        "mcp__supaterm__",
        "mcp__Supaterm__",
        "supaterm.",
        "Supaterm.",
        "supaterm/",
        "supaterm:",
        "mcp_supaterm_",
        "supaterm ",
        "Supaterm ",
        "supaterm · ",
      ]) {
        expect(resolveSupatermMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveSupatermMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });
  it("pretty prints Claude and Cursor Supaterm MCP tool names", () => {
    expect(resolveSupatermMcpToolPresentation("mcp__supaterm__supaterm_thread_read")).toEqual({
      displayName: "Read a Supaterm thread",
      logo: "supaterm",
    });
  });

  it("pretty prints Codex Supaterm MCP tool names", () => {
    expect(resolveSupatermMcpToolPresentation("supaterm.create_threads")).toEqual({
      displayName: "Create Supaterm threads",
      logo: "supaterm",
    });
  });

  it("pretty prints thread metadata updates", () => {
    expect(resolveSupatermMcpToolPresentation("mcp__supaterm__supaterm_thread_update")).toEqual({
      displayName: "Update Supaterm thread metadata",
      logo: "supaterm",
    });
  });

  it("pretty prints bare Supaterm MCP toolkit names", () => {
    expect(resolveSupatermMcpToolPresentation("list_scheduled_tasks")).toEqual({
      displayName: "List scheduled tasks",
      logo: "supaterm",
    });
  });

  it("pretty prints worktree Supaterm MCP tool names", () => {
    expect(resolveSupatermMcpToolPresentation("mcp__supaterm__supaterm_worktree_handoff")).toEqual({
      displayName: "Hand off thread to a git worktree",
      logo: "supaterm",
    });
    expect(resolveSupatermMcpToolPresentation("supaterm.supaterm_worktree_status")).toEqual({
      displayName: "Get thread worktree status",
      logo: "supaterm",
    });
  });

  it("pretty prints preview Supaterm MCP tool names", () => {
    expect(resolveSupatermMcpToolPresentation("Supaterm.preview_open")).toEqual({
      displayName: "Open a page in the preview browser",
      logo: "supaterm",
    });
    expect(resolveSupatermMcpToolPresentation("mcp__supaterm__preview_status")).toEqual({
      displayName: "Get preview browser status",
      logo: "supaterm",
    });
  });

  it("matches the separator variants ACP registry agents emit", () => {
    for (const name of [
      "mcp_supaterm_delegate_task",
      "supaterm:delegate_task",
      "supaterm/delegate_task",
      "supaterm delegate_task",
      "supaterm__delegate_task",
    ]) {
      expect(resolveSupatermMcpToolPresentation(name)?.displayName).toBe("Delegate a child task");
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveSupatermMcpToolPresentation("supaterm-thread_opencode2-adapter_delegate_task")
        ?.displayName,
    ).toBe("Delegate a child task");
    expect(
      resolveSupatermMcpToolPresentation("supaterm-thread_opencode2-adapter_not_a_tool"),
    ).toBeNull();
  });

  it("keeps unknown MCP tools on the generic renderer path", () => {
    expect(resolveSupatermMcpToolPresentation("mcp__github__search_issues")).toBeNull();
    expect(resolveSupatermMcpToolPresentation("supaterm.not_a_real_tool")).toBeNull();
  });
});
