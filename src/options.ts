/** Thresholds for the quality checks and the comparison of two photos. */
export interface QualityThresholds {
  /** Warn below this width in pixels. */
  minWidth: number;
  /** Warn below this height in pixels. */
  minHeight: number;
  /** Warn when the file is smaller than this many bytes. */
  minFileSizeBytes: number;
  /** Warn "too dark" above this fraction of crushed pixels. */
  clippedDarkLimit: number;
  /** Warn "too bright" above this fraction of blown pixels. */
  clippedBrightLimit: number;
  /** Warn "uneven lighting" above this evenness score. */
  unevenLimit: number;
  /** Sharpness is unreliable when more than this fraction is clipped. */
  sharpnessUnreliableClipping: number;
  /**
   * Photos are resampled to this many pixels square before measuring.
   * Changing it changes every score, so scores recorded at another size
   * are not comparable.
   */
  analysisSize: number;
  /** A luma at or below this counts as crushed (0–255). */
  darkLevel: number;
  /** A luma at or above this counts as blown (0–255). */
  brightLevel: number;
  /** Two photos differ in exposure above this relative difference in mean luma. */
  exposureDiffLimit: number;
}

export const DEFAULT_THRESHOLDS: Readonly<QualityThresholds> = Object.freeze({
  minWidth: 300,
  minHeight: 300,
  // 7,500 bytes is the 10,000 base64 characters 0.x measured.
  minFileSizeBytes: 7500,
  clippedDarkLimit: 0.15,
  clippedBrightLimit: 0.15,
  unevenLimit: 0.25,
  sharpnessUnreliableClipping: 0.1,
  analysisSize: 512,
  darkLevel: 4,
  brightLevel: 251,
  exposureDiffLimit: 0.25,
});

/** Your own text (for example a translation), keyed by warning type, reason or level. */
export type Messages = Readonly<Partial<Record<string, string>>>;

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

/**
 * Thresholds over the defaults, validated and frozen.
 *
 * @throws {TypeError} for an unknown threshold, or one that is not a
 *   non-negative number (`analysisSize`: a whole number of at least 3)
 */
export function resolveThresholds(
  overrides: Partial<QualityThresholds> | undefined
): Readonly<QualityThresholds> {
  if (overrides === undefined) {
    return DEFAULT_THRESHOLDS;
  }
  if (
    // JavaScript callers are not type-checked.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    overrides === null ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides)
  ) {
    throw new TypeError('photo-quality thresholds must be an object');
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!hasOwn(DEFAULT_THRESHOLDS, key)) {
      throw new TypeError(`Unknown photo-quality threshold "${key}"`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(
        `photo-quality threshold "${key}" must be a non-negative number`
      );
    }
    if (key === 'analysisSize' && !(Number.isInteger(value) && value >= 3)) {
      throw new TypeError(
        'photo-quality threshold "analysisSize" must be a whole number of at least 3'
      );
    }
  }
  return Object.freeze({ ...DEFAULT_THRESHOLDS, ...overrides });
}

/**
 * @throws {TypeError} when messages are not an object of strings
 */
export function resolveMessages(messages: Messages | undefined): Messages {
  if (messages === undefined) {
    return Object.freeze({});
  }
  if (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    messages === null ||
    typeof messages !== 'object' ||
    Array.isArray(messages) ||
    Object.values(messages).some((m) => typeof m !== 'string')
  ) {
    throw new TypeError('photo-quality messages must be an object of strings');
  }
  return Object.freeze({ ...messages });
}

/** The caller's text for `key` when given, otherwise `fallback`. */
export function messageOr(
  messages: Messages | undefined,
  key: string,
  fallback: string
): string {
  const text =
    messages !== undefined && hasOwn(messages, key) ? messages[key] : undefined;
  return typeof text === 'string' ? text : fallback;
}
