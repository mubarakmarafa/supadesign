import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSidebarWorkspaceTabs } from "./useSidebarWorkspaceTabs";
import { WORKSPACE_DOCK } from "./workspace-tabs-state";

export function useWorkspaceDockBottomInset() {
  const insets = useSafeAreaInsets();
  const sidebarTabs = useSidebarWorkspaceTabs();
  return sidebarTabs === "picker" ? Math.max(insets.bottom, 12) + WORKSPACE_DOCK.bottomGap : 0;
}
