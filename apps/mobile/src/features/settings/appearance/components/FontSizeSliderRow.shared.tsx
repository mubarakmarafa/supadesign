import * as Haptics from "expo-haptics";
import { SymbolView } from "../../../../components/AppSymbol";
import { useCallback, useEffect, useMemo } from "react";
import { View, type AccessibilityActionEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type { ComponentProps } from "react";

import { AppText as Text } from "../../../../components/AppText";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

const THUMB_SIZE = 26;
const TRACK_HEIGHT = 4;
const SNAP_ANIMATION = { duration: 120 } as const;

function clampFraction(value: number): number {
  "worklet";
  return Math.min(1, Math.max(0, value));
}

function createSliderGesture(input: {
  readonly disabled: boolean | undefined;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly progress: SharedValue<number>;
  readonly trackWidth: SharedValue<number>;
  readonly dragging: SharedValue<boolean>;
  readonly commit: (next: number) => void;
}) {
  const { disabled, min, max, step, value, progress, trackWidth, dragging, commit } = input;
  const snapValue = (raw: number): number => {
    "worklet";
    const stepped = Math.round((raw - min) / step) * step + min;
    return Math.min(max, Math.max(min, stepped));
  };
  const fractionAt = (x: number): number => {
    "worklet";
    const usable = trackWidth.value - THUMB_SIZE;
    if (usable <= 0) {
      return 0;
    }
    return clampFraction((x - THUMB_SIZE / 2) / usable);
  };
  const valueAtFraction = (f: number): number => {
    "worklet";
    return snapValue(min + f * (max - min));
  };
  const fractionOfValue = (v: number): number => {
    "worklet";
    return clampFraction((v - min) / (max - min));
  };

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      dragging.set(true);
      const f = fractionAt(event.x);
      progress.set(f);
    })
    .onFinalize((_event, success) => {
      if (!dragging.value) {
        return;
      }
      dragging.set(false);
      if (!success) {
        progress.set(withTiming(fractionOfValue(value), SNAP_ANIMATION));
        return;
      }
      const next = valueAtFraction(progress.value);
      progress.set(withTiming(fractionOfValue(next), SNAP_ANIMATION));
      runOnJS(commit)(next);
    });

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .onEnd((event) => {
      const next = valueAtFraction(fractionAt(event.x));
      progress.set(withTiming(fractionOfValue(next), SNAP_ANIMATION));
      runOnJS(commit)(next);
    });

  return Gesture.Race(pan, tap);
}

export function FontSizeSliderRow(props: {
  readonly disabled?: boolean;
  readonly icon: SymbolName;
  readonly label: string;
  readonly valueLabel: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const { min, max, step, value, disabled, onChange } = props;
  const fraction = (value - min) / (max - min);

  const progress = useSharedValue(clampFraction(fraction));
  const trackWidth = useSharedValue(0);
  const dragging = useSharedValue(false);

  useEffect(() => {
    if (!dragging.get()) {
      progress.set(withTiming(clampFraction(fraction), SNAP_ANIMATION));
    }
  }, [dragging, fraction, progress]);

  const commit = useCallback(
    (next: number) => {
      if (disabled || next === value) {
        return;
      }
      Haptics.selectionAsync().catch(() => undefined);
      onChange(next);
    },
    [disabled, onChange, value],
  );

  const gesture = useMemo(
    () =>
      createSliderGesture({
        disabled,
        min,
        max,
        step,
        value,
        progress,
        trackWidth,
        dragging,
        commit,
      }),
    [commit, disabled, dragging, max, min, progress, step, trackWidth, value],
  );

  const fillStyle = useAnimatedStyle(() => ({
    width: THUMB_SIZE / 2 + progress.value * Math.max(0, trackWidth.value - THUMB_SIZE),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * Math.max(0, trackWidth.value - THUMB_SIZE) }],
  }));

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === "increment") {
      commit(Math.min(max, value + step));
    } else if (event.nativeEvent.actionName === "decrement") {
      commit(Math.max(min, value - step));
    }
  };

  return (
    <View className={disabled ? "gap-1 p-4 opacity-[0.45]" : "gap-1 p-4"}>
      <View className="flex-row items-center gap-4">
        <SymbolView
          name={props.icon}
          size={22}
          tintColorClassName={"accent-icon"}
          type="monochrome"
          weight="regular"
        />
        <Text className="flex-1 text-lg text-foreground">{props.label}</Text>
        <Text className="text-base font-supaterm-medium text-foreground-muted">
          {props.valueLabel}
        </Text>
      </View>
      <View className="flex-row items-center gap-3">
        <SymbolView
          name="textformat.size.smaller"
          size={15}
          tintColorClassName={"accent-icon-muted"}
          type="monochrome"
          weight="regular"
        />
        <GestureDetector gesture={gesture}>
          <View
            accessible
            accessibilityActions={[
              { name: "increment", label: `Increase ${props.label}` },
              { name: "decrement", label: `Decrease ${props.label}` },
            ]}
            accessibilityLabel={props.label}
            accessibilityRole="adjustable"
            accessibilityState={{ disabled: Boolean(disabled) }}
            accessibilityValue={{ min, max, now: value, text: props.valueLabel }}
            className="h-11 flex-1 justify-center"
            onAccessibilityAction={handleAccessibilityAction}
            onLayout={(event) => {
              trackWidth.set(event.nativeEvent.layout.width);
            }}
          >
            <View
              className="w-full rounded-full bg-secondary-border"
              style={{ height: TRACK_HEIGHT }}
            >
              <Animated.View
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={fillStyle}
              />
            </View>
            <Animated.View
              className="absolute left-0 rounded-full border-border bg-primary-foreground"
              style={[
                {
                  borderWidth: 1,
                  height: THUMB_SIZE,
                  marginTop: -THUMB_SIZE / 2,
                  shadowColor: "#000000",
                  shadowOffset: { height: 2, width: 0 },
                  shadowOpacity: 0.18,
                  shadowRadius: 3,
                  top: "50%",
                  width: THUMB_SIZE,
                },
                thumbStyle,
              ]}
            />
          </View>
        </GestureDetector>
        <SymbolView
          name="textformat.size.larger"
          size={22}
          tintColorClassName={"accent-icon-muted"}
          type="monochrome"
          weight="regular"
        />
      </View>
    </View>
  );
}
