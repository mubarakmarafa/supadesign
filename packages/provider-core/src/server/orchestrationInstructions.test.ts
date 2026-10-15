import { assert, describe, it } from "@effect/vitest";

import {
  SUPATERM_ORCHESTRATION_INSTRUCTIONS,
  supatermAcpPromptWithInstructions,
  supatermOrchestrationPromptForFirstRun,
  supatermOrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

describe("Supaterm orchestration provider instructions", () => {
  it("distinguishes delegated subagents from ordinary top-level threads", () => {
    assert.include(SUPATERM_ORCHESTRATION_INSTRUCTIONS, "Use `delegate_task`");
    assert.include(
      SUPATERM_ORCHESTRATION_INSTRUCTIONS,
      "ordinary top-level Supaterm conversations",
    );
    assert.include(SUPATERM_ORCHESTRATION_INSTRUCTIONS, "Never use them merely");
    assert.include(SUPATERM_ORCHESTRATION_INSTRUCTIONS, "cross-provider");
    assert.include(SUPATERM_ORCHESTRATION_INSTRUCTIONS, "call `delegate_task` again");
    assert.include(
      SUPATERM_ORCHESTRATION_INSTRUCTIONS,
      "Do not use `supaterm_thread_send` on `childThreadId`",
    );
  });

  it("documents structured schedules instead of JSON strings", () => {
    assert.include(SUPATERM_ORCHESTRATION_INSTRUCTIONS, "structured object, never as JSON text");
    assert.include(SUPATERM_ORCHESTRATION_INSTRUCTIONS, '"everyMs":3600000');
    assert.include(SUPATERM_ORCHESTRATION_INSTRUCTIONS, "bindToCurrentThread=false");
  });

  it("injects prompt fallback only for an MCP-enabled first run", () => {
    const prompt = "Inspect the repository.";
    const injected = supatermOrchestrationPromptForFirstRun({
      prompt,
      runOrdinal: 1,
      hasSupatermMcp: true,
    });

    assert.include(injected, "<supaterm_orchestration_instructions>");
    assert.include(injected, `<user_request>\n${prompt}\n</user_request>`);
    assert.equal(
      supatermOrchestrationPromptForFirstRun({ prompt, runOrdinal: 2, hasSupatermMcp: true }),
      prompt,
    );
    assert.equal(
      supatermOrchestrationPromptForFirstRun({ prompt, runOrdinal: 1, hasSupatermMcp: false }),
      prompt,
    );
  });

  it("only exposes the system prompt when the Supaterm MCP server is attached", () => {
    assert.equal(supatermOrchestrationSystemPrompt(false), undefined);
    assert.equal(supatermOrchestrationSystemPrompt(true), SUPATERM_ORCHESTRATION_INSTRUCTIONS);
  });

  it("gives ACP sessions provider-neutral mode, browser, and orchestration guidance", () => {
    const injected = supatermAcpPromptWithInstructions({
      prompt: "Inspect the repository.",
      state: { interactionMode: "default", hasSupatermMcp: true },
    });

    assert.include(injected, "Supaterm interaction mode: Default");
    assert.include(injected, "Supaterm collaborative browser");
    assert.include(injected, "Supaterm orchestration");
    assert.include(injected, "<user_request>\nInspect the repository.\n</user_request>");
  });

  it("reinjects ACP guidance only when mode or tool availability changes", () => {
    const prompt = "Continue.";
    const defaultState = { interactionMode: "default", hasSupatermMcp: true } as const;

    assert.equal(
      supatermAcpPromptWithInstructions({
        prompt,
        state: defaultState,
        previousState: defaultState,
      }),
      prompt,
    );
    assert.include(
      supatermAcpPromptWithInstructions({
        prompt,
        state: { ...defaultState, interactionMode: "plan" },
        previousState: defaultState,
      }),
      "Supaterm interaction mode: Plan",
    );
    const withoutMcp = supatermAcpPromptWithInstructions({
      prompt,
      state: { interactionMode: "default", hasSupatermMcp: false },
    });
    assert.include(withoutMcp, "Supaterm interaction mode: Default");
    assert.notInclude(withoutMcp, "Supaterm collaborative browser");
    assert.notInclude(withoutMcp, "Supaterm orchestration");
  });
});
