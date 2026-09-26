/**
 * Before showing two photos side by side, say how comparable they are.
 *
 * Two checks, both about the camera and never about the subject:
 * 1. assessComparability: same device, same settings, similar light?
 * 2. estimateCameraMotion (optional): was the second taken closer or turned?
 *    It reads the skin around the subject, never the subject itself.
 */
import {
  assessComparability,
  estimateCameraMotion,
  explainComparabilityReason,
  summariseComparability,
  type RgbaImage,
} from '@molecare/photo-quality';
import type { StoredPhoto } from './photoRecord';

export function comparisonNotes(
  earlier: StoredPhoto,
  later: StoredPhoto,
  pixels?: { earlier: RgbaImage; later: RgbaImage }
): string[] {
  const withQuality = (photo: StoredPhoto) => ({
    ...photo.capture,
    quality: photo.quality,
  });
  const result = assessComparability(withQuality(earlier), withQuality(later));
  const notes = [
    summariseComparability(result.level),
    ...result.reasons.map((reason) => explainComparabilityReason(reason)),
  ];

  const motion = pixels
    ? estimateCameraMotion(pixels.earlier, pixels.later)
    : null;
  if (motion?.reliable) {
    const percent = Math.round((motion.scale - 1) * 100);
    if (Math.abs(percent) >= 5) {
      notes.push(
        `The second photo was taken about ${String(Math.abs(percent))}% ${
          percent > 0 ? 'closer' : 'further away'
        }, so sizes in it look ${percent > 0 ? 'larger' : 'smaller'}.`
      );
    }
  }
  return notes;
}
