/**
 * How the camera moved between two photos of the same spot, read from the skin
 * around the subject rather than from the subject itself.
 *
 * The subject cannot be the reference. A mole that grew looks the same as one
 * photographed from closer, and a mole that changed shape looks the same as one
 * photographed at a tilt. Measuring the camera from the mole would explain real
 * change away. So only a ring of skin outside the subject is used.
 *
 * How: each photo's ring is resampled onto a log-radius × angle grid around the
 * centre. Moving the camera closer or further scales the ring about the centre,
 * which on that grid is a shift along log-radius; turning the camera is a shift
 * along angle. Phase correlation of the two grids finds both shifts at once.
 * (Masking the centre and working in the frequency domain instead, as
 * Fourier–Mellin does, lets the mask's own ring dominate both spectra, and the
 * scale estimate sticks at 1.)
 *
 * What it measures: distance, as scale, and in-plane rotation. What it does not:
 * tilt, which distorts shape anisotropically, or sideways movement. It assumes
 * the subject is roughly centred in both photos, as the capture guide asks.
 *
 * A confidence comes back with every answer. Skin with too little texture to
 * register, or two photos of different skin, report `reliable: false` instead
 * of guessing.
 *
 * Pure arithmetic on decoded pixels, like metrics.ts.
 */
import { luma, type RgbaImage } from './metrics';

export interface CameraMotion {
  /**
   * Linear scale of the second photo relative to the first. Above 1, the second
   * was taken closer, so everything in it looks larger.
   */
  readonly scale: number;
  /** Rotation of the second photo relative to the first, in degrees, -180 to 180. */
  readonly rotationDegrees: number;
  /** Height of the correlation peak over the mean of the surface. */
  readonly confidence: number;
  /** Whether the confidence clears `minConfidence`. When false, treat as "cannot tell". */
  readonly reliable: boolean;
}

export interface CameraMotionOptions {
  /** Side of the square both photos are reduced to. A power of two, 64 to 1024. Default 256. */
  readonly size?: number;
  /**
   * Radius left out around the centre, as a fraction of the square's side. The
   * subject should fit inside with room to spare, so that growth stays inside
   * too. Default 0.2, a disc 40% of the frame across.
   */
  readonly subjectRadius?: number;
  /** Confidence below which the estimate is `reliable: false`. Default 12. */
  readonly minConfidence?: number;
}

export const DEFAULT_CAMERA_MOTION: Readonly<Required<CameraMotionOptions>> =
  Object.freeze({ size: 256, subjectRadius: 0.2, minConfidence: 12 });

/** The ring reaches this close to the edge of the square, as a fraction of its side. */
const OUTER_RADIUS = 0.48;

/** Index into an array whose bounds the caller has already checked. */
const at = (values: ArrayLike<number>, index: number): number =>
  values[index] as number;

const isPowerOfTwo = (n: number): boolean =>
  Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

function resolve(options: CameraMotionOptions): Required<CameraMotionOptions> {
  const merged = { ...DEFAULT_CAMERA_MOTION, ...options };
  if (!isPowerOfTwo(merged.size) || merged.size < 64 || merged.size > 1024) {
    throw new TypeError(
      'photo-quality camera motion "size" must be a power of two from 64 to 1024'
    );
  }
  if (!(merged.subjectRadius > 0 && merged.subjectRadius < 0.35)) {
    throw new TypeError(
      'photo-quality camera motion "subjectRadius" must be above 0 and below 0.35'
    );
  }
  if (!(merged.minConfidence > 0)) {
    throw new TypeError(
      'photo-quality camera motion "minConfidence" must be positive'
    );
  }
  return merged;
}

/** In-place iterative radix-2 FFT. Both arrays have the same power-of-two length. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = at(re, i);
      re[i] = at(re, j);
      re[j] = tr;
      const ti = at(im, i);
      im[i] = at(im, j);
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = ((inverse ? 2 : -2) * Math.PI) / len;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(step * k);
      const wi = Math.sin(step * k);
      for (let start = 0; start < n; start += len) {
        const a = start + k;
        const b = a + half;
        const xr = at(re, b) * wr - at(im, b) * wi;
        const xi = at(re, b) * wi + at(im, b) * wr;
        re[b] = at(re, a) - xr;
        im[b] = at(im, a) - xi;
        re[a] = at(re, a) + xr;
        im[a] = at(im, a) + xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = at(re, i) / n;
      im[i] = at(im, i) / n;
    }
  }
}

/** 2D FFT of a rows × cols grid, row-major, in place. Both dimensions powers of two. */
function fft2d(
  re: Float64Array,
  im: Float64Array,
  rows: number,
  cols: number,
  inverse: boolean
): void {
  const rowRe = new Float64Array(cols);
  const rowIm = new Float64Array(cols);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    for (let c = 0; c < cols; c++) {
      rowRe[c] = at(re, base + c);
      rowIm[c] = at(im, base + c);
    }
    fft(rowRe, rowIm, inverse);
    for (let c = 0; c < cols; c++) {
      re[base + c] = at(rowRe, c);
      im[base + c] = at(rowIm, c);
    }
  }
  const colRe = new Float64Array(rows);
  const colIm = new Float64Array(rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      colRe[r] = at(re, r * cols + c);
      colIm[r] = at(im, r * cols + c);
    }
    fft(colRe, colIm, inverse);
    for (let r = 0; r < rows; r++) {
      re[r * cols + c] = at(colRe, r);
      im[r * cols + c] = at(colIm, r);
    }
  }
}

/** Luma of the centred square crop, box-averaged down to size × size. */
function squareLuma(image: RgbaImage, size: number): Float64Array | null {
  const y = luma(image.data, image.width, image.height);
  if (!y) {
    return null;
  }
  const side = Math.min(image.width, image.height);
  const x0 = Math.floor((image.width - side) / 2);
  const y0 = Math.floor((image.height - side) / 2);
  const out = new Float64Array(size * size);
  for (let oy = 0; oy < size; oy++) {
    const r0 = y0 + Math.floor((oy * side) / size);
    const r1 = Math.max(r0 + 1, y0 + Math.floor(((oy + 1) * side) / size));
    for (let ox = 0; ox < size; ox++) {
      const c0 = x0 + Math.floor((ox * side) / size);
      const c1 = Math.max(c0 + 1, x0 + Math.floor(((ox + 1) * side) / size));
      let sum = 0;
      let n = 0;
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          sum += at(y, r * image.width + c);
          n++;
        }
      }
      out[oy * size + ox] = sum / n;
    }
  }
  return out;
}

/** Bilinear sample of a square grid; the caller keeps (x, y) inside it. */
function sample(
  values: Float64Array,
  size: number,
  x: number,
  y: number
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const fx = x - x0;
  const fy = y - y0;
  const top =
    at(values, y0 * size + x0) * (1 - fx) + at(values, y0 * size + x1) * fx;
  const bottom =
    at(values, y1 * size + x0) * (1 - fx) + at(values, y1 * size + x1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** @internal Exported for tests; not reachable through the package's `exports` map. */
export interface Ring {
  /** log-radius rows × angle columns, mean removed, tapered along the radius. */
  readonly data: Float64Array;
  readonly rows: number;
  readonly cols: number;
  /** Change in log-radius from one row to the next. */
  readonly logStep: number;
  /** Spread of the ring's values before normalising; 0 means featureless. */
  readonly spread: number;
}

/**
 * The skin between the subject and the frame's edge, on a log-radius × angle
 * grid centred on the square. A full turn of angle, so the angle axis wraps
 * naturally; the radius axis is tapered so its ends do not wrap into each other.
 */
function ring(image: Float64Array, size: number, subjectRadius: number): Ring {
  const rows = size / 2;
  const cols = size;
  const centre = (size - 1) / 2;
  const inner = subjectRadius * size;
  const outer = OUTER_RADIUS * size;
  const logStep = Math.log(outer / inner) / (rows - 1);
  const data = new Float64Array(rows * cols);
  let sum = 0;
  for (let r = 0; r < rows; r++) {
    const radius = inner * Math.exp(r * logStep);
    for (let c = 0; c < cols; c++) {
      const theta = (2 * Math.PI * c) / cols;
      const v = sample(
        image,
        size,
        centre + radius * Math.cos(theta),
        centre + radius * Math.sin(theta)
      );
      data[r * cols + c] = v;
      sum += v;
    }
  }
  const mean = sum / data.length;
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    const d = at(data, i) - mean;
    sumSq += d * d;
  }
  const spread = Math.sqrt(sumSq / data.length);
  for (let r = 0; r < rows; r++) {
    const taper = 0.5 - 0.5 * Math.cos((2 * Math.PI * (r + 0.5)) / rows);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      data[i] = (at(data, i) - mean) * taper;
    }
  }
  return Object.freeze({ data, rows, cols, logStep, spread });
}

/** Wrap an index into -n/2 .. n/2. */
const wrap = (index: number, n: number): number =>
  index >= n / 2 ? index - n : index;

/** Sub-sample offset of a peak from its two neighbours, by fitting a parabola. */
/** @internal Exported for tests. */
export function refine(left: number, centre: number, right: number): number {
  const denominator = left - 2 * centre + right;
  return denominator === 0 ? 0 : (0.5 * (left - right)) / denominator;
}

/** Shift of `b` relative to `a`, in rows and columns, and the strength of the match. */
/** @internal Exported for tests. */
export function phaseCorrelate(
  a: Ring,
  b: Ring
): { rows: number; cols: number; confidence: number } {
  const { rows, cols } = a;
  const n = rows * cols;
  const aRe = Float64Array.from(a.data);
  const aIm = new Float64Array(n);
  const bRe = Float64Array.from(b.data);
  const bIm = new Float64Array(n);
  fft2d(aRe, aIm, rows, cols, false);
  fft2d(bRe, bIm, rows, cols, false);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // conj(A) * B, so the peak sits at the shift of b relative to a.
    const r = at(aRe, i) * at(bRe, i) + at(aIm, i) * at(bIm, i);
    const m = at(aRe, i) * at(bIm, i) - at(aIm, i) * at(bRe, i);
    const norm = Math.hypot(r, m);
    re[i] = norm > 0 ? r / norm : 0;
    im[i] = norm > 0 ? m / norm : 0;
  }
  fft2d(re, im, rows, cols, true);

  let peak = -Infinity;
  let peakIndex = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = at(re, i);
    sum += Math.abs(v);
    if (v > peak) {
      peak = v;
      peakIndex = i;
    }
  }
  const row = Math.floor(peakIndex / cols);
  const col = peakIndex % cols;
  const value = (r: number, c: number): number =>
    at(re, ((r + rows) % rows) * cols + ((c + cols) % cols));
  const mean = sum / n;
  return {
    rows: wrap(
      row + refine(value(row - 1, col), peak, value(row + 1, col)),
      rows
    ),
    cols: wrap(
      col + refine(value(row, col - 1), peak, value(row, col + 1)),
      cols
    ),
    confidence: mean > 0 ? peak / mean : 0,
  };
}

/** Rings flatter than this, in grey levels, have nothing to register. */
const MIN_SPREAD = 1;

/**
 * Estimate how the camera moved between two photos of the same spot, from the
 * skin around the subject. Returns null if either image has no usable pixels.
 *
 * @throws {TypeError} for invalid options
 */
export function estimateCameraMotion(
  before: RgbaImage | null | undefined,
  after: RgbaImage | null | undefined,
  options: CameraMotionOptions = {}
): CameraMotion | null {
  const { size, subjectRadius, minConfidence } = resolve(options);
  if (!before || !after) {
    return null;
  }
  const lumaBefore = squareLuma(before, size);
  const lumaAfter = squareLuma(after, size);
  if (!lumaBefore || !lumaAfter) {
    return null;
  }
  const ringBefore = ring(lumaBefore, size, subjectRadius);
  const ringAfter = ring(lumaAfter, size, subjectRadius);
  if (ringBefore.spread < MIN_SPREAD || ringAfter.spread < MIN_SPREAD) {
    return Object.freeze({
      scale: 1,
      rotationDegrees: 0,
      confidence: 0,
      reliable: false,
    });
  }
  const shift = phaseCorrelate(ringBefore, ringAfter);

  // Taking the second photo closer by s pushes everything outward: a feature at
  // radius r appears at s·r, one log-radius row step further per log(s).
  const scale = Math.exp(shift.rows * ringBefore.logStep);
  // Already in -180..180: phaseCorrelate wraps the column shift into
  // -cols/2..cols/2, and a parabola fitted at the maximum moves it at most half a
  // step, so no second wrap is needed.
  const rotationDegrees = (shift.cols * 360) / ringBefore.cols;

  return Object.freeze({
    scale,
    rotationDegrees,
    confidence: shift.confidence,
    reliable: shift.confidence >= minConfidence,
  });
}
