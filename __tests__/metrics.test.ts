import {
  evenness,
  exposure,
  luma,
  measurePixels,
  sharpness,
  type RgbaImage,
} from '../src';

const SIZE = 64;

/** An RGBA image from a function of (x, y) returning a grey level. */
function grey(
  width: number,
  height: number,
  fn: (x: number, y: number) => number
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0, p = 0; row < height; row++) {
    for (let col = 0; col < width; col++, p += 4) {
      const v = Math.max(0, Math.min(255, Math.round(fn(col, row))));
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Deterministic pseudo-random field, standing in for photographic texture. */
function noiseField(width: number, height: number, seed = 1): Float64Array {
  let x = seed;
  const values = new Float64Array(width * height);
  for (let i = 0; i < values.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    values[i] = 100 + (x % 100);
  }
  return values;
}

/** Box-blur a field, which is what defocus does to detail. */
function blurred(
  values: Float64Array,
  width: number,
  height: number,
  radius: number
): Float64Array {
  const out = new Float64Array(values.length);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let sum = 0;
      let n = 0;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const r = row + dr;
          const c = col + dc;
          if (r >= 0 && r < height && c >= 0 && c < width) {
            sum += values[r * width + c] ?? 0;
            n++;
          }
        }
      }
      out[row * width + col] = sum / n;
    }
  }
  return out;
}

const fromField = (values: Float64Array, width: number, height: number) =>
  grey(width, height, (x, y) => values[y * width + x] ?? 0);

/** measurePixels for an image the test expects to measure. */
function measured(image: RgbaImage) {
  const metrics = measurePixels(image);
  if (!metrics) {
    throw new Error('expected metrics');
  }
  return metrics;
}

describe('sharpness', () => {
  it('falls by orders of magnitude when detail is blurred away', () => {
    const field = noiseField(SIZE, SIZE);
    const sharp = measured(fromField(field, SIZE, SIZE)).sharpness ?? 0;
    const soft =
      measured(fromField(blurred(field, SIZE, SIZE, 2), SIZE, SIZE))
        .sharpness ?? 0;

    expect(sharp).toBeGreaterThan(soft * 50);
  });

  it('decreases monotonically as blur radius grows', () => {
    const field = noiseField(SIZE, SIZE, 7);
    const scores = [0, 1, 2, 4].map(
      (radius) =>
        measured(
          fromField(
            radius ? blurred(field, SIZE, SIZE, radius) : field,
            SIZE,
            SIZE
          )
        ).sharpness ?? 0
    );

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1] ?? 0);
    }
  });

  it('is near zero for a flat field, which has no detail to measure', () => {
    expect(measured(grey(SIZE, SIZE, () => 128)).sharpness).toBeCloseTo(0, 6);
  });

  it('is null for an image with no interior pixels', () => {
    expect(sharpness(new Float64Array(4), 2, 2)).toBeNull();
  });
});

describe('exposure', () => {
  it('reports the mean level', () => {
    expect(measured(grey(SIZE, SIZE, () => 128)).exposure.mean).toBeCloseTo(
      128,
      0
    );
  });

  it('reports crushed shadows and blown highlights', () => {
    expect(measured(grey(SIZE, SIZE, () => 0)).exposure).toMatchObject({
      darkFraction: 1,
      brightFraction: 0,
    });
    expect(measured(grey(SIZE, SIZE, () => 255)).exposure).toMatchObject({
      darkFraction: 0,
      brightFraction: 1,
    });
  });

  it('reports a correctly exposed frame as clipping neither end', () => {
    const { exposure: e } = measured(
      fromField(noiseField(SIZE, SIZE, 3), SIZE, SIZE)
    );
    expect(e).toMatchObject({ darkFraction: 0, brightFraction: 0 });
  });

  it('measures partial clipping as a fraction, not a flag', () => {
    const { exposure: e } = measured(
      grey(SIZE, SIZE, (x) => (x < SIZE / 2 ? 255 : 128))
    );
    expect(e.brightFraction).toBeCloseTo(0.5, 2);
  });

  it('counts against the levels passed in', () => {
    const y = luma(grey(8, 8, () => 40).data, 8, 8) ?? new Float64Array();

    expect(exposure(y, { darkLevel: 50 })?.darkFraction).toBe(1);
    expect(exposure(y)?.darkFraction).toBe(0);
    expect(() => exposure(y, { darkLevel: -1 })).toThrow(TypeError);
  });

  it('is null for no pixels', () => {
    expect(exposure(new Float64Array(0))).toBeNull();
  });
});

describe('evenness', () => {
  it('is zero for uniform illumination', () => {
    expect(measured(grey(SIZE, SIZE, () => 140)).evenness).toBeCloseTo(0, 6);
  });

  it('detects a linear gradient across the frame', () => {
    const even = measured(grey(SIZE, SIZE, () => 140)).evenness ?? 0;
    const gradient =
      measured(grey(SIZE, SIZE, (x) => 40 + (x / SIZE) * 200)).evenness ?? 0;

    expect(gradient).toBeGreaterThan(even + 0.2);
  });

  it('detects a hotspot in the centre', () => {
    const hotspot = measured(
      grey(SIZE, SIZE, (x, y) =>
        Math.hypot(x - SIZE / 2, y - SIZE / 2) < SIZE / 4 ? 250 : 90
      )
    ).evenness;

    expect(hotspot).toBeGreaterThan(0.15);
  });

  it('does not move when only sharpness changes', () => {
    const field = noiseField(SIZE, SIZE, 11);
    const sharp = measured(fromField(field, SIZE, SIZE)).evenness ?? 0;
    const soft =
      measured(fromField(blurred(field, SIZE, SIZE, 2), SIZE, SIZE)).evenness ??
      1;

    expect(soft).toBeCloseTo(sharp, 1);
  });

  it('is null when there is nothing to compare', () => {
    expect(evenness(new Float64Array(1), 1, 1)).toBeNull(); // one block only
    expect(evenness(new Float64Array(16), 4, 4, 1)).toBeNull(); // fewer than two blocks
    expect(evenness(new Float64Array(0), 0, 4)).toBeNull();
    expect(evenness(new Float64Array(64), 8, 8)).toBeNull(); // all black: no mean
  });
});

describe('input handling', () => {
  it('returns null for a missing or truncated buffer', () => {
    expect(measurePixels(null)).toBeNull();
    expect(measurePixels(undefined)).toBeNull();
    expect(
      measurePixels({ data: new Uint8Array(8), width: 64, height: 64 })
    ).toBeNull();
    expect(luma(null, 4, 4)).toBeNull();
    expect(luma(new Uint8Array(64), 0, 4)).toBeNull();
  });

  it('reports the dimensions it measured, so scores can be compared like for like', () => {
    expect(measured(grey(32, 48, () => 100))).toMatchObject({
      width: 32,
      height: 48,
    });
  });

  it('returns frozen results', () => {
    const metrics = measured(grey(8, 8, () => 100));
    expect(Object.isFrozen(metrics)).toBe(true);
    expect(Object.isFrozen(metrics.exposure)).toBe(true);
  });
});
