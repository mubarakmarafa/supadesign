import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import type { NativeLayoutMetrics } from "../lib/reserved-regions";

interface ObserverProps extends ViewProps {
  readonly onMetricsChange?: (event: NativeSyntheticEvent<NativeLayoutMetrics>) => void;
}

function resolveObserver() {
  try {
    const module = requireOptionalNativeModule<{
      readonly ViewPrototypes?: { readonly SupatermNativeControls_LayoutMetrics?: unknown };
    }>("SupatermNativeControls");
    if (!module?.ViewPrototypes?.SupatermNativeControls_LayoutMetrics) return null;
    return requireNativeView<ObserverProps>("SupatermNativeControls", "LayoutMetrics");
  } catch {
    return null;
  }
}
const Observer = resolveObserver();

export function NativeLayoutObserver(props: {
  readonly onChange?: (metrics: NativeLayoutMetrics) => void;
}) {
  return Observer ? (
    <Observer
      pointerEvents="none"
      onMetricsChange={props.onChange ? (event) => props.onChange?.(event.nativeEvent) : undefined}
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
    />
  ) : null;
}
