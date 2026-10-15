import Animated from "react-native-reanimated";
import { useNoticeMotion } from "../lib/useNoticeMotion";

import { AppText as Text } from "./AppText";
export function ErrorBanner(props: { readonly message: string }) {
  const motion = useNoticeMotion();
  return (
    <Animated.View
      {...motion}
      collapsable={false}
      className="rounded-2xl border border-danger-border bg-danger px-3.5 py-3"
    >
      <Text className="font-supaterm-medium text-sm text-danger-foreground">{props.message}</Text>
    </Animated.View>
  );
}
