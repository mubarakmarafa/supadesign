// Pixel helpers for the app icon artwork: a retro computer whose screen shows a lit bolt.

// The screen glass, as fractions of the 1024×1024 artwork. Everything outside it is
// low-saturation casing, apart from small details that must not count as part of the bolt.
const SCREEN = { left: 0.17, top: 0.13, right: 0.83, bottom: 0.75 };

export interface RgbImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

const rgbToHsl = (red: number, green: number, blue: number) => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return { hue: 0, saturation: 0, lightness };
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const sector =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return { hue: sector * 60, saturation, lightness };
};

const hslToRgb = (hue: number, saturation: number, lightness: number) => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const [r, g, b] =
    hue < 60
      ? [chroma, secondary, 0]
      : hue < 120
        ? [secondary, chroma, 0]
        : hue < 180
          ? [0, chroma, secondary]
          : hue < 240
            ? [0, secondary, chroma]
            : hue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return [r, g, b].map((channel) =>
    Math.round(Math.min(255, Math.max(0, (channel + offset) * 255))),
  );
};

// How strongly a screen pixel belongs to the yellow bolt or its glow: 0 for the dark glass and
// the light bezel, rising to 1 for saturated yellow.
const boltWeight = (red: number, green: number, blue: number) => {
  const { hue, saturation, lightness } = rgbToHsl(red, green, blue);
  if (hue < 30 || hue > 75 || saturation < 0.2 || lightness > 0.75) return 0;
  return Math.min(1, (saturation - 0.2) / 0.3);
};

const forEachScreenPixel = (image: RgbImage, visit: (offset: number, index: number) => void) => {
  for (let y = Math.floor(SCREEN.top * image.height); y < SCREEN.bottom * image.height; y += 1) {
    for (let x = Math.floor(SCREEN.left * image.width); x < SCREEN.right * image.width; x += 1) {
      const index = y * image.width + x;
      visit(index * 3, index);
    }
  }
};

// Returns a copy of the artwork with the bolt and its glow shifted to `hue` degrees.
export const recolorBolt = (image: RgbImage, hue: number): Uint8Array => {
  const output = Uint8Array.from(image.data);
  forEachScreenPixel(image, (offset) => {
    const weight = boltWeight(output[offset]!, output[offset + 1]!, output[offset + 2]!);
    if (weight === 0) return;
    const { saturation, lightness } = rgbToHsl(
      output[offset]!,
      output[offset + 1]!,
      output[offset + 2]!,
    );
    const shifted = hslToRgb(hue, saturation, lightness);
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = Math.round(
        output[offset + channel]! * (1 - weight) + shifted[channel]! * weight,
      );
    }
  });
  return output;
};
