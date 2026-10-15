import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { useSidebar } from "../components/ui/sidebar";
import { createThreadNavigation } from "../lib/threadNavigation";
import { readThreadShell, waitForSidebarThreadShell } from "../state/entities";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { buildThreadRouteParams } from "../threadRoutes";
import { readPendingThreadCreation } from "../state/threadOutbox";

export function useSidebarThreadNavigation() {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const { isMobile, setOpenMobile } = useSidebar();
  const navigation = useMemo(
    () =>
      createThreadNavigation({
        getLocation: () => router.state.location,
        isReady: (threadRef) =>
          readThreadShell(threadRef) !== null || readPendingThreadCreation(threadRef) !== null,
        waitForThread: waitForSidebarThreadShell,
        navigate: (threadRef) => {
          const selection = useThreadSelectionStore.getState();
          if (selection.hasSelection()) selection.clearSelection();
          selection.setAnchor(scopedThreadKey(threadRef));
          if (isMobile) setOpenMobile(false);
          return router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(threadRef),
          });
        },
      }),
    [isMobile, router, setOpenMobile],
  );
  useEffect(() => () => navigation.cancel(), [navigation]);
  useEffect(
    () => () => {
      if (router.state.location !== location) navigation.cancel();
    },
    [location, navigation, router],
  );
  return navigation.navigate;
}
