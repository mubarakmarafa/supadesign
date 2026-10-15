import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { APP_PRODUCT_NAME, APP_SLUG } from "@supaterm/shared/appIdentity";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect("identifies a failed source read and preserves its cause", () => {
  const sourceState = `/profiles/${APP_PRODUCT_NAME}/Local State`;
  const cause = PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "readFileString",
    pathOrDescriptor: sourceState,
  });
  return Effect.gen(function* () {
    const error = yield* resolveUserDataPath({
      appDataDirectory: "/profiles",
      isDevelopment: false,
      platform: "win32",
    }).pipe(Effect.flip);
    assert.equal(error.operation, "read");
    assert.equal(error.resourcePath, sourceState);
    assert.equal(error.category, "PermissionDenied");
    assert.strictEqual(error.cause, cause);
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        exists: (path) => Effect.succeed(path === sourceState),
        readFileString: () => Effect.fail(cause),
      }),
    ),
    Effect.provide(NodeServices.layer),
  );
});

it.effect.each([APP_PRODUCT_NAME])(
  "preserves Windows credential keys from %s without copying browser databases",
  (sourceName) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: `${APP_SLUG}-v2-profile-` });
      const source = path.join(directory, sourceName);
      const destination = path.join(directory, `${APP_SLUG}-v2`);
      const state = '{"os_crypt":{"encrypted_key":"test-encrypted-key"}}';
      yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
      yield* fs.writeFileString(path.join(source, "Local State"), state);
      yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "V1 owns this database");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(yield* fs.readFileString(path.join(destination, "Local State")), state);
      assert.equal(yield* fs.readFileString(path.join(source, "Local State")), state);
      assert.isFalse(yield* fs.exists(path.join(destination, "IndexedDB")));
      yield* fs.writeFileString(path.join(destination, "Local State"), "existing V2 state");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Local State")),
        "existing V2 state",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each([
  {
    isDevelopment: false,
    current: `${APP_SLUG}-v2`,
    official: ["supaterm-v2", "supa3-v2", "Supaterm (Alpha)", "Supaterm"],
  },
  {
    isDevelopment: true,
    current: `${APP_SLUG}-dev`,
    official: ["supaterm-dev", "supa3-dev", "Supaterm (Dev)"],
  },
])(
  "uses $current and never falls back to the official app's profiles",
  ({ isDevelopment, current, official }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: `${APP_SLUG}-profile-` });
      for (const name of official) {
        yield* fs.makeDirectory(path.join(directory, name), { recursive: true });
        yield* fs.writeFileString(path.join(directory, name, "Local State"), "official state");
      }
      const resolve = resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment,
        platform: "win32",
      });
      assert.equal(yield* resolve, path.join(directory, current));
      assert.isFalse(yield* fs.exists(path.join(directory, current, "Local State")));
      yield* fs.makeDirectory(path.join(directory, current));
      assert.equal(yield* resolve, path.join(directory, current));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
