/* eslint-env jest, node */
import PhotoComparability from '../src/PhotoComparability';

const {LEVEL, REASON} = PhotoComparability;

/** A history entry carrying a capture record, with overrides applied. */
function entry(overrides = {}) {
  return {
    imagepath: '/photo.jpg',
    capture: {
      v: 1,
      source: 'camera',
      device: {model: 'iPhone 15 Pro', platform: 'ios'},
      processing: {maxWidth: 2048, maxHeight: 2048, quality: 0.85},
      quality: {measured: true, meanLuma: 150, evenness: 0.05},
      ...overrides,
    },
  };
}

describe('a matched pair', () => {
  it('is good when device, pipeline and lighting all agree', () => {
    const result = PhotoComparability.assess(entry(), entry());

    expect(result.level).toBe(LEVEL.GOOD);
    expect(result.comparable).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('tolerates small differences in exposure', () => {
    const a = entry({quality: {measured: true, meanLuma: 150, evenness: 0.05}});
    const b = entry({quality: {measured: true, meanLuma: 170, evenness: 0.05}});

    expect(PhotoComparability.assess(a, b).level).toBe(LEVEL.GOOD);
  });
});

describe('differences that make a comparison misleading', () => {
  it('rates a different device poor', () => {
    // Cameras differ in colour rendering and detail, so a difference between
    // two devices is partly the devices.
    const b = entry({device: {model: 'Pixel 8', platform: 'android'}});
    const result = PhotoComparability.assess(entry(), b);

    expect(result.level).toBe(LEVEL.POOR);
    expect(result.reasons).toContain(REASON.DIFFERENT_DEVICE);
  });

  it('rates a different resampling pipeline poor', () => {
    const b = entry({
      processing: {maxWidth: 1024, maxHeight: 1024, quality: 0.85},
    });
    const result = PhotoComparability.assess(entry(), b);

    expect(result.level).toBe(LEVEL.POOR);
    expect(result.reasons).toContain(REASON.DIFFERENT_PROCESSING);
  });

  it('rates a library photo poor even when everything else matches', () => {
    // Its recorded device is whichever phone imported the file, so a match
    // there means nothing about how the photo was taken.
    const b = entry({source: 'library'});
    const result = PhotoComparability.assess(entry(), b);

    expect(result.level).toBe(LEVEL.POOR);
    expect(result.reasons).toContain(REASON.FROM_LIBRARY);
  });

  it('rates a large exposure difference fair, not poor', () => {
    // Real, and worth saying, but not the same class as a different camera.
    const b = entry({quality: {measured: true, meanLuma: 60, evenness: 0.05}});
    const result = PhotoComparability.assess(entry(), b);

    expect(result.level).toBe(LEVEL.FAIR);
    expect(result.reasons).toContain(REASON.EXPOSURE_DIFFERS);
  });

  it('flags uneven lighting in either photo', () => {
    const b = entry({quality: {measured: true, meanLuma: 150, evenness: 0.4}});

    expect(PhotoComparability.assess(entry(), b).reasons).toContain(
      REASON.UNEVEN_LIGHTING,
    );
    expect(PhotoComparability.assess(b, entry()).reasons).toContain(
      REASON.UNEVEN_LIGHTING,
    );
  });

  it('collects every reason, not just the first', () => {
    const b = entry({
      device: {model: 'Pixel 8', platform: 'android'},
      quality: {measured: true, meanLuma: 40, evenness: 0.5},
    });
    const {reasons} = PhotoComparability.assess(entry(), b);

    expect(reasons).toEqual(
      expect.arrayContaining([
        REASON.DIFFERENT_DEVICE,
        REASON.EXPOSURE_DIFFERS,
        REASON.UNEVEN_LIGHTING,
      ]),
    );
  });
});

describe('photos that cannot be assessed', () => {
  it('reports unknown when either photo predates provenance', () => {
    // These can never be assessed — there is nothing to read it from. Saying so
    // is the truthful answer; claiming a match would be worse than silence.
    const legacy = {imagepath: '/old.jpg'};

    for (const pair of [
      [entry(), legacy],
      [legacy, entry()],
      [legacy, legacy],
    ]) {
      const result = PhotoComparability.assess(pair[0], pair[1]);
      expect(result.level).toBe(LEVEL.UNKNOWN);
      expect(result.reasons).toEqual([REASON.NO_PROVENANCE]);
      expect(result.comparable).toBe(false);
    }
  });

  it('never reports good when a photo was not measured', () => {
    // Absence of a measurement is not a poor measurement, but it is not
    // evidence of a match either.
    const b = entry({quality: {measured: false}});
    const result = PhotoComparability.assess(entry(), b);

    expect(result.level).toBe(LEVEL.FAIR);
    expect(result.reasons).toContain(REASON.NOT_MEASURED);
  });

  it('handles a capture record with no quality block at all', () => {
    const b = entry({quality: undefined});

    expect(() => PhotoComparability.assess(entry(), b)).not.toThrow();
    expect(PhotoComparability.assess(entry(), b).reasons).toContain(
      REASON.NOT_MEASURED,
    );
  });

  it('does not throw on missing entries', () => {
    expect(() => PhotoComparability.assess(null, null)).not.toThrow();
    expect(PhotoComparability.assess(null, entry()).level).toBe(LEVEL.UNKNOWN);
  });
});

describe('what the user is told', () => {
  it('explains every reason it can produce', () => {
    for (const reason of Object.values(REASON)) {
      const text = PhotoComparability.explain(reason);

      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toBe(PhotoComparability.explain('unrecognised'));
    }
  });

  it('never claims the mole did or did not change', () => {
    // These conditions make that reading unreliable, so the copy must not make
    // it. The whole point is to say the photo is uncertain, not the lesion.
    const forbidden =
      /\b(no change|unchanged|has changed|is growing|worse|better|benign|malignant)\b/i;

    for (const reason of Object.values(REASON)) {
      expect(PhotoComparability.explain(reason)).not.toMatch(forbidden);
    }
    for (const level of Object.values(LEVEL)) {
      expect(PhotoComparability.summarise(level)).not.toMatch(forbidden);
    }
  });

  it('summarises each level distinctly', () => {
    const summaries = Object.values(LEVEL).map(PhotoComparability.summarise);

    expect(new Set(summaries).size).toBe(summaries.length);
  });
});
