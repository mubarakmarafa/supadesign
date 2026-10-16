import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveServerBackedAppStageLabel } from "./branding.logic";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("does not label stable web builds", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "");

    const branding = await import("./branding");

    expect(branding.APP_STAGE_LABEL).toBeNull();
    expect(branding.APP_DISPLAY_NAME).toBe("Supaterm");
  });

  it("keeps development web builds identified without changing the title", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "");

    const branding = await import("./branding");

    expect(branding.APP_STAGE_LABEL).toBe("Dev");
    expect(branding.APP_DISPLAY_NAME).toBe("Supaterm");
  });

  it("preserves an absent desktop stage over the web build fallback", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "Supaterm",
            stageLabel: null,
            displayName: "Supaterm",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_STAGE_LABEL).toBeNull();
    expect(branding.APP_DISPLAY_NAME).toBe("Supaterm");
  });

  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "Supaterm",
            stageLabel: "Nightly",
            displayName: "Supaterm",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("Supaterm");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("Supaterm");
  });

  it("normalizes hosted app channel metadata", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("nightly");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Nightly");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("Supaterm");
  });

  it("does not label the latest hosted app channel", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "latest");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("latest");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Latest");
    expect(branding.APP_STAGE_LABEL).toBe("Latest");
    expect(branding.APP_DISPLAY_NAME).toBe("Supaterm");
  });

  it("ignores unknown hosted app channels", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "preview");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBeNull();
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBeNull();
  });
});

describe("branding logic", () => {
  it("returns Nightly for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: null,
      }),
    ).toBe("Nightly");
  });
});
