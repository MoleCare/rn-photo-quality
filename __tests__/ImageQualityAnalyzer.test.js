/* eslint-env jest, node */

// The decode path needs a native image editor and the filesystem. Mocked here
// so each test states the pixels it is testing against; PhotoPixelSource has
// its own tests, and ImageQualityMetrics is verified against real photographs.
jest.mock('../src/PhotoPixelSource', () => ({
  __esModule: true,
  default: {decode: jest.fn(async () => null)},
}));

import ImageQualityAnalyzer from '../src/ImageQualityAnalyzer';
import PhotoPixelSource from '../src/PhotoPixelSource';

/** A decoded frame of one flat grey level, for driving the exposure checks. */
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

/** A decoded frame lit by a left-to-right gradient. */
function gradientFrame(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let row = 0, p = 0; row < size; row++) {
    for (let col = 0; col < size; col++, p += 4) {
      const v = Math.round(30 + (col / size) * 200);
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return {data, width: size, height: size};
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: the pixels could not be read. Tests that care set their own frame.
  PhotoPixelSource.decode.mockResolvedValue(null);
});

const {WARNING_TYPES} = ImageQualityAnalyzer;

/**
 * Build a base64 payload shaped like a real camera JPEG: a long low-entropy
 * header region followed by high-entropy scan data.
 *
 * Both halves matter, and a naive payload reproduces neither failure. The
 * removed estimators were defeated by the header (their sample offset never
 * left it) and by the scan data (Huffman coding makes it near-uniform noise,
 * so no byte statistic distinguishes a dark photo from a bright one). A payload
 * of uniformly random bytes would let a restored brightness check pass these
 * tests, because its mean lands comfortably above the too-dark threshold.
 */
function fakeJpegBase64(byteLength, seed = 1) {
  const bytes = Buffer.alloc(byteLength);
  // JPEG SOI + APP0/JFIF marker. Bytes 0..HEADER_BYTES stay mostly zero, as a
  // real camera JPEG's headers do — JFIF, EXIF, quantization tables and an
  // embedded thumbnail leave long low-entropy runs there. This is what defeated
  // the removed brightness estimator: its sample offset was capped at base64
  // char 1000, i.e. byte 750, so it never reached the scan data at all.
  const HEADER_BYTES = 3000;
  bytes.write('\xFF\xD8\xFF\xE0', 0, 'binary');
  let x = seed;
  for (let i = HEADER_BYTES; i < byteLength; i++) {
    // xorshift — cheap, deterministic, and flat enough to stand in for
    // entropy-coded scan data
    /* eslint-disable no-bitwise */
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    bytes[i] = x & 0xff;
    /* eslint-enable no-bitwise */
  }
  return bytes.toString('base64');
}

/** A photo that should pass: adequate dimensions, adequate payload. */
function goodPhoto(overrides = {}) {
  return {
    data: fakeJpegBase64(40000),
    width: 2048,
    height: 1536,
    ...overrides,
  };
}

describe('ImageQualityAnalyzer', () => {
  describe('checks that are implemented', () => {
    it('passes a photo with adequate resolution and payload size', async () => {
      const result = await ImageQualityAnalyzer.analyze(goodPhoto());

      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.critical).toBe(false);
    });

    it('flags a photo below the minimum dimensions', async () => {
      const result = await ImageQualityAnalyzer.analyze(
        goodPhoto({width: 150, height: 200}),
      );

      expect(result.ok).toBe(false);
      expect(result.warnings).toContain(
        ImageQualityAnalyzer.getActionableFeedback(
          WARNING_TYPES.LOW_RESOLUTION,
        ),
      );
    });

    it('flags a payload too small to hold a usable photo', async () => {
      const result = await ImageQualityAnalyzer.analyze(
        goodPhoto({data: fakeJpegBase64(2000)}),
      );

      expect(result.ok).toBe(false);
      expect(result.warnings).toContain(
        ImageQualityAnalyzer.getActionableFeedback(WARNING_TYPES.SMALL_FILE),
      );
    });

    it('does not flag resolution when dimensions are unknown', async () => {
      // The picker does not always report dimensions. Absent data is not
      // evidence of a bad photo, so it must not produce a warning.
      const result = await ImageQualityAnalyzer.analyze(
        goodPhoto({width: 0, height: 0}),
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('critical classification', () => {
    it('is critical only when the photo is both too small and too few pixels', async () => {
      const result = await ImageQualityAnalyzer.analyze({
        data: fakeJpegBase64(2000),
        width: 150,
        height: 200,
      });

      expect(result.critical).toBe(true);
    });

    it('is not critical when only one signal fires', async () => {
      const lowRes = await ImageQualityAnalyzer.analyze(
        goodPhoto({width: 150, height: 200}),
      );
      const smallFile = await ImageQualityAnalyzer.analyze(
        goodPhoto({data: fakeJpegBase64(2000)}),
      );

      expect(lowRes.critical).toBe(false);
      expect(smallFile.critical).toBe(false);
    });

    it('treats a missing payload as critical', async () => {
      expect((await ImageQualityAnalyzer.analyze(null)).critical).toBe(true);
      expect((await ImageQualityAnalyzer.analyze({})).critical).toBe(true);
    });
  });

  /**
   * The regression this file exists for, restated for the pixel implementation.
   *
   * The original defect was warnings invented from data that could not support
   * them: brightness, blur and colour cast estimated from the compressed JPEG,
   * which is entropy-coded noise. Sharpness returned 100/100 on every image
   * including one blurred at sigma 20, brightness correlated with true
   * luminance at r=0.25, and a correctly exposed photo was warned about.
   *
   * The measurements are real now, so the guard changes shape: a warning about
   * the pixels may only appear when the pixels were actually read. Nothing may
   * be inferred from the payload.
   */
  describe('never warns about pixels it did not measure', () => {
    const pixelWarnings = [
      WARNING_TYPES.TOO_DARK,
      WARNING_TYPES.TOO_BRIGHT,
      WARNING_TYPES.UNEVEN_LIGHTING,
      WARNING_TYPES.BLURRY,
      WARNING_TYPES.COLOR_CAST,
    ].map(type => ImageQualityAnalyzer.getActionableFeedback(type));

    it('emits no pixel warning when the image could not be decoded', async () => {
      PhotoPixelSource.decode.mockResolvedValue(null);

      for (let seed = 1; seed <= 20; seed++) {
        const {warnings, measured} = await ImageQualityAnalyzer.analyze(
          goodPhoto({data: fakeJpegBase64(40000, seed)}),
        );

        expect(measured).toBe(false);
        for (const pixelWarning of pixelWarnings) {
          expect(warnings).not.toContain(pixelWarning);
        }
      }
    });

    it('says whether it measured, so silence is not read as a pass', async () => {
      PhotoPixelSource.decode.mockResolvedValue(null);
      const undecodable = await ImageQualityAnalyzer.analyze(goodPhoto());

      PhotoPixelSource.decode.mockResolvedValue(flatFrame(128));
      const measured = await ImageQualityAnalyzer.analyze(goodPhoto());

      // Both pass. Only one of them was actually looked at.
      expect(undecodable.ok).toBe(true);
      expect(measured.ok).toBe(true);
      expect(undecodable.measured).toBe(false);
      expect(measured.measured).toBe(true);
    });

    it('does not depend on the payload bytes, only on the decoded pixels', async () => {
      // Two completely different payloads, same decoded frame, same verdict.
      PhotoPixelSource.decode.mockResolvedValue(flatFrame(128));

      const a = await ImageQualityAnalyzer.analyze(
        goodPhoto({data: fakeJpegBase64(40000, 1)}),
      );
      const b = await ImageQualityAnalyzer.analyze(
        goodPhoto({data: 'A'.repeat(40000)}),
      );

      expect(a.warnings).toEqual(b.warnings);
    });

    it('ignores a second argument, so a reference photo cannot be silently used', async () => {
      PhotoPixelSource.decode.mockResolvedValue(flatFrame(128));
      const reference = fakeJpegBase64(40000, 42);

      const withRef = await ImageQualityAnalyzer.analyze(
        goodPhoto(),
        reference,
      );
      const withoutRef = await ImageQualityAnalyzer.analyze(goodPhoto());

      expect(withRef).toEqual(withoutRef);
    });
  });

  describe('measurements on decoded pixels', () => {
    it('flags a frame with crushed shadows', async () => {
      PhotoPixelSource.decode.mockResolvedValue(flatFrame(0));

      const {warnings, ok} = await ImageQualityAnalyzer.analyze(goodPhoto());

      expect(ok).toBe(false);
      expect(warnings).toContain(
        ImageQualityAnalyzer.getActionableFeedback(WARNING_TYPES.TOO_DARK),
      );
    });

    it('flags a frame with blown highlights', async () => {
      PhotoPixelSource.decode.mockResolvedValue(flatFrame(255));

      const {warnings} = await ImageQualityAnalyzer.analyze(goodPhoto());

      expect(warnings).toContain(
        ImageQualityAnalyzer.getActionableFeedback(WARNING_TYPES.TOO_BRIGHT),
      );
    });

    it('passes a correctly exposed, evenly lit frame', async () => {
      // The case the old implementation got wrong: it warned "too dark" and
      // "colour tint" on a correctly exposed photograph.
      PhotoPixelSource.decode.mockResolvedValue(flatFrame(150));

      const {ok, warnings} = await ImageQualityAnalyzer.analyze(goodPhoto());

      expect(ok).toBe(true);
      expect(warnings).toEqual([]);
    });

    it('flags uneven lighting across the frame', async () => {
      PhotoPixelSource.decode.mockResolvedValue(gradientFrame());

      const {warnings} = await ImageQualityAnalyzer.analyze(goodPhoto());

      expect(warnings).toContain(
        ImageQualityAnalyzer.getActionableFeedback(
          WARNING_TYPES.UNEVEN_LIGHTING,
        ),
      );
    });

    it('does not gate on sharpness, but records it', async () => {
      // Its scale depends on lens, sensor noise and subject. Recording builds
      // the distribution a threshold needs; guessing one is what the previous
      // implementation did.
      PhotoPixelSource.decode.mockResolvedValue(gradientFrame());

      const {warnings, metrics} = await ImageQualityAnalyzer.analyze(
        goodPhoto(),
      );

      expect(warnings).not.toContain(
        ImageQualityAnalyzer.getActionableFeedback(WARNING_TYPES.BLURRY),
      );
      expect(typeof metrics.sharpness).toBe('number');
    });

    it('marks sharpness unreliable when clipping has destroyed detail', async () => {
      // A blown frame scores as blurred because the detail is gone, not soft.
      // Measured: 1.2 on an overexposed image whose original scored 2521.
      PhotoPixelSource.decode.mockResolvedValue(flatFrame(255));

      const {metrics} = await ImageQualityAnalyzer.analyze(goodPhoto());

      expect(metrics.sharpnessReliable).toBe(false);
    });

    it('records the size it measured at, since scores are resolution-dependent', async () => {
      PhotoPixelSource.decode.mockResolvedValue(flatFrame(150));

      const {metrics} = await ImageQualityAnalyzer.analyze(goodPhoto());

      expect(metrics.analysisSize).toBe(512);
    });
  });

  describe('getActionableFeedback', () => {
    it('gives specific guidance for every known warning type', () => {
      for (const type of Object.values(WARNING_TYPES)) {
        const message = ImageQualityAnalyzer.getActionableFeedback(type);

        expect(message.length).toBeGreaterThan(0);
        expect(message).not.toBe(
          ImageQualityAnalyzer.getActionableFeedback('unknown_type'),
        );
      }
    });

    it('falls back to generic advice for an unrecognised type', () => {
      expect(ImageQualityAnalyzer.getActionableFeedback('nonsense')).toContain(
        'Photo quality issue',
      );
    });
  });
});
