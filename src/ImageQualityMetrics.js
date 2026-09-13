/**
 * Quality metrics computed from decoded pixels.
 *
 * Deliberately free of React Native imports: every function here takes plain
 * arrays and returns numbers, so each one can be checked against images with
 * known properties.
 *
 * Stateless: levels are passed per call (defaults in DEFAULT_OPTIONS).
 */
import {DEFAULT_OPTIONS, resolveOptions} from './defaults';

export default class ImageQualityMetrics {
  /** The default resample target; pass `analysisSize` to change it per call. */
  static ANALYSIS_SIZE = DEFAULT_OPTIONS.analysisSize;

  static DARK_LEVEL = DEFAULT_OPTIONS.darkLevel;

  static BRIGHT_LEVEL = DEFAULT_OPTIONS.brightLevel;

  /**
   * Per-channel luma (Rec. 709) for an RGBA buffer.
   *
   * @param {Uint8Array|Uint8ClampedArray|number[]} rgba
   * @param {number} width
   * @param {number} height
   * @returns {Float64Array|null}
   */
  static luma(rgba, width, height) {
    if (!rgba || !width || !height) {
      return null;
    }
    const count = width * height;
    if (rgba.length < count * 4) {
      return null;
    }

    const y = new Float64Array(count);
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      y[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    }
    return y;
  }

  /**
   * Sharpness as the variance of the Laplacian.
   *
   * @returns {number|null} higher is sharper
   */
  static sharpness(y, width, height) {
    if (!y || width < 3 || height < 3) {
      return null;
    }

    let sum = 0;
    let sumSq = 0;
    let n = 0;

    for (let row = 1; row < height - 1; row++) {
      for (let col = 1; col < width - 1; col++) {
        const i = row * width + col;
        const lap =
          -4 * y[i] + y[i - 1] + y[i + 1] + y[i - width] + y[i + width];
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    }

    if (!n) {
      return null;
    }
    const mean = sum / n;
    return sumSq / n - mean * mean;
  }

  /**
   * Exposure: mean level and the fraction of pixels pinned at either end.
   *
   * @param {Float64Array} y - luma
   * @param {{darkLevel?: number, brightLevel?: number}} [options]
   * @returns {{mean: number, darkFraction: number, brightFraction: number}|null}
   */
  static exposure(y, options) {
    const {darkLevel, brightLevel} = resolveOptions(options);
    if (!y || !y.length) {
      return null;
    }

    let dark = 0;
    let bright = 0;
    let sum = 0;

    for (let i = 0; i < y.length; i++) {
      const v = y[i];
      sum += v;
      if (v <= darkLevel) {
        dark++;
      } else if (v >= brightLevel) {
        bright++;
      }
    }

    return {
      mean: sum / y.length,
      darkFraction: dark / y.length,
      brightFraction: bright / y.length,
    };
  }

  /**
   * Illumination evenness as the coefficient of variation of block means.
   *
   * @returns {number|null} 0 is perfectly even; larger is more uneven
   */
  static evenness(y, width, height, blocks = 4) {
    if (!y || !width || !height || blocks < 2) {
      return null;
    }

    const means = [];
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
            sum += y[row * width + col];
            n++;
          }
        }
        if (n) {
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

  /**
   * Compute every metric for one decoded image.
   *
   * @param {{data: Uint8Array, width: number, height: number}} decoded
   * @param {Object} [options] - see exposure()
   * @returns {{sharpness: number|null, exposure: Object|null, evenness: number|null, width: number, height: number}|null}
   */
  static all(decoded, options) {
    const opts = resolveOptions(options);
    if (!decoded || !decoded.data) {
      return null;
    }

    const {data, width, height} = decoded;
    const y = ImageQualityMetrics.luma(data, width, height);
    if (!y) {
      return null;
    }

    return {
      sharpness: ImageQualityMetrics.sharpness(y, width, height),
      exposure: ImageQualityMetrics.exposure(y, opts),
      evenness: ImageQualityMetrics.evenness(y, width, height),
      width,
      height,
    };
  }
}
