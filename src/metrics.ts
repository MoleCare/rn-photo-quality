/**
 * Quality metrics computed from decoded pixels. Pure functions: plain arrays
 * in, numbers out, so each can be checked against images with known
 * properties.
 */
import { resolveThresholds, type QualityThresholds } from './options';

export interface RgbaImage {
  /** RGBA bytes, row by row. */
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export interface Exposure {
  /** Mean luma, 0–255. */
  readonly mean: number;
  /** Fraction of pixels at or below `darkLevel`. */
  readonly darkFraction: number;
  /** Fraction of pixels at or above `brightLevel`. */
  readonly brightFraction: number;
}

export interface PixelMetrics {
  /** Variance of the Laplacian; higher is sharper. */
  readonly sharpness: number | null;
  readonly exposure: Exposure;
  /** Coefficient of variation of block means; 0 is perfectly even. */
  readonly evenness: number | null;
  readonly width: number;
  readonly height: number;
}

/** Index into an array whose bounds the caller has already checked. */
const at = (values: ArrayLike<number>, index: number): number =>
  values[index] as number;

/** Rec. 709 luma for each pixel of an RGBA buffer, or null if it is too short. */
export function luma(
  rgba: ArrayLike<number> | null | undefined,
  width: number,
  height: number
): Float64Array | null {
  if (!rgba || !(width > 0) || !(height > 0)) {
    return null;
  }
  const count = width * height;
  if (rgba.length < count * 4) {
    return null;
  }
  const y = new Float64Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    y[i] =
      0.2126 * at(rgba, p) +
      0.7152 * at(rgba, p + 1) +
      0.0722 * at(rgba, p + 2);
  }
  return y;
}

/** Sharpness as the variance of the Laplacian, or null with no interior pixels. */
export function sharpness(
  y: ArrayLike<number>,
  width: number,
  height: number
): number | null {
  if (width < 3 || height < 3) {
    return null;
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const i = row * width + col;
      const lap =
        -4 * at(y, i) +
        at(y, i - 1) +
        at(y, i + 1) +
        at(y, i - width) +
        at(y, i + width);
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mean level and the fractions of pixels pinned at either end. */
export function exposure(
  y: ArrayLike<number>,
  thresholds?: Partial<Pick<QualityThresholds, 'darkLevel' | 'brightLevel'>>
): Exposure | null {
  const levels = resolveThresholds(thresholds);
  return y.length === 0 ? null : exposureOf(y, levels);
}

/** exposure() for pixels already known to be there. */
function exposureOf(
  y: ArrayLike<number>,
  {
    darkLevel,
    brightLevel,
  }: Pick<QualityThresholds, 'darkLevel' | 'brightLevel'>
): Exposure {
  let dark = 0;
  let bright = 0;
  let sum = 0;
  for (let i = 0; i < y.length; i++) {
    const v = at(y, i);
    sum += v;
    if (v <= darkLevel) {
      dark++;
    } else if (v >= brightLevel) {
      bright++;
    }
  }
  return Object.freeze({
    mean: sum / y.length,
    darkFraction: dark / y.length,
    brightFraction: bright / y.length,
  });
}

/** Illumination evenness: coefficient of variation of the means of a grid of blocks. */
export function evenness(
  y: ArrayLike<number>,
  width: number,
  height: number,
  blocks = 4
): number | null {
  if (!(width > 0) || !(height > 0) || blocks < 2) {
    return null;
  }
  const means: number[] = [];
  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      const x0 = Math.floor((bx * width) / blocks);
      const x1 = Math.floor(((bx + 1) * width) / blocks);
      const y0 = Math.floor((by * height) / blocks);
      const y1 = Math.floor(((by + 1) * height) / blocks);
      let sum = 0;
      let n = 0;
      for (let row = y0; row < y1; row++) {
        for (let col = x0; col < x1; col++) {
          sum += at(y, row * width + col);
          n++;
        }
      }
      if (n > 0) {
        means.push(sum / n);
      }
    }
  }
  if (means.length < 2) {
    return null;
  }
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  if (mean <= 0) {
    return null;
  }
  const variance =
    means.reduce((acc, m) => acc + (m - mean) * (m - mean), 0) / means.length;
  return Math.sqrt(variance) / mean;
}

/** Every metric for one decoded image, or null if the pixels are missing or short. */
export function measurePixels(
  image: RgbaImage | null | undefined,
  thresholds?: Partial<Pick<QualityThresholds, 'darkLevel' | 'brightLevel'>>
): PixelMetrics | null {
  const y = image ? luma(image.data, image.width, image.height) : null;
  if (!image || !y) {
    return null;
  }
  const { width, height } = image;
  return Object.freeze({
    sharpness: sharpness(y, width, height),
    // luma() returned at least one pixel.
    exposure: exposureOf(y, resolveThresholds(thresholds)),
    evenness: evenness(y, width, height),
    width,
    height,
  });
}
