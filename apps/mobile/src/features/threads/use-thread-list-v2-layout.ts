import { useMemo } from "react";

import { buildThreadListV2Items, threadListInboxReturns } from "./threadListV2";

type ThreadListV2LayoutInput = Required<
  Omit<Parameters<typeof buildThreadListV2Items>[0], "inboxReturnAt">
>;

/** Keeps Home and the iPad sidebar on the same partition. */
export function useThreadListV2Layout({
  threads,
  environmentId,
  projectRefs,
  searchQuery,
  matchedThreadKeys,
  pendingOrder,
  queuedThreadKeys,
  settledLimit,
  now,
  pinnedShelfExpanded,
  activeShelfExpanded,
  workingShelfExpanded,
  snoozedShelfExpanded,
  settledShelfExpanded,
  selectedThreadKey,
}: ThreadListV2LayoutInput) {
  const threadListV2Layout = useMemo(() => {
    threadListInboxReturns.observe(threads);
    // Settled threads remain live shells; archived threads stay hidden.
    return buildThreadListV2Items({
      pendingOrder,
      threads: threads.filter((thread) => thread.archivedAt === null),
      environmentId,
      projectRefs,
      searchQuery,
      matchedThreadKeys,
      queuedThreadKeys,
      settledLimit,
      now,
      pinnedShelfExpanded,
      activeShelfExpanded,
      workingShelfExpanded,
      inboxReturnAt: threadListInboxReturns.returnedAt,
      snoozedShelfExpanded,
      settledShelfExpanded,
      selectedThreadKey,
    });
  }, [
    pinnedShelfExpanded,
    activeShelfExpanded,
    workingShelfExpanded,
    pendingOrder,
    queuedThreadKeys,
    now,
    snoozedShelfExpanded,
    settledShelfExpanded,
    selectedThreadKey,
    environmentId,
    searchQuery,
    matchedThreadKeys,
    settledLimit,
    threads,
    projectRefs,
  ]);
  return { threadListV2Layout };
}
