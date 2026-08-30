export const DEFAULT_PALETTE = {
  base: [22, 22, 24],
  accent: [78, 92, 88]
};

function luminance([red, green, blue]) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function clampColor(color, { minimumLuminance = 0, maximumLuminance, maximumSpread }) {
  let result = color.map((channel) => Math.max(0, Math.min(255, channel)));
  const average = result.reduce((total, channel) => total + channel, 0) / result.length;
  const spread = Math.max(...result) - Math.min(...result);

  if (spread > maximumSpread) {
    const saturationScale = maximumSpread / spread;
    result = result.map((channel) => average + (channel - average) * saturationScale);
  }

  const currentLuminance = luminance(result);
  if (currentLuminance > maximumLuminance) {
    const brightnessScale = maximumLuminance / currentLuminance;
    result = result.map((channel) => channel * brightnessScale);
  } else if (currentLuminance > 0 && currentLuminance < minimumLuminance) {
    const brightnessScale = Math.min(1.6, minimumLuminance / currentLuminance);
    result = result.map((channel) => channel * brightnessScale);
  }

  return result.map((channel) => Math.round(Math.max(0, Math.min(170, channel))));
}

export function clampPalette(palette) {
  return {
    base: clampColor(palette.base, {
      maximumLuminance: 58,
      maximumSpread: 78
    }),
    accent: clampColor(palette.accent, {
      minimumLuminance: 36,
      maximumLuminance: 98,
      maximumSpread: 118
    })
  };
}

export function extractPaletteFromPixels(pixels) {
  const totals = [0, 0, 0];
  let samples = 0;
  let accent = DEFAULT_PALETTE.accent;
  let accentScore = -1;

  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    const brightest = Math.max(red, green, blue);
    const darkest = Math.min(red, green, blue);
    const pixelLuminance = luminance([red, green, blue]);

    if (alpha < 180 || pixelLuminance < 18 || pixelLuminance > 242) continue;

    totals[0] += red;
    totals[1] += green;
    totals[2] += blue;
    samples += 1;

    const saturation = brightest - darkest;
    const score = saturation * (0.35 + pixelLuminance / 255);
    if (score > accentScore) {
      accentScore = score;
      accent = [red, green, blue];
    }
  }

  if (!samples) return DEFAULT_PALETTE;

  return clampPalette({
    base: totals.map((total) => Math.round(total / samples)),
    accent
  });
}
