# Changelog

All notable changes to this package are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## 1.0.0

First public release. Breaking changes from 0.x, which was never published.

### Changed

- Written in TypeScript and published as built code: CommonJS and ES modules,
  each with its own type declarations, behind an `exports` map. It loads from
  Metro, Node (`require` and `import`), Jest with default settings and
  TypeScript.
- **No native module is imported by the package.** The analyzer takes a
  `loadAnalysisJpeg` function, and `imageEditorJpegLoader` builds one from the
  `@react-native-community/image-editor`, `react-native-fs` (or
  `@dr.pogodin/react-native-fs`) and `Image.getSize` your app passes in. Expo
  apps can pass a loader built on `expo-image-manipulator`. The peer
  dependencies on `react-native`, `react-native-fs`, `image-editor` and
  `react-native-device-info` are gone; `jpeg-js` is the only dependency.
- **A photo can be analysed from its file URI.** With a `uri`, no copy of the
  photo is written and its base64 never has to be in JavaScript memory; only
  the small analysis image is read. `base64` still works.
- Named functions replace the classes of statics:
  - `ImageQualityAnalyzer.analyze` → `createPhotoAnalyzer({loadAnalysisJpeg, thresholds, messages}).analyze(photo)`
  - `ImageQualityMetrics.*` → `measurePixels`, `luma`, `sharpness`, `exposure`, `evenness`
  - `PhotoPixelSource.base64ToBytes` → `base64ToBytes`; decoding is `decodeJpeg`
  - `CaptureMetadata.build` / `isPresent` → `buildCaptureMetadata` / `isCaptureMetadata`
  - `PhotoComparability.assess` / `explain` / `summarise` → `assessComparability` (takes the two capture records) / `explainComparabilityReason` / `summariseComparability`
- `buildCaptureMetadata` no longer reads the device: pass `device` from your
  app (for example from react-native-device-info). Without it, device fields
  are `null`. The record is still version 1 with the same fields, so stored
  records stay readable and comparable.
- Quality reports add `measurementFailure` (`no_loader`, `load_failed` with
  its cause, or `decode_failed`) next to `measured`. The stored `metrics`
  fields are unchanged.
- The small-file check uses bytes: `minFileSizeBytes` (7,500) replaces
  `minBase64Length` (10,000 characters, the same size). It uses `fileSize`
  when given, otherwise the size of `base64`.
- An unknown or invalid threshold or message, or a loader that is not a
  function, throws a `TypeError`.

### Removed

- Warning types that were never produced: `blurry`, `color_cast`,
  `inconsistent_brightness`, `inconsistent_variance`.
- `CaptureMetadata.isComparable` (use `assessComparability`), `DEFAULT_OPTIONS`
  (now `DEFAULT_THRESHOLDS`), and the default export.
