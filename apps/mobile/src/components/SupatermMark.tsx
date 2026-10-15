import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function SupatermMark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg
      accessibilityLabel="Supaterm"
      height={props.height}
      width={props.height * (12 / 19)}
      viewBox="0 0 12 19"
    >
      <ThemedPath
        d="M5 0L11 0L11 1L12 1L12 4L11 4L11 5L10 5L10 6L9 6L9 7L11 7L11 8L12 8L12 11L11 11L11 13L10 13L10 14L9 14L9 15L8 15L8 16L7 16L7 17L6 17L6 18L5 18L5 19L2 19L2 17L3 17L3 15L4 15L4 13L5 13L5 12L1 12L1 10L0 10L0 7L2 7L2 5L3 5L3 3L4 3L4 1L5 1Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
