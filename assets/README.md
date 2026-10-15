# Brand icons

The three shared Icon Composer projects are the source of truth for exported application icons:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

Each project uses `text.svg` for the Supaterm mark and `background.svg` for the artwork behind it. Additional layers use semantic names that describe their role and placement.

Run `vp run icons:export` from the repository root to regenerate the tracked iOS, Linux, Windows, and web assets. The development web exports are also copied to `apps/web/public` for the browser favicon and splash screen. Run `vp run icons:check` to verify that the generated assets and public copies match their sources without changing files.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

The desktop app's macOS icons are 1024×1024 PNGs with the classic macOS safe area: the opaque icon body is 824×824, inset 100 pixels on every side, with only the native shadow extending into the surrounding transparent canvas. macOS 26 and later re-mask this rendition to the system shape, but show a full-bleed icon inside a gray tile.

Since Icon Composer 27, both its command-line `macOS` export and the app's `macOS pre-Tahoe` preset are full bleed, so the export script leaves the tracked macOS PNGs unchanged and prints a reminder after every run. Render them with Xcode's asset compiler instead, which still builds the classic rendition. Run this from the repository root; `actool` needs an absolute input path, and `--standalone-icon-behavior all` is what adds the 1024px entry to the compiled `.icns`:

```bash
variant=nightly png=nightly-macos-1024.png
work=$(mktemp -d)
xcrun actool "$PWD/assets/$variant/app-icon.icon" --compile "$work" --platform macosx \
  --minimum-deployment-target 11.0 --app-icon app-icon --standalone-icon-behavior all \
  --output-partial-info-plist "$work/partial.plist"
iconutil -c iconset "$work/app-icon.icns" -o "$work/app-icon.iconset"
cp "$work/app-icon.iconset/icon_512x512@2x.png" "assets/$variant/$png"
```

The variants and their PNGs are:

- `dev` -> `blueprint-macos-1024.png`
- `nightly` -> `nightly-macos-1024.png`
- `prod` -> `black-macos-1024.png`

Do not resize, composite, or otherwise post-process the rendered PNG, and do not edit the generated PNG or ICO files directly.

## Android launcher and splash artwork

Android masks the central 72dp of a 108dp adaptive canvas, and the Android 12+ splash screen masks
the central two thirds of a 288dp canvas, so the Icon Composer exports cannot be used directly:
their rounded-square silhouette gets framed again and the wordmark is cropped. The Android artwork
is instead rendered from the same Icon Composer SVG sources by `vp run icons:export:android`:

- `apps/mobile/assets/android-icon-foreground.png`: the shared transparent wordmark, sized to stay
  inside the safe zone
- `apps/mobile/assets/android-icon-background-*.png`: the variant's artwork layers, placed as in
  its `icon.json` and fitted into the masked central two thirds over a full-bleed copy that fills
  the parallax margin. Dev's `annotations.svg` follows the wordmark instead, so the wireframe boxes
  stay around the letters.
- `apps/mobile/assets/android-splash-icon-*.png`: the two layers composed into one 288dp image, so
  the splash mask reproduces the launcher icon's framing.

Rerun the export after changing a layer SVG or its position in `icon.json`. `android-icon-mark.png` remains a flat silhouette for
Android's monochrome themed icon.
