import {Platform} from 'react-native';
import ImageEditor from '@react-native-community/image-editor';
import jpeg from 'jpeg-js';
import ImageQualityMetrics from './ImageQualityMetrics';

const RNFS = require('react-native-fs');

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Turns a captured photo into decoded pixels for ImageQualityMetrics.
 *
 * Route: resample to the fixed analysis size with the native image editor,
 * read the result back, and decode it in JS with jpeg-js.
 */
export default class PhotoPixelSource {
  /**
   * Decode a base64 JPEG down to RGBA at the analysis size.
   *
   * Returns null on any failure. A photo that cannot be analysed must not be
   * treated as a bad photo — the caller distinguishes "measured and poor" from
   * "could not measure".
   *
   * @param {string} base64 - JPEG data, with or without a data: prefix
   * @returns {Promise<{data: Uint8Array, width: number, height: number}|null>}
   */
  static async decode(base64) {
    if (!base64 || typeof base64 !== 'string') {
      return null;
    }

    const clean = base64.includes(',') ? base64.split(',')[1] : base64;
    const size = ImageQualityMetrics.ANALYSIS_SIZE;

    // Random suffix: two photos analysed in the same millisecond must not
    // share (and delete) each other's temp file.
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const sourcePath = `${RNFS.CachesDirectoryPath}/qa_src_${suffix}.jpg`;
    let resizedPath = null;

    try {
      await RNFS.writeFile(sourcePath, clean, 'base64');
      const uri =
        Platform.OS === 'android' ? `file://${sourcePath}` : sourcePath;

      const {width, height} = await PhotoPixelSource._imageSize(uri);
      if (!width || !height) {
        return null;
      }

      // Square on purpose: every analysis image must have the same pixel count.
      const cropped = await ImageEditor.cropImage(uri, {
        offset: {x: 0, y: 0},
        size: {width, height},
        displaySize: {width: size, height: size},
      });

      // image-editor 2.x resolves a URI string; 3.x and 4.x resolve
      // {uri, path, width, height, ...}.
      const croppedUri =
        typeof cropped === 'string' ? cropped : cropped && cropped.uri;
      if (!croppedUri) {
        return null;
      }

      resizedPath = croppedUri.replace('file://', '');
      const resizedBase64 = await RNFS.readFile(resizedPath, 'base64');
      const bytes = PhotoPixelSource.base64ToBytes(resizedBase64);
      if (!bytes) {
        return null;
      }

      const decoded = jpeg.decode(bytes, {useTArray: true});
      if (!decoded || !decoded.data) {
        return null;
      }

      return {
        data: decoded.data,
        width: decoded.width,
        height: decoded.height,
      };
    } catch (error) {
      console.warn('PhotoPixelSource: could not decode:', error?.message);
      return null;
    } finally {
      // Awaited, so the copies of the photo are gone before the caller moves on.
      await RNFS.unlink(sourcePath).catch(() => {});
      if (resizedPath) {
        await RNFS.unlink(resizedPath).catch(() => {});
      }
    }
  }

  /**
   * Base64 to bytes without an intermediate `atob` string.
   *
   * @param {string} input
   * @returns {Uint8Array|null}
   */
  static base64ToBytes(input) {
    if (!input) {
      return null;
    }

    const str = input.replace(/[^A-Za-z0-9+/]/g, '');
    const byteLength = Math.floor((str.length * 3) / 4);
    const bytes = new Uint8Array(byteLength);

    let byteIndex = 0;
    let accumulator = 0;
    let bits = 0;

    for (let i = 0; i < str.length; i++) {
      const value = BASE64_CHARS.indexOf(str[i]);
      if (value < 0) {
        continue;
      }
      /* eslint-disable no-bitwise */
      accumulator = (accumulator << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes[byteIndex++] = (accumulator >> bits) & 0xff;
      }
      /* eslint-enable no-bitwise */
    }

    return byteIndex === byteLength ? bytes : bytes.subarray(0, byteIndex);
  }

  /**
   * Image dimensions via the RN Image module.
   * Split out so tests can drive the decode path without a native bridge.
   */
  static _imageSize(uri) {
    const {Image} = require('react-native');
    return new Promise((resolve, reject) => {
      Image.getSize(
        uri,
        (width, height) => resolve({width, height}),
        error => reject(error || new Error('Failed to read image size')),
      );
    });
  }
}
