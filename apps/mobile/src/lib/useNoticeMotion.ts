import { useMemo } from "react";
import { Easing, FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { useReduceMotion } from "./useReducedMotionPreference";
import { isKeyboardMotionSuppressed } from "./motionInput";

export function useNoticeMotion() {
  const preference = useReduceMotion();
  const reduceMotion = isKeyboardMotionSuppressed() ? ReduceMotion.Always : preference;
  return useMemo(
    () => ({
      entering: FadeIn.duration(160)
        .easing(Easing.bezier(0.32, 0.72, 0, 1))
        .reduceMotion(reduceMotion),
      exiting: FadeOut.duration(120)
        .easing(Easing.bezier(0.32, 0.72, 0, 1))
        .reduceMotion(reduceMotion),
    }),
    [reduceMotion],
  );
}
