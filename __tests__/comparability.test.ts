import {
  COMPARABILITY_LEVEL as LEVEL,
  COMPARABILITY_REASON as REASON,
  assessComparability,
  explainComparabilityReason,
  summariseComparability,
  type ComparabilityLevel,
  type ComparabilityReason,
} from '../src';

/** A stored capture record, as MoleCare keeps with each photo. */
const capture = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  source: 'camera',
  device: { model: 'iPhone 15 Pro', platform: 'ios' },
  processing: { maxWidth: 2048, maxHeight: 2048, quality: 0.85 },
  quality: { measured: true, meanLuma: 150, evenness: 0.05 },
  ...overrides,
});

describe('a matched pair', () => {
  it('is good when device, pipeline and lighting all agree', () => {
    expect(assessComparability(capture(), capture())).toEqual({
      level: LEVEL.GOOD,
      reasons: [],
      comparable: true,
    });
  });

  it('tolerates small differences in exposure', () => {
    const b = capture({
      quality: { measured: true, meanLuma: 170, evenness: 0.05 },
    });
    expect(assessComparability(capture(), b).level).toBe(LEVEL.GOOD);
  });
});

describe('differences that make a comparison misleading', () => {
  it('rates a different device poor', () => {
    const result = assessComparability(
      capture(),
      capture({ device: { model: 'Pixel 8', platform: 'android' } })
    );
    expect(result.level).toBe(LEVEL.POOR);
    expect(result.reasons).toContain(REASON.DIFFERENT_DEVICE);
  });

  it('rates a missing device or pipeline record as different', () => {
    expect(
      assessComparability(capture(), capture({ device: null })).reasons
    ).toContain(REASON.DIFFERENT_DEVICE);
    expect(
      assessComparability(capture({ processing: undefined }), capture()).reasons
    ).toContain(REASON.DIFFERENT_PROCESSING);
  });

  it('rates a different resampling pipeline poor', () => {
    const result = assessComparability(
      capture(),
      capture({
        processing: { maxWidth: 1024, maxHeight: 1024, quality: 0.85 },
      })
    );
    expect(result.level).toBe(LEVEL.POOR);
    expect(result.reasons).toContain(REASON.DIFFERENT_PROCESSING);
  });

  it('rates a library photo poor even when everything else matches', () => {
    const result = assessComparability(
      capture(),
      capture({ source: 'library' })
    );
    expect(result.level).toBe(LEVEL.POOR);
    expect(result.reasons).toEqual([REASON.FROM_LIBRARY]);
  });

  it('rates a large exposure difference fair, not poor', () => {
    const result = assessComparability(
      capture(),
      capture({ quality: { measured: true, meanLuma: 60, evenness: 0.05 } })
    );
    expect(result).toMatchObject({
      level: LEVEL.FAIR,
      reasons: [REASON.EXPOSURE_DIFFERS],
    });
  });

  it('flags uneven lighting in either photo', () => {
    const b = capture({
      quality: { measured: true, meanLuma: 150, evenness: 0.4 },
    });
    expect(assessComparability(capture(), b).reasons).toContain(
      REASON.UNEVEN_LIGHTING
    );
    expect(assessComparability(b, capture()).reasons).toContain(
      REASON.UNEVEN_LIGHTING
    );
  });

  it('collects every reason, not just the first', () => {
    const b = capture({
      device: { model: 'Pixel 8', platform: 'android' },
      quality: { measured: true, meanLuma: 40, evenness: 0.5 },
    });
    expect(assessComparability(capture(), b).reasons).toEqual([
      REASON.DIFFERENT_DEVICE,
      REASON.EXPOSURE_DIFFERS,
      REASON.UNEVEN_LIGHTING,
    ]);
  });

  it('uses the limits the app passes', () => {
    const b = capture({
      quality: { measured: true, meanLuma: 60, evenness: 0.3 },
    });
    expect(
      assessComparability(capture(), b, {
        exposureDiffLimit: 0.7,
        unevenLimit: 0.35,
      }).level
    ).toBe(LEVEL.GOOD);
    expect(() =>
      assessComparability(capture(), b, { exposureLimit: 1 } as never)
    ).toThrow(TypeError);
  });
});

describe('photos that cannot be assessed', () => {
  it('reports unknown when either photo predates provenance', () => {
    for (const [a, b] of [
      [capture(), undefined],
      [null, capture()],
      [{}, {}],
    ]) {
      expect(assessComparability(a, b)).toEqual({
        level: LEVEL.UNKNOWN,
        reasons: [REASON.NO_PROVENANCE],
        comparable: false,
      });
    }
  });

  it('never reports good when a photo was not measured', () => {
    for (const quality of [{ measured: false }, undefined, null]) {
      const result = assessComparability(capture(), capture({ quality }));
      expect(result).toMatchObject({
        level: LEVEL.FAIR,
        reasons: [REASON.NOT_MEASURED],
      });
    }
  });

  it('skips the exposure check when a stored mean is missing or zero', () => {
    expect(
      assessComparability(
        capture({
          quality: { measured: true, meanLuma: null, evenness: null },
        }),
        capture({ quality: { measured: true, meanLuma: 0 } })
      ).level
    ).toBe(LEVEL.GOOD);
    expect(
      assessComparability(
        capture({ quality: { measured: true, meanLuma: 0 } }),
        capture({ quality: { measured: true, meanLuma: 0 } })
      ).level
    ).toBe(LEVEL.GOOD);
  });

  it('returns frozen results', () => {
    const result = assessComparability(
      capture(),
      capture({ source: 'library' })
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasons)).toBe(true);
  });
});

describe('what the person is told', () => {
  it('explains every reason and summarises every level distinctly', () => {
    const reasons = Object.values(REASON).map((r) =>
      explainComparabilityReason(r)
    );
    const levels = Object.values(LEVEL).map((l) => summariseComparability(l));

    expect(new Set(reasons).size).toBe(reasons.length);
    expect(new Set(levels).size).toBe(levels.length);
    for (const text of reasons) {
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it('never claims the subject did or did not change', () => {
    const forbidden =
      /\b(no change|unchanged|has changed|is growing|worse|better|benign|malignant)\b/i;
    for (const reason of Object.values(REASON)) {
      expect(explainComparabilityReason(reason)).not.toMatch(forbidden);
    }
    for (const level of Object.values(LEVEL)) {
      expect(summariseComparability(level)).not.toMatch(forbidden);
    }
  });

  it('uses the app’s text, and general text for something it does not know', () => {
    expect(
      explainComparabilityReason(REASON.FROM_LIBRARY, {
        from_library: 'Galerie.',
      })
    ).toBe('Galerie.');
    expect(summariseComparability(LEVEL.GOOD, { good: 'Bien.' })).toBe('Bien.');
    expect(
      explainComparabilityReason('something_new' as ComparabilityReason)
    ).toBe('These photos may not be directly comparable.');
    expect(summariseComparability('something_new' as ComparabilityLevel)).toBe(
      summariseComparability(LEVEL.UNKNOWN)
    );
  });
});
