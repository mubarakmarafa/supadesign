import type {
  OrchestrationV2AppThread,
  ThreadPullRequestLink,
  ThreadPullRequestWatch,
} from "@supaterm/contracts";

/** The link with its watch replaced, or removed when `watch` is undefined. */
export function withPullRequestWatch(
  link: ThreadPullRequestLink,
  watch: ThreadPullRequestWatch | undefined,
): ThreadPullRequestLink {
  const { watch: _previous, ...rest } = link;
  return watch === undefined ? rest : { ...rest, watch };
}

/**
 * The thread with every pull request and workflow run watch ended: for a thread that takes no
 * more wakes, and for a fork, which must not be woken by the watches its source started.
 */
export function withoutWatches(thread: OrchestrationV2AppThread): OrchestrationV2AppThread {
  return {
    ...thread,
    pullRequests: thread.pullRequests?.map((link) => withPullRequestWatch(link, undefined)),
    ...(thread.workflowRunWatches === undefined ? {} : { workflowRunWatches: [] }),
  };
}
