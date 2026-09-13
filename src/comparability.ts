/**
 * How much two photos of the same subject can be compared.
 *
 * Does not correct anything, and never says whether the subject changed. It
 * says how much weight a comparison can carry, given how the photos were
 * taken and measured.
 */
import { CAPTURE_SOURCE, isCaptureMetadata } from './capture';
import {
  messageOr,
  resolveThresholds,
  type Messages,
  type QualityThresholds,
} from './options';

export const COMPARABILITY_LEVEL = Object.freeze({
  GOOD: 'good',
  FAIR: 'fair',
  POOR: 'poor',
  UNKNOWN: 'unknown',
} as const);

export type ComparabilityLevel =
  (typeof COMPARABILITY_LEVEL)[keyof typeof COMPARABILITY_LEVEL];

export const COMPARABILITY_REASON = Object.freeze({
  NO_PROVENANCE: 'no_provenance',
  DIFFERENT_DEVICE: 'different_device',
  DIFFERENT_PROCESSING: 'different_processing',
  FROM_LIBRARY: 'from_library',
  EXPOSURE_DIFFERS: 'exposure_differs',
  UNEVEN_LIGHTING: 'uneven_lighting',
  NOT_MEASURED: 'not_measured',
} as const);

export type ComparabilityReason =
  (typeof COMPARABILITY_REASON)[keyof typeof COMPARABILITY_REASON];

export interface Comparability {
  readonly level: ComparabilityLevel;
  readonly reasons: readonly ComparabilityReason[];
  /** No reason at all to doubt the comparison. */
  readonly comparable: boolean;
}

/** A stored capture record, read defensively: old records may lack fields. */
interface StoredCapture {
  source?: unknown;
  device?: { model?: unknown; platform?: unknown } | null;
  processing?: {
    maxWidth?: unknown;
    maxHeight?: unknown;
    quality?: unknown;
  } | null;
  quality?: {
    measured?: unknown;
    meanLuma?: unknown;
    evenness?: unknown;
  } | null;
}

const STRUCTURAL: readonly ComparabilityReason[] = Object.freeze([
  COMPARABILITY_REASON.DIFFERENT_DEVICE,
  COMPARABILITY_REASON.DIFFERENT_PROCESSING,
  COMPARABILITY_REASON.FROM_LIBRARY,
]);

const sameDevice = (a: StoredCapture, b: StoredCapture): boolean =>
  Boolean(a.device && b.device) &&
  a.device?.model === b.device?.model &&
  a.device?.platform === b.device?.platform;

const sameProcessing = (a: StoredCapture, b: StoredCapture): boolean =>
  Boolean(a.processing && b.processing) &&
  a.processing?.maxWidth === b.processing?.maxWidth &&
  a.processing?.maxHeight === b.processing?.maxHeight &&
  a.processing?.quality === b.processing?.quality;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function qualityReasons(
  a: StoredCapture,
  b: StoredCapture,
  thresholds: Readonly<QualityThresholds>
): ComparabilityReason[] {
  if (a.quality?.measured !== true || b.quality?.measured !== true) {
    return [COMPARABILITY_REASON.NOT_MEASURED];
  }
  const reasons: ComparabilityReason[] = [];
  const lumaA = a.quality.meanLuma;
  const lumaB = b.quality.meanLuma;
  if (isNumber(lumaA) && isNumber(lumaB) && Math.max(lumaA, lumaB) > 0) {
    const diff = Math.abs(lumaA - lumaB) / Math.max(lumaA, lumaB);
    if (diff > thresholds.exposureDiffLimit) {
      reasons.push(COMPARABILITY_REASON.EXPOSURE_DIFFERS);
    }
  }
  if (
    [a.quality.evenness, b.quality.evenness].some(
      (value) => isNumber(value) && value > thresholds.unevenLimit
    )
  ) {
    reasons.push(COMPARABILITY_REASON.UNEVEN_LIGHTING);
  }
  return reasons;
}

/**
 * Compare two stored capture records (the `capture` kept with each photo,
 * including `capture.quality` from the analyzer).
 *
 * @throws {TypeError} for invalid thresholds
 */
export function assessComparability(
  a: unknown,
  b: unknown,
  thresholds?: Partial<
    Pick<QualityThresholds, 'exposureDiffLimit' | 'unevenLimit'>
  >
): Comparability {
  const limits = resolveThresholds(thresholds);
  if (!isCaptureMetadata(a) || !isCaptureMetadata(b)) {
    return Object.freeze({
      level: COMPARABILITY_LEVEL.UNKNOWN,
      reasons: Object.freeze([COMPARABILITY_REASON.NO_PROVENANCE]),
      comparable: false,
    });
  }
  const capA = a as StoredCapture;
  const capB = b as StoredCapture;
  const reasons: ComparabilityReason[] = [];
  if (
    capA.source === CAPTURE_SOURCE.LIBRARY ||
    capB.source === CAPTURE_SOURCE.LIBRARY
  ) {
    reasons.push(COMPARABILITY_REASON.FROM_LIBRARY);
  }
  if (!sameDevice(capA, capB)) {
    reasons.push(COMPARABILITY_REASON.DIFFERENT_DEVICE);
  }
  if (!sameProcessing(capA, capB)) {
    reasons.push(COMPARABILITY_REASON.DIFFERENT_PROCESSING);
  }
  reasons.push(...qualityReasons(capA, capB, limits));

  let level: ComparabilityLevel = COMPARABILITY_LEVEL.GOOD;
  if (reasons.some((reason) => STRUCTURAL.includes(reason))) {
    level = COMPARABILITY_LEVEL.POOR;
  } else if (reasons.length > 0) {
    level = COMPARABILITY_LEVEL.FAIR;
  }
  return Object.freeze({
    level,
    reasons: Object.freeze(reasons),
    comparable: reasons.length === 0,
  });
}

const REASON_TEXT: Readonly<Record<ComparabilityReason, string>> =
  Object.freeze({
    no_provenance:
      'One of these photos was taken before capture provenance was recorded, so they cannot be checked for a like-for-like match.',
    different_device:
      'These photos were taken on different devices. Cameras differ in colour and detail, so some of the difference you see is the camera.',
    different_processing:
      'These photos were saved at different sizes or quality settings, so fine detail is not directly comparable.',
    from_library:
      'One of these came from your photo library rather than the in-app camera, so how it was taken is unknown.',
    exposure_differs:
      'One photo is noticeably brighter than the other. Colour and edges look different under different light.',
    uneven_lighting:
      'One photo is lit unevenly across the frame, which can look like a change in shape or shade.',
    not_measured:
      'One of these photos could not be checked for lighting and focus.',
  });

const LEVEL_TEXT: Readonly<Record<ComparabilityLevel, string>> = Object.freeze({
  good: 'Taken the same way — good for comparison.',
  fair: 'Reasonable comparison, with some differences in how these were taken.',
  poor: 'Taken differently — some of what you see is the photo, not the subject.',
  unknown: 'How these photos were taken is unknown.',
});

/** A plain explanation of one reason: yours when given, otherwise English. */
export function explainComparabilityReason(
  reason: ComparabilityReason,
  messages?: Messages
): string {
  // A reason from a newer version, or from JavaScript, falls back to general text.
  const known = Object.prototype.hasOwnProperty.call(REASON_TEXT, reason);
  return messageOr(
    messages,
    reason,
    known ? REASON_TEXT[reason] : 'These photos may not be directly comparable.'
  );
}

/** One line for a level: yours when given, otherwise English. */
export function summariseComparability(
  level: ComparabilityLevel,
  messages?: Messages
): string {
  const known = Object.prototype.hasOwnProperty.call(LEVEL_TEXT, level);
  return messageOr(
    messages,
    level,
    known ? LEVEL_TEXT[level] : LEVEL_TEXT.unknown
  );
}
