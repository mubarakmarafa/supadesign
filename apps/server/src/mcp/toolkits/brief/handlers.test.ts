import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type OrchestrationV2ThreadProjection,
  ThreadId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadBrief from "../../../threadBrief/ThreadBriefService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as BriefHandlers from "./handlers.ts";
import { BriefToolkit } from "./tools.ts";

const caller = ThreadId.make("thread:caller");
const projectId = ProjectId.make("project:mcp-test");

const setup = Effect.gen(function* () {
  let nextId = 0;
  const brief = yield* ThreadBrief.make({
    projectOf: () => Effect.succeed(projectId),
    seedText: () => Effect.succeed(null),
    newId: Effect.sync(() => `decision-${++nextId}`),
    now: Effect.succeed("2026-10-21T00:00:00.000Z"),
    load: Effect.succeed([]),
    save: () => Effect.void,
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(ThreadBrief.ThreadBriefService, brief),
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment"),
      requestNamespace: "session",
      thread: {
        threadId: caller,
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
      getProjectThreadRecords: ({ threadId }) =>
        Effect.succeed(
          idleThreadProjection(
            liveThreadShell(threadId),
          ) as unknown as OrchestrationV2ThreadProjection,
        ),
    }),
  );
  const toolkit = yield* BriefToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(BriefHandlers.layer).pipe(Layer.provide(dependencies)),
    ),
  );
  const run = <Name extends keyof typeof BriefToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((results) => results.at(-1)?.result),
      Effect.provide(dependencies),
    );
  return { brief, run };
});

it.effect("reads the designer's brief with settled decisions apart from waiting ones", () =>
  Effect.gen(function* () {
    const { brief, run } = yield* setup;
    yield* brief.setBrief({ threadId: caller, text: "A calm onboarding", by: "designer" });
    yield* brief.addDecision({ threadId: caller, text: "Three steps at most", by: "designer" });
    yield* brief.addDecision({ threadId: caller, text: "Skip the welcome video", by: "agent" });
    const result = yield* run("supaterm_brief_read", {});
    expect(result).toMatchObject({
      brief: "A calm onboarding",
      decisions: [{ text: "Three steps at most" }],
      awaitingDesigner: [{ text: "Skip the welcome video" }],
    });
  }),
);

it.effect("reads an empty brief as null", () =>
  Effect.gen(function* () {
    const { run } = yield* setup;
    expect(yield* run("supaterm_brief_read", {})).toEqual({
      brief: null,
      decisions: [],
      awaitingDesigner: [],
    });
  }),
);

it.effect("suggests a decision on the calling thread's card, left for the designer", () =>
  Effect.gen(function* () {
    const { brief, run } = yield* setup;
    const result = yield* run("supaterm_decision_suggest", { text: "Use the brand serif" });
    expect(result).toMatchObject({ status: "suggested" });
    const current = yield* brief.get(caller);
    expect(current?.decisions.map((decision) => [decision.text, decision.status])).toEqual([
      ["Use the brand serif", "suggested"],
    ]);
  }),
);

it.effect("reports the service's refusal, such as a rejected suggestion", () =>
  Effect.gen(function* () {
    const { brief, run } = yield* setup;
    const first = yield* brief.addDecision({ threadId: caller, text: "Autoplay", by: "agent" });
    yield* brief.rejectDecision({ threadId: caller, decisionId: first.id, by: "designer" });
    const result = yield* run("supaterm_decision_suggest", { text: "Autoplay" });
    expect(result).toMatchObject({ _tag: "ThreadBriefError" });
  }),
);
