import jpeg from 'jpeg-js';

import { base64ToBytes, decodeJpeg } from '../src';

describe('base64ToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    const original = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x01, 0xfe, 0x42]);
    const bytes = base64ToBytes(original.toString('base64'));
    expect(Buffer.from(bytes ?? []).equals(original)).toBe(true);
  });

  it('round-trips a payload the size of an analysis image', () => {
    const original = Buffer.alloc(60000);
    for (let i = 0; i < original.length; i++) {
      original[i] = (i * 31) % 256;
    }
    const bytes = base64ToBytes(original.toString('base64'));
    expect(bytes?.length).toBe(original.length);
    expect(Buffer.from(bytes ?? []).equals(original)).toBe(true);
  });

  it('reproduces a real JPEG header exactly', () => {
    // Wrong bytes would not throw: jpeg-js would decode an image nobody took.
    const jpegStart = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);
    expect(
      Array.from(base64ToBytes(jpegStart.toString('base64')) ?? [])
    ).toEqual(Array.from(jpegStart));
  });

  it('tolerates whitespace, padding and a data: prefix', () => {
    const original = Buffer.from('photo payload bytes');
    const encoded = original.toString('base64');

    expect(
      Buffer.from(
        base64ToBytes(`${encoded.slice(0, 4)}\n  ${encoded.slice(4)}`) ?? []
      ).equals(original)
    ).toBe(true);
    expect(
      Buffer.from(
        base64ToBytes(`data:image/jpeg;base64,${encoded}`) ?? []
      ).equals(original)
    ).toBe(true);
  });

  it('returns null for nothing to decode', () => {
    expect(base64ToBytes('')).toBeNull();
    expect(base64ToBytes('====')).toBeNull();
  });
});

describe('decodeJpeg', () => {
  it('decodes a real JPEG to RGBA', () => {
    const data = Buffer.alloc(8 * 6 * 4, 200);
    const encoded = Buffer.from(
      jpeg.encode({ data, width: 8, height: 6 }, 90).data
    ).toString('base64');

    const image = decodeJpeg(encoded);

    expect(image).toMatchObject({ width: 8, height: 6 });
    expect(image?.data.length).toBe(8 * 6 * 4);
  });

  it('returns null for no data and throws for data that is not a JPEG', () => {
    expect(decodeJpeg('')).toBeNull();
    expect(() =>
      decodeJpeg(Buffer.from('not a jpeg').toString('base64'))
    ).toThrow();
  });
});
