import PhotoPixelSource from './PhotoPixelSource';
import ImageQualityMetrics from './ImageQualityMetrics';
import {getConfig} from './config';

/**
 * Capture quality checks for clinical / lesion photos.
 *
 * Cheap checks on the payload (resolution, file size), then — when the image
 * can be decoded — pixel measurements: exposure clipping, illumination
 * evenness and sharpness.
 *
 * Thresholds come from package config (see configure()). Sharpness is measured
 * and recorded but not gated by default; its scale needs a real capture set.
 */
export default class ImageQualityAnalyzer {
  static get MIN_WIDTH() {
    return getConfig().minWidth;
  }
  static get MIN_HEIGHT() {
    return getConfig().minHeight;
  }
  static get MIN_BASE64_LENGTH() {
    return getConfig().minBase64Length;
  }
  static get CLIPPED_DARK_LIMIT() {
    return getConfig().clippedDarkLimit;
  }
  static get CLIPPED_BRIGHT_LIMIT() {
    return getConfig().clippedBrightLimit;
  }
  static get UNEVEN_LIMIT() {
    return getConfig().unevenLimit;
  }
  static get SHARPNESS_UNRELIABLE_CLIPPING() {
    return getConfig().sharpnessUnreliableClipping;
  }

  /** Warning types. */
  static WARNING_TYPES = {
    LOW_RESOLUTION: 'low_resolution',
    SMALL_FILE: 'small_file',
    TOO_DARK: 'too_dark',
    TOO_BRIGHT: 'too_bright',
    UNEVEN_LIGHTING: 'uneven_lighting',
    BLURRY: 'blurry',
    COLOR_CAST: 'color_cast',
    INCONSISTENT_BRIGHTNESS: 'inconsistent_brightness',
    INCONSISTENT_VARIANCE: 'inconsistent_variance',
  };

  /**
   * Run the available quality checks on a captured image.
   *
   * @param {Object} image - Image object from react-native-image-picker
   *   { data: base64String, width, height, fileSize, uri }
   * @returns {Promise<{ok: boolean, warnings: string[], critical: boolean, measured: boolean, metrics: Object|null}>}
   */
  static async analyze(image) {
    const warningTypes = [];

    if (!image || !image.data) {
      return {
        ok: false,
        warnings: ['No image data available.'],
        critical: true,
      };
    }

    const width = image.width || 0;
    const height = image.height || 0;
    if (width > 0 && height > 0) {
      if (
        width < ImageQualityAnalyzer.MIN_WIDTH ||
        height < ImageQualityAnalyzer.MIN_HEIGHT
      ) {
        warningTypes.push(ImageQualityAnalyzer.WARNING_TYPES.LOW_RESOLUTION);
      }
    }

    if (image.data.length < ImageQualityAnalyzer.MIN_BASE64_LENGTH) {
      warningTypes.push(ImageQualityAnalyzer.WARNING_TYPES.SMALL_FILE);
    }

    let metrics = null;
    const decoded = await PhotoPixelSource.decode(image.data);
    if (decoded) {
      metrics = ImageQualityMetrics.all(decoded);
    }

    if (metrics && metrics.exposure) {
      const {darkFraction, brightFraction} = metrics.exposure;

      if (darkFraction > ImageQualityAnalyzer.CLIPPED_DARK_LIMIT) {
        warningTypes.push(ImageQualityAnalyzer.WARNING_TYPES.TOO_DARK);
      }
      if (brightFraction > ImageQualityAnalyzer.CLIPPED_BRIGHT_LIMIT) {
        warningTypes.push(ImageQualityAnalyzer.WARNING_TYPES.TOO_BRIGHT);
      }

      if (
        metrics.evenness !== null &&
        metrics.evenness > ImageQualityAnalyzer.UNEVEN_LIMIT
      ) {
        warningTypes.push(ImageQualityAnalyzer.WARNING_TYPES.UNEVEN_LIGHTING);
      }
    }

    const warnings = warningTypes.map(type =>
      ImageQualityAnalyzer.getActionableFeedback(type),
    );

    const critical =
      warningTypes.includes(
        ImageQualityAnalyzer.WARNING_TYPES.LOW_RESOLUTION,
      ) &&
      warningTypes.includes(ImageQualityAnalyzer.WARNING_TYPES.SMALL_FILE);

    return {
      ok: warnings.length === 0,
      warnings,
      critical,
      measured: !!metrics,
      metrics: metrics ? ImageQualityAnalyzer._summarise(metrics) : null,
    };
  }

  static _summarise(metrics) {
    const clipped = metrics.exposure
      ? Math.max(metrics.exposure.darkFraction, metrics.exposure.brightFraction)
      : null;

    return {
      analysisSize: ImageQualityMetrics.ANALYSIS_SIZE,
      sharpness: metrics.sharpness,
      sharpnessReliable:
        clipped !== null &&
        clipped <= ImageQualityAnalyzer.SHARPNESS_UNRELIABLE_CLIPPING,
      meanLuma: metrics.exposure ? metrics.exposure.mean : null,
      darkFraction: metrics.exposure ? metrics.exposure.darkFraction : null,
      brightFraction: metrics.exposure ? metrics.exposure.brightFraction : null,
      evenness: metrics.evenness,
    };
  }

  /**
   * Map warning types to actionable user feedback.
   * Override via configure({ messages: { [type]: '...' } }).
   *
   * @param {string} warningType - One of WARNING_TYPES values
   * @returns {string}
   */
  static getActionableFeedback(warningType) {
    const overrides = getConfig().messages;
    if (overrides && typeof overrides[warningType] === 'string') {
      return overrides[warningType];
    }

    switch (warningType) {
      case ImageQualityAnalyzer.WARNING_TYPES.LOW_RESOLUTION:
        return 'Image resolution is low. Move closer to the subject, or switch to the rear camera for higher quality.';
      case ImageQualityAnalyzer.WARNING_TYPES.SMALL_FILE:
        return 'Image file is very small and may lack detail. Try retaking the photo from a shorter distance.';
      case ImageQualityAnalyzer.WARNING_TYPES.TOO_DARK:
        return 'The photo is too dark. Turn on a room light or move near a window for natural lighting.';
      case ImageQualityAnalyzer.WARNING_TYPES.TOO_BRIGHT:
        return 'The photo is overexposed. Move away from direct light or disable flash.';
      case ImageQualityAnalyzer.WARNING_TYPES.UNEVEN_LIGHTING:
        return 'The lighting across this photo is uneven. Move away from a single strong light or window so the subject is lit evenly.';
      case ImageQualityAnalyzer.WARNING_TYPES.BLURRY:
        return 'The photo appears blurry. Hold your phone steady for 2 seconds, or tap to focus before capturing.';
      case ImageQualityAnalyzer.WARNING_TYPES.COLOR_CAST:
        return 'The photo has an unnatural colour tint. Natural daylight gives the most accurate colours — avoid fluorescent or coloured lighting.';
      case ImageQualityAnalyzer.WARNING_TYPES.INCONSISTENT_BRIGHTNESS:
        return 'Lighting conditions differ from your previous photo. Try to use similar lighting for accurate comparison.';
      case ImageQualityAnalyzer.WARNING_TYPES.INCONSISTENT_VARIANCE:
        return 'This photo looks different from your previous one. Try to match the same angle and distance for consistent tracking.';
      default:
        return 'Photo quality issue detected. Consider retaking the photo for better accuracy.';
    }
  }
}
