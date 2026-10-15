import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export function validateStoreBuild(build) {
  if (
    build.schema !== 1 ||
    !["ios", "android"].includes(build.platform) ||
    !/^[a-f0-9]{40}$/.test(build.sha) ||
    !/^\d+\.\d+\.\d+$/.test(build.version) ||
    build.identifier !== "com.supaterm.mobile" ||
    build.projectFullName !== "@supabitapp/supaterm"
  ) {
    throw new Error("Invalid production mobile build manifest.");
  }
  if (build.platform === "ios" && !/^\d+(\.\d+){0,2}$/.test(build.buildNumber)) {
    throw new Error("Invalid iOS build number.");
  }
  if (
    build.platform === "android" &&
    (!Number.isInteger(build.versionCode) ||
      build.versionCode <= 0 ||
      build.versionCode > 2100000000)
  ) {
    throw new Error("Invalid Android version code.");
  }
  return build;
}

export function androidManifestIdentity(xml) {
  const attribute = (name) => {
    const match = xml.match(new RegExp(`\\b${name}="([^"]+)"`));
    if (!match) throw new Error(`Android manifest is missing ${name}.`);
    return match[1];
  };
  return {
    identifier: attribute("package"),
    version: attribute("android:versionName"),
    versionCode: Number(attribute("android:versionCode")),
  };
}

export function readBuildIdentity(binary, platform, bundletoolPath) {
  const exec = (command, args, options = {}) =>
    NodeChildProcess.execFileSync(command, args, { encoding: "utf8", ...options });
  if (platform === "android") {
    if (!bundletoolPath) throw new Error("BUNDLETOOL_PATH is required for Android build metadata.");
    return androidManifestIdentity(
      exec("java", ["-jar", bundletoolPath, "dump", "manifest", `--bundle=${binary}`]),
    );
  }
  if (platform !== "ios") throw new Error("Unsupported mobile platform.");
  const entries = exec("unzip", ["-Z1", binary]).split("\n");
  const plists = entries.filter((entry) => /^Payload\/[^/]+\.app\/Info.plist$/.test(entry));
  if (plists.length !== 1) throw new Error("Expected exactly one iOS application Info.plist.");
  const plist = exec("unzip", ["-p", binary, plists[0]], { encoding: "buffer" });
  const data = JSON.parse(
    exec("plutil", ["-convert", "json", "-o", "-", "--", "-"], { input: plist }),
  );
  return {
    identifier: data.CFBundleIdentifier,
    version: data.CFBundleShortVersionString,
    buildNumber: data.CFBundleVersion,
  };
}

export function selectReviewBuilds(candidates, sha, binaryArtifacts) {
  const selected = new Map();
  for (const candidate of candidates) {
    const build = validateStoreBuild(candidate.build);
    if (build.sha !== sha) continue;
    const previous = selected.get(build.platform);
    if (!previous || candidate.attempt > previous.attempt) selected.set(build.platform, candidate);
  }
  for (const { build, attempt } of selected.values()) {
    const binary = `mobile-production-${build.platform}-${attempt}`;
    if (!binaryArtifacts.includes(binary))
      throw new Error(`The signed binary artifact ${binary} is missing.`);
  }
  const builds = [...selected.values()].map((candidate) => candidate.build);
  if (candidates.length > 0 && builds.length === 0)
    throw new Error("No signed store builds match the requested source commit.");
  if (new Set(builds.map((build) => build.version)).size > 1)
    throw new Error("Mobile store builds have different app versions.");
  return builds;
}

if (process.argv[1] && NodeURL.pathToFileURL(process.argv[1]).href === import.meta.url) {
  const command = process.argv[2];
  if (command === "create") {
    const identity = readBuildIdentity(
      process.env.MOBILE_BINARY,
      process.env.MOBILE_PLATFORM,
      process.env.BUNDLETOOL_PATH,
    );
    if (identity.version !== process.env.MOBILE_VERSION)
      throw new Error("Signed binary version does not match the release version.");
    const build = validateStoreBuild({
      schema: 1,
      platform: process.env.MOBILE_PLATFORM,
      sha: process.env.MOBILE_SOURCE_SHA,
      projectFullName: "@supabitapp/supaterm",
      ...identity,
    });
    await NodeFSP.writeFile(process.env.MOBILE_BUILD_MANIFEST, JSON.stringify(build, null, 2));
  } else if (command === "matrix") {
    const requestedPlatform = process.env.MOBILE_PLATFORM;
    if (!["ios", "android"].includes(requestedPlatform))
      throw new Error("MOBILE_PLATFORM must be ios or android.");
    const root = process.argv[3];
    const candidates = [];
    for (const name of await NodeFSP.readdir(root)) {
      const match = name.match(/^mobile-store-build-(ios|android)-(\d+)$/);
      if (!match) continue;
      const build = JSON.parse(
        await NodeFSP.readFile(NodePath.join(root, name, "manifest.json"), "utf8"),
      );
      if (build.platform !== match[1])
        throw new Error("Store build artifact platform does not match its manifest.");
      if (build.platform === requestedPlatform)
        candidates.push({ build, attempt: Number(match[2]) });
    }
    const builds = selectReviewBuilds(
      candidates,
      process.env.MOBILE_SOURCE_SHA,
      JSON.parse(process.env.MOBILE_BINARY_ARTIFACTS),
    );
    const platform = builds.length === 2 ? "all" : (builds[0]?.platform ?? "all");
    await NodeFSP.appendFile(
      process.env.GITHUB_OUTPUT,
      `enabled=${builds.length > 0}\nplatform=${platform}\nmatrix=${JSON.stringify({ include: builds })}\n`,
    );
  } else {
    throw new Error("Usage: mobile-store-release.mjs <create|matrix>");
  }
}
