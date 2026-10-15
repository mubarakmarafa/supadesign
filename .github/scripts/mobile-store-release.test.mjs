import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  androidManifestIdentity,
  selectReviewBuilds,
  validateStoreBuild,
} from "./mobile-store-release.mjs";

const sha = "a".repeat(40);
const ios = {
  schema: 1,
  sha,
  platform: "ios",
  version: "26.0.10",
  buildNumber: "10",
  identifier: "com.supaterm.mobile",
  projectFullName: "@supabitapp/supacode",
};
const android = { ...ios, platform: "android", versionCode: 25 };

NodeTest.test("reads the exact signed Android version and package", () => {
  NodeAssert.deepEqual(
    androidManifestIdentity(
      '<manifest package="com.supaterm.mobile" android:versionCode="25" android:versionName="26.0.10"/>',
    ),
    { identifier: ios.identifier, version: ios.version, versionCode: 25 },
  );
  NodeAssert.throws(
    () => androidManifestIdentity('<manifest package="other.app"/>'),
    /versionName/,
  );
});

NodeTest.test("rejects development identifiers and invalid native build numbers", () => {
  NodeAssert.throws(
    () => validateStoreBuild({ ...ios, identifier: "com.supaterm.mobile.dev" }),
    /Invalid production/,
  );
  NodeAssert.throws(() => validateStoreBuild({ ...ios, buildNumber: "latest" }), /Invalid iOS/);
  NodeAssert.throws(() => validateStoreBuild({ ...android, versionCode: 0 }), /Invalid Android/);
});

NodeTest.test("selects the newest successful attempt per platform from the exact source", () => {
  const newer = { ...ios, buildNumber: "11" };
  NodeAssert.deepEqual(
    selectReviewBuilds(
      [
        { build: ios, attempt: 1 },
        { build: newer, attempt: 2 },
        { build: android, attempt: 1 },
      ],
      sha,
      ["mobile-production-ios-1", "mobile-production-ios-2", "mobile-production-android-1"],
    ),
    [newer, android],
  );
});

NodeTest.test("refuses missing binaries and mismatched source commits", () => {
  NodeAssert.throws(
    () => selectReviewBuilds([{ build: ios, attempt: 1 }], sha, []),
    /signed binary artifact/,
  );
  NodeAssert.throws(
    () =>
      selectReviewBuilds([{ build: ios, attempt: 1 }], "b".repeat(40), ["mobile-production-ios-1"]),
    /No signed store builds/,
  );
});

NodeTest.test("refuses mixed iOS and Android app versions", () => {
  NodeAssert.throws(
    () =>
      selectReviewBuilds(
        [
          { build: ios, attempt: 1 },
          { build: { ...android, version: "26.0.11" }, attempt: 1 },
        ],
        sha,
        ["mobile-production-ios-1", "mobile-production-android-1"],
      ),
    /different app versions/,
  );
});

NodeTest.test("OTA-only runs produce no review builds", () => {
  NodeAssert.deepEqual(selectReviewBuilds([], sha, []), []);
});
