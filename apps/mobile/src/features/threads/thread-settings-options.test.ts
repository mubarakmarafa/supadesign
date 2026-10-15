import type { ProviderOptionDescriptor } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  reasoningSliderOptions,
  runtimeModeChoicesForSupportedModes,
  selectableChoices,
} from "./thread-settings-options";

const effortDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
    { id: "ultracode", label: "Ultracode" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
};

describe("selectableChoices", () => {
  it("hides prompt-injected and workflow-trigger choices, keeping declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("runtimeModeChoicesForSupportedModes", () => {
  it("keeps controls usable when forward-compatible decoding removes every advertised mode", () => {
    expect(runtimeModeChoicesForSupportedModes([])).toHaveLength(4);
  });
});

describe("reasoningSliderOptions", () => {
  it("positions the thumb among selectable levels after hidden choices are removed", () => {
    const descriptor = {
      ...effortDescriptor,
      options: [
        effortDescriptor.options[3]!,
        effortDescriptor.options[0]!,
        effortDescriptor.options[4]!,
        effortDescriptor.options[1]!,
        effortDescriptor.options[2]!,
      ],
    };
    expect(reasoningSliderOptions(descriptor, "high")).toEqual({
      choices: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      selectedIndex: 2,
    });
  });

  it.each(["ultrathink", "ultracode", "unknown", undefined])(
    "preserves the choice picker when the current level is %s",
    (currentValue) => {
      expect(reasoningSliderOptions(effortDescriptor, currentValue)).toBeNull();
    },
  );

  it("supports a model with one fixed reasoning level", () => {
    expect(
      reasoningSliderOptions(
        { ...effortDescriptor, options: [{ id: "high", label: "High" }] },
        "high",
      ),
    ).toEqual({ choices: [{ id: "high", label: "High" }], selectedIndex: 0 });
  });

  it("does not create stops for a model with no selectable levels", () => {
    expect(reasoningSliderOptions({ ...effortDescriptor, options: [] }, "high")).toBeNull();
  });
});
