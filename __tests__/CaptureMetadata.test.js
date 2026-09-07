/* eslint-env jest, node */

jest.mock('react-native', () => ({
  Platform: {OS: 'ios', Version: '17.2'},
}));

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getModel: jest.fn(() => 'iPhone 15 Pro'),
    getVersion: jest.fn(() => '2.4.8'),
    getBuildNumber: jest.fn(() => '2004008'),
    isEmulatorSync: jest.fn(() => false),
  },
}));

import CaptureMetadata from '../src/CaptureMetadata';
import DeviceInfo from 'react-native-device-info';

const asset = {
  width: 1536,
  height: 2048,
  fileSize: 812345,
  type: 'image/jpeg',
  timestamp: '2026-08-30T09:00:00.000Z',
};

const pickerOptions = {maxWidth: 2048, maxHeight: 2048, quality: 0.85};

const cameraContext = {
  source: CaptureMetadata.SOURCE.CAMERA,
  pickerOptions,
};

beforeEach(() => jest.clearAllMocks());

describe('build', () => {
  it('records the delivered image', () => {
    const m = CaptureMetadata.build(asset, cameraContext);

    expect(m.image.width).toBe(1536);
    expect(m.image.height).toBe(2048);
    expect(m.image.fileSize).toBe(812345);
    expect(m.image.type).toBe('image/jpeg');
    expect(m.image.megapixels).toBeCloseTo(3.15, 2);
    expect(m.image.aspectRatio).toBeCloseTo(0.75, 3);
  });

  it('records the caps the image was produced under', () => {
    // The reason this matters: change MAX_WIDTH later and the archive silently
    // splits into two populations that are not comparable. Without this stored
    // per photo, there is no way to tell which is which.
    const m = CaptureMetadata.build(asset, cameraContext);

    expect(m.processing).toEqual({
      maxWidth: 2048,
      maxHeight: 2048,
      quality: 0.85,
    });
  });

  it('records the device and build that produced it', () => {
    const m = CaptureMetadata.build(asset, cameraContext);

    expect(m.device).toEqual({
      platform: 'ios',
      osVersion: '17.2',
      model: 'iPhone 15 Pro',
      appVersion: '2.4.8',
      appBuild: '2004008',
      isEmulator: false,
    });
  });

  it('names the fields it cannot capture rather than omitting them', () => {
    // A later migration must be able to tell "this predates the capability"
    // from "we tried and it failed". Silence makes those look identical.
    const m = CaptureMetadata.build(asset, cameraContext);

    expect(m.unavailable).toEqual(
      expect.arrayContaining(['iso', 'exposureTime', 'focalLength']),
    );
    expect(m.partial).toBe(false);
  });

  it('distinguishes a camera capture from a library pick', () => {
    const camera = CaptureMetadata.build(asset, cameraContext);
    const library = CaptureMetadata.build(asset, {
      source: CaptureMetadata.SOURCE.LIBRARY,
      pickerOptions,
    });

    expect(camera.deviceIsCaptureDevice).toBe(true);
    // A library photo may come from any device at any time, so the recorded
    // device is the app's, not the camera's.
    expect(library.deviceIsCaptureDevice).toBe(false);
  });

  it('separates when the photo was taken from when it was added', () => {
    const m = CaptureMetadata.build(asset, {
      source: CaptureMetadata.SOURCE.LIBRARY,
      pickerOptions,
    });

    expect(m.image.assetTimestamp).toBe('2026-08-30T09:00:00.000Z');
    expect(m.capturedAt).not.toBe(m.image.assetTimestamp);
    expect(Date.parse(m.capturedAt)).not.toBeNaN();
  });

  it('carries a version so old records stay readable', () => {
    expect(CaptureMetadata.build(asset, cameraContext).v).toBe(
      CaptureMetadata.VERSION,
    );
  });
});

describe('build never fails the capture', () => {
  it('survives a device-info getter that throws', () => {
    // Native bridges can be unavailable. One missing getter must not cost the
    // whole record -- a photo saved without provenance can never get it back.
    DeviceInfo.getModel.mockImplementation(() => {
      throw new Error('bridge unavailable');
    });

    const m = CaptureMetadata.build(asset, cameraContext);

    expect(m.device.model).toBeNull();
    expect(m.device.appVersion).toBe('2.4.8');
    expect(m.image.width).toBe(1536);
  });

  it('produces a usable record from an asset with nothing in it', () => {
    const m = CaptureMetadata.build({}, cameraContext);

    expect(m.v).toBe(CaptureMetadata.VERSION);
    expect(m.image.width).toBeNull();
    expect(m.image.megapixels).toBeNull();
  });

  it('does not throw on a null asset', () => {
    expect(() => CaptureMetadata.build(null, cameraContext)).not.toThrow();
    expect(() => CaptureMetadata.build(null)).not.toThrow();
  });

  it('stores null rather than NaN for unparseable numbers', () => {
    const m = CaptureMetadata.build(
      {width: 'wide', height: undefined, fileSize: NaN},
      cameraContext,
    );

    expect(m.image.width).toBeNull();
    expect(m.image.height).toBeNull();
    expect(m.image.fileSize).toBeNull();
  });
});

describe('isPresent', () => {
  it('is false for photos stored before provenance existed', () => {
    // These can never be backfilled -- there is nothing to read it from.
    expect(CaptureMetadata.isPresent(undefined)).toBe(false);
    expect(CaptureMetadata.isPresent(null)).toBe(false);
    expect(CaptureMetadata.isPresent({})).toBe(false);
  });

  it('is true for a built record', () => {
    expect(
      CaptureMetadata.isPresent(CaptureMetadata.build(asset, cameraContext)),
    ).toBe(true);
  });
});

describe('isComparable', () => {
  const build = overrides =>
    CaptureMetadata.build(
      {...asset, ...overrides.asset},
      {
        source: overrides.source || CaptureMetadata.SOURCE.CAMERA,
        pickerOptions: overrides.pickerOptions || pickerOptions,
      },
    );

  it('accepts two camera captures from the same device and pipeline', () => {
    expect(CaptureMetadata.isComparable(build({}), build({}))).toBe(true);
  });

  it('rejects photos taken under different resolution caps', () => {
    const a = build({});
    const b = build({pickerOptions: {...pickerOptions, maxWidth: 1024}});

    expect(CaptureMetadata.isComparable(a, b)).toBe(false);
  });

  it('rejects photos taken at different JPEG quality', () => {
    const a = build({});
    const b = build({pickerOptions: {...pickerOptions, quality: 0.5}});

    expect(CaptureMetadata.isComparable(a, b)).toBe(false);
  });

  it('rejects photos from different devices', () => {
    const a = build({});
    DeviceInfo.getModel.mockReturnValue('Pixel 8');
    const b = build({});

    expect(CaptureMetadata.isComparable(a, b)).toBe(false);
  });

  it('rejects a library photo even when everything else matches', () => {
    // The device string on a library photo describes the phone that imported
    // it, not the camera that took it.
    const a = build({});
    const b = build({source: CaptureMetadata.SOURCE.LIBRARY});

    expect(CaptureMetadata.isComparable(a, b)).toBe(false);
  });

  it('treats a missing record as not comparable, never as a match', () => {
    const a = build({});

    expect(CaptureMetadata.isComparable(a, null)).toBe(false);
    expect(CaptureMetadata.isComparable(null, a)).toBe(false);
    expect(CaptureMetadata.isComparable(null, null)).toBe(false);
  });
});
