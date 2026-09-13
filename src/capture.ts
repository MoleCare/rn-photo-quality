/**
 * Provenance for a stored photo.
 *
 * Resolution caps, JPEG quality, device and capture source all change the
 * pixels, and none of it can be recovered from the stored image afterwards,
 * so it is recorded at capture time, alongside the photo.
 *
 * The record shape is version 1, unchanged from 0.x, so stored records stay
 * readable. The package reads nothing from the device: the app passes the
 * device details and the time.
 */

export const CAPTURE_METADATA_VERSION = 1;

export const CAPTURE_SOURCE = Object.freeze({
  CAMERA: 'camera',
  LIBRARY: 'library',
} as const);

export type CaptureSource =
  (typeof CAPTURE_SOURCE)[keyof typeof CAPTURE_SOURCE];

/** Fields the capture stack cannot provide, named rather than omitted. */
export const UNAVAILABLE_FIELDS: readonly string[] = Object.freeze([
  'iso',
  'exposureTime',
  'focalLength',
  'colourTemperature',
  'torch',
  'lens',
]);

export interface DeviceDetails {
  readonly platform: string | null;
  readonly osVersion: string | null;
  readonly model: string | null;
  readonly appVersion: string | null;
  readonly appBuild: string | null;
  readonly isEmulator: boolean | null;
}

export const DEVICE_FIELDS: readonly (keyof DeviceDetails)[] = Object.freeze([
  'platform',
  'osVersion',
  'model',
  'appVersion',
  'appBuild',
  'isEmulator',
]);

/** One entry of an image picker's `assets`. Extra fields are ignored. */
export interface PickerAsset {
  readonly width?: unknown;
  readonly height?: unknown;
  readonly fileSize?: unknown;
  readonly type?: unknown;
  readonly timestamp?: unknown;
}

export interface PickerSettings {
  readonly maxWidth?: unknown;
  readonly maxHeight?: unknown;
  readonly quality?: unknown;
}

export interface CaptureContext {
  readonly source?: CaptureSource;
  readonly pickerOptions?: PickerSettings;
  /** Device details from your app; only DEVICE_FIELDS are kept. Omitted: all null. */
  readonly device?: Partial<DeviceDetails> | null;
  /** When the photo was added. Default: now. */
  readonly capturedAt?: Date | string | number;
}

export interface CaptureMetadata {
  readonly v: number;
  readonly capturedAt: string;
  readonly source: CaptureSource | null;
  readonly partial: boolean;
  readonly unavailable: readonly string[];
  readonly image: {
    readonly width: number | null;
    readonly height: number | null;
    readonly fileSize: number | null;
    readonly type: string | null;
    readonly assetTimestamp: string | null;
    readonly megapixels: number | null;
    readonly aspectRatio: number | null;
  };
  readonly processing: {
    readonly maxWidth: number | null;
    readonly maxHeight: number | null;
    readonly quality: number | null;
  };
  readonly device: DeviceDetails;
  readonly deviceIsCaptureDevice: boolean;
}

const numberOrNull = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return typeof value !== 'boolean' &&
    value !== null &&
    value !== '' &&
    Number.isFinite(n)
    ? n
    : null;
};

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const isoTime = (value: unknown): string => {
  if (
    value instanceof Date ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    const time = new Date(value);
    if (!Number.isNaN(time.getTime())) {
      return time.toISOString();
    }
  }
  return new Date().toISOString();
};

const pickDevice = (given: unknown): DeviceDetails => {
  const source =
    given !== null && typeof given === 'object'
      ? (given as Record<string, unknown>)
      : {};
  const text = (key: string): string | null => {
    const value = source[key];
    return typeof value === 'string' ? value : null;
  };
  return Object.freeze({
    platform: text('platform'),
    osVersion: text('osVersion'),
    model: text('model'),
    appVersion: text('appVersion'),
    appBuild: text('appBuild'),
    isEmulator:
      typeof source.isEmulator === 'boolean' ? source.isEmulator : null,
  });
};

/**
 * Build the record to store beside an image. Never throws: a capture must not
 * fail because its provenance is incomplete.
 */
export function buildCaptureMetadata(
  asset: PickerAsset | null | undefined,
  context: CaptureContext | null | undefined = {}
): CaptureMetadata {
  const a = asset ?? {};
  const c = context ?? {};
  const picker = c.pickerOptions ?? {};
  const source =
    c.source === CAPTURE_SOURCE.CAMERA || c.source === CAPTURE_SOURCE.LIBRARY
      ? c.source
      : null;
  const width = numberOrNull(a.width);
  const height = numberOrNull(a.height);

  return Object.freeze({
    v: CAPTURE_METADATA_VERSION,
    capturedAt: isoTime(c.capturedAt),
    source,
    partial: false,
    unavailable: [...UNAVAILABLE_FIELDS],
    image: Object.freeze({
      width,
      height,
      fileSize: numberOrNull(a.fileSize),
      type: stringOrNull(a.type),
      assetTimestamp: stringOrNull(a.timestamp),
      megapixels:
        width && height ? Math.round((width * height) / 10000) / 100 : null,
      aspectRatio:
        width && height ? Math.round((width / height) * 1000) / 1000 : null,
    }),
    processing: Object.freeze({
      maxWidth: numberOrNull(picker.maxWidth),
      maxHeight: numberOrNull(picker.maxHeight),
      quality: numberOrNull(picker.quality),
    }),
    device: pickDevice(c.device),
    deviceIsCaptureDevice: source === CAPTURE_SOURCE.CAMERA,
  });
}

/** Whether a stored value is a capture record (of any version). */
export function isCaptureMetadata(value: unknown): value is CaptureMetadata {
  return (
    value !== null &&
    typeof value === 'object' &&
    Boolean((value as { v?: unknown }).v)
  );
}
