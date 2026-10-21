import {
  type BoardAutomationRunList,
  type LiveEnvironmentList,
  type ThreadBankList,
  type ThreadProgressList,
  WS_METHODS,
  WsBoardRpcGroup,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as BoardAutomation from "./boardAutomation/BoardAutomationService.ts";
import * as LiveEnvironment from "./liveEnvironment/LiveEnvironmentService.ts";
import * as ProjectSummary from "./project/ProjectSummary.ts";
import * as ThreadBank from "./threadBank/ThreadBankService.ts";
import * as ThreadProgress from "./threadProgress/ThreadProgressService.ts";

/** Streams a service's per-project list: now, then after every change, until the client leaves. */
const subscription = <A>(
  subscribe: (listener: (list: A) => Effect.Effect<void>) => Effect.Effect<() => void>,
) =>
  Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      subscribe((list) => Queue.offer(queue, list)),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
  );

/**
 * Handlers for `WsBoardRpcGroup`, merged with the core handlers in `ws.ts`.
 * Each is one service call, so the transport stays thin.
 */
export const layer = WsBoardRpcGroup.toLayer(
  Effect.gen(function* () {
    const liveEnvironments = yield* LiveEnvironment.LiveEnvironmentService;
    const threadBanks = yield* ThreadBank.ThreadBankService;
    const boardAutomations = yield* BoardAutomation.BoardAutomationService;
    const threadProgress = yield* ThreadProgress.ThreadProgressService;
    const projectSummary = yield* ProjectSummary.ProjectSummary;

    return WsBoardRpcGroup.of({
      [WS_METHODS.liveEnvironmentActivate]: (input) => liveEnvironments.activate(input),
      [WS_METHODS.liveEnvironmentStop]: (input) => liveEnvironments.stop(input.threadId),
      [WS_METHODS.liveEnvironmentRetry]: (input) => liveEnvironments.retry(input.threadId),
      [WS_METHODS.liveEnvironmentDiscard]: (input) => liveEnvironments.discard(input.threadId),
      [WS_METHODS.liveEnvironmentSaveDevScript]: (input) => liveEnvironments.saveDevScript(input),
      [WS_METHODS.subscribeLiveEnvironments]: (input) =>
        subscription<LiveEnvironmentList>((listener) =>
          liveEnvironments.subscribe(input.projectId, listener),
        ),
      [WS_METHODS.threadBankAdd]: (input) => threadBanks.add(input).pipe(Effect.asVoid),
      [WS_METHODS.threadBankUpdate]: (input) => threadBanks.update(input),
      [WS_METHODS.threadBankRemove]: (input) => threadBanks.remove(input),
      [WS_METHODS.threadBankReorder]: (input) => threadBanks.reorder(input),
      [WS_METHODS.threadBankSend]: (input) => threadBanks.send(input.threadId).pipe(Effect.asVoid),
      [WS_METHODS.subscribeThreadBanks]: (input) =>
        subscription<ThreadBankList>((listener) =>
          threadBanks.subscribe(input.projectId, listener),
        ),
      [WS_METHODS.boardAutomationCancel]: (input) => boardAutomations.cancel(input.threadId),
      [WS_METHODS.boardAutomationRunNow]: (input) =>
        input.columnId === undefined
          ? boardAutomations.runNow(input.threadId)
          : boardAutomations.rerun({ threadId: input.threadId, columnId: input.columnId }),
      [WS_METHODS.subscribeBoardAutomations]: (input) =>
        subscription<BoardAutomationRunList>((listener) =>
          boardAutomations.subscribe(input.projectId, listener),
        ),
      [WS_METHODS.threadProgressCapture]: (input) =>
        threadProgress.capture({
          threadId: input.threadId,
          source: "designer",
          screen: input.screen,
        }),
      [WS_METHODS.threadProgressRemove]: (input) => threadProgress.remove(input),
      [WS_METHODS.threadSummarySet]: (input) =>
        threadProgress
          .setSummary({ threadId: input.threadId, text: input.text, source: "designer" })
          .pipe(Effect.asVoid),
      [WS_METHODS.subscribeThreadProgress]: (input) =>
        subscription<ThreadProgressList>((listener) =>
          threadProgress.subscribe(input.projectId, listener),
        ),
      [WS_METHODS.projectsSummary]: (input) => projectSummary.describe(input.projectId),
    });
  }),
);
