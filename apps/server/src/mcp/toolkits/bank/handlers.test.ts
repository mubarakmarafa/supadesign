import { expect, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  type OrchestrationV2ThreadProjection,
  type RuntimeMode,
  ThreadId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadBank from "../../../threadBank/ThreadBankService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as BankHandlers from "./handlers.ts";
import { BankToolkit } from "./tools.ts";

const caller = ThreadId.make("thread:caller");
const card = ThreadId.make("thread:card");
const projectId = ProjectId.make("project:mcp-test");

const image = (id: string) => ({
  type: "image" as const,
  id: ChatAttachmentId.make(id),
  name: `${id}.png`,
  mimeType: "image/png",
  sizeBytes: 10,
});

/** An attachment the card's thread already holds from an earlier message. */
const owned = image("thread-card-00000000-0000-4000-8000-000000000001");

const setup = (options: { readonly callerRuntimeMode?: RuntimeMode } = {}) =>
  Effect.gen(function* () {
    const sent: Array<string> = [];
    let nextEntry = 0;
    const bank = yield* ThreadBank.make({
      projectOf: () => Effect.succeed(projectId),
      claim: ({ attachments, context }) => Effect.succeed({ attachments, context }),
      send: (input) => Effect.sync(() => void sent.push(input.text)),
      newEntryId: Effect.sync(() => `entry-${++nextEntry}`),
      now: Effect.succeed("2026-10-21T00:00:00.000Z"),
      load: Effect.succeed([]),
      save: () => Effect.void,
    });
    const shellOf = (threadId: ThreadId) =>
      liveThreadShell(
        threadId,
        threadId === caller && options.callerRuntimeMode !== undefined
          ? { runtimeMode: options.callerRuntimeMode }
          : {},
      );
    const providerInstanceId = ProviderInstanceId.make("codex");
    const dependencies = Layer.mergeAll(
      Layer.succeed(ThreadBank.ThreadBankService, bank),
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment"),
        requestNamespace: "session",
        thread: { threadId: caller, providerSessionId: "session", providerInstanceId },
        client: undefined,
        issuedAt: 0,
        capabilities: new Set(["orchestration" as const]),
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) => Effect.succeed(shellOf(threadId)),
        // Like the real store, messages come back only when they were asked for.
        getProjectThreadRecords: ({ threadId }, fields) =>
          Effect.succeed({
            ...idleThreadProjection(shellOf(threadId)),
            ...(fields.some((field) => field === "messages")
              ? { messages: [{ id: MessageId.make("message:earlier"), attachments: [owned] }] }
              : { messages: undefined }),
          } as unknown as OrchestrationV2ThreadProjection),
      }),
    );
    const toolkit = yield* BankToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(BankHandlers.layer).pipe(Layer.provide(dependencies)),
      ),
    );
    const bankAdd = (params: Parameters<typeof toolkit.handle<"supaterm_bank_add">>[1]) =>
      toolkit.handle("supaterm_bank_add", params).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((results) => results.at(-1)?.result),
        Effect.provide(dependencies),
      );
    return { bank, bankAdd, sent };
  });

it.effect("banks onto the calling thread's own card without sending anything", () =>
  Effect.gen(function* () {
    const { bank, bankAdd, sent } = yield* setup();
    const first = yield* bankAdd({ text: "Try a warmer palette" });
    const second = yield* bankAdd({ text: "Keep the header sticky" });
    expect(first).toMatchObject({ threadId: caller, bankedCount: 1 });
    expect(second).toMatchObject({ threadId: caller, bankedCount: 2 });
    const entries = yield* bank.get(caller);
    expect(entries.map((entry) => entry.text)).toEqual([
      "Try a warmer palette",
      "Keep the header sticky",
    ]);
    expect(sent).toEqual([]);
  }),
);

it.effect("banks onto another card with an attachment its thread already holds", () =>
  Effect.gen(function* () {
    const { bank, bankAdd } = yield* setup();
    const result = yield* bankAdd({
      threadId: card,
      text: "Compare with this earlier capture",
      attachments: [owned],
    });
    expect(result).toMatchObject({ threadId: card, bankedCount: 1 });
    const [entry] = yield* bank.get(card);
    expect(entry?.attachments).toEqual([owned]);
    expect(yield* bank.get(caller)).toEqual([]);
  }),
);

it.effect("refuses an attachment that is neither pending nor the card's", () =>
  Effect.gen(function* () {
    const { bank, bankAdd } = yield* setup();
    const result = yield* bankAdd({
      threadId: card,
      text: "See this",
      attachments: [image("thread-other-00000000-0000-4000-8000-000000000002")],
    });
    expect(result).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "invalid_request" });
    expect(yield* bank.get(card)).toEqual([]);
  }),
);

it.effect("reports the bank's own refusal, such as an empty message", () =>
  Effect.gen(function* () {
    const { bankAdd } = yield* setup();
    const result = yield* bankAdd({ text: "   " });
    expect(result).toMatchObject({ _tag: "ThreadBankError", message: "There's nothing to bank." });
  }),
);

it.effect("refuses a card that runs with broader modes than the caller", () =>
  Effect.gen(function* () {
    const { bank, bankAdd } = yield* setup({ callerRuntimeMode: "approval-required" });
    const result = yield* bankAdd({ threadId: card, text: "Make it louder" });
    expect(result).toMatchObject({
      _tag: "OrchestratorMcpFailure",
      code: "runtime_mode_escalation_denied",
    });
    expect(yield* bank.get(card)).toEqual([]);
  }),
);
