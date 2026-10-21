import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  BoardColumnId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as BoardAutomation from "../../../boardAutomation/BoardAutomationService.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as ProjectBoard from "../../../projectBoard/ProjectBoardService.ts";
import * as ThreadBank from "../../../threadBank/ThreadBankService.ts";
import * as ThreadProgress from "../../../threadProgress/ThreadProgressService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as BoardHandlers from "./handlers.ts";
import { BoardToolkit } from "./tools.ts";

const caller = ThreadId.make("thread:caller");
const projectId = ProjectId.make("project:mcp-test");
const ideas = BoardColumnId.make("ideas");

const setup = Effect.gen(function* () {
  const sent: Array<string> = [];
  const launched: Array<ThreadId> = [];
  const bank = yield* ThreadBank.make({
    projectOf: () => Effect.succeed(projectId),
    claim: ({ attachments, context }) => Effect.succeed({ attachments, context }),
    send: (input) => Effect.sync(() => void sent.push(input.text)),
    newEntryId: Effect.sync(() => `entry-${sent.length}`),
    now: Effect.succeed("2026-10-21T00:00:00.000Z"),
    load: Effect.succeed([]),
    save: () => Effect.void,
  });
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
      getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
    }),
    Layer.mock(Project.ProjectService)({
      getById: (id) => Effect.succeedSome({ id } as never),
    }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) =>
        Effect.sync(() => {
          launched.push(input.threadId!);
          return {} as never;
        }),
    }),
    Layer.mock(ProjectBoard.ProjectBoardService)({
      read: () => Effect.succeed([{ id: ideas } as never]),
      placeNewCard: () => Effect.succeed({ columnId: ideas, index: 0 }),
    }),
    Layer.mock(ThreadProgress.ThreadProgressService)({
      setSummary: () => Effect.succeed(true),
    }),
    Layer.mock(BoardAutomation.BoardAutomationService)({}),
    NodeCrypto.layer,
  );
  const toolkit = yield* BoardToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(BoardHandlers.layer).pipe(Layer.provide(dependencies)),
    ),
  );
  const addCard = (params: Parameters<typeof toolkit.handle<"supaterm_board_add_card">>[1]) =>
    toolkit.handle("supaterm_board_add_card", params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((results) => results.at(-1)?.result),
      Effect.provide(dependencies),
    );
  return { bank, addCard, launched, sent };
});

it.effect("banks a new card's title and summary without starting it", () =>
  Effect.gen(function* () {
    const { bank, addCard, launched, sent } = yield* setup;
    const result = yield* addCard({
      columnId: ideas,
      title: "Warmer palette",
      summary: " Try oranges in the header. ",
    });
    expect(result).toMatchObject({ columnId: ideas, index: 0 });
    const threadId = launched[0]!;
    const entries = yield* bank.get(threadId);
    expect(entries.map((entry) => entry.text)).toEqual([
      "Warmer palette\nTry oranges in the header.",
    ]);
    expect(sent).toEqual([]);

    yield* addCard({ columnId: ideas, title: "Sticky header" });
    expect((yield* bank.get(launched[1]!)).map((entry) => entry.text)).toEqual(["Sticky header"]);
  }),
);
