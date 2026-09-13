import PhotoPixelSource from './PhotoPixelSource';
import ImageQualityMetrics from './ImageQualityMetrics';
import {DEFAULT_OPTIONS, messageFor, resolveOptions} from './defaults';

/**
 * Capture quality checks for close-up photos that will be compared over time.
 * It measures the photo, never what the photo shows.
 *
 * Cheap checks on the payload (resolution, file size), then — when the image
 * can be decoded — pixel measurements: exposure clipping, illumination
 * evenness and sharpness.
 *
 * Stateless: thresholds and messages are passed with each call (defaults in
 * DEFAULT_OPTIONS). Sharpness is measured and recorded but not gated; its scale
 * needs a real capture set.
 */
export default class ImageQualityAnalyzer {
  static MIN_WIDTH = DEFAULT_OPTIONS.minWidth;
  static MIN_HEIGHT = DEFAULT_OPTIONS.minHeight;
  static MIN_BASE64_LENGTH = DEFAULT_OPTIONS.minBase64Length;
  static CLIPPED_DARK_LIMIT = DEFAULT_OPTIONS.clippedDarkLimit;
  static CLIPPED_BRIGHT_LIMIT = DEFAULT_OPTIONS.clippedBrightLimit;
  static UNEVEN_LIMIT = DEFAULT_OPTIONS.unevenLimit;
  static SHARPNESS_UNRELIABLE_CLIPPING = DEFAULT_OPTIONS.sharpnessUnreliableClipping;

  /** Warning types. */
  static WARNING_TYPES = Object.freeze({
    NO_IMAGE_DATA: 'no_image_data',
    LOW_RESOLUTION: 'low_resolution',
    SMALL_FILE: 'small_file',
    TOO_DARK: 'too_dark',
    TOO_BRIGHT: 'too_bright',
    UNEVEN_LIGHTING: 'uneven_lighting',
    BLURRY: 'blurry',
    COLOR_CAST: 'color_cast',
    INCONSISTENT_BRIGHTNESS: 'inconsistent_brightness',
    INCONSISTENT_VARIANCE: 'inconsistent_variance',
  });

  /**
   * Run the available quality checks on a captured image.
   *
   * @param {Object} image - Image object from react-native-image-picker
   *   { data: base64String, width, height, fileSize, uri }
   * @param {Object} [options] - thresholds (see DEFAULT_OPTIONS) and `messages`,
   *   your own text keyed by warning type
   * @returns {Promise<{ok: boolean, warningTypes: string[], warnings: string[], critical: boolean, measured: boolean, metrics: Object|null}>}
   *   `warningTypes` are stable codes to map to your own text; `warnings` is
   *   that text, from `messages` or the built-in English.
   * @throws {TypeError} (as a rejection) for an unknown or invalid option
   */
  static async analyze(image, options) {
    // Only an options object counts. Anything else in the second place (the
    // old API took a reference photo there) is ignored, never used.
    const opts = resolveOptions(
      options !== null && typeof options === 'object' ? options : undefined,
    );
    const types = ImageQualityAnalyzer.WARNING_TYPES;
    const warningTypes = [];

    if (!image || !image.data) {
      return {
        ok: false,
        warningTypes: [types.NO_IMAGE_DATA],
        warnings: [ImageQualityAnalyzer.getActionableFeedback(types.NO_IMAGE_DATA, opts.messages)],
        critical: true,
        measured: false,
        metrics: null,
      };
    }

    const width = image.width || 0;
    const height = image.height || 0;
    if (width > 0 && height > 0) {
      if (width < opts.minWidth || height < opts.minHeight) {
        warningTypes.push(types.LOW_RESOLUTION);
      }
    }

    if (image.data.length < opts.minBase64Length) {
      warningTypes.push(types.SMALL_FILE);
    }

    let metrics = null;
    const decoded = await PhotoPixelSource.decode(image.data, {
      analysisSize: opts.analysisSize,
    });
    if (decoded) {
      metrics = ImageQualityMetrics.all(decoded, opts);
    }

    if (metrics && metrics.exposure) {
      const {darkFraction, brightFraction} = metrics.exposure;

      if (darkFraction > opts.clippedDarkLimit) {
        warningTypes.push(types.TOO_DARK);
      }
      if (brightFraction > opts.clippedBrightLimit) {
        warningTypes.push(types.TOO_BRIGHT);
      }

      if (metrics.evenness !== null && metrics.evenness > opts.unevenLimit) {
        warningTypes.push(types.UNEVEN_LIGHTING);
      }
    }

    const warnings = warningTypes.map(type =>
      ImageQualityAnalyzer.getActionableFeedback(type, opts.messages),
    );

    const critical =
      warningTypes.includes(types.LOW_RESOLUTION) &&
      warningTypes.includes(types.SMALL_FILE);

    return {
      ok: warnings.length === 0,
      warningTypes,
      warnings,
      critical,
      measured: !!metrics,
      metrics: metrics ? ImageQualityAnalyzer._summarise(metrics, opts) : null,
    };
  }

  static _summarise(metrics, opts = DEFAULT_OPTIONS) {
    const clipped = metrics.exposure
      ? Math.max(metrics.exposure.darkFraction, metrics.exposure.brightFraction)
      : null;

    return {
      analysisSize: opts.analysisSize,
      sharpness: metrics.sharpness,
      sharpnessReliable:
        clipped !== null && clipped <= opts.sharpnessUnreliableClipping,
      meanLuma: metrics.exposure ? metrics.exposure.mean : null,
      darkFraction: metrics.exposure ? metrics.exposure.darkFraction : null,
      brightFraction: metrics.exposure ? metrics.exposure.brightFraction : null,
      evenness: metrics.evenness,
    };
  }

  /**
   * Map warning types to actionable user feedback.
   *
   * @param {string} warningType - One of WARNING_TYPES values
   * @param {Object<string, string>} [messages] - your own text keyed by warning
   *   type; `default` covers any other type
   * @returns {string}
   */
  static getActionableFeedback(warningType, messages) {
    const own = messageFor(messages, warningType);
    if (own !== null) {
      return own;
    }

    const types = ImageQualityAnalyzer.WARNING_TYPES;
    switch (warningType) {
      case types.NO_IMAGE_DATA:
        return 'No image data available.';
      case types.LOW_RESOLUTION:
        return 'Image resolution is low. Move closer to the subject, or switch to the rear camera for higher quality.';
      case types.SMALL_FILE:
        return 'Image file is very small and may lack detail. Try retaking the photo from a shorter distance.';
      case types.TOO_DARK:
        return 'The photo is too dark. Turn on a room light or move near a window for natural lighting.';
      case types.TOO_BRIGHT:
        return 'The photo is overexposed. Move away from direct light or disable flash.';
      case types.UNEVEN_LIGHTING:
        return 'The lighting across this photo is uneven. Move away from a single strong light or window so the subject is lit evenly.';
      case types.BLURRY:
        return 'The photo appears blurry. Hold your phone steady for 2 seconds, or tap to focus before capturing.';
      case types.COLOR_CAST:
        return 'The photo has an unnatural colour tint. Natural daylight gives the most accurate colours — avoid fluorescent or coloured lighting.';
      case types.INCONSISTENT_BRIGHTNESS:
        return 'Lighting conditions differ from your previous photo. Try to use similar lighting for accurate comparison.';
      case types.INCONSISTENT_VARIANCE:
        return 'This photo looks different from your previous one. Try to match the same angle and distance for consistent tracking.';
      default:
        return messageFor(messages, 'default') ||
          'Photo quality issue detected. Consider retaking the photo for better accuracy.';
    }
  }
}
