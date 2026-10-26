import { useState } from "react";
import { Platform } from "react-native";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";

export function usePullRequestToolbarHeight(bottomInset: number) {
  const { buttonSize } = useAndroidControlSizing();
  // Reserve the controls, native toolbar padding, and outer gaps before onLayout measures them.
  return useState(() => (Platform.OS === "android" ? bottomInset + buttonSize + 40 : 0));
}
