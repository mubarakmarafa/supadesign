import React, { type ComponentRef, type Ref } from "react";
import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from "react-native";
import SupatermSourceTextRunNativeComponent from "./SupatermSourceTextRunNativeComponent";
import SupatermSourceTextNativeComponent from "./SupatermSourceTextNativeComponent";
import { flattenStyles } from "./util";

const TextAncestorContext = React.createContext<[boolean, TextStyle]>([false, {}]);

export type SourceTextProps = Omit<TextProps, "onTextLayout" | "onPress" | "onLongPress"> & {
  nativeTextRef?: Ref<ComponentRef<typeof Text>>;
  onSelectionChange?: (event: {
    nativeEvent: { target: number; start: number; end: number };
  }) => void;
};

/** One selectable document on iOS, with nested runs carrying syntax colors. */
export function SourceText({ style, children, nativeTextRef, ...props }: SourceTextProps) {
  const [isAncestor, rootStyle] = React.useContext(TextAncestorContext);
  const flattenedStyle = React.useMemo(() => flattenStyles(rootStyle, style), [rootStyle, style]);
  const contextValue = React.useMemo<[boolean, TextStyle]>(
    () => [true, StyleSheet.flatten([rootStyle, style]) ?? {}],
    [rootStyle, style],
  );
  if (Platform.OS !== "ios") {
    const { onSelectionChange: _onSelectionChange, ...textProps } = props;
    return (
      <Text ref={nativeTextRef} style={style} {...textProps}>
        {children}
      </Text>
    );
  }
  const occurrences = new Map<string, number>();
  const runs = React.Children.toArray(children).map((child) => {
    if (React.isValidElement(child)) return child;
    if (typeof child !== "string" && typeof child !== "number") return null;
    const text = String(child);
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);
    return (
      <SupatermSourceTextRunNativeComponent
        key={`${text}:${occurrence}`}
        style={flattenedStyle}
        {...flattenedStyle}
        text={text}
      />
    );
  });
  if (isAncestor) {
    return <TextAncestorContext.Provider value={contextValue}>{runs}</TextAncestorContext.Provider>;
  }
  return (
    <TextAncestorContext.Provider value={contextValue}>
      <SupatermSourceTextNativeComponent
        allowFontScaling
        selectable
        {...props}
        style={flattenedStyle}
      >
        {runs}
      </SupatermSourceTextNativeComponent>
    </TextAncestorContext.Provider>
  );
}
