import { Image } from "expo-image";

import { SUPATERM_BRAND_MARK_SOURCE } from "./brandAssets";

export function SupatermIcon(props: { readonly size: number }) {
  return (
    <Image
      source={SUPATERM_BRAND_MARK_SOURCE}
      accessibilityIgnoresInvertColors
      accessibilityLabel="Supaterm"
      style={{ width: props.size, height: props.size }}
    />
  );
}
