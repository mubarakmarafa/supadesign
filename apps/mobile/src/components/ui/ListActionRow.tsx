import type { ComponentProps } from "react";
import { Platform, type Pressable } from "react-native";
import { useResolveClassNames } from "uniwind";

import { AppActivityIndicator } from "./AppActivityIndicator";
import { ListRowLayout, type ListRowContentProps } from "./ListRowLayout";
import { RowPressable } from "./RowPressable";

/** Pressable props pass through, so inline confirms can bind their ref, touch and hint. */
export function ListActionRow({
  icon,
  label,
  description,
  detail,
  tone,
  loading,
  accessibilityHint,
  ...props
}: Omit<ComponentProps<typeof Pressable>, "children"> &
  ListRowContentProps & {
    readonly tone?: "default" | "danger";
    readonly loading?: boolean;
  }) {
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  const disabled = Boolean(props.disabled || loading);
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint ?? description}
      accessibilityState={{ disabled, busy: Boolean(loading) }}
      android_ripple={{ color: rippleStyle.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      {...props}
      disabled={disabled}
      className="bg-grouped-card"
    >
      <ListRowLayout
        icon={icon}
        label={label}
        description={description}
        detail={detail}
        tone={tone}
        disabled={disabled}
        accessory={
          loading ? (
            <AppActivityIndicator
              colorClassName={tone === "danger" ? "accent-danger-foreground" : "accent-icon"}
            />
          ) : undefined
        }
      />
    </RowPressable>
  );
}
