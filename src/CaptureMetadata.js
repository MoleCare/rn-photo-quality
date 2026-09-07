import {Platform} from 'react-native';
import DeviceInfo from 'react-native-device-info';

/**
 * Provenance for a stored photo.
 *
 * Resolution caps, JPEG quality, device and capture source all change the
 * pixels, and none of it can be recovered from the stored image afterwards.
 * Recorded at capture time, alongside the photo, or it is lost.
 */
export default class CaptureMetadata {
  /**
   * Bump when the shape changes. Consumers must tolerate older versions.
   */
  static VERSION = 1;

  /** Where a photo came from. Library photos carry far weaker guarantees. */
  static SOURCE = {
    CAMERA: 'camera',
    LIBRARY: 'library',
  };

  /**
   * Fields the current capture stack cannot provide. Named rather than omitted.
   */
  static UNAVAILABLE_FIELDS = [
    'iso',
    'exposureTime',
    'focalLength',
    'colourTemperature',
    'torch',
    'lens',
  ];

  /**
   * Build the record to store beside an image.
   *
   * Never throws: a capture must not fail because its provenance could not be
   * read.
   *
   * @param {Object} asset - one entry from react-native-image-picker's `assets`
   * @param {Object} context
   * @param {string} context.source - one of CaptureMetadata.SOURCE
   * @param {Object} [context.pickerOptions]
   * @returns {Object} metadata record
   */
  static build(asset, context = {}) {
    const record = {
      v: CaptureMetadata.VERSION,
      capturedAt: new Date().toISOString(),
      source: context.source || null,
      partial: false,
      unavailable: [...CaptureMetadata.UNAVAILABLE_FIELDS],
    };

    try {
      const {source, pickerOptions} = context;

      record.image = {
        width: CaptureMetadata._number(asset && asset.width),
        height: CaptureMetadata._number(asset && asset.height),
        fileSize: CaptureMetadata._number(asset && asset.fileSize),
        type: (asset && asset.type) || null,
        assetTimestamp: (asset && asset.timestamp) || null,
      };

      const {width, height} = record.image;
      record.image.megapixels =
        width && height ? Math.round((width * height) / 10000) / 100 : null;
      record.image.aspectRatio =
        width && height ? Math.round((width / height) * 1000) / 1000 : null;

      record.processing = {
        maxWidth: CaptureMetadata._number(
          pickerOptions && pickerOptions.maxWidth,
        ),
        maxHeight: CaptureMetadata._number(
          pickerOptions && pickerOptions.maxHeight,
        ),
        quality: CaptureMetadata._number(
          pickerOptions && pickerOptions.quality,
        ),
      };

      record.device = CaptureMetadata._device();
      record.deviceIsCaptureDevice = source === CaptureMetadata.SOURCE.CAMERA;
    } catch (error) {
      record.partial = true;
      record.error = error && error.message ? error.message : String(error);
      console.warn('CaptureMetadata: partial record:', record.error);
    }

    return record;
  }

  static _device() {
    const device = {
      platform: Platform.OS || null,
      osVersion: String(Platform.Version || '') || null,
      model: null,
      appVersion: null,
      appBuild: null,
      isEmulator: null,
    };

    try {
      device.model = DeviceInfo.getModel();
    } catch (e) {
      /* left null */
    }
    try {
      device.appVersion = DeviceInfo.getVersion();
    } catch (e) {
      /* left null */
    }
    try {
      device.appBuild = DeviceInfo.getBuildNumber();
    } catch (e) {
      /* left null */
    }
    try {
      device.isEmulator = DeviceInfo.isEmulatorSync();
    } catch (e) {
      /* left null */
    }

    return device;
  }

  static isPresent(metadata) {
    return !!(metadata && typeof metadata === 'object' && metadata.v);
  }

  /**
   * Whether two photos were produced by the same pipeline on the same device.
   */
  static isComparable(a, b) {
    if (!CaptureMetadata.isPresent(a) || !CaptureMetadata.isPresent(b)) {
      return false;
    }

    const sameDevice =
      a.device &&
      b.device &&
      a.device.model === b.device.model &&
      a.device.platform === b.device.platform;

    const sameProcessing =
      a.processing &&
      b.processing &&
      a.processing.maxWidth === b.processing.maxWidth &&
      a.processing.maxHeight === b.processing.maxHeight &&
      a.processing.quality === b.processing.quality;

    const bothFromCamera =
      a.source === CaptureMetadata.SOURCE.CAMERA &&
      b.source === CaptureMetadata.SOURCE.CAMERA;

    return !!(sameDevice && sameProcessing && bothFromCamera);
  }

  static _number(value) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
}
