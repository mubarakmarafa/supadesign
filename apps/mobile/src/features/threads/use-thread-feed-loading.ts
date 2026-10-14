import { useCallback, useState } from "react";
import type { ThreadContentPresentation } from "./threadContentPresentation";

/**
 * Keeps the loading handoff open until the incoming list has positioned its messages. The feed
 * mounts once per thread, so opening a cached conversation waits for the list too; messages the
 * user just wrote and empty conversations show at once.
 */
export function useThreadFeedLoading(input: {
  readonly listMountKey: string;
  readonly contentKind: ThreadContentPresentation["kind"];
  readonly hasContent: boolean;
  readonly hasLocalMessages: boolean;
}) {
  const [loadedListKey, setLoadedListKey] = useState<string | null>(null);
  const [opening, setOpening] = useState(true);
  const fetchingMessages = input.contentKind === "loading" && !input.hasLocalMessages;
  if (fetchingMessages && !opening) {
    setOpening(true);
    setLoadedListKey(null);
  }
  const loading =
    fetchingMessages ||
    (opening &&
      input.contentKind === "ready" &&
      !input.hasLocalMessages &&
      input.hasContent &&
      loadedListKey !== input.listMountKey);

  if (!loading && opening) setOpening(false);

  const onListLoaded = useCallback(() => {
    setLoadedListKey(input.listMountKey);
  }, [input.listMountKey]);

  return { loading, onListLoaded };
}
