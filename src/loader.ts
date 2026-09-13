/**
 * Getting the analysis image: the photo resampled to a small square JPEG.
 *
 * The package imports no native module. The app passes in its own, which keeps
 * the package usable with any file-system and image library (bare React
 * Native or Expo) and testable without mocks.
 */
import { stripDataUrl } from './jpeg';

/** A photo to analyse: a file URI, base64 JPEG data, or both. */
export interface PhotoSource {
  /** `file://` URI or path of the photo, as image pickers return it. */
  readonly uri?: string;
  /** Base64 JPEG data, with or without a `data:` prefix. */
  readonly base64?: string;
  readonly width?: number;
  readonly height?: number;
  /** File size in bytes, when the picker reports it. */
  readonly fileSize?: number;
}

/**
 * Returns base64 JPEG data of `photo` resampled to `size` × `size` pixels.
 * It may throw or reject; the analyzer reports that as "not measured".
 */
export type AnalysisJpegLoader = (
  photo: PhotoSource,
  size: number
) => Promise<string>;

/** The part of @react-native-community/image-editor (2.x, 3.x or 4.x) used. */
export interface ImageEditorModule {
  cropImage(
    uri: string,
    cropData: {
      offset: { x: number; y: number };
      size: { width: number; height: number };
      displaySize?: { width: number; height: number };
    }
  ): Promise<string | { uri: string }>;
}

/** The part of react-native-fs (or @dr.pogodin/react-native-fs) used. */
export interface FileSystemModule {
  readonly CachesDirectoryPath: string;
  writeFile(
    path: string,
    contents: string,
    encoding: 'base64'
  ): Promise<unknown>;
  readFile(path: string, encoding: 'base64'): Promise<string>;
  unlink(path: string): Promise<unknown>;
}

export interface ImageEditorLoaderModules {
  readonly imageEditor: ImageEditorModule;
  readonly fileSystem: FileSystemModule;
  /** Width and height of an image at a URI, for example from `Image.getSize`. */
  readonly getImageSize: (
    uri: string
  ) => Promise<{ width: number; height: number }>;
  /** `Platform.OS`. Android needs a `file://` URI for a local path. */
  readonly platform: string;
}

const deleteQuietly = async (
  fileSystem: FileSystemModule,
  path: string | null
): Promise<void> => {
  if (path !== null) {
    await fileSystem.unlink(path).catch(() => undefined);
  }
};

/**
 * A loader built on @react-native-community/image-editor and a
 * react-native-fs-compatible file system.
 *
 * Given a `uri`, it crops the photo in place and writes nothing but the small
 * analysis image. Given only `base64`, it writes a temporary copy first. Every
 * temporary file is deleted before the promise settles.
 */
export function imageEditorJpegLoader(
  modules: ImageEditorLoaderModules
): AnalysisJpegLoader {
  const { imageEditor, fileSystem, getImageSize, platform } = modules;

  return async (photo, size) => {
    let sourcePath: string | null = null;
    let resizedPath: string | null = null;
    try {
      let uri = photo.uri;
      if (!uri) {
        if (!photo.base64) {
          throw new Error('The photo has neither a uri nor base64 data');
        }
        // Random suffix: two photos analysed in the same millisecond must not
        // share (and delete) each other's file.
        const suffix = `${String(Date.now())}_${Math.random().toString(36).slice(2, 10)}`;
        sourcePath = `${fileSystem.CachesDirectoryPath}/qa_src_${suffix}.jpg`;
        await fileSystem.writeFile(
          sourcePath,
          stripDataUrl(photo.base64),
          'base64'
        );
        uri = platform === 'android' ? `file://${sourcePath}` : sourcePath;
      }

      const known =
        photo.width !== undefined &&
        photo.height !== undefined &&
        photo.width > 0 &&
        photo.height > 0
          ? { width: photo.width, height: photo.height }
          : await getImageSize(uri);
      if (!(known.width > 0 && known.height > 0)) {
        throw new Error('Could not read the size of the photo');
      }

      // Square on purpose: every analysis image has the same pixel count.
      const cropped = await imageEditor.cropImage(uri, {
        offset: { x: 0, y: 0 },
        size: { width: known.width, height: known.height },
        displaySize: { width: size, height: size },
      });
      // image-editor 2.x resolves a URI string; 3.x and 4.x resolve {uri, ...}.
      const croppedUri = typeof cropped === 'string' ? cropped : cropped.uri;
      resizedPath = croppedUri.replace(/^file:\/\//, '');
      return await fileSystem.readFile(resizedPath, 'base64');
    } finally {
      // Awaited, so no copy of the photo outlives the call.
      await deleteQuietly(fileSystem, sourcePath);
      await deleteQuietly(fileSystem, resizedPath);
    }
  };
}
