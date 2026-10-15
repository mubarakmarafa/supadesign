import type { ServerConfig } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveEnvironmentIconPickerLock } from "./EnvironmentIconPicker";

const config = { environment: { capabilities: {} } } as unknown as ServerConfig;

describe("resolveEnvironmentIconPickerLock", () => {
  it("locks until the environment is connected", () => {
    expect(
      resolveEnvironmentIconPickerLock({ serverConfig: null, operateAccess: "granted" }),
    ).toMatch(/Connect/);
  });

  it("locks when the session cannot operate the environment", () => {
    expect(
      resolveEnvironmentIconPickerLock({ serverConfig: config, operateAccess: "denied" }),
    ).toMatch(/cannot change/);
  });

  it("waits for a settings grant before allowing changes", () => {
    expect(
      resolveEnvironmentIconPickerLock({ serverConfig: config, operateAccess: "pending" }),
    ).toMatch(/cannot change/);
    expect(
      resolveEnvironmentIconPickerLock({ serverConfig: config, operateAccess: "granted" }),
    ).toBeNull();
  });
});
