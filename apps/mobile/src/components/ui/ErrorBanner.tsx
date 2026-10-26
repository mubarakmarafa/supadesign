import Animated from "react-native-reanimated";
import { useNoticeMotion } from "../../lib/useNoticeMotion";

import { Notice } from "./Notice";

export function ErrorBanner(props: { readonly message: string }) {
  const motion = useNoticeMotion();
  return (
    <Animated.View {...motion} collapsable={false}>
      <Notice tone="danger" message={props.message} />
    </Animated.View>
  );
}
