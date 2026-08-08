/**
 * Pixel pipeline for the photo editor preview.
 *
 * All grading happens in the single working space defined in `color-space.ts`:
 * scene-linear, Rec.709 primaries, D65. Pixels are decoded once on entry and
 * encoded once on exit; nothing in between touches gamma-encoded code values.
 *
 * Auto white balance uses **Shades of Gray** (Finlayson & Trezzi, CIC 2004): the
 * illuminant estimate is the Minkowski p-norm of each channel rather than its
 * mean. p = 1 is Gray World, p -> infinity is Max-RGB, and p = 6 is the value
 * the paper reports as best on the standard sets. This matters concretely here:
 * Gray World assumes the scene averages to neutral, so a photo that is half blue
 * sky is "corrected" by cutting blue and lifting red until the whole frame goes
 * yellow. A higher p weights bright, near-specular pixels, which are usually
 * genuinely neutral, so a dominant hue no longer drags the estimate.
 */

/* ------------------------------------------------------------------ *
 * The working space.
 *
 * Scene-linear RGB, Rec.709/sRGB primaries, D65. Pixels are decoded once
 * on entry and encoded once on exit; no operation below runs on
 * gamma-encoded code values, because:
 *
 *  - Exposure is a multiply by 2^EV, which is only a stop of light in
 *    linear; on encoded values it is an arbitrary curve change.
 *  - White balance gains are radiometric. Applied to encoded values they
 *    shift hue as well as cast.
 *  - Unsharp masking on encoded values darkens and rings edges, because
 *    the average of two encoded values is not the encoded average.
 *
 * The transfer function is the true piecewise sRGB EOTF (IEC 61966-2-1),
 * not the 2.2 power approximation; they diverge most in the deep shadows,
 * which is where interiors carry detail.
 * ------------------------------------------------------------------ */

/** Rec.709 luminance weights. For use on LINEAR values only. */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

/** Scene-linear mid grey. Contrast and every pivoted operation turn about this. */
export const MID_GREY = 0.18;

export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value <= 0.0031308 ? value * 12.92 : (1.055 * (value ** (1 / 2.4))) - 0.055;
}

/** 8-bit code value -> linear, tabulated: the decode runs on every pixel. */
const SRGB_DECODE = (() => {
  const table = new Float32Array(256);
  for (let code = 0; code < 256; code += 1) table[code] = srgbToLinear(code / 255);
  return table;
})();

/**
 * Linear -> 8-bit code value.
 *
 * Indexed by sqrt(linear), not by linear: a uniform-in-linear grid spends
 * nearly all its samples in the highlights and quantises the shadows. One sqrt
 * beats both a binary search and the pow it replaces.
 */
const ENCODE_STEPS = 4096;
const ENCODE_TABLE = (() => {
  const table = new Float32Array(ENCODE_STEPS + 1);
  for (let index = 0; index <= ENCODE_STEPS; index += 1) {
    table[index] = linearToSrgb((index / ENCODE_STEPS) ** 2) * 255;
  }
  return table;
})();

export function encodeLinear(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 255;
  return ENCODE_TABLE[(Math.sqrt(value) * ENCODE_STEPS) | 0];
}

export function luminance(red: number, green: number, blue: number): number {
  return (LUMA_R * red) + (LUMA_G * green) + (LUMA_B * blue);
}

export interface PreviewOperations {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  temperature: number;
  tint: number;
  hue: number;
}

export interface ImageStatistics {
  /** Shades-of-Gray illuminant gains, normalised so green is 1. */
  redGain: number;
  greenGain: number;
  blueGain: number;
  /** Linear luminance percentiles driving the automatic tone proposal. */
  shadowLevel: number;
  highlightLevel: number;
}

export const PREVIEW_MAX_EDGE = 1400;

/** Minkowski order. 1 = Gray World, infinity = Max-RGB, 6 = Finlayson & Trezzi. */
export const SHADES_OF_GRAY_P = 6;

/** Above this relative chroma a pixel is treated as scene colour, not illuminant. */
const NEUTRAL_CHROMA_LIMIT = 0.35;

/** Channel-gain coefficients shared with the backend's `_temperature_tint`. */
const TEMPERATURE_RED = 0.18;
const TEMPERATURE_GREEN = 0.025;
const TINT_RED_BLUE = 0.07;
const TINT_GREEN = 0.1;

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

export function analyzeImage(image: ImageData): ImageStatistics {
  const { data } = image;
  const pixels = data.length / 4;
  const power = SHADES_OF_GRAY_P;

  let red = 0;
  let green = 0;
  let blue = 0;
  let counted = 0;
  let fallbackRed = 0;
  let fallbackGreen = 0;
  let fallbackBlue = 0;
  const histogram = new Uint32Array(1024);

  for (let index = 0; index < data.length; index += 4) {
    const linearRed = SRGB_DECODE[data[index]];
    const linearGreen = SRGB_DECODE[data[index + 1]];
    const linearBlue = SRGB_DECODE[data[index + 2]];

    fallbackRed += linearRed ** power;
    fallbackGreen += linearGreen ** power;
    fallbackBlue += linearBlue ** power;

    // Only near-neutral pixels carry illuminant information. A blue sky is
    // strongly chromatic *by nature*, so including it makes the estimator chase
    // the subject instead of the light — which is exactly how a p-norm alone
    // still turns a sky-heavy frame yellow. Saturated pixels are therefore
    // excluded rather than merely down-weighted.
    const high = Math.max(linearRed, linearGreen, linearBlue);
    const low = Math.min(linearRed, linearGreen, linearBlue);
    if (high > 1e-4 && ((high - low) / high) < NEUTRAL_CHROMA_LIMIT) {
      red += linearRed ** power;
      green += linearGreen ** power;
      blue += linearBlue ** power;
      counted += 1;
    }

    const luma = luminance(linearRed, linearGreen, linearBlue);
    histogram[clamp(Math.round(Math.sqrt(luma) * 1023), 0, 1023)] += 1;
  }

  // Too few neutral pixels to be trustworthy (a macro shot of one coloured wall,
  // say): fall back to the plain p-norm over everything rather than to noise.
  const enoughNeutral = counted >= Math.max(16, pixels * 0.02);
  const total = enoughNeutral ? counted : pixels;
  const sumRed = enoughNeutral ? red : fallbackRed;
  const sumGreen = enoughNeutral ? green : fallbackGreen;
  const sumBlue = enoughNeutral ? blue : fallbackBlue;

  const norm = (value: number) => (value / total) ** (1 / power);
  const normRed = Math.max(1e-6, norm(sumRed));
  const normGreen = Math.max(1e-6, norm(sumGreen));
  const normBlue = Math.max(1e-6, norm(sumBlue));

  // Normalise on green: the estimate is an illuminant direction, and anchoring it
  // to green keeps overall exposure unchanged so white balance does not double as
  // a brightness control.
  const gain = (value: number) => clamp(normGreen / value, 0.5, 2);

  const shadowTarget = pixels * 0.005;
  const highlightTarget = pixels * 0.995;
  let seen = 0;
  let shadowBin = -1;
  let highlightBin = 1023;
  for (let bin = 0; bin < 1024; bin += 1) {
    seen += histogram[bin];
    if (shadowBin < 0 && seen >= shadowTarget) shadowBin = bin;
    if (seen >= highlightTarget) {
      highlightBin = bin;
      break;
    }
  }
  if (shadowBin < 0) shadowBin = 0;

  // The histogram is uniform in sqrt(luma); undo that to get back to linear.
  const toLinear = (bin: number) => (bin / 1023) ** 2;

  return {
    redGain: gain(normRed),
    greenGain: 1,
    blueGain: gain(normBlue),
    shadowLevel: toLinear(shadowBin),
    highlightLevel: Math.max(toLinear(highlightBin), toLinear(shadowBin) + 1e-4),
  };
}

/**
 * Solve for the temperature/tint the user would have dialled to reach the
 * estimated illuminant, so pressing Auto can move those knobs instead of hiding
 * the correction behind a flag.
 *
 *   redGain  = 1 + t*TEMPERATURE_RED + n*TINT_RED_BLUE
 *   blueGain = 1 - t*TEMPERATURE_RED + n*TINT_RED_BLUE
 *
 * Subtracting isolates temperature; averaging isolates tint.
 */
export function proposeWhiteBalance(stats: ImageStatistics) {
  const temperature = (stats.redGain - stats.blueGain) / (2 * TEMPERATURE_RED);
  const tint = (((stats.redGain + stats.blueGain) / 2) - 1) / TINT_RED_BLUE;
  return {
    temperature: clamp(Math.round(temperature * 20) / 20, -1, 1),
    tint: clamp(Math.round(tint * 20) / 20, -1, 1),
  };
}

/**
 * Propose exposure and contrast that reproduce a levels stretch of
 * [shadowLevel, highlightLevel] onto [0, 1].
 *
 * In linear the stretch is `out = (x - s) * g` with `g = 1/(h - s)`. The editor's
 * controls are a gain and a contrast pivoted on MID_GREY, so solve
 * `out = m + c*(k*x - m)` for the same line: `c*k = g` and `m*(1 - c) = -s*g`.
 */
export function proposeTone(stats: ImageStatistics) {
  const gain = 1 / Math.max(1e-4, stats.highlightLevel - stats.shadowLevel);
  const contrast = clamp(1 + ((stats.shadowLevel * gain) / MID_GREY), 0.5, 1.5);
  const exposure = clamp(Math.log2(Math.max(1e-4, gain / contrast)), -2, 2);
  return {
    exposure: Math.round(exposure * 20) / 20,
    contrast: Math.round(contrast * 20) / 20,
  };
}

function applySharpness(image: Float32Array, width: number, height: number, sharpness: number) {
  const amount = sharpness - 1;
  if (Math.abs(amount) < 0.01) return;

  // Separable 1-2-1 gaussian, in linear light so edges neither ring nor darken.
  const horizontal = new Float32Array(image.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = (row + x) * 3;
      const left = (row + Math.max(0, x - 1)) * 3;
      const right = (row + Math.min(width - 1, x + 1)) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        horizontal[index + channel] =
          (image[left + channel] + (2 * image[index + channel]) + image[right + channel]) / 4;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    const above = Math.max(0, y - 1) * width;
    const below = Math.min(height - 1, y + 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = (row + x) * 3;
      const up = (above + x) * 3;
      const down = (below + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const blurred = (horizontal[up + channel] + (2 * horizontal[index + channel]) + horizontal[down + channel]) / 4;
        image[index + channel] = Math.max(0, image[index + channel] + (amount * (image[index + channel] - blurred)));
      }
    }
  }
}

/**
 * Grade `source` into `target`. `whiteBalance` supplies the illuminant gains when
 * automatic white balance is engaged; pass null to leave the illuminant alone.
 */
export function renderPreview(
  source: ImageData,
  target: ImageData,
  operations: PreviewOperations,
  whiteBalance: { redGain: number; greenGain: number; blueGain: number } | null,
) {
  const input = source.data;
  const output = target.data;
  const pixels = input.length / 4;
  const working = new Float32Array(pixels * 3);

  const exposureGain = (2 ** operations.exposure) * operations.brightness;
  const redGain = exposureGain
    * (whiteBalance?.redGain ?? 1)
    * (1 + (operations.temperature * TEMPERATURE_RED) + (operations.tint * TINT_RED_BLUE));
  const greenGain = exposureGain
    * (whiteBalance?.greenGain ?? 1)
    * (1 - (Math.abs(operations.temperature) * TEMPERATURE_GREEN) - (operations.tint * TINT_GREEN));
  const blueGain = exposureGain
    * (whiteBalance?.blueGain ?? 1)
    * (1 - (operations.temperature * TEMPERATURE_RED) + (operations.tint * TINT_RED_BLUE));

  const contrast = operations.contrast;
  const saturation = operations.saturation;
  const hueRadians = (operations.hue * Math.PI) / 180;
  const hueCos = Math.cos(hueRadians);
  const hueSin = Math.sin(hueRadians);
  const rotateHue = operations.hue !== 0;

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const source4 = pixel * 4;
    const target3 = pixel * 3;

    // Decode once, then every operation below is on linear light.
    let red = SRGB_DECODE[input[source4]] * redGain;
    let green = SRGB_DECODE[input[source4 + 1]] * greenGain;
    let blue = SRGB_DECODE[input[source4 + 2]] * blueGain;

    if (contrast !== 1) {
      red = MID_GREY + ((red - MID_GREY) * contrast);
      green = MID_GREY + ((green - MID_GREY) * contrast);
      blue = MID_GREY + ((blue - MID_GREY) * contrast);
    }

    if (saturation !== 1) {
      const luma = luminance(red, green, blue);
      red = luma + ((red - luma) * saturation);
      green = luma + ((green - luma) * saturation);
      blue = luma + ((blue - luma) * saturation);
    }

    if (rotateHue) {
      // Rotate in the (R-Y, B-Y) chroma plane. G-Y is not free: luma is fixed by
      // LUMA_R*(R-Y) + LUMA_G*(G-Y) + LUMA_B*(B-Y) = 0, so deriving it from the
      // rotated pair is what keeps the rotation luma-preserving.
      const luma = luminance(red, green, blue);
      const chromaRed = red - luma;
      const chromaBlue = blue - luma;
      const rotatedRed = (chromaRed * hueCos) - (chromaBlue * hueSin);
      const rotatedBlue = (chromaRed * hueSin) + (chromaBlue * hueCos);
      const rotatedGreen = -((LUMA_R * rotatedRed) + (LUMA_B * rotatedBlue)) / LUMA_G;
      red = luma + rotatedRed;
      green = luma + rotatedGreen;
      blue = luma + rotatedBlue;
    }

    working[target3] = red < 0 ? 0 : red;
    working[target3 + 1] = green < 0 ? 0 : green;
    working[target3 + 2] = blue < 0 ? 0 : blue;
  }

  applySharpness(working, source.width, source.height, operations.sharpness);

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const source4 = pixel * 4;
    const target3 = pixel * 3;
    output[source4] = encodeLinear(working[target3]);
    output[source4 + 1] = encodeLinear(working[target3 + 1]);
    output[source4 + 2] = encodeLinear(working[target3 + 2]);
    output[source4 + 3] = input[source4 + 3];
  }
}

export function previewSize(width: number, height: number, maxEdge = PREVIEW_MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function mediaProxyUrl(uploadId: number) {
  return `/api/media-proxy?upload=${encodeURIComponent(String(uploadId))}`;
}
