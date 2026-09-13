/**
 * Capture quality checks for close-up photos that will be compared over time.
 * It measures the photo, never what the photo shows.
 */
import { decodeJpeg } from './jpeg';
import type { AnalysisJpegLoader, PhotoSource } from './loader';
import { measurePixels } from './metrics';
import {
  messageOr,
  resolveMessages,
  resolveThresholds,
  type Messages,
  type QualityThresholds,
} from './options';

export const WARNING_TYPE = Object.freeze({
  NO_IMAGE_DATA: 'no_image_data',
  LOW_RESOLUTION: 'low_resolution',
  SMALL_FILE: 'small_file',
  TOO_DARK: 'too_dark',
  TOO_BRIGHT: 'too_bright',
  UNEVEN_LIGHTING: 'uneven_lighting',
} as const);

export type WarningType = (typeof WARNING_TYPE)[keyof typeof WARNING_TYPE];

/**
 * The measurements kept with a photo. The field names are the ones MoleCare
 * stores, so records written by 0.x and 1.x read the same.
 */
export interface QualitySummary {
  readonly analysisSize: number;
  readonly sharpness: number | null;
  readonly sharpnessReliable: boolean;
  readonly meanLuma: number | null;
  readonly darkFraction: number | null;
  readonly brightFraction: number | null;
  readonly evenness: number | null;
}

export type MeasurementFailure =
  /** No `loadAnalysisJpeg` was given, so only size checks ran. */
  | { readonly reason: 'no_loader' }
  /** The loader threw or rejected. */
  | { readonly reason: 'load_failed'; readonly cause: unknown }
  /** The loaded data was not a JPEG that could be decoded. */
  | { readonly reason: 'decode_failed'; readonly cause?: unknown };

export interface QualityReport {
  /** No warnings. */
  readonly ok: boolean;
  /** Stable codes, for your own text. */
  readonly warningTypes: readonly WarningType[];
  /** Text for each warning: yours from `messages`, or the built-in English. */
  readonly warnings: readonly string[];
  /** The photo is unusable: missing, or both too small and too low-resolution. */
  readonly critical: boolean;
  /** Whether the pixels were measured. Unmeasured is not a bad photo. */
  readonly measured: boolean;
  readonly measurementFailure: MeasurementFailure | null;
  readonly metrics: QualitySummary | null;
}

export interface PhotoAnalyzerOptions {
  /** Without one, only resolution and file size are checked. */
  readonly loadAnalysisJpeg?: AnalysisJpegLoader;
  readonly thresholds?: Partial<QualityThresholds>;
  readonly messages?: Messages;
}

export interface PhotoAnalyzer {
  readonly thresholds: Readonly<QualityThresholds>;
  /** Never rejects for a photo problem; only for an invalid argument. */
  analyze(photo: PhotoSource | null | undefined): Promise<QualityReport>;
}

const ENGLISH: Readonly<Record<WarningType, string>> = Object.freeze({
  no_image_data: 'No image data available.',
  low_resolution:
    'Image resolution is low. Move closer to the subject, or switch to the rear camera for higher quality.',
  small_file:
    'Image file is very small and may lack detail. Try retaking the photo from a shorter distance.',
  too_dark:
    'The photo is too dark. Turn on a room light or move near a window for natural lighting.',
  too_bright:
    'The photo is overexposed. Move away from direct light or disable flash.',
  uneven_lighting:
    'The lighting across this photo is uneven. Move away from a single strong light or window so the subject is lit evenly.',
});

/** The text for a warning type: yours when given, otherwise the built-in English. */
export function qualityWarningText(
  type: WarningType,
  messages?: Messages
): string {
  return messageOr(messages, type, ENGLISH[type]);
}

const fileSizeOf = (photo: PhotoSource): number | null => {
  if (typeof photo.fileSize === 'number' && Number.isFinite(photo.fileSize)) {
    return photo.fileSize;
  }
  return photo.base64 === undefined
    ? null
    : Math.floor((photo.base64.length * 3) / 4);
};

/**
 * A photo analyzer. It keeps no state: the loader, thresholds and messages are
 * fixed at creation.
 *
 * @throws {TypeError} for invalid options
 */
export function createPhotoAnalyzer(
  options: PhotoAnalyzerOptions = {}
): PhotoAnalyzer {
  const thresholds = resolveThresholds(options.thresholds);
  const messages = resolveMessages(options.messages);
  const { loadAnalysisJpeg } = options;
  if (
    loadAnalysisJpeg !== undefined &&
    typeof loadAnalysisJpeg !== 'function'
  ) {
    throw new TypeError('photo-quality loadAnalysisJpeg must be a function');
  }

  const report = (
    warningTypes: WarningType[],
    critical: boolean,
    measurementFailure: MeasurementFailure | null,
    metrics: QualitySummary | null
  ): QualityReport =>
    Object.freeze({
      ok: warningTypes.length === 0,
      warningTypes: Object.freeze(warningTypes),
      warnings: Object.freeze(
        warningTypes.map((type) => qualityWarningText(type, messages))
      ),
      critical,
      measured: metrics !== null,
      measurementFailure,
      metrics,
    });

  const measure = async (
    photo: PhotoSource
  ): Promise<
    | { metrics: ReturnType<typeof measurePixels>; failure: null }
    | { metrics: null; failure: MeasurementFailure }
  > => {
    if (!loadAnalysisJpeg) {
      return { metrics: null, failure: Object.freeze({ reason: 'no_loader' }) };
    }
    let data: string;
    try {
      data = await loadAnalysisJpeg(photo, thresholds.analysisSize);
    } catch (cause) {
      return {
        metrics: null,
        failure: Object.freeze({ reason: 'load_failed', cause }),
      };
    }
    try {
      const metrics = measurePixels(decodeJpeg(data), thresholds);
      return metrics
        ? { metrics, failure: null }
        : {
            metrics: null,
            failure: Object.freeze({ reason: 'decode_failed' }),
          };
    } catch (cause) {
      return {
        metrics: null,
        failure: Object.freeze({ reason: 'decode_failed', cause }),
      };
    }
  };

  const analyze = async (
    photo: PhotoSource | null | undefined
  ): Promise<QualityReport> => {
    if (photo === null || photo === undefined) {
      return report([WARNING_TYPE.NO_IMAGE_DATA], true, null, null);
    }
    // JavaScript callers are not type-checked.
    if (typeof photo !== 'object') {
      throw new TypeError('photo-quality analyze expects a photo object');
    }
    if (!photo.uri && !photo.base64) {
      return report([WARNING_TYPE.NO_IMAGE_DATA], true, null, null);
    }

    const warningTypes: WarningType[] = [];
    const { width = 0, height = 0 } = photo;
    if (
      width > 0 &&
      height > 0 &&
      (width < thresholds.minWidth || height < thresholds.minHeight)
    ) {
      warningTypes.push(WARNING_TYPE.LOW_RESOLUTION);
    }
    const fileSize = fileSizeOf(photo);
    if (fileSize !== null && fileSize < thresholds.minFileSizeBytes) {
      warningTypes.push(WARNING_TYPE.SMALL_FILE);
    }

    const { metrics, failure } = await measure(photo);
    let summary: QualitySummary | null = null;
    if (metrics) {
      const { exposure } = metrics;
      if (exposure.darkFraction > thresholds.clippedDarkLimit) {
        warningTypes.push(WARNING_TYPE.TOO_DARK);
      }
      if (exposure.brightFraction > thresholds.clippedBrightLimit) {
        warningTypes.push(WARNING_TYPE.TOO_BRIGHT);
      }
      if (
        metrics.evenness !== null &&
        metrics.evenness > thresholds.unevenLimit
      ) {
        warningTypes.push(WARNING_TYPE.UNEVEN_LIGHTING);
      }
      const clipped = Math.max(exposure.darkFraction, exposure.brightFraction);
      summary = Object.freeze({
        analysisSize: thresholds.analysisSize,
        sharpness: metrics.sharpness,
        sharpnessReliable: clipped <= thresholds.sharpnessUnreliableClipping,
        meanLuma: exposure.mean,
        darkFraction: exposure.darkFraction,
        brightFraction: exposure.brightFraction,
        evenness: metrics.evenness,
      });
    }

    const critical =
      warningTypes.includes(WARNING_TYPE.LOW_RESOLUTION) &&
      warningTypes.includes(WARNING_TYPE.SMALL_FILE);
    return report(warningTypes, critical, failure, summary);
  };

  return Object.freeze({ thresholds, analyze });
}
