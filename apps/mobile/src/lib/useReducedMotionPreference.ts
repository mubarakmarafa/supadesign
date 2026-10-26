import { useSyncExternalStore } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { ReduceMotion } from "react-native-reanimated";

let reducedMotion = true;
let generation = 0;
let stopListening: (() => void) | undefined;
const listeners = new Set<() => void>();

function update(enabled: boolean) {
  if (reducedMotion === enabled) return;
  reducedMotion = enabled;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const readPreference = () => {
      const currentGeneration = ++generation;
      void AccessibilityInfo.isReduceMotionEnabled().then(
        (enabled) => {
          if (generation === currentGeneration) update(enabled);
        },
        () => undefined,
      );
    };
    const motionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        generation++;
        update(enabled);
      },
    );
    const appSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") readPreference();
    });
    stopListening = () => {
      motionSubscription.remove();
      appSubscription.remove();
    };
    readPreference();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      generation++;
      stopListening?.();
      stopListening = undefined;
    }
  };
}

/** Shares the live OS preference; motion stays off until the first native read. */
export function useReducedMotionPreference() {
  return useSyncExternalStore(subscribe, () => reducedMotion);
}

/** Live preference as a Reanimated `ReduceMotion`, for `.reduceMotion(...)` and timing configs. */
export function useReduceMotion() {
  return useReducedMotionPreference() ? ReduceMotion.Always : ReduceMotion.Never;
}
