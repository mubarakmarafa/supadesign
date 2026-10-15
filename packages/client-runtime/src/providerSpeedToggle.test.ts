import type { ProviderOptionDescriptor } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getSpeedToggle, getSpeedToggleNextValue } from "./providerSpeedToggle.ts";

const CODEX = "codex";

const EFFORT: ProviderOptionDescriptor = {
  id: "reasoningEffort",
  label: "Reasoning",
  type: "select",
  options: [{ id: "high", label: "High" }],
  currentValue: "high",
};

function fastModeDescriptor(
  currentValue: boolean,
): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue };
}

function serviceTierDescriptor(
  currentValue: "default" | "priority" | "ultrafast" | "flex",
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return {
    id: "serviceTier",
    label: "Service Tier",
    type: "select",
    options: [
      { id: "default", label: "Standard", isDefault: true },
      { id: "priority", label: "Fast" },
      { id: "ultrafast", label: "Ultrafast" },
      { id: "flex", label: "Flex" },
    ],
    currentValue,
  };
}

describe("getSpeedToggle", () => {
  it("toggles boolean fast mode on and off", () => {
    expect(getSpeedToggle(CODEX, [EFFORT, fastModeDescriptor(false)])).toEqual({
      descriptorId: "fastMode",
      level: "off",
      onValue: true,
      offValue: false,
      coversDescriptor: true,
    });
    expect(getSpeedToggle(CODEX, [fastModeDescriptor(true)])?.level).toBe("fast");
  });

  it("toggles Codex between Standard and Fast and reports Ultrafast", () => {
    expect(getSpeedToggle(CODEX, [EFFORT, serviceTierDescriptor("default")])).toEqual({
      descriptorId: "serviceTier",
      level: "off",
      onValue: "priority",
      offValue: "default",
      coversDescriptor: false,
    });
    expect(getSpeedToggle(CODEX, [serviceTierDescriptor("priority")])?.level).toBe("fast");
    expect(getSpeedToggle(CODEX, [serviceTierDescriptor("ultrafast")])?.level).toBe("ultrafast");
    expect(getSpeedToggle(CODEX, [serviceTierDescriptor("flex")])?.level).toBe("off");
  });

  it("covers the Codex tier when Standard and Fast are its only options", () => {
    const descriptor = serviceTierDescriptor("default");
    const standardAndFast = {
      ...descriptor,
      options: descriptor.options.filter(({ id }) => id === "default" || id === "priority"),
    };
    expect(getSpeedToggle(CODEX, [standardAndFast])?.coversDescriptor).toBe(true);
  });

  it("turns on Ultrafast when the model has no Fast tier", () => {
    const descriptor = serviceTierDescriptor("default");
    const withoutFast = {
      ...descriptor,
      options: descriptor.options.filter(({ id }) => id !== "priority"),
    };
    expect(getSpeedToggle(CODEX, [withoutFast])?.onValue).toBe("ultrafast");
  });

  it("turns Fast or Ultrafast off to Standard", () => {
    const fast = getSpeedToggle(CODEX, [serviceTierDescriptor("priority")]);
    const ultrafast = getSpeedToggle(CODEX, [serviceTierDescriptor("ultrafast")]);
    const off = getSpeedToggle(CODEX, [serviceTierDescriptor("default")]);
    expect(fast && getSpeedToggleNextValue(fast)).toBe("default");
    expect(ultrafast && getSpeedToggleNextValue(ultrafast)).toBe("default");
    expect(off && getSpeedToggleNextValue(off)).toBe("priority");
  });

  it("has no toggle for service tiers without a speed tier", () => {
    const descriptor = serviceTierDescriptor("default");
    const standardAndFlex = {
      ...descriptor,
      options: descriptor.options.filter(({ id }) => id === "default" || id === "flex"),
    };
    expect(getSpeedToggle(CODEX, [EFFORT, standardAndFlex])).toBeNull();
    expect(getSpeedToggle("opencode", [serviceTierDescriptor("priority")])).toBeNull();
  });
});
