import { estimateCameraMotion, type RgbaImage } from '../src';

const SIDE = 512;

/** A seeded pseudo-random generator, so every run sees the same texture. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Skin-like texture: noise blurred at a few scales, so there is detail to register. */
function texture(seed: number, side = SIDE): Float64Array {
  const random = mulberry32(seed);
  let g = new Float64Array(side * side).map(() => random());
  const blur = (src: Float64Array, r: number): Float64Array => {
    const out = new Float64Array(src.length);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < side && xx >= 0 && xx < side) {
              s += src[yy * side + xx] as number;
              n++;
            }
          }
        }
        out[y * side + x] = s / n;
      }
    }
    return out;
  };
  const fine = blur(g, 1);
  const coarse = blur(blur(g, 3), 3);
  g = fine.map(
    (v, i) => 120 + 90 * (v - 0.5) + 160 * ((coarse[i] as number) - 0.5)
  );
  return g;
}

/** Draw a dark round "mole" of the given radius at the centre. */
function withMole(
  base: Float64Array,
  radius: number,
  side = SIDE
): Float64Array {
  const out = Float64Array.from(base);
  const c = (side - 1) / 2;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d < radius) out[y * side + x] = 40;
      else if (d < radius + 2)
        out[y * side + x] =
          40 + ((d - radius) / 2) * ((out[y * side + x] as number) - 40);
    }
  }
  return out;
}

/** Re-photograph a grey image: scale by s and rotate by degrees about the centre. */
function warp(
  src: Float64Array,
  s: number,
  degrees: number,
  side = SIDE
): Float64Array {
  const out = new Float64Array(side * side);
  const c = (side - 1) / 2;
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  let mean = 0;
  for (const v of src) mean += v;
  mean /= src.length;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      // Inverse map: where in the original does this output pixel come from?
      const dx = (x - c) / s;
      const dy = (y - c) / s;
      const sx = c + cos * dx + sin * dy;
      const sy = c - sin * dx + cos * dy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= side - 1 || y0 >= side - 1) {
        out[y * side + x] = mean;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const p = (xx: number, yy: number) => src[yy * side + xx] as number;
      out[y * side + x] =
        (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) +
        (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return out;
}

function rgba(grey: Float64Array, side = SIDE): RgbaImage {
  const data = new Uint8Array(side * side * 4);
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    const v = Math.max(0, Math.min(255, Math.round(grey[i] as number)));
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = 255;
  }
  return { data, width: side, height: side };
}

const skin = texture(7);
const photo = rgba(withMole(skin, 40));

describe('estimateCameraMotion', () => {
  it('reports no movement between identical photos', () => {
    const m = estimateCameraMotion(photo, photo);
    expect(m).not.toBeNull();
    expect(m?.scale).toBeCloseTo(1, 2);
    expect(Math.abs(m?.rotationDegrees ?? 99)).toBeLessThan(1);
    expect(m?.reliable).toBe(true);
  });

  it.each([1.2, 0.85, 1.1])('recovers a change of distance: scale %s', (s) => {
    const after = rgba(withMole(warp(skin, s, 0), 40 * s));
    const m = estimateCameraMotion(photo, after);
    expect(m?.reliable).toBe(true);
    expect(Math.abs((m?.scale ?? 0) - s) / s).toBeLessThan(0.04);
  });

  it.each([12, -8, 25])(
    'recovers an in-plane rotation of %s degrees',
    (degrees) => {
      const after = rgba(withMole(warp(skin, 1, degrees), 40));
      const m = estimateCameraMotion(photo, after);
      expect(m?.reliable).toBe(true);
      expect(Math.abs((m?.rotationDegrees ?? 99) - degrees)).toBeLessThan(1.5);
      expect(m?.scale).toBeCloseTo(1, 1);
    }
  );

  it('recovers distance and rotation together', () => {
    const after = rgba(withMole(warp(skin, 1.15, -10), 40 * 1.15));
    const m = estimateCameraMotion(photo, after);
    expect(m?.reliable).toBe(true);
    expect(Math.abs((m?.scale ?? 0) - 1.15) / 1.15).toBeLessThan(0.04);
    expect(Math.abs((m?.rotationDegrees ?? 99) + 10)).toBeLessThan(1.5);
  });

  it('does not mistake a mole that grew for a camera that moved', () => {
    // The whole point: the mole's diameter grows by 60%, the skin around it and
    // the camera stay put. The estimate must say the camera did not move.
    const grown = rgba(withMole(skin, 64));
    const m = estimateCameraMotion(photo, grown);
    expect(m?.reliable).toBe(true);
    expect(Math.abs((m?.scale ?? 0) - 1)).toBeLessThan(0.03);
  });

  it('reads the camera correctly even when the mole grew at the same time', () => {
    // Both happen at once: the camera moves 10% closer and the mole's diameter
    // grows 60%. The estimate must report the camera's 1.1 — the growth must
    // neither be explained away nor leak into the camera figure.
    const both = rgba(withMole(warp(skin, 1.1, 0), 64 * 1.1));
    const m = estimateCameraMotion(photo, both);
    expect(m?.reliable).toBe(true);
    expect(Math.abs((m?.scale ?? 0) - 1.1) / 1.1).toBeLessThan(0.02);
  });

  it('says it cannot tell when there is no texture to register', () => {
    const flat = rgba(new Float64Array(SIDE * SIDE).fill(128));
    const m = estimateCameraMotion(flat, flat);
    expect(m?.reliable).toBe(false);
  });

  it('says it cannot tell when the photos are of different skin', () => {
    const other = rgba(withMole(texture(99), 40));
    const m = estimateCameraMotion(photo, other);
    expect(m?.reliable).toBe(false);
  });

  it('returns null without pixels, and rejects bad options', () => {
    expect(estimateCameraMotion(null, photo)).toBeNull();
    expect(
      estimateCameraMotion(photo, {
        data: new Uint8Array(4),
        width: 10,
        height: 10,
      })
    ).toBeNull();
    expect(() => estimateCameraMotion(photo, photo, { size: 100 })).toThrow(
      TypeError
    );
    expect(() =>
      estimateCameraMotion(photo, photo, { subjectRadius: 0.5 })
    ).toThrow(TypeError);
  });
});
