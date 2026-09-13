import jpeg from 'jpeg-js';

import type { RgbaImage } from './metrics';

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Strip a `data:...;base64,` prefix if there is one. */
export const stripDataUrl = (base64: string): string => {
  const comma = base64.indexOf(',');
  return base64.startsWith('data:') && comma >= 0
    ? base64.slice(comma + 1)
    : base64;
};

/**
 * Base64 to bytes without building an intermediate binary string. Characters
 * outside the base64 alphabet (whitespace, padding) are skipped.
 */
export function base64ToBytes(input: string): Uint8Array | null {
  const str = stripDataUrl(input).replace(/[^A-Za-z0-9+/]/g, '');
  if (str.length === 0) {
    return null;
  }
  const bytes = new Uint8Array(Math.floor((str.length * 3) / 4));
  let byteIndex = 0;
  let accumulator = 0;
  let bits = 0;
  for (const char of str) {
    accumulator = ((accumulator << 6) | BASE64_CHARS.indexOf(char)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex++] = (accumulator >> bits) & 0xff;
    }
  }
  return bytes;
}

/**
 * Decode a base64 JPEG to RGBA. Memory is capped: the analysis image is small,
 * so a huge decode means the loader returned the wrong image, or a hostile one.
 *
 * @throws when the bytes are not a JPEG jpeg-js can decode
 */
export function decodeJpeg(base64: string): RgbaImage | null {
  const bytes = base64ToBytes(base64);
  if (!bytes) {
    return null;
  }
  const decoded = jpeg.decode(bytes, {
    useTArray: true,
    maxResolutionInMP: 16,
    maxMemoryUsageInMB: 128,
  });
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}
