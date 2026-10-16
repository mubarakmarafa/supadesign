#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

const ICON_VARIANTS = ["dev", "nightly", "prod"] as const;
type IconVariant = (typeof ICON_VARIANTS)[number];

const ADAPTIVE_CANVAS = 432;
const SPLASH_CANVAS = 1152;
const OUTPUT_DIRECTORY = "apps/mobile/assets";

export class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

const transparentCanvas = (size: number) =>
  sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });

const render = <A>(layer: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new AndroidIconRenderError({ layer, cause }) });

interface Casing {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

const IconComposerFill = Schema.Struct({ fill: Schema.Struct({ solid: Schema.String }) });
const decodeIconComposerFill = Schema.decodeUnknownEffect(Schema.fromJsonString(IconComposerFill));

// The icon's fill is the casing colour, so the parallax margin continues the casing.
const readCasing = Effect.fn("androidIcons.readCasing")(function* (repositoryRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const document = yield* fs
    .readFileString(path.join(repositoryRoot, "assets", "prod", "app-icon.icon", "icon.json"))
    .pipe(Effect.flatMap(decodeIconComposerFill));
  const channels = document.fill.solid
    .replace(/^[a-z-]+:/, "")
    .split(",")
    .map(Number);
  if (channels.length !== 4 || channels.some((channel) => !Number.isFinite(channel))) {
    return yield* new AndroidIconRenderError({ layer: "icon.json", cause: document.fill.solid });
  }
  const [r, g, b, alpha] = channels as [number, number, number, number];
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), alpha };
});

const readArtwork = Effect.fn("androidIcons.readArtwork")(function* (
  repositoryRoot: string,
  variant: IconVariant,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.readFile(
    path.join(repositoryRoot, "assets", variant, "app-icon.icon", "Assets", "artwork.png"),
  );
});

const renderBackground = (
  variant: IconVariant,
  artwork: Uint8Array,
  casing: Casing,
  size: number,
) =>
  render(`${variant}-background`, async () => {
    const visible = Math.round((size * 2) / 3);
    const inset = Math.round((size - visible) / 2);
    const fitted = await sharp(artwork).resize(visible, visible).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: casing } })
      .composite([{ input: fitted, left: inset, top: inset }])
      .png()
      .toBuffer();
  });

const renderTransparent = (size: number) =>
  render("foreground", () => transparentCanvas(size).png().toBuffer());

const exportAndroidIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const write = Effect.fn("androidIcons.write")(function* (name: string, contents: Uint8Array) {
    yield* fs.writeFile(path.join(repositoryRoot, OUTPUT_DIRECTORY, name), contents);
    yield* Console.log(`wrote ${OUTPUT_DIRECTORY}/${name}`);
  });
  yield* write("android-icon-foreground.png", yield* renderTransparent(ADAPTIVE_CANVAS));
  const casing = yield* readCasing(repositoryRoot);
  for (const variant of ICON_VARIANTS) {
    const artwork = yield* readArtwork(repositoryRoot, variant);
    yield* write(
      `android-icon-background-${variant}.png`,
      yield* renderBackground(variant, artwork, casing, ADAPTIVE_CANVAS),
    );
    yield* write(
      `android-splash-icon-${variant}.png`,
      yield* renderBackground(variant, artwork, casing, SPLASH_CANVAS),
    );
  }
});

if (import.meta.main) {
  exportAndroidIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
