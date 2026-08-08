import assert from "node:assert/strict";
import test from "node:test";

import {
  MID_GREY,
  analyzeImage,
  encodeLinear,
  linearToSrgb,
  srgbToLinear,
  previewSize,
  proposeTone,
  proposeWhiteBalance,
  renderPreview,
} from "./image-preview.ts";

const NEUTRAL = {
  exposure: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  sharpness: 1,
  temperature: 0,
  tint: 0,
  hue: 0,
};

function imageOf(pixels, width = pixels.length, height = 1) {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b], index) => {
    data[index * 4] = r;
    data[(index * 4) + 1] = g;
    data[(index * 4) + 2] = b;
    data[(index * 4) + 3] = 255;
  });
  return { data, width, height };
}

function blank(source) {
  return {
    data: new Uint8ClampedArray(source.data.length),
    width: source.width,
    height: source.height,
  };
}

function graded(pixels, operations, whiteBalance = null) {
  const source = imageOf(pixels);
  const target = blank(source);
  renderPreview(source, target, { ...NEUTRAL, ...operations }, whiteBalance);
  return target.data;
}

/** A frame that is mostly blue sky — the case that turned yellow under Gray World. */
function blueSkyScene() {
  const pixels = [];
  for (let i = 0; i < 70; i += 1) pixels.push([90, 150, 230]);   // sky
  for (let i = 0; i < 20; i += 1) pixels.push([200, 198, 195]);  // near-neutral wall
  for (let i = 0; i < 10; i += 1) pixels.push([120, 110, 100]);  // ground
  return pixels;
}

test("the sRGB transfer function round-trips and is piecewise, not a 2.2 power", () => {
  for (const value of [0, 0.02, 0.2, 0.5, 0.9, 1]) {
    assert.ok(Math.abs(linearToSrgb(srgbToLinear(value)) - value) < 1e-6);
  }
  // The linear toe is where the pure power law is most wrong.
  assert.ok(Math.abs(srgbToLinear(0.02) - (0.02 ** 2.2)) > 1e-4);
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(1), 1);
});

test("the tabulated encode matches the analytic one closely", () => {
  for (const linear of [0.0005, 0.01, 0.18, 0.5, 0.87, 0.999]) {
    const exact = linearToSrgb(linear) * 255;
    assert.ok(
      Math.abs(encodeLinear(linear) - exact) < 1.0,
      `encode(${linear}) = ${encodeLinear(linear)}, expected ~${exact}`,
    );
  }
});

test("neutral settings round-trip every code value within a quantisation step", () => {
  const pixels = [[0, 0, 0], [10, 20, 30], [128, 128, 128], [240, 12, 200], [255, 255, 255]];
  const out = graded(pixels, {});
  pixels.forEach(([r, g, b], index) => {
    assert.ok(Math.abs(out[index * 4] - r) <= 1, `red ${out[index * 4]} vs ${r}`);
    assert.ok(Math.abs(out[(index * 4) + 1] - g) <= 1);
    assert.ok(Math.abs(out[(index * 4) + 2] - b) <= 1);
    assert.equal(out[(index * 4) + 3], 255);
  });
});

test("exposure is a real stop in linear light", () => {
  // +1 EV must double LINEAR luminance, which is not a doubling of code value.
  const source = 0.18;
  const code = Math.round(linearToSrgb(source) * 255);
  const out = graded([[code, code, code]], { exposure: 1 });
  const resulting = srgbToLinear(out[0] / 255);
  assert.ok(
    Math.abs(resulting - (source * 2)) < 0.01,
    `expected ~${source * 2} linear, got ${resulting}`,
  );
  // And emphatically not a doubling of the encoded value.
  assert.ok(out[0] < code * 2);
});

test("Shades of Gray does not chase a dominant blue sky", () => {
  const stats = analyzeImage(imageOf(blueSkyScene()));
  const proposal = proposeWhiteBalance(stats);
  assert.ok(
    Math.abs(proposal.temperature) <= 0.35,
    `p-norm estimate should stay restrained, got ${proposal.temperature}`,
  );

  // The regression this replaces: a plain channel mean is dragged by the sky.
  let meanRed = 0;
  let meanBlue = 0;
  for (const [r, , b] of blueSkyScene()) {
    meanRed += srgbToLinear(r / 255);
    meanBlue += srgbToLinear(b / 255);
  }
  const grayWorldSkew = meanBlue / meanRed;
  assert.ok(grayWorldSkew > 1.5, "sanity: the scene really is blue-dominant");
  const shadesSkew = stats.blueGain === 0 ? Infinity : stats.redGain / stats.blueGain;
  assert.ok(
    shadesSkew < grayWorldSkew,
    `Shades of Gray (${shadesSkew}) must correct less than Gray World (${grayWorldSkew})`,
  );
});

test("a genuinely tinted frame is still corrected", () => {
  const tinted = [];
  for (let i = 0; i < 50; i += 1) tinted.push([120, 130, 190]);
  const stats = analyzeImage(imageOf(tinted));
  assert.ok(stats.blueGain < 1, "a blue cast should pull blue down");
  assert.ok(stats.redGain > 1, "and lift red");
});

test("white balance is anchored on green so it does not change exposure", () => {
  const stats = analyzeImage(imageOf(blueSkyScene()));
  assert.equal(stats.greenGain, 1);
});

test("a neutral frame needs no correction", () => {
  const grey = [];
  for (let level = 40; level < 200; level += 4) grey.push([level, level, level]);
  const stats = analyzeImage(imageOf(grey));
  assert.ok(Math.abs(stats.redGain - 1) < 0.02, `red gain ${stats.redGain}`);
  assert.ok(Math.abs(stats.blueGain - 1) < 0.02, `blue gain ${stats.blueGain}`);
  const proposal = proposeWhiteBalance(stats);
  assert.equal(proposal.temperature, 0);
  assert.equal(proposal.tint, 0);
});

test("the white balance proposal inverts the gain formula it is solved from", () => {
  const stats = { redGain: 1.09, greenGain: 1, blueGain: 0.95, shadowLevel: 0, highlightLevel: 1 };
  const { temperature, tint } = proposeWhiteBalance(stats);
  const red = 1 + (temperature * 0.18) + (tint * 0.07);
  const blue = 1 - (temperature * 0.18) + (tint * 0.07);
  assert.ok(Math.abs(red - stats.redGain) < 0.02, `reconstructed red ${red}`);
  assert.ok(Math.abs(blue - stats.blueGain) < 0.02, `reconstructed blue ${blue}`);
});

test("the tone proposal expands a flat image and leaves a full-range one alone", () => {
  const flat = [];
  for (let level = 110; level < 150; level += 1) flat.push([level, level, level]);
  const flatProposal = proposeTone(analyzeImage(imageOf(flat)));
  assert.ok(flatProposal.contrast > 1, `expected contrast lift, got ${flatProposal.contrast}`);

  const full = [[0, 0, 0], [128, 128, 128], [255, 255, 255]];
  const fullProposal = proposeTone(analyzeImage(imageOf(full)));
  assert.ok(Math.abs(fullProposal.exposure) <= 0.35, `exposure ${fullProposal.exposure}`);
  assert.ok(Math.abs(fullProposal.contrast - 1) <= 0.35, `contrast ${fullProposal.contrast}`);
});

test("contrast pivots on scene-linear mid grey, not on code value 128", () => {
  const midCode = Math.round(linearToSrgb(MID_GREY) * 255);
  const out = graded([[midCode, midCode, midCode]], { contrast: 1.4 });
  assert.ok(Math.abs(out[0] - midCode) <= 2, `${midCode} should be the fixed point, got ${out[0]}`);
  // 128 is NOT the fixed point, which is the whole point of grading in linear.
  const at128 = graded([[128, 128, 128]], { contrast: 1.4 });
  assert.ok(at128[0] > 129, `code 128 sits above mid grey and should lift, got ${at128[0]}`);
});

test("temperature warms toward red and cools toward blue", () => {
  const warm = graded([[128, 128, 128]], { temperature: 1 });
  assert.ok(warm[0] > 128 && warm[2] < 128);
  const cool = graded([[128, 128, 128]], { temperature: -1 });
  assert.ok(cool[0] < 128 && cool[2] > 128);
});

test("tint trades green against magenta", () => {
  const magenta = graded([[128, 128, 128]], { tint: 1 });
  assert.ok(magenta[1] < 128, "green falls toward magenta");
  const green = graded([[128, 128, 128]], { tint: -1 });
  assert.ok(green[1] > 128);
});

test("full desaturation collapses to Rec.709 luminance", () => {
  const out = graded([[255, 0, 0]], { saturation: 0 });
  assert.equal(out[0], out[1]);
  assert.equal(out[1], out[2]);
  const expected = encodeLinear(0.2126);
  assert.ok(Math.abs(out[0] - expected) <= 2, `expected ~${expected}, got ${out[0]}`);
});

test("hue rotation preserves luminance and leaves neutrals neutral", () => {
  const before = srgbToLinear(0.4);
  const out = graded([[200, 60, 90]], { hue: 40 });
  const after = (0.2126 * srgbToLinear(out[0] / 255))
    + (0.7152 * srgbToLinear(out[1] / 255))
    + (0.0722 * srgbToLinear(out[2] / 255));
  const original = (0.2126 * srgbToLinear(200 / 255))
    + (0.7152 * srgbToLinear(60 / 255))
    + (0.0722 * srgbToLinear(90 / 255));
  assert.ok(Math.abs(after - original) < 0.01, `luma ${after} vs ${original}`);
  assert.ok(before > 0);

  const grey = graded([[128, 128, 128]], { hue: 90 });
  assert.ok(Math.abs(grey[0] - grey[1]) <= 1 && Math.abs(grey[1] - grey[2]) <= 1);
});

test("sharpening raises edge contrast and softening lowers it", () => {
  const width = 5;
  const edge = [];
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < width; x += 1) edge.push(x < 2 ? [40, 40, 40] : [200, 200, 200]);
  }
  const source = imageOf(edge, width, 3);
  const sharp = blank(source);
  renderPreview(source, sharp, { ...NEUTRAL, sharpness: 1.6 }, null);
  const soft = blank(source);
  renderPreview(source, soft, { ...NEUTRAL, sharpness: 0.4 }, null);

  const centre = ((1 * width) + 2) * 4;
  const before = ((1 * width) + 1) * 4;
  assert.ok(
    (sharp.data[centre] - sharp.data[before]) > (soft.data[centre] - soft.data[before]),
    "unsharp mask must widen the edge step",
  );
});

test("grading never emits negative or out-of-range code values", () => {
  const out = graded([[0, 0, 0], [255, 255, 255], [10, 250, 5]], {
    exposure: -2, contrast: 1.5, saturation: 1.5, temperature: -1, tint: 1,
  });
  for (const value of out) assert.ok(value >= 0 && value <= 255);
});

test("the working copy is bounded but small images are never upscaled", () => {
  assert.deepEqual(previewSize(4000, 3000, 1400), { width: 1400, height: 1050 });
  assert.deepEqual(previewSize(3000, 4000, 1400), { width: 1050, height: 1400 });
  assert.deepEqual(previewSize(800, 600, 1400), { width: 800, height: 600 });
});
