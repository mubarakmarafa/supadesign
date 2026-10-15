import { EnvironmentId } from "@supaterm/contracts";
import { buildPairingUrl, resolveRemotePairingTarget } from "@supaterm/shared/remote";
import { describe, expect, it } from "vite-plus/test";
import {
  emptyRemotePairingForm,
  updateRemotePairingHost,
  updateRemotePairingCode,
  resolveRemotePairingForm,
} from "./remotePairingForm";

describe("remote pairing form", () => {
  const pairingUrl = buildPairingUrl("http://192.168.1.10:3773", "code", {
    environmentId: EnvironmentId.make("paired-environment"),
    routes: ["https://machine.ts.net"],
  });
  const pasted = updateRemotePairingHost(emptyRemotePairingForm, pairingUrl, "https://app.test");

  it("preserves identity and routes when submitting a pasted link", () => {
    expect(resolveRemotePairingTarget(resolveRemotePairingForm(pasted))).toMatchObject({
      environmentId: "paired-environment",
      routes: ["https://machine.ts.net/"],
      credential: "code",
    });
  });

  it("discards link metadata after editing either field", () => {
    const hostEdited = updateRemotePairingHost(pasted, "https://other.test", "https://app.test");
    const codeEdited = updateRemotePairingCode(pasted, "new-code");
    expect(resolveRemotePairingTarget(resolveRemotePairingForm(hostEdited))).toMatchObject({
      httpBaseUrl: "https://other.test/",
      credential: "code",
    });
    expect(resolveRemotePairingTarget(resolveRemotePairingForm(hostEdited))).not.toHaveProperty(
      "environmentId",
    );
    expect(resolveRemotePairingTarget(resolveRemotePairingForm(codeEdited))).toMatchObject({
      credential: "new-code",
    });
    expect(resolveRemotePairingTarget(resolveRemotePairingForm(codeEdited))).not.toHaveProperty(
      "environmentId",
    );
  });
});
