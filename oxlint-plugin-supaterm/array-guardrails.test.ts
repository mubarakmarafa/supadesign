import { createOxlintRuleHarness } from "./test/utils.ts";

const filterMap = createOxlintRuleHarness("array-guardrails/no-array-filter-map", {
  pluginName: "array-guardrails",
  pluginPath: "oxlint-plugin-supaterm/array-guardrails.ts",
});

filterMap.valid(
  "iterator pipeline",
  "const values: number[] = [1, 2]; values.values().filter(Boolean).toArray();",
);
filterMap.valid(
  "unknown receiver",
  "declare const values: Iterable<number>; Array.from(values).filter(Boolean).map(String);",
);
filterMap.invalid(
  "filter then map",
  "const values: number[] = [1, 2]; values.filter(Boolean).map(String);",
);
filterMap.invalid(
  "map then filter",
  "const values: number[] = [1, 2]; values.map(String).filter(Boolean);",
);

const reduceCopy = createOxlintRuleHarness("array-guardrails/no-reduce-accumulator-copy", {
  pluginName: "array-guardrails",
  pluginPath: "oxlint-plugin-supaterm/array-guardrails.ts",
});

reduceCopy.valid(
  "mutating accumulator",
  "const values = [1, 2]; values.reduce((acc, value) => { acc.push(value); return acc; }, [] as number[]);",
);
reduceCopy.invalid(
  "concat accumulator",
  "const values = [1, 2]; values.reduce((acc, value) => acc.concat(value), [] as number[]);",
);
reduceCopy.invalid(
  "array from accumulator",
  "const values = [1, 2]; values.reduce((acc, value) => Array.from(acc).concat(value), [] as number[]);",
);
