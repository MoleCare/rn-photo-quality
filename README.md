# @molecare/photo-quality

On-device photo quality checks for React Native and Expo. Before a photo is
kept, tell the person if it is too dark, washed out or unevenly lit, record how
it was taken, and grade whether two photos were taken in comparable
conditions.

Everything runs on the device. No network, no uploads, no telemetry, no state.
TypeScript, with types included, and no native code of its own.

> **Not a medical device.** This package measures photos, never what they
> show. It makes no clinical claim, and its thresholds have not been clinically
> validated. Do not use its output for diagnosis or treatment decisions.

Made by [MoleCare](https://www.molecare.co.uk), where it checks skin photos
before they are compared over time. It works for any close-up photo you want
to keep consistent.

## Install

Use your project's package manager; they all install from the npm registry.

```bash
npm install @molecare/photo-quality
yarn add @molecare/photo-quality
pnpm add @molecare/photo-quality
bun add @molecare/photo-quality
npx expo install @molecare/photo-quality
```

The package imports no native module. To measure pixels, it needs a way to
turn a photo into a small JPEG. You pass that in (see below), using the image
and file libraries your app already has.

### Works with

|                  |                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------- |
| React Native     | Metro, with or without package `exports`; any image and file library                |
| Expo             | `expo-image-manipulator` or any other resizer, passed in as a loader                |
| Package managers | npm, Yarn 1, Yarn 4 (Plug'n'Play and `node_modules`), pnpm, Bun, each checked in CI |
| Node             | `require` and `import`                                                              |
| Jest             | default settings; no mocks needed                                                   |
| TypeScript       | `moduleResolution` `bundler`, `node16` and `nodenext`                               |

## Check a photo

### Bare React Native

With `@react-native-community/image-editor` (2.x, 3.x or 4.x) and
`react-native-fs` (or `@dr.pogodin/react-native-fs`):

```ts
import { Image, Platform } from 'react-native';
import ImageEditor from '@react-native-community/image-editor';
import RNFS from 'react-native-fs';
import {
  createPhotoAnalyzer,
  imageEditorJpegLoader,
} from '@molecare/photo-quality';

const analyzer = createPhotoAnalyzer({
  loadAnalysisJpeg: imageEditorJpegLoader({
    imageEditor: ImageEditor,
    fileSystem: RNFS,
    getImageSize: (uri) =>
      new Promise((resolve, reject) =>
        Image.getSize(
          uri,
          (width, height) => resolve({ width, height }),
          reject
        )
      ),
    platform: Platform.OS,
  }),
});

// One asset from react-native-image-picker (or any picker).
const report = await analyzer.analyze({
  uri: asset.uri,
  width: asset.width,
  height: asset.height,
  fileSize: asset.fileSize,
});
```

Pass `uri` when you have it: the photo is resized where it is, and only the
small analysis image is read into JavaScript. `base64` also works; it is
written to a temporary file first. Every temporary file is deleted before
`analyze` returns.

### Expo

Any function that returns a base64 JPEG of the photo resampled to `size` ×
`size` works as a loader, for example with `expo-image-manipulator`:

```ts
const analyzer = createPhotoAnalyzer({
  loadAnalysisJpeg: async (photo, size) => {
    const result = await manipulateAsync(
      photo.uri,
      [{ resize: { width: size, height: size } }],
      { base64: true, format: SaveFormat.JPEG }
    );
    return result.base64 ?? '';
  },
});
```

### The report

```ts
const report = await analyzer.analyze(photo);
// {ok, warningTypes, warnings, critical, measured, measurementFailure, metrics}

if (!report.ok) {
  // warningTypes are stable codes to map to your own text:
  // 'no_image_data', 'low_resolution', 'small_file', 'too_dark', 'too_bright', 'uneven_lighting'.
  // warnings is the text for the same list (yours from `messages`, or English).
}
if (report.critical) {
  // No photo, or both too few pixels and too small a file: not usable.
}
if (!report.measured) {
  // report.measurementFailure.reason: 'no_loader', 'load_failed' (with cause) or 'decode_failed'.
  // The pixels could not be read. That is not a bad photo.
}
```

`analyze` only rejects for a programming error (a photo that is not an
object). A photo that cannot be measured is a result, never an exception.

Sharpness is measured and reported in `metrics`, but not used as a warning:
its scale depends on the camera and needs a real capture set to calibrate.

Measuring decodes the analysis image in JavaScript. At the default 512 × 512
that is tens of milliseconds even on a fast engine, and slower under Hermes, so
show a short "checking" state while it runs, or lower `analysisSize`. Scores
measured at different sizes are not comparable.

## Record how a photo was taken

Store the record next to the photo. It is what makes a later comparison
possible, and it cannot be recovered afterwards.

```ts
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import { CAPTURE_SOURCE, buildCaptureMetadata } from '@molecare/photo-quality';

const capture = buildCaptureMetadata(asset, {
  source: CAPTURE_SOURCE.CAMERA, // or LIBRARY
  pickerOptions: { maxWidth: 2048, maxHeight: 2048, quality: 0.85 },
  device: {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    model: DeviceInfo.getModel(),
    appVersion: DeviceInfo.getVersion(),
    appBuild: DeviceInfo.getBuildNumber(),
  },
});
capture.quality = { measured: report.measured, ...report.metrics }; // in your stored copy
```

`buildCaptureMetadata` never throws and reads nothing from the device itself.
Leave `device` out to record no device details at all. Records carry
`v: 1`; `isCaptureMetadata(value)` tells a record from a photo stored before
you recorded one.

## Compare two photos

```ts
import {
  assessComparability,
  explainComparabilityReason,
  summariseComparability,
} from '@molecare/photo-quality';

const result = assessComparability(photoA.capture, photoB.capture);
// {level: 'good' | 'fair' | 'poor' | 'unknown', reasons, comparable}

summariseComparability(result.level);
result.reasons.map((reason) => explainComparabilityReason(reason));
```

Different devices, different picker settings, or a photo from the library
make a comparison `poor`. A large exposure difference, uneven lighting or an
unmeasured photo make it `fair`. A missing record makes it `unknown`. The text
never says whether the subject changed.

## No state, no global settings

Nothing is kept between calls and there is no global configuration. Settings
belong to the analyzer you create, or go with the call:

| Threshold                     | Default | Meaning                                                |
| ----------------------------- | ------- | ------------------------------------------------------ |
| `minWidth`, `minHeight`       | 300     | Warn below this many pixels                            |
| `minFileSizeBytes`            | 7500    | Warn below this file size                              |
| `clippedDarkLimit`            | 0.15    | Warn "too dark" above this fraction of crushed pixels  |
| `clippedBrightLimit`          | 0.15    | Warn "too bright" above this fraction of blown pixels  |
| `unevenLimit`                 | 0.25    | Warn "uneven lighting", and flag it in comparisons     |
| `sharpnessUnreliableClipping` | 0.1     | Sharpness is unreliable above this clipped fraction    |
| `analysisSize`                | 512     | Pixels square the photo is measured at                 |
| `darkLevel`, `brightLevel`    | 4, 251  | Luma counted as crushed or blown                       |
| `exposureDiffLimit`           | 0.25    | Relative mean-luma difference that makes photos differ |

```ts
const analyzer = createPhotoAnalyzer({
  loadAnalysisJpeg,
  thresholds: { minWidth: 600 },
  messages: { too_dark: t('photo.tooDark') },
});
assessComparability(a, b, { exposureDiffLimit: 0.3 });
explainComparabilityReason(reason, { from_library: t('photo.fromLibrary') });
```

An unknown or invalid threshold or message throws a `TypeError` rather than
being ignored.

The pixel measurements are also exported on their own (`measurePixels`,
`luma`, `sharpness`, `exposure`, `evenness`, `decodeJpeg`, `base64ToBytes`)
for your own analysis.

## Privacy

- Photos are processed on the device. With a `uri`, no copy of the photo is
  written; the small analysis image is written to the cache folder and deleted
  before `analyze` returns. With `base64`, a temporary copy is written and
  deleted the same way.
- The capture record holds only what your app passes: the device model name,
  platform, OS and app version, and the picker timestamp. It never reads EXIF,
  location or a device identifier. A model name plus a timestamp stored next to
  a health photo can still help identify someone, so treat the record as
  personal data, and leave `device` out if you don't need it.
- Nothing is stored by the package.

## Upgrading from 0.x

See [CHANGELOG.md](CHANGELOG.md): the classes became functions, native modules
are passed in, and the device is no longer read by the package.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Please never attach a real photo of a
person's skin to an issue or pull request.

Security problems: see [SECURITY.md](SECURITY.md).

## License

Apache-2.0 © MoleCare LTD
