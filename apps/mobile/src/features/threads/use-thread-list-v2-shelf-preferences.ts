import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useLayoutEffect, useRef } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

/**
 * Refs advance before persistence starts so consecutive presses always toggle the latest value,
 * even if React has not rendered the optimistic patch yet.
 */
export function useThreadListV2ShelfPreferences() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferencesResult);
  const pinnedShelfExpanded =
    !loaded || preferencesResult.value.threadListPinnedShelfExpanded !== false;
  const activeShelfExpanded =
    !loaded || preferencesResult.value.threadListActiveShelfExpanded !== false;
  const snoozedShelfExpanded =
    loaded && preferencesResult.value.threadListSnoozedShelfExpanded === true;
  const doneShelfExpanded = loaded && preferencesResult.value.threadListDoneShelfExpanded === true;
  const workingShelfExpanded =
    loaded && preferencesResult.value.threadListWorkingShelfExpanded === true;
  const pinnedShelfExpandedRef = useRef(pinnedShelfExpanded);
  const activeShelfExpandedRef = useRef(activeShelfExpanded);
  const snoozedShelfExpandedRef = useRef(snoozedShelfExpanded);
  const doneShelfExpandedRef = useRef(doneShelfExpanded);
  const workingShelfExpandedRef = useRef(workingShelfExpanded);
  useLayoutEffect(() => {
    pinnedShelfExpandedRef.current = pinnedShelfExpanded;
    activeShelfExpandedRef.current = activeShelfExpanded;
    snoozedShelfExpandedRef.current = snoozedShelfExpanded;
    doneShelfExpandedRef.current = doneShelfExpanded;
    workingShelfExpandedRef.current = workingShelfExpanded;
  });

  const togglePinnedShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !pinnedShelfExpandedRef.current;
    pinnedShelfExpandedRef.current = expanded;
    savePreferences({ threadListPinnedShelfExpanded: expanded });
  }, [loaded, savePreferences]);
  const toggleActiveShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !activeShelfExpandedRef.current;
    activeShelfExpandedRef.current = expanded;
    savePreferences({ threadListActiveShelfExpanded: expanded });
  }, [loaded, savePreferences]);
  const toggleSnoozedShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !snoozedShelfExpandedRef.current;
    snoozedShelfExpandedRef.current = expanded;
    savePreferences({ threadListSnoozedShelfExpanded: expanded });
  }, [loaded, savePreferences]);
  const toggleDoneShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !doneShelfExpandedRef.current;
    doneShelfExpandedRef.current = expanded;
    savePreferences({ threadListDoneShelfExpanded: expanded });
  }, [loaded, savePreferences]);
  const toggleWorkingShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !workingShelfExpandedRef.current;
    workingShelfExpandedRef.current = expanded;
    savePreferences({ threadListWorkingShelfExpanded: expanded });
  }, [loaded, savePreferences]);

  return {
    loaded,
    pinnedShelfExpanded,
    activeShelfExpanded,
    doneShelfExpanded,
    snoozedShelfExpanded,
    workingShelfExpanded,
    togglePinnedShelf,
    toggleActiveShelf,
    toggleDoneShelf,
    toggleSnoozedShelf,
    toggleWorkingShelf,
  } as const;
}
