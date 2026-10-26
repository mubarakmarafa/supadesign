import { SymbolView } from "../../components/ui/AppSymbol";

/** The amber pen marks unsent work in the Drafts section and on thread rows alike. */
export function UnsentDraftIcon({ size = 12 }: { readonly size?: number }) {
  return (
    <SymbolView
      name="square.and.pencil"
      size={size}
      tintColorClassName="accent-adaptive-amber-700-300"
      type="monochrome"
    />
  );
}
