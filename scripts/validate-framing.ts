/**
 * Validate estimateCameraMotion on real skin: ISIC dermoscopy images with
 * known, synthetic camera motion; simulated growth of the centre only; and
 * pairs of different photos. Runs the package's own source, unmodified.
 *
 *   ISIC_DIR=/path/to/isic npx tsx scripts/validate-framing.ts 60
 *
 * Not part of the published package, and not run in CI: it needs images.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { estimateCameraMotion } from '../src/framing';
import type { RgbaImage } from '../src/metrics';

const SIDE = 512;

/** Index into an array whose bounds the caller has already checked. */
const at = (values: ArrayLike<number>, index: number): number =>
  values[index] as number;
const N = Number(process.argv[2] ?? 40);
// Folders of ISIC JPEGs: <ISIC_DIR>/mel-all and <ISIC_DIR>/ben-all. None ship here.
const DATA =
  process.env.ISIC_DIR ??
  join(process.env.HOME ?? '', 'molecare-ml/data/isic-raw');

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20260925);

/** Decode, centre-crop to a square, box-average to SIDE × SIDE grey. */
function load(path: string): Float64Array | null {
  let img;
  try {
    img = jpeg.decode(readFileSync(path), {
      useTArray: true,
      maxResolutionInMP: 200,
      maxMemoryUsageInMB: 2048,
    });
  } catch {
    return null;
  }
  const { width, height, data } = img;
  const side = Math.min(width, height);
  const x0 = Math.floor((width - side) / 2);
  const y0 = Math.floor((height - side) / 2);
  const out = new Float64Array(SIDE * SIDE);
  for (let oy = 0; oy < SIDE; oy++) {
    const r0 = y0 + Math.floor((oy * side) / SIDE);
    const r1 = Math.max(r0 + 1, y0 + Math.floor(((oy + 1) * side) / SIDE));
    for (let ox = 0; ox < SIDE; ox++) {
      const c0 = x0 + Math.floor((ox * side) / SIDE);
      const c1 = Math.max(c0 + 1, x0 + Math.floor(((ox + 1) * side) / SIDE));
      let s = 0,
        n = 0;
      for (let r = r0; r < r1; r++)
        for (let c = c0; c < c1; c++) {
          const p = (r * width + c) * 4;
          s +=
            0.2126 * at(data, p) +
            0.7152 * at(data, p + 1) +
            0.0722 * at(data, p + 2);
          n++;
        }
      out[oy * SIDE + ox] = s / n;
    }
  }
  return out;
}

function bilinear(
  src: Float64Array,
  x: number,
  y: number,
  fill: number
): number {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= SIDE - 1 || y0 >= SIDE - 1) return fill;
  const fx = x - x0,
    fy = y - y0;
  const p = (xx: number, yy: number) => at(src, yy * SIDE + xx);
  return (
    (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) +
    (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy
  );
}

const meanOf = (a: Float64Array) => a.reduce((s, v) => s + v, 0) / a.length;

/** The camera moves: scale s and rotate by degrees about the centre. */
function camera(src: Float64Array, s: number, degrees: number): Float64Array {
  const out = new Float64Array(SIDE * SIDE),
    c = (SIDE - 1) / 2,
    fill = meanOf(src);
  const t = (degrees * Math.PI) / 180,
    cos = Math.cos(t),
    sin = Math.sin(t);
  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x < SIDE; x++) {
      const dx = (x - c) / s,
        dy = (y - c) / s;
      out[y * SIDE + x] = bilinear(
        src,
        c + cos * dx + sin * dy,
        c - sin * dx + cos * dy,
        fill
      );
    }
  return out;
}

/** The centre grows: content within radius R is enlarged by g, blending back over a band. */
function grow(src: Float64Array, R: number, g: number): Float64Array {
  const out = new Float64Array(SIDE * SIDE),
    c = (SIDE - 1) / 2,
    band = 0.03 * SIDE,
    fill = meanOf(src);
  const edge = R * g;
  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x < SIDE; x++) {
      const dx = x - c,
        dy = y - c,
        r = Math.hypot(dx, dy);
      let rs: number;
      if (r <= edge) rs = r / g;
      else if (r < edge + band)
        rs = R + ((r - edge) * (edge + band - R)) / band;
      else rs = r;
      const k = r > 0 ? rs / r : 0;
      out[y * SIDE + x] = bilinear(src, c + dx * k, c + dy * k, fill);
    }
  return out;
}

function rgba(g: Float64Array): RgbaImage {
  const data = new Uint8Array(SIDE * SIDE * 4);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const v = Math.max(0, Math.min(255, Math.round(at(g, i))));
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = 255;
  }
  return { data, width: SIDE, height: SIDE };
}

const pick = (dir: string, n: number) => {
  const files = readdirSync(join(DATA, dir))
    .filter((f) => f.endsWith('.jpg'))
    .sort();
  const chosen: string[] = [];
  while (chosen.length < n) {
    const f = files[Math.floor(random() * files.length)];
    if (f !== undefined && !chosen.includes(f)) chosen.push(join(DATA, dir, f));
  }
  return chosen;
};

const paths = [...pick('mel-all', N / 2), ...pick('ben-all', N / 2)];
const images = paths.map(load).filter((x): x is Float64Array => x !== null);
console.log(`loaded ${images.length} of ${paths.length} real ISIC images\n`);

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return at(s, Math.min(s.length - 1, Math.floor(q * s.length)));
};

// 1. Known camera motion.
const scaleErr: number[] = [],
  rotErr: number[] = [];
let reliable = 0;
for (const img of images) {
  const s = 0.8 + random() * 0.45,
    d = -30 + random() * 60;
  const m = estimateCameraMotion(rgba(img), rgba(camera(img, s, d)));
  if (m?.reliable) {
    reliable++;
    scaleErr.push(Math.abs(m.scale - s) / s);
    rotErr.push(Math.abs(m.rotationDegrees - d));
  }
}
console.log(`CAMERA MOVED (scale 0.80–1.25, rotation ±30°)`);
console.log(`  reliable: ${reliable}/${images.length}`);
if (scaleErr.length) {
  console.log(
    `  scale error  median ${(100 * pct(scaleErr, 0.5)).toFixed(2)}%  p90 ${(100 * pct(scaleErr, 0.9)).toFixed(2)}%  max ${(100 * pct(scaleErr, 1)).toFixed(2)}%`
  );
  console.log(
    `  rotation err median ${pct(rotErr, 0.5).toFixed(2)}°  p90 ${pct(rotErr, 0.9).toFixed(2)}°  max ${pct(rotErr, 1).toFixed(2)}°`
  );
}

// 2. Only the centre grows by 30%; the camera does not move. Scale should stay 1.
console.log(
  `\nONLY THE CENTRE GREW by 30% (camera still) — should read scale 1.00`
);
for (const f of [0.08, 0.12, 0.15, 0.2, 0.25]) {
  const devs: number[] = [];
  let falseMotion = 0,
    rel = 0;
  for (const img of images) {
    const m = estimateCameraMotion(rgba(img), rgba(grow(img, f * SIDE, 1.3)));
    if (m?.reliable) {
      rel++;
      devs.push(Math.abs(m.scale - 1));
      if (Math.abs(m.scale - 1) > 0.05) falseMotion++;
    }
  }
  console.log(
    `  grown region radius ${(f * 100).toFixed(0)}% of side → ${(f * 130).toFixed(1)}% after growth` +
      `  | reliable ${rel}/${images.length}  median |scale-1| ${devs.length ? (100 * pct(devs, 0.5)).toFixed(2) : 'n/a'}%` +
      `  | reported as camera motion >5%: ${falseMotion}`
  );
}

// 3. Two different photos: must not claim a confident match.
let falseMatch = 0;
for (let i = 0; i < images.length; i++) {
  const a = images[i];
  const b = images[(i + 1) % images.length];
  if (!a || !b) continue;
  const m = estimateCameraMotion(rgba(a), rgba(b));
  if (m?.reliable) falseMatch++;
}
console.log(
  `\nDIFFERENT PHOTOS paired: claimed a reliable match ${falseMatch}/${images.length} times (want 0)`
);
