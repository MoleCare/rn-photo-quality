/**
 * An analyzer for Expo, in one file.
 *
 * The package needs one thing from the app: a function that returns the photo
 * as a small base64 JPEG. expo-image-manipulator does that.
 */
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { createPhotoAnalyzer } from '@molecare/photo-quality';

export const analyzer = createPhotoAnalyzer({
  loadAnalysisJpeg: async (photo, size) => {
    if (!photo.uri) return '';
    const small = await manipulateAsync(
      photo.uri,
      [{ resize: { width: size, height: size } }],
      {
        base64: true,
        format: SaveFormat.JPEG,
      }
    );
    return small.base64 ?? '';
  },
  // Your own words, or translations, keyed by warning type.
  messages: {
    too_dark: 'This photo looks dark. Try somewhere brighter.',
    uneven_lighting: 'The light is uneven. Try facing a window.',
  },
});
