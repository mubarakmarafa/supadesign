#!/usr/bin/env node

// Derives the nightly and dev icon artwork from the production artwork by recolouring the
// screen's bolt, so the three builds stay distinguishable in the Dock. Run after changing
// assets/prod/app-icon.icon/Assets/artwork.png, then `vp run icons:export`. `--check` reports
// stale variants without writing them.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

import { recolorBolt, type RgbImage } from "./lib/icon-artwork.ts";

const BOLT_HUES = { nightly: 285, dev: 195 } as const;

export class IconVariantError extends Schema.TaggedError<IconVariantError>()("IconVariantError", {
  variant: Schema.String,
  cause: Schema.Defect(),
}) {}

const artworkPath = (path: Path.Path, repositoryRoot: string, variant: string) =>
  path.join(repositoryRoot, "assets", variant, "app-icon.icon", "Assets", "artwork.png");

const readRgb = (variant: string, file: string) =>
  Effect.tryPromise({
    try: async (): Promise<RgbImage> => {
      const { data, info } = await sharp(file)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    },
    catch: (cause) => new IconVariantError({ variant, cause }),
  });

const exportIconVariants = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const check = process.argv.includes("--check");
  const production = yield* readRgb("prod", artworkPath(path, repositoryRoot, "prod"));
  const stale: Array<string> = [];
  for (const [variant, hue] of Object.entries(BOLT_HUES)) {
    const file = artworkPath(path, repositoryRoot, variant);
    const pixels = recolorBolt(production, hue);
    if (check) {
      const current = yield* readRgb(variant, file);
      if (Buffer.compare(Buffer.from(current.data), Buffer.from(pixels)) !== 0) stale.push(file);
      continue;
    }
    const png = yield* Effect.tryPromise({
      try: () =>
        sharp(pixels, {
          raw: { width: production.width, height: production.height, channels: 3 },
        })
          .png({ compressionLevel: 9 })
          .toBuffer(),
      catch: (cause) => new IconVariantError({ variant, cause }),
    });
    yield* fs.writeFile(file, png);
    yield* Console.log(`wrote ${path.relative(repositoryRoot, file)}`);
  }
  if (stale.length > 0) {
    return yield* new IconVariantError({
      variant: "check",
      cause: `stale icon variants, run vp run icons:variants: ${stale.join(", ")}`,
    });
  }
});

if (import.meta.main) {
  exportIconVariants.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
