import { describe, expect, it } from "vite-plus/test";
import { APP_DEV_URL_SCHEME, APP_URL_SCHEME } from "./appIdentity.ts";
import { providerAuthReturnUrl } from "./providerAuthReturnUrl.ts";

describe("provider auth return destinations", () => {
  it.each([APP_URL_SCHEME, APP_DEV_URL_SCHEME])(
    "returns to %s Welcome and the selected settings instance",
    (scheme) => {
      expect(providerAuthReturnUrl(`${scheme}://app/welcome?code=secret#agents:machine-id`)).toBe(
        `${scheme}://app/welcome#agents:machine-id`,
      );
      expect(
        providerAuthReturnUrl(`${scheme}://app/settings/providers?instanceId=work&code=secret`),
      ).toBe(`${scheme}://app/settings/providers?instanceId=work`);
    },
  );
  it.each([
    `${APP_URL_SCHEME}://attacker/welcome`,
    `${APP_URL_SCHEME}://app/welcome/../evil`,
    // The official app's schemes belong to Supaterm, not this fork.
    "supaterm://app/welcome",
    "supaterm-dev://app/welcome",
    "https://attacker.example/welcome",
  ])("rejects %s", (url) => expect(providerAuthReturnUrl(url)).toBeUndefined());
});
