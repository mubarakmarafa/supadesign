import { Platform } from "react-native";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { WORKSPACE_DOCK } from "./workspace-tabs-state";

export function useWorkspaceDockHeight() {
  const { scale } = useAndroidControlSizing();
  return Platform.OS === "android" ? 80 * Math.max(1, scale) : WORKSPACE_DOCK.height;
}
