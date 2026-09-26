/**
 * What to store next to each photo, so a later photo can be compared with it.
 *
 * The capture record cannot be recovered afterwards, so build it when the
 * photo is added. Device details come from your app; leave them out and none
 * are recorded.
 */
import {
  CAPTURE_SOURCE,
  buildCaptureMetadata,
  type CaptureMetadata,
  type PickerAsset,
  type QualityReport,
  type QualitySummary,
} from '@molecare/photo-quality';

export interface StoredPhoto {
  uri: string;
  capture: CaptureMetadata;
  /** Whether the pixels were measured, and what they measured. Comparisons read it. */
  quality: { measured: boolean } & Partial<QualitySummary>;
}

export function photoRecord(
  asset: PickerAsset & { uri: string },
  report: QualityReport,
  fromCamera: boolean,
  device?: { platform: string; osVersion: string; model: string },
  now: Date = new Date()
): StoredPhoto {
  return {
    uri: asset.uri,
    capture: buildCaptureMetadata(asset, {
      source: fromCamera ? CAPTURE_SOURCE.CAMERA : CAPTURE_SOURCE.LIBRARY,
      // The same settings you gave the picker, so two photos can be matched.
      pickerOptions: { maxWidth: 2048, maxHeight: 2048, quality: 0.85 },
      device: device ?? null,
      capturedAt: now,
    }),
    quality: { measured: report.measured, ...report.metrics },
  };
}
