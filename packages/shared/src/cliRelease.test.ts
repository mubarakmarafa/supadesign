import { describe, expect, it } from "vite-plus/test";

import { APP_REPOSITORY } from "./appIdentity.ts";
import {
  CLI_RELEASES_PAGE_URL,
  cliArchiveTarCommand,
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("resolves download URLs under the fork's tagged release, honoring a mirror", () => {
    expect(cliReleaseDownloadBaseUrl("1.2.3")).toBe(
      `https://github.com/${APP_REPOSITORY}/releases/download/v1.2.3`,
    );
    expect(cliReleaseDownloadBaseUrl("1.2.3", "https://mirror.example/supaterm/")).toBe(
      "https://mirror.example/supaterm/v1.2.3",
    );
    expect(CLI_RELEASES_PAGE_URL).toBe(`https://github.com/${APP_REPOSITORY}/releases`);
  });

  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  supaterm-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *supaterm-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("supaterm-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("supaterm-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
  });

  it("pages through the release index at the largest page GitHub allows", () => {
    expect(cliReleaseIndexPageUrl(1)).toBe(
      `https://api.github.com/repos/${APP_REPOSITORY}/releases?per_page=100&page=1`,
    );
    expect(cliReleaseIndexPageUrl(3)).toContain("page=3");
  });
});
