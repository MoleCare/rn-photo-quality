import jpeg from 'jpeg-js';

import {
  DEFAULT_THRESHOLDS,
  WARNING_TYPE,
  createPhotoAnalyzer,
  qualityWarningText,
  type AnalysisJpegLoader,
  type PhotoSource,
  type WarningType,
} from '../src';

/** A real JPEG, base64, of a frame built pixel by pixel. */
function jpegOf(size: number, level: (x: number, y: number) => number): string {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0, p = 0; y < size; y++) {
    for (let x = 0; x < size; x++, p += 4) {
      const v = Math.max(0, Math.min(255, Math.round(level(x, y))));
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return Buffer.from(
    jpeg.encode({ data, width: size, height: size }, 100).data
  ).toString('base64');
}

const flat = (level: number) => jpegOf(32, () => level);
const gradient = () => jpegOf(32, (x) => 30 + (x / 32) * 200);

/** A loader that returns the given analysis image. */
const returning = (base64: string) =>
  jest.fn<ReturnType<AnalysisJpegLoader>, Parameters<AnalysisJpegLoader>>(() =>
    Promise.resolve(base64)
  );

/** A photo that should pass: adequate dimensions and file size. */
const goodPhoto = (overrides: Partial<PhotoSource> = {}): PhotoSource => ({
  uri: 'file:///photos/1.jpg',
  width: 2048,
  height: 1536,
  fileSize: 400000,
  ...overrides,
});

const PIXEL_WARNINGS: WarningType[] = [
  WARNING_TYPE.TOO_DARK,
  WARNING_TYPE.TOO_BRIGHT,
  WARNING_TYPE.UNEVEN_LIGHTING,
];

describe('checks that need no pixels', () => {
  const analyzer = createPhotoAnalyzer();

  it('passes a photo with adequate resolution and file size', async () => {
    const report = await analyzer.analyze(goodPhoto());

    expect(report).toMatchObject({
      ok: true,
      warningTypes: [],
      warnings: [],
      critical: false,
    });
  });

  it('flags a photo below the minimum dimensions', async () => {
    const report = await analyzer.analyze(
      goodPhoto({ width: 150, height: 200 })
    );

    expect(report.warningTypes).toEqual([WARNING_TYPE.LOW_RESOLUTION]);
    expect(report.warnings).toEqual([
      qualityWarningText(WARNING_TYPE.LOW_RESOLUTION),
    ]);
  });

  it('flags a file too small to hold a usable photo, from fileSize or base64', async () => {
    expect(
      (await analyzer.analyze(goodPhoto({ fileSize: 2000 }))).warningTypes
    ).toEqual([WARNING_TYPE.SMALL_FILE]);
    expect(
      (
        await analyzer.analyze({
          base64: 'A'.repeat(2000),
          width: 2048,
          height: 1536,
        })
      ).warningTypes
    ).toEqual([WARNING_TYPE.SMALL_FILE]);
  });

  it('does not warn about what it does not know', async () => {
    // Absent dimensions or size are not evidence of a bad photo.
    const report = await analyzer.analyze({ uri: 'file:///photos/1.jpg' });
    expect(report.ok).toBe(true);
    expect(
      (await analyzer.analyze(goodPhoto({ fileSize: Number.NaN }))).ok
    ).toBe(true);
  });

  it('is critical only when the photo is both too small and too low-resolution', async () => {
    const both = await analyzer.analyze(
      goodPhoto({ width: 150, height: 200, fileSize: 2000 })
    );
    const lowRes = await analyzer.analyze(
      goodPhoto({ width: 150, height: 200 })
    );
    const small = await analyzer.analyze(goodPhoto({ fileSize: 2000 }));

    expect([both.critical, lowRes.critical, small.critical]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('treats a missing photo as critical', async () => {
    for (const photo of [null, undefined, {}]) {
      expect(await analyzer.analyze(photo as PhotoSource)).toMatchObject({
        ok: false,
        critical: true,
        measured: false,
        metrics: null,
        warningTypes: [WARNING_TYPE.NO_IMAGE_DATA],
        warnings: ['No image data available.'],
      });
    }
  });

  it('rejects something that is not a photo object', async () => {
    await expect(analyzer.analyze('file:///x.jpg' as never)).rejects.toThrow(
      TypeError
    );
  });

  it('says it did not measure when no loader was given', async () => {
    expect(await analyzer.analyze(goodPhoto())).toMatchObject({
      measured: false,
      measurementFailure: { reason: 'no_loader' },
    });
  });
});

describe('never warns about pixels it did not measure', () => {
  it('reports a loader failure with its cause, and no pixel warning', async () => {
    const cause = new Error('file gone');
    const analyzer = createPhotoAnalyzer({
      loadAnalysisJpeg: () => Promise.reject(cause),
    });

    const report = await analyzer.analyze(goodPhoto());

    expect(report).toMatchObject({
      ok: true,
      measured: false,
      measurementFailure: { reason: 'load_failed', cause },
    });
    for (const type of PIXEL_WARNINGS) {
      expect(report.warningTypes).not.toContain(type);
    }
  });

  it('reports data that is not a JPEG as a decode failure', async () => {
    const garbage = createPhotoAnalyzer({
      loadAnalysisJpeg: returning('bm90IGEganBlZw=='),
    });
    const empty = createPhotoAnalyzer({ loadAnalysisJpeg: returning('') });

    const g = await garbage.analyze(goodPhoto());
    const e = await empty.analyze(goodPhoto());

    expect(g.measurementFailure?.reason).toBe('decode_failed');
    expect(g.measurementFailure && 'cause' in g.measurementFailure).toBe(true);
    expect(e.measurementFailure).toEqual({ reason: 'decode_failed' });
  });

  it('says whether it measured, so silence is not read as a pass', async () => {
    const measured = await createPhotoAnalyzer({
      loadAnalysisJpeg: returning(flat(150)),
    }).analyze(goodPhoto());
    expect(measured).toMatchObject({
      ok: true,
      measured: true,
      measurementFailure: null,
    });
  });
});

describe('measurements on decoded pixels', () => {
  const analyze = (analysisImage: string, photo = goodPhoto()) =>
    createPhotoAnalyzer({ loadAnalysisJpeg: returning(analysisImage) }).analyze(
      photo
    );

  it('flags crushed shadows and blown highlights', async () => {
    expect((await analyze(flat(0))).warningTypes).toContain(
      WARNING_TYPE.TOO_DARK
    );
    expect((await analyze(flat(255))).warningTypes).toContain(
      WARNING_TYPE.TOO_BRIGHT
    );
  });

  it('passes a correctly exposed, evenly lit frame', async () => {
    const report = await analyze(flat(150));
    expect(report).toMatchObject({ ok: true, warningTypes: [] });
  });

  it('flags uneven lighting across the frame', async () => {
    expect((await analyze(gradient())).warningTypes).toContain(
      WARNING_TYPE.UNEVEN_LIGHTING
    );
  });

  it('records sharpness without gating on it', async () => {
    const { metrics } = await analyze(gradient());
    expect(typeof metrics?.sharpness).toBe('number');
  });

  it('marks sharpness unreliable when clipping has destroyed detail', async () => {
    expect((await analyze(flat(255))).metrics?.sharpnessReliable).toBe(false);
    expect((await analyze(flat(150))).metrics?.sharpnessReliable).toBe(true);
  });

  it('keeps the measurement field names MoleCare stores, so old and new records read the same', async () => {
    const { metrics } = await analyze(flat(150));
    expect(Object.keys(metrics ?? {}).sort()).toEqual([
      'analysisSize',
      'brightFraction',
      'darkFraction',
      'evenness',
      'meanLuma',
      'sharpness',
      'sharpnessReliable',
    ]);
  });

  it('asks the loader for the analysis size and records it', async () => {
    const loader = returning(flat(150));
    const photo = goodPhoto();

    const report = await createPhotoAnalyzer({
      loadAnalysisJpeg: loader,
      thresholds: { analysisSize: 256 },
    }).analyze(photo);

    expect(loader).toHaveBeenCalledWith(photo, 256);
    expect(report.metrics?.analysisSize).toBe(256);
    expect(DEFAULT_THRESHOLDS.analysisSize).toBe(512);
  });

  it('records null sharpness and evenness when the frame is too small for them', async () => {
    // A 1×1 image has a luma but no interior for sharpness, and one block.
    const report = await analyze(jpegOf(1, () => 128));
    expect(report.metrics).toMatchObject({ sharpness: null, evenness: null });
  });
});

describe('what the person is told', () => {
  it('has specific guidance for every warning type, all different', () => {
    const texts = Object.values(WARNING_TYPE).map((type) =>
      qualityWarningText(type)
    );
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it('uses the text and codes the app gives', async () => {
    const report = await createPhotoAnalyzer({
      messages: { small_file: 'Fichier trop petit.' },
    }).analyze(goodPhoto({ fileSize: 10 }));

    expect(report.warningTypes).toEqual([WARNING_TYPE.SMALL_FILE]);
    expect(report.warnings).toEqual(['Fichier trop petit.']);
  });
});

describe('options', () => {
  it('refuses mistyped or meaningless settings', () => {
    const bad: unknown[] = [
      { thresholds: { minWdth: 1 } },
      { thresholds: { unevenLimit: -1 } },
      { thresholds: { analysisSize: 1.5 } },
      { thresholds: { analysisSize: 2 } },
      { thresholds: 'strict' },
      { thresholds: null },
      { messages: 'hello' },
      { messages: { too_dark: 42 } },
      { messages: null },
      { loadAnalysisJpeg: 'not a function' },
    ];
    for (const options of bad) {
      expect(() => createPhotoAnalyzer(options as never)).toThrow(TypeError);
    }
  });

  it('freezes the analyzer, its thresholds and every report', async () => {
    const analyzer = createPhotoAnalyzer({ thresholds: { minWidth: 600 } });
    const report = await analyzer.analyze(goodPhoto({ width: 500 }));

    for (const frozen of [
      analyzer,
      analyzer.thresholds,
      report,
      report.warningTypes,
      report.warnings,
    ]) {
      expect(Object.isFrozen(frozen)).toBe(true);
    }
    expect(report.warningTypes).toEqual([WARNING_TYPE.LOW_RESOLUTION]);
  });
});
