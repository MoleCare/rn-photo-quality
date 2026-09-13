import CaptureMetadata from './CaptureMetadata';
import {DEFAULT_OPTIONS, messageFor, resolveOptions} from './defaults';

/**
 * How much two photos of the same subject can be compared.
 *
 * Does not correct anything. Says how much weight the comparison can carry
 * given provenance and measured quality. Stateless: limits and messages are
 * passed per call.
 */
export default class PhotoComparability {
  static LEVEL = Object.freeze({
    GOOD: 'good',
    FAIR: 'fair',
    POOR: 'poor',
    UNKNOWN: 'unknown',
  });

  static REASON = Object.freeze({
    NO_PROVENANCE: 'no_provenance',
    DIFFERENT_DEVICE: 'different_device',
    DIFFERENT_PROCESSING: 'different_processing',
    FROM_LIBRARY: 'from_library',
    EXPOSURE_DIFFERS: 'exposure_differs',
    UNEVEN_LIGHTING: 'uneven_lighting',
    NOT_MEASURED: 'not_measured',
  });

  static EXPOSURE_DIFF_LIMIT = DEFAULT_OPTIONS.exposureDiffLimit;

  static UNEVEN_LIMIT = DEFAULT_OPTIONS.unevenLimit;

  /**
   * Assess a pair of history entries.
   *
   * @param {Object} a - entry optionally carrying `capture`
   * @param {Object} b - the entry it is being compared against
   * @param {{exposureDiffLimit?: number, unevenLimit?: number}} [options]
   * @returns {{level: string, reasons: string[], comparable: boolean}}
   * @throws {TypeError} for an unknown or invalid option
   */
  static assess(a, b, options) {
    const opts = resolveOptions(options);
    const capA = a && a.capture;
    const capB = b && b.capture;
    const reasons = [];

    if (!CaptureMetadata.isPresent(capA) || !CaptureMetadata.isPresent(capB)) {
      return {
        level: PhotoComparability.LEVEL.UNKNOWN,
        reasons: [PhotoComparability.REASON.NO_PROVENANCE],
        comparable: false,
      };
    }

    if (
      capA.source === CaptureMetadata.SOURCE.LIBRARY ||
      capB.source === CaptureMetadata.SOURCE.LIBRARY
    ) {
      reasons.push(PhotoComparability.REASON.FROM_LIBRARY);
    }

    if (!PhotoComparability._sameDevice(capA, capB)) {
      reasons.push(PhotoComparability.REASON.DIFFERENT_DEVICE);
    }

    if (!PhotoComparability._sameProcessing(capA, capB)) {
      reasons.push(PhotoComparability.REASON.DIFFERENT_PROCESSING);
    }

    reasons.push(...PhotoComparability._qualityReasons(capA, capB, opts));

    return {
      level: PhotoComparability._level(reasons),
      reasons,
      comparable: reasons.length === 0,
    };
  }

  static _qualityReasons(capA, capB, opts = DEFAULT_OPTIONS) {
    const qA = capA.quality;
    const qB = capB.quality;
    const reasons = [];

    if (!qA || !qB || qA.measured !== true || qB.measured !== true) {
      reasons.push(PhotoComparability.REASON.NOT_MEASURED);
      return reasons;
    }

    const lumaA = qA.meanLuma;
    const lumaB = qB.meanLuma;
    if (
      typeof lumaA === 'number' &&
      typeof lumaB === 'number' &&
      Math.max(lumaA, lumaB) > 0
    ) {
      const diff = Math.abs(lumaA - lumaB) / Math.max(lumaA, lumaB);
      if (diff > opts.exposureDiffLimit) {
        reasons.push(PhotoComparability.REASON.EXPOSURE_DIFFERS);
      }
    }

    const uneven = [qA.evenness, qB.evenness].some(
      value =>
        typeof value === 'number' && value > opts.unevenLimit,
    );
    if (uneven) {
      reasons.push(PhotoComparability.REASON.UNEVEN_LIGHTING);
    }

    return reasons;
  }

  static _level(reasons) {
    if (reasons.length === 0) {
      return PhotoComparability.LEVEL.GOOD;
    }

    const structural = [
      PhotoComparability.REASON.DIFFERENT_DEVICE,
      PhotoComparability.REASON.DIFFERENT_PROCESSING,
      PhotoComparability.REASON.FROM_LIBRARY,
    ];
    if (reasons.some(reason => structural.includes(reason))) {
      return PhotoComparability.LEVEL.POOR;
    }

    return PhotoComparability.LEVEL.FAIR;
  }

  static _sameDevice(a, b) {
    return !!(
      a.device &&
      b.device &&
      a.device.model === b.device.model &&
      a.device.platform === b.device.platform
    );
  }

  static _sameProcessing(a, b) {
    return !!(
      a.processing &&
      b.processing &&
      a.processing.maxWidth === b.processing.maxWidth &&
      a.processing.maxHeight === b.processing.maxHeight &&
      a.processing.quality === b.processing.quality
    );
  }

  /**
   * Plain explanation for one reason.
   * @param {string} reason - one of REASON
   * @param {Object<string, string>} [messages] - your own text keyed by reason
   */
  static explain(reason, messages) {
    const own = messageFor(messages, reason);
    if (own !== null) {
      return own;
    }

    switch (reason) {
      case PhotoComparability.REASON.NO_PROVENANCE:
        return 'One of these photos was taken before capture provenance was recorded, so they cannot be checked for a like-for-like match.';
      case PhotoComparability.REASON.DIFFERENT_DEVICE:
        return 'These photos were taken on different devices. Cameras differ in colour and detail, so some of the difference you see is the camera.';
      case PhotoComparability.REASON.DIFFERENT_PROCESSING:
        return 'These photos were saved at different sizes or quality settings, so fine detail is not directly comparable.';
      case PhotoComparability.REASON.FROM_LIBRARY:
        return 'One of these came from your photo library rather than the in-app camera, so how it was taken is unknown.';
      case PhotoComparability.REASON.EXPOSURE_DIFFERS:
        return 'One photo is noticeably brighter than the other. Colour and edges look different under different light.';
      case PhotoComparability.REASON.UNEVEN_LIGHTING:
        return 'One photo is lit unevenly across the frame, which can look like a change in shape or shade.';
      case PhotoComparability.REASON.NOT_MEASURED:
        return 'One of these photos could not be checked for lighting and focus.';
      default:
        return 'These photos may not be directly comparable.';
    }
  }

  /**
   * One line describing a level.
   * @param {string} level - one of LEVEL
   * @param {Object<string, string>} [messages] - your own text keyed by level
   */
  static summarise(level, messages) {
    const own = messageFor(messages, level);
    if (own !== null) {
      return own;
    }

    switch (level) {
      case PhotoComparability.LEVEL.GOOD:
        return 'Taken the same way — good for comparison.';
      case PhotoComparability.LEVEL.FAIR:
        return 'Reasonable comparison, with some differences in how these were taken.';
      case PhotoComparability.LEVEL.POOR:
        return 'Taken differently — some of what you see is the photo, not the subject.';
      default:
        return 'How these photos were taken is unknown.';
    }
  }
}
