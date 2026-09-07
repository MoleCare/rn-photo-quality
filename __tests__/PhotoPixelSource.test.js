/* eslint-env jest, node */

// The decode pipeline needs a native image editor and the filesystem; only the
// pure byte conversion is exercised here. The metrics it feeds are verified
// against real photographs in ImageQualityMetrics.
jest.mock('react-native', () => ({Platform: {OS: 'ios'}}));
jest.mock('@react-native-community/image-editor', () => ({
  cropImage: jest.fn(),
}));
jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/tmp',
  writeFile: jest.fn(),
  readFile: jest.fn(),
  unlink: jest.fn(() => Promise.resolve()),
}));

import PhotoPixelSource from '../src/PhotoPixelSource';

describe('base64ToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    const original = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x01, 0xfe, 0x42]);

    const bytes = PhotoPixelSource.base64ToBytes(original.toString('base64'));

    expect(Buffer.from(bytes).equals(original)).toBe(true);
  });

  it('round-trips a payload the size of an analysis image', () => {
    const original = Buffer.alloc(60000);
    for (let i = 0; i < original.length; i++) {
      original[i] = (i * 31) % 256;
    }

    const bytes = PhotoPixelSource.base64ToBytes(original.toString('base64'));

    expect(bytes.length).toBe(original.length);
    expect(Buffer.from(bytes).equals(original)).toBe(true);
  });

  it('reproduces a real JPEG header exactly', () => {
    // Wrong bytes here would not throw — jpeg-js would decode garbage and the
    // metrics would describe an image nobody took.
    const jpegStart = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);

    const bytes = PhotoPixelSource.base64ToBytes(jpegStart.toString('base64'));

    expect(Array.from(bytes)).toEqual(Array.from(jpegStart));
  });

  it('tolerates whitespace and padding', () => {
    const original = Buffer.from('photo payload bytes');
    const encoded = original.toString('base64');

    const spaced = PhotoPixelSource.base64ToBytes(
      encoded.slice(0, 4) + '\n  ' + encoded.slice(4),
    );

    expect(Buffer.from(spaced).equals(original)).toBe(true);
  });

  it('returns null for nothing to decode', () => {
    expect(PhotoPixelSource.base64ToBytes('')).toBeNull();
    expect(PhotoPixelSource.base64ToBytes(null)).toBeNull();
  });
});

describe('decode', () => {
  it('returns null rather than throwing when there is no image', async () => {
    // A photo that cannot be analysed must not be treated as a bad photo.
    await expect(PhotoPixelSource.decode(null)).resolves.toBeNull();
    await expect(PhotoPixelSource.decode('')).resolves.toBeNull();
    await expect(PhotoPixelSource.decode(123)).resolves.toBeNull();
  });
});
