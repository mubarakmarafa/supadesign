import { definePlugin } from "@oxlint/plugins";

import { noArrayFilterMapRule } from "./array-guardrails/rules/no-array-filter-map.ts";
import { noReduceAccumulatorCopyRule } from "./array-guardrails/rules/no-reduce-accumulator-copy.ts";

export default definePlugin({
  meta: { name: "array-guardrails" },
  rules: {
    "no-array-filter-map": noArrayFilterMapRule,
    "no-reduce-accumulator-copy": noReduceAccumulatorCopyRule,
  },
});
