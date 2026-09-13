/* eslint-env jest, node */

// The package keeps no state: every setting goes with the call, and one
// caller's settings can never change what another caller gets.

jest.mock('../src/PhotoPixelSource', () => ({
  __esModule: true,
  default: {decode: jest.fn(async () => null)},
}));

import DeviceInfo from 'react-native-device-info';
import ImageQualityAnalyzer from '../src/ImageQualityAnalyzer';
import ImageQualityMetrics from '../src/ImageQualityMetrics';
import PhotoPixelSource from '../src/PhotoPixelSource';
import PhotoComparability from '../src/PhotoComparability';
import CaptureMetadata from '../src/CaptureMetadata';

const {WARNING_TYPES} = ImageQualityAnalyzer;

/** A payload long enough to pass the small-file check. */
const image = (width = 1000, height = 1000) => ({
  data: 'A'.repeat(20000),
  width,
  height,
});

function flatFrame(level, size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = level;
    data[p + 1] = level;
    data[p + 2] = level;
    data[p + 3] = 255;
  }
  return {data, width: size, height: size};
}

const entry = (meanLuma, extra = {}) => ({
  capture: {
    v: 1,
    source: CaptureMetadata.SOURCE.CAMERA,
    device: {platform: 'ios', model: 'Phone'},
    processing: {maxWidth: 2048, maxHeight: 2048, quality: 0.85},
    quality: {measured: true, meanLuma, evenness: 0.05},
    ...extra,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  PhotoPixelSource.decode.mockResolvedValue(null);
});

describe('the public API', () => {
  it('has no global configuration to change', () => {
    const api = require('../src');
    expect(api.configure).toBeUndefined();
    expect(api.getConfig).toBeUndefined();
    expect(api.resetConfig).toBeUndefined();
    expect(Object.isFrozen(api.DEFAULT_OPTIONS)).toBe(true);
  });

  it('freezes its shared constants', () => {
    for (const constant of [
      WARNING_TYPES,
      PhotoComparability.LEVEL,
      PhotoComparability.REASON,
      CaptureMetadata.SOURCE,
      CaptureMetadata.UNAVAILABLE_FIELDS,
      CaptureMetadata.DEVICE_FIELDS,
    ]) {
      expect(Object.isFrozen(constant)).toBe(true);
    }
  });

  it('has no module-level variables in its source', () => {
    const fs = require('fs');
    const path = require('path');
    const srcDir = path.join(__dirname, '..', 'src');
    for (const file of fs.readdirSync(srcDir).filter(f => f.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
      expect([file, /^(let|var)\s/m.test(source)]).toEqual([file, false]);
    }
  });
});

describe('ImageQualityAnalyzer options', () => {
  it('uses the thresholds of one call without changing the next', async () => {
    const strict = await ImageQualityAnalyzer.analyze(image(1000, 1000), {minWidth: 2000});
    const plain = await ImageQualityAnalyzer.analyze(image(1000, 1000));

    expect(strict.warningTypes).toEqual([WARNING_TYPES.LOW_RESOLUTION]);
    expect(plain.warningTypes).toEqual([]);
    expect(plain.ok).toBe(true);
  });

  it('passes the analysis size to the decoder and records it', async () => {
    PhotoPixelSource.decode.mockResolvedValue(flatFrame(128));

    const result = await ImageQualityAnalyzer.analyze(image(), {analysisSize: 256});

    expect(PhotoPixelSource.decode).toHaveBeenCalledWith(expect.any(String), {analysisSize: 256});
    expect(result.metrics.analysisSize).toBe(256);
  });

  it('returns codes, and the text the caller gives for them', async () => {
    const small = {data: 'A'.repeat(10), width: 1000, height: 1000};

    const result = await ImageQualityAnalyzer.analyze(small, {
      messages: {small_file: 'Petit fichier.'},
    });

    expect(result.warningTypes).toEqual([WARNING_TYPES.SMALL_FILE]);
    expect(result.warnings).toEqual(['Petit fichier.']);
  });

  it('names missing image data with a code too', async () => {
    const result = await ImageQualityAnalyzer.analyze(null);

    expect(result).toMatchObject({
      ok: false,
      critical: true,
      measured: false,
      metrics: null,
      warningTypes: [WARNING_TYPES.NO_IMAGE_DATA],
      warnings: ['No image data available.'],
    });
  });

  it('never uses a photo passed where the options go', async () => {
    // A base64 reference is ignored (the old API took one there); a picker
    // asset object is refused as unknown options rather than read.
    const withString = await ImageQualityAnalyzer.analyze(image(), 'A'.repeat(20000));
    const plain = await ImageQualityAnalyzer.analyze(image());
    expect(withString).toEqual(plain);

    await expect(ImageQualityAnalyzer.analyze(image(), image())).rejects.toThrow(/Unknown/);
  });

  it('refuses a mistyped or meaningless option instead of ignoring it', async () => {
    await expect(ImageQualityAnalyzer.analyze(image(), {minWdth: 10})).rejects.toThrow(/minWdth/);
    await expect(ImageQualityAnalyzer.analyze(image(), {unevenLimit: -1})).rejects.toThrow(TypeError);
    await expect(ImageQualityAnalyzer.analyze(image(), {analysisSize: 1.5})).rejects.toThrow(TypeError);
    await expect(ImageQualityAnalyzer.analyze(image(), {messages: 'no'})).rejects.toThrow(TypeError);
  });
});

describe('ImageQualityMetrics options', () => {
  it('counts dark pixels against the level passed in', () => {
    const y = ImageQualityMetrics.luma(flatFrame(40).data, 32, 32);

    expect(ImageQualityMetrics.exposure(y, {darkLevel: 50}).darkFraction).toBe(1);
    expect(ImageQualityMetrics.exposure(y).darkFraction).toBe(0);
  });
});

describe('PhotoComparability options', () => {
  it('uses the exposure limit of one call without changing the next', () => {
    // 100 vs 70 is a 30% difference: over the default 25% limit.
    expect(PhotoComparability.assess(entry(100), entry(70), {exposureDiffLimit: 0.5}).reasons).toEqual([]);
    expect(PhotoComparability.assess(entry(100), entry(70)).reasons).toEqual([
      PhotoComparability.REASON.EXPOSURE_DIFFERS,
    ]);
  });

  it('takes explanation and summary text from the caller when given', () => {
    const {REASON, LEVEL} = PhotoComparability;

    expect(PhotoComparability.explain(REASON.FROM_LIBRARY, {from_library: 'De la galerie.'})).toBe(
      'De la galerie.',
    );
    expect(PhotoComparability.summarise(LEVEL.GOOD, {good: 'Bien.'})).toBe('Bien.');
    expect(PhotoComparability.summarise(LEVEL.GOOD)).toMatch(/good for comparison/);
    // Array.map passes an index as the second argument; it must not matter.
    expect(Object.values(LEVEL).map(PhotoComparability.summarise)).toEqual(
      Object.values(LEVEL).map(level => PhotoComparability.summarise(level)),
    );
  });
});

describe('CaptureMetadata inputs', () => {
  const asset = {width: 1536, height: 2048, fileSize: 812345, type: 'image/jpeg'};

  it('records the device details the app passes, without reading the device', () => {
    const m = CaptureMetadata.build(asset, {
      source: CaptureMetadata.SOURCE.CAMERA,
      device: {platform: 'android', model: 'Kiosk tablet', serial: 'dropped'},
    });

    expect(m.device).toEqual({
      platform: 'android',
      osVersion: null,
      model: 'Kiosk tablet',
      appVersion: null,
      appBuild: null,
      isEmulator: null,
    });
    expect(DeviceInfo.getModel).not.toHaveBeenCalled();
  });

  it('records no device details when the app passes null', () => {
    const m = CaptureMetadata.build(asset, {source: CaptureMetadata.SOURCE.CAMERA, device: null});

    expect(Object.values(m.device).every(v => v === null)).toBe(true);
    expect(DeviceInfo.getModel).not.toHaveBeenCalled();
  });

  it('still reads the device when the app passes nothing, as before', () => {
    const m = CaptureMetadata.build(asset, {source: CaptureMetadata.SOURCE.CAMERA});

    expect(DeviceInfo.getModel).toHaveBeenCalled();
    expect(m.device).toEqual(CaptureMetadata.readDevice());
  });

  it('uses the capture time the app passes', () => {
    const m = CaptureMetadata.build(asset, {capturedAt: '2026-09-01T08:30:00.000Z'});
    expect(m.capturedAt).toBe('2026-09-01T08:30:00.000Z');

    const fallback = CaptureMetadata.build(asset, {capturedAt: 'not a date'});
    expect(Date.parse(fallback.capturedAt)).not.toBeNaN();
  });
});
