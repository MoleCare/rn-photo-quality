/* eslint-env jest, node */
import ImageQualityMetrics from '../src/ImageQualityMetrics';

const SIZE = 64;

/** Build an RGBA buffer from a function of (x, y) returning a grey level. */
function grey(width, height, fn) {
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
  return {data, width, height};
}

/** Deterministic pseudo-random field — stands in for photographic texture. */
function noiseField(width, height, seed = 1) {
  let x = seed;
  const values = new Float64Array(width * height);
  for (let i = 0; i < values.length; i++) {
    /* eslint-disable no-bitwise */
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    /* eslint-enable no-bitwise */
    values[i] = 100 + (x % 100);
  }
  return values;
}

/** Box-blur a field, which is what defocus does to detail. */
function blurred(values, width, height, radius) {
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
            sum += values[r * width + c];
            n++;
          }
        }
      }
      out[row * width + col] = sum / n;
    }
  }
  return out;
}

const fromField = (values, width, height) =>
  grey(width, height, (x, y) => values[y * width + x]);

describe('sharpness', () => {
  it('falls by orders of magnitude when detail is blurred away', () => {
    // The property the previous analyzer could not deliver: its score was
    // exactly 100/100 on every image, blurred or not.
    const field = noiseField(SIZE, SIZE);
    const sharp = ImageQualityMetrics.all(fromField(field, SIZE, SIZE));
    const soft = ImageQualityMetrics.all(
      fromField(blurred(field, SIZE, SIZE, 2), SIZE, SIZE),
    );

    expect(sharp.sharpness).toBeGreaterThan(soft.sharpness * 50);
  });

  it('decreases monotonically as blur radius grows', () => {
    const field = noiseField(SIZE, SIZE, 7);
    const scores = [0, 1, 2, 4].map(radius => {
      const values = radius
        ? blurred(field, SIZE, SIZE, radius)
        : field;
      return ImageQualityMetrics.all(fromField(values, SIZE, SIZE)).sharpness;
    });

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it('is near zero for a flat field, which has no detail to measure', () => {
    const flat = ImageQualityMetrics.all(grey(SIZE, SIZE, () => 128));

    expect(flat.sharpness).toBeCloseTo(0, 6);
  });

  it('returns null rather than a number for an image with no interior', () => {
    expect(ImageQualityMetrics.sharpness(new Float64Array(4), 2, 2)).toBeNull();
  });
});

describe('exposure', () => {
  it('reports the mean level', () => {
    expect(
      ImageQualityMetrics.all(grey(SIZE, SIZE, () => 128)).exposure.mean,
    ).toBeCloseTo(128, 0);
  });

  it('reports crushed shadows', () => {
    const {exposure} = ImageQualityMetrics.all(grey(SIZE, SIZE, () => 0));

    expect(exposure.darkFraction).toBe(1);
    expect(exposure.brightFraction).toBe(0);
  });

  it('reports blown highlights', () => {
    const {exposure} = ImageQualityMetrics.all(grey(SIZE, SIZE, () => 255));

    expect(exposure.brightFraction).toBe(1);
    expect(exposure.darkFraction).toBe(0);
  });

  it('reports a correctly exposed frame as clipping neither end', () => {
    // Detail at a clipped level is gone, not dim. This is the distinction the
    // gate acts on, so it must not fire on a normal photograph.
    const field = noiseField(SIZE, SIZE, 3);
    const {exposure} = ImageQualityMetrics.all(fromField(field, SIZE, SIZE));

    expect(exposure.darkFraction).toBe(0);
    expect(exposure.brightFraction).toBe(0);
  });

  it('measures partial clipping as a fraction, not a flag', () => {
    // Half the frame blown, half correct.
    const {exposure} = ImageQualityMetrics.all(
      grey(SIZE, SIZE, x => (x < SIZE / 2 ? 255 : 128)),
    );

    expect(exposure.brightFraction).toBeCloseTo(0.5, 2);
  });
});

describe('evenness', () => {
  it('is zero for uniform illumination', () => {
    expect(
      ImageQualityMetrics.all(grey(SIZE, SIZE, () => 140)).evenness,
    ).toBeCloseTo(0, 6);
  });

  it('detects a linear gradient across the frame', () => {
    // The case the previous centre-versus-frame version was blind to: window
    // light. Measured on real images it moved 0.838 -> 0.837, while the block
    // spread moved 0.054 -> 0.315.
    const even = ImageQualityMetrics.all(grey(SIZE, SIZE, () => 140)).evenness;
    const gradient = ImageQualityMetrics.all(
      grey(SIZE, SIZE, x => 40 + (x / SIZE) * 200),
    ).evenness;

    expect(gradient).toBeGreaterThan(even + 0.2);
  });

  it('detects a hotspot in the centre', () => {
    const hotspot = ImageQualityMetrics.all(
      grey(SIZE, SIZE, (x, y) => {
        const dx = x - SIZE / 2;
        const dy = y - SIZE / 2;
        return Math.hypot(dx, dy) < SIZE / 4 ? 250 : 90;
      }),
    ).evenness;

    expect(hotspot).toBeGreaterThan(0.15);
  });

  it('does not move when only sharpness changes', () => {
    // Blur redistributes detail, not illumination. If these coupled, a blurred
    // photo would also be reported as unevenly lit.
    const field = noiseField(SIZE, SIZE, 11);
    const sharp = ImageQualityMetrics.all(fromField(field, SIZE, SIZE));
    const soft = ImageQualityMetrics.all(
      fromField(blurred(field, SIZE, SIZE, 2), SIZE, SIZE),
    );

    expect(soft.evenness).toBeCloseTo(sharp.evenness, 1);
  });
});

describe('input handling', () => {
  it('returns null for a missing or truncated buffer', () => {
    expect(ImageQualityMetrics.all(null)).toBeNull();
    expect(ImageQualityMetrics.all({data: null, width: 4, height: 4})).toBeNull();
    // Buffer shorter than width * height * 4 — a partial decode.
    expect(
      ImageQualityMetrics.all({data: new Uint8Array(8), width: 64, height: 64}),
    ).toBeNull();
  });

  it('reports the dimensions it measured, so scores can be compared like for like', () => {
    // Sharpness is resolution-dependent: on one image, sharp against blurred
    // separated 1x at 128 px and 392x at 512 px. A score without its size is
    // not interpretable.
    const result = ImageQualityMetrics.all(grey(32, 48, () => 100));

    expect(result.width).toBe(32);
    expect(result.height).toBe(48);
  });

  it('fixes an analysis size for callers to resample to', () => {
    expect(ImageQualityMetrics.ANALYSIS_SIZE).toBe(512);
  });
});
