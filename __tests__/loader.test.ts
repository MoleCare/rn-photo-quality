import {
  imageEditorJpegLoader,
  type FileSystemModule,
  type ImageEditorModule,
} from '../src';

function modules(platform = 'ios') {
  const fileSystem = {
    CachesDirectoryPath: '/caches',
    writeFile: jest.fn<Promise<void>, [string, string, 'base64']>(() =>
      Promise.resolve()
    ),
    readFile: jest.fn<Promise<string>, [string, 'base64']>(() =>
      Promise.resolve('UkVTSVpFRA==')
    ),
    unlink: jest.fn<Promise<void>, [string]>(() => Promise.resolve()),
  } satisfies FileSystemModule;
  const imageEditor = {
    cropImage: jest.fn<
      ReturnType<ImageEditorModule['cropImage']>,
      Parameters<ImageEditorModule['cropImage']>
    >(() => Promise.resolve({ uri: 'file:///caches/resized.jpg' })),
  };
  const getImageSize = jest.fn(() =>
    Promise.resolve({ width: 4000, height: 3000 })
  );
  return {
    fileSystem,
    imageEditor,
    getImageSize,
    load: imageEditorJpegLoader({
      fileSystem,
      imageEditor,
      getImageSize,
      platform,
    }),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a photo with a uri', () => {
  it('resizes the photo in place and writes no copy of it', async () => {
    const m = modules();

    const data = await m.load(
      { uri: 'file:///photos/1.jpg', width: 2048, height: 1536 },
      512
    );

    expect(data).toBe('UkVTSVpFRA==');
    expect(m.fileSystem.writeFile).not.toHaveBeenCalled();
    expect(m.getImageSize).not.toHaveBeenCalled();
    expect(m.imageEditor.cropImage).toHaveBeenCalledWith(
      'file:///photos/1.jpg',
      {
        offset: { x: 0, y: 0 },
        size: { width: 2048, height: 1536 },
        displaySize: { width: 512, height: 512 },
      }
    );
    // 3.x and 4.x resolve {uri, ...}; the resized file is read, then deleted.
    expect(m.fileSystem.readFile).toHaveBeenCalledWith(
      '/caches/resized.jpg',
      'base64'
    );
    expect(m.fileSystem.unlink.mock.calls).toEqual([['/caches/resized.jpg']]);
  });

  it('reads the size when the picker did not report it', async () => {
    const m = modules();

    await m.load({ uri: 'file:///photos/1.jpg' }, 256);

    expect(m.getImageSize).toHaveBeenCalledWith('file:///photos/1.jpg');
    expect(m.imageEditor.cropImage.mock.calls[0]?.[1].size).toEqual({
      width: 4000,
      height: 3000,
    });
  });
});

describe('a photo given as base64', () => {
  it('writes a temporary copy, reads the 2.x string result, and deletes both files', async () => {
    const m = modules('ios');
    m.imageEditor.cropImage.mockResolvedValue('file:///caches/resized2.jpg');

    await m.load({ base64: 'data:image/jpeg;base64,QUJD' }, 512);

    const [sourcePath, contents] = m.fileSystem.writeFile.mock.calls[0] ?? [];
    expect(sourcePath).toMatch(/^\/caches\/qa_src_\d+_[a-z0-9]+\.jpg$/);
    expect(contents).toBe('QUJD'); // the data: prefix is not written
    // iOS takes the path as it is.
    expect(m.getImageSize).toHaveBeenCalledWith(sourcePath);
    expect(m.fileSystem.unlink.mock.calls.map(([p]) => p)).toEqual([
      sourcePath,
      '/caches/resized2.jpg',
    ]);
  });

  it('gives Android a file:// URI for the temporary copy', async () => {
    const m = modules('android');

    await m.load({ base64: 'QUJD', width: 10, height: 10 }, 512);

    const [sourcePath] = m.fileSystem.writeFile.mock.calls[0] ?? [];
    expect(m.imageEditor.cropImage.mock.calls[0]?.[0]).toBe(
      `file://${String(sourcePath)}`
    );
  });

  it('gives photos analysed in the same millisecond their own files', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1757750000000);
    const m = modules();

    await Promise.all([
      m.load({ base64: 'QUJD' }, 512),
      m.load({ base64: 'QUJD' }, 512),
    ]);

    const written = m.fileSystem.writeFile.mock.calls.map(([p]) => p);
    expect(new Set(written).size).toBe(2);
  });
});

describe('failures', () => {
  it('rejects a photo with neither uri nor base64, writing nothing', async () => {
    const m = modules();

    await expect(m.load({}, 512)).rejects.toThrow(/neither a uri nor base64/);
    expect(m.fileSystem.writeFile).not.toHaveBeenCalled();
    expect(m.fileSystem.unlink).not.toHaveBeenCalled();
  });

  it('rejects when the size cannot be read, and still deletes the copy', async () => {
    const m = modules();
    m.getImageSize.mockResolvedValue({ width: 0, height: 0 });

    await expect(m.load({ base64: 'QUJD' }, 512)).rejects.toThrow(/size/);
    expect(m.fileSystem.unlink).toHaveBeenCalledTimes(1);
    expect(m.imageEditor.cropImage).not.toHaveBeenCalled();
  });

  it('deletes every temporary file even when reading fails, and ignores a failed delete', async () => {
    const m = modules();
    m.fileSystem.readFile.mockRejectedValue(new Error('read failed'));
    m.fileSystem.unlink.mockRejectedValue(new Error('already gone'));

    await expect(m.load({ base64: 'QUJD' }, 512)).rejects.toThrow(
      'read failed'
    );
    expect(m.fileSystem.unlink).toHaveBeenCalledTimes(2);
  });
});
