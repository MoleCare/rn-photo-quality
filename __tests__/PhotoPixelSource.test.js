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

describe('decode with each image-editor version', () => {
  const ImageEditor = require('@react-native-community/image-editor');
  const RNFS = require('react-native-fs');
  const jpeg = require('jpeg-js');

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(PhotoPixelSource, '_imageSize')
      .mockResolvedValue({width: 1000, height: 1000});
    RNFS.readFile.mockResolvedValue(Buffer.from([1, 2, 3, 4]).toString('base64'));
    jest
      .spyOn(jpeg, 'decode')
      .mockReturnValue({data: new Uint8Array(4), width: 1, height: 1});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the resized file from a 2.x string result', async () => {
    ImageEditor.cropImage.mockResolvedValue('file:///tmp/resized.jpg');

    const pixels = await PhotoPixelSource.decode('AAAA');

    expect(pixels).toEqual({data: new Uint8Array(4), width: 1, height: 1});
    expect(RNFS.readFile).toHaveBeenCalledWith('/tmp/resized.jpg', 'base64');
  });

  it('reads the resized file from a 4.x object result', async () => {
    // 4.x resolves {uri, path, ...}; calling .replace on it used to throw, and
    // every photo was reported as "not measured".
    ImageEditor.cropImage.mockResolvedValue({
      uri: 'file:///tmp/resized4.jpg',
      path: '/tmp/resized4.jpg',
      width: 256,
      height: 256,
    });

    const pixels = await PhotoPixelSource.decode('AAAA');

    expect(pixels).not.toBeNull();
    expect(RNFS.readFile).toHaveBeenCalledWith('/tmp/resized4.jpg', 'base64');
  });

  it('deletes both temporary files before returning', async () => {
    ImageEditor.cropImage.mockResolvedValue('file:///tmp/resized.jpg');

    await PhotoPixelSource.decode('AAAA');

    const deleted = RNFS.unlink.mock.calls.map(([path]) => path);
    expect(deleted).toContain('/tmp/resized.jpg');
    expect(deleted.some(path => path.startsWith('/tmp/qa_src_'))).toBe(true);
  });

  it('gives photos analysed in the same millisecond their own temp files', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1757750000000);
    ImageEditor.cropImage.mockResolvedValue('file:///tmp/resized.jpg');

    await Promise.all([
      PhotoPixelSource.decode('AAAA'),
      PhotoPixelSource.decode('AAAA'),
    ]);

    const written = RNFS.writeFile.mock.calls.map(([path]) => path);
    expect(written).toHaveLength(2);
    expect(written[0]).not.toBe(written[1]);
  });
});
