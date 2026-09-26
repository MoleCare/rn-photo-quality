// The examples in examples/ are documentation; this runs the plain ones so a
// change that breaks them fails here, not in someone's app.
import type { QualityReport, RgbaImage } from '@molecare/photo-quality';
import { comparisonNotes } from '../examples/comparePhotos';
import { photoRecord } from '../examples/photoRecord';

const report = (
  measured: boolean,
  meanLuma = 120,
  evenness = 0.05
): QualityReport => ({
  ok: true,
  warningTypes: [],
  warnings: [],
  critical: false,
  measured,
  measurementFailure: measured ? null : { reason: 'no_loader' },
  metrics: measured
    ? {
        analysisSize: 512,
        sharpness: 10,
        sharpnessReliable: false,
        meanLuma,
        darkFraction: 0,
        brightFraction: 0,
        evenness,
      }
    : null,
});

const asset = {
  uri: 'file:///photo.jpg',
  width: 2048,
  height: 1536,
  fileSize: 400_000,
};
const phone = { platform: 'ios', osVersion: '18.0', model: 'iPhone15,2' };
const march = new Date('2026-03-01T10:00:00Z');
const june = new Date('2026-06-01T10:00:00Z');

describe('examples/photoRecord', () => {
  it('stores the capture record and the measurements together', () => {
    const photo = photoRecord(asset, report(true), true, phone, march);
    expect(photo.uri).toBe('file:///photo.jpg');
    expect(photo.capture).toMatchObject({
      v: 1,
      source: 'camera',
      capturedAt: march.toISOString(),
    });
    expect(photo.capture.device.model).toBe('iPhone15,2');
    expect(photo.quality).toMatchObject({ measured: true, meanLuma: 120 });
  });

  it('records no device details when none are given', () => {
    const photo = photoRecord(asset, report(false), false, undefined, march);
    expect(photo.capture.source).toBe('library');
    expect(photo.capture.device.model).toBeNull();
    expect(photo.quality).toEqual({ measured: false });
  });
});

describe('examples/comparePhotos', () => {
  it('calls two camera photos from one phone in similar light comparable', () => {
    const notes = comparisonNotes(
      photoRecord(asset, report(true), true, phone, march),
      photoRecord(asset, report(true, 125), true, phone, june)
    );
    expect(notes).toHaveLength(1);
  });

  it('explains what makes a comparison weaker', () => {
    const notes = comparisonNotes(
      photoRecord(asset, report(true, 60), true, phone, march),
      photoRecord(
        asset,
        report(true, 180),
        true,
        { ...phone, model: 'Pixel 8' },
        june
      )
    );
    expect(notes.length).toBeGreaterThan(2);
    expect(notes.join(' ')).toMatch(/different devices/);
  });

  it('adds nothing about distance when the camera estimate is not reliable', () => {
    const flat = (): RgbaImage => ({
      width: 64,
      height: 64,
      data: new Uint8Array(64 * 64 * 4).fill(128),
    });
    const earlier = photoRecord(asset, report(true), true, phone, march);
    const later = photoRecord(asset, report(true), true, phone, june);
    // A flat grey image has no skin texture to register, so the estimate is
    // unreliable and must not be turned into a note.
    const notes = comparisonNotes(earlier, later, {
      earlier: flat(),
      later: flat(),
    });
    expect(notes.join(' ')).not.toMatch(/closer|further/);
  });

  it('never says whether the subject changed', () => {
    const notes = comparisonNotes(
      photoRecord(asset, report(true, 60), false, phone, march),
      photoRecord(
        asset,
        report(false),
        true,
        { ...phone, model: 'Pixel 8' },
        june
      )
    );
    notes.forEach((note) => {
      expect(note).not.toMatch(
        /grown|grew|bigger|worse|concern|risk|see a doctor/i
      );
    });
  });
});
