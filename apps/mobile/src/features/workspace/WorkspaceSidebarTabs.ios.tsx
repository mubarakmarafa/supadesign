import { View } from "react-native";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { useWorkspaceTabSelection } from "./useWorkspaceTabSelection";

export function WorkspaceSidebarTabs() {
  const workspace = useWorkspaceTabs()!;
  const selectTab = useWorkspaceTabSelection();
  return (
    <View className="px-4 pb-3 pt-2">
      <SegmentedControl
        role="tab"
        options={[
          { value: "threads", label: "Threads" },
          { value: "pullRequests", label: "Pull requests" },
        ]}
        selected={workspace.state.selectedTab}
        onSelect={selectTab}
      />
    </View>
  );
}
