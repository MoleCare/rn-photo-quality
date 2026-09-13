import {
  CAPTURE_METADATA_VERSION,
  CAPTURE_SOURCE,
  DEVICE_FIELDS,
  UNAVAILABLE_FIELDS,
  buildCaptureMetadata,
  isCaptureMetadata,
  type CaptureContext,
} from '../src';

const asset = {
  width: 1536,
  height: 2048,
  fileSize: 812345,
  type: 'image/jpeg',
  timestamp: '2026-08-30T09:00:00.000Z',
};

const pickerOptions = { maxWidth: 2048, maxHeight: 2048, quality: 0.85 };

const device = {
  platform: 'ios',
  osVersion: '17.2',
  model: 'iPhone 15 Pro',
  appVersion: '2.4.8',
  appBuild: '2004008',
  isEmulator: false,
};

const camera: CaptureContext = {
  source: CAPTURE_SOURCE.CAMERA,
  pickerOptions,
  device,
};

describe('buildCaptureMetadata', () => {
  it('keeps the version 1 record shape that is already stored', () => {
    // Photos saved by 0.x carry these fields; 1.x must write the same ones.
    const record = buildCaptureMetadata(asset, camera);

    expect(Object.keys(record).sort()).toEqual([
      'capturedAt',
      'device',
      'deviceIsCaptureDevice',
      'image',
      'partial',
      'processing',
      'source',
      'unavailable',
      'v',
    ]);
    expect(Object.keys(record.image).sort()).toEqual([
      'aspectRatio',
      'assetTimestamp',
      'fileSize',
      'height',
      'megapixels',
      'type',
      'width',
    ]);
    expect(record.v).toBe(1);
    expect(CAPTURE_METADATA_VERSION).toBe(1);
    expect(record.partial).toBe(false);
  });

  it('records the delivered image', () => {
    const { image } = buildCaptureMetadata(asset, camera);

    expect(image).toMatchObject({
      width: 1536,
      height: 2048,
      fileSize: 812345,
      type: 'image/jpeg',
    });
    expect(image.megapixels).toBeCloseTo(3.15, 2);
    expect(image.aspectRatio).toBeCloseTo(0.75, 3);
  });

  it('records the caps the image was produced under', () => {
    expect(buildCaptureMetadata(asset, camera).processing).toEqual(
      pickerOptions
    );
  });

  it('records the device details the app passes, and only the known fields', () => {
    const record = buildCaptureMetadata(asset, {
      ...camera,
      device: { ...device, serial: 'dropped', osVersion: 17 } as never,
    });

    expect(record.device).toEqual({ ...device, osVersion: null });
    expect(Object.keys(record.device)).toEqual([...DEVICE_FIELDS]);
  });

  it('records no device details when none are passed, and reads nothing itself', () => {
    for (const given of [undefined, null]) {
      const record = buildCaptureMetadata(asset, { ...camera, device: given });
      expect(Object.values(record.device).every((v) => v === null)).toBe(true);
    }
  });

  it('names the fields it cannot capture rather than omitting them', () => {
    expect(buildCaptureMetadata(asset, camera).unavailable).toEqual(
      expect.arrayContaining(['iso', 'exposureTime', 'focalLength'])
    );
  });

  it('distinguishes a camera capture from a library pick', () => {
    expect(buildCaptureMetadata(asset, camera).deviceIsCaptureDevice).toBe(
      true
    );
    expect(
      buildCaptureMetadata(asset, { source: CAPTURE_SOURCE.LIBRARY })
        .deviceIsCaptureDevice
    ).toBe(false);
  });

  it('uses the time the app passes, and otherwise now', () => {
    expect(
      buildCaptureMetadata(asset, { capturedAt: '2026-09-01T08:30:00.000Z' })
        .capturedAt
    ).toBe('2026-09-01T08:30:00.000Z');
    expect(
      buildCaptureMetadata(asset, { capturedAt: new Date(0) }).capturedAt
    ).toBe('1970-01-01T00:00:00.000Z');
    for (const capturedAt of ['not a date', undefined, {} as never]) {
      const record = buildCaptureMetadata(asset, { capturedAt });
      expect(Date.parse(record.capturedAt)).not.toBeNaN();
    }
  });

  it('separates when the photo was taken from when it was added', () => {
    const record = buildCaptureMetadata(asset, {
      source: CAPTURE_SOURCE.LIBRARY,
    });
    expect(record.image.assetTimestamp).toBe('2026-08-30T09:00:00.000Z');
    expect(record.capturedAt).not.toBe(record.image.assetTimestamp);
  });
});

describe('never fails the capture', () => {
  it('produces a usable record from nothing', () => {
    for (const [a, c] of [
      [null, null],
      [undefined, undefined],
      [{}, {}],
    ] as const) {
      const record = buildCaptureMetadata(a, c);
      expect(record.v).toBe(1);
      expect(record.source).toBeNull();
      expect(record.image).toMatchObject({
        width: null,
        megapixels: null,
        aspectRatio: null,
      });
      expect(record.processing).toEqual({
        maxWidth: null,
        maxHeight: null,
        quality: null,
      });
    }
  });

  it('stores null rather than NaN or a guess for values that are not numbers', () => {
    const record = buildCaptureMetadata(
      {
        width: 'wide',
        height: null,
        fileSize: Number.NaN,
        type: '',
        timestamp: 42,
      },
      {
        pickerOptions: { maxWidth: true, maxHeight: '', quality: '0.85' },
        source: 'drone' as never,
      }
    );

    expect(record.image).toMatchObject({
      width: null,
      height: null,
      fileSize: null,
      type: null,
      assetTimestamp: null,
    });
    expect(record.processing).toEqual({
      maxWidth: null,
      maxHeight: null,
      quality: 0.85,
    });
    expect(record.source).toBeNull();
  });
});

describe('isCaptureMetadata', () => {
  it('is false for photos stored before provenance existed', () => {
    for (const value of [undefined, null, {}, 'v1', { v: 0 }]) {
      expect(isCaptureMetadata(value)).toBe(false);
    }
  });

  it('is true for a built record, and for a stored one of any version', () => {
    expect(isCaptureMetadata(buildCaptureMetadata(asset, camera))).toBe(true);
    expect(isCaptureMetadata({ v: 2 })).toBe(true);
  });
});

describe('frozen', () => {
  it('freezes records and constants', () => {
    const record = buildCaptureMetadata(asset, camera);
    for (const frozen of [
      record,
      record.image,
      record.processing,
      record.device,
      CAPTURE_SOURCE,
      UNAVAILABLE_FIELDS,
      DEVICE_FIELDS,
    ]) {
      expect(Object.isFrozen(frozen)).toBe(true);
    }
  });
});
