import {
  DEFAULT_THRESHOLDS,
  evenness,
  luma,
  measurePixels,
  type RgbaImage,
} from '../src';

/**
 * Photo-quality checks must judge the light, not the skin. Skin-tone bias is a
 * known failure of skin imaging tools, so these tests run every check over ten
 * skin colours spanning the Monk Skin Tone scale (approximate swatch values,
 * lightest to darkest) under the same light.
 */
const SKIN_TONES: Record<string, [number, number, number]> = {
  'MST 1': [0xf6, 0xed, 0xe4],
  'MST 2': [0xf3, 0xe7, 0xdb],
  'MST 3': [0xf7, 0xea, 0xd0],
  'MST 4': [0xea, 0xda, 0xba],
  'MST 5': [0xd7, 0xbd, 0x96],
  'MST 6': [0xa0, 0x7e, 0x56],
  'MST 7': [0x82, 0x5c, 0x43],
  'MST 8': [0x60, 0x41, 0x34],
  'MST 9': [0x3a, 0x31, 0x2a],
  'MST 10': [0x29, 0x24, 0x20],
};
const TONES = Object.entries(SKIN_TONES);
const SIZE = 64;

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (l: number) => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

/** A patch of skin lit by light(x, y), applied in linear light like a camera sees it. */
function skin(
  [r, g, b]: [number, number, number],
  light: (x: number, y: number) => number
): RgbaImage {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0, p = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++, p += 4) {
      const k = light(x, y);
      data[p] = toSrgb(toLinear(r) * k);
      data[p + 1] = toSrgb(toLinear(g) * k);
      data[p + 2] = toSrgb(toLinear(b) * k);
      data[p + 3] = 255;
    }
  }
  return { data, width: SIZE, height: SIZE };
}

/** The value, or a failed test if a metric unexpectedly returned null. */
function present<T>(value: T | null): T {
  if (value === null) {
    throw new Error('metric returned null');
  }
  return value;
}

const evennessOf = (image: RgbaImage) =>
  present(
    evenness(
      present(luma(image.data, image.width, image.height)),
      image.width,
      image.height
    )
  );

describe('photo quality is the same for every skin tone', () => {
  test.each(TONES)(
    '%s in good, even light raises no exposure or lighting warning',
    (_name, colour) => {
      const metrics = present(measurePixels(skin(colour, () => 1)));
      expect(metrics.exposure.darkFraction).toBeLessThanOrEqual(
        DEFAULT_THRESHOLDS.clippedDarkLimit
      );
      expect(metrics.exposure.brightFraction).toBeLessThanOrEqual(
        DEFAULT_THRESHOLDS.clippedBrightLimit
      );
      expect(evennessOf(skin(colour, () => 1))).toBeLessThan(
        DEFAULT_THRESHOLDS.unevenLimit
      );
    }
  );

  test.each(TONES)(
    '%s in dim light is not called "too dark": that check is for clipped pixels',
    (_name, colour) => {
      const metrics = present(measurePixels(skin(colour, () => 0.25)));
      expect(metrics.exposure.darkFraction).toBe(0);
    }
  );

  test('the same lighting gradient scores the same unevenness on every skin tone', () => {
    // Light falls from full to 40% across the frame.
    const gradient = (x: number) => 1 - 0.6 * (x / (SIZE - 1));
    const scores = TONES.map(([, colour]) =>
      evennessOf(skin(colour, gradient))
    );
    const verdicts = scores.map((s) => s > DEFAULT_THRESHOLDS.unevenLimit);
    expect(new Set(verdicts).size).toBe(1);
    expect(Math.max(...scores) - Math.min(...scores)).toBeLessThan(0.05);
  });
});
