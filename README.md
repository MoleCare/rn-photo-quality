# @molecare/photo-quality

On-device photo quality checks for React Native. Before a photo is kept, tell
the person if it is too dark, washed out, unevenly lit or blurry, record how it
was taken, and grade whether two photos were taken in comparable conditions.

Everything runs on the device. No network, no uploads, no telemetry.

> **Not a medical device.** This package measures photos, never what they
> show. It makes no clinical claim, and its thresholds have not been clinically
> validated. Do not use its output for diagnosis or treatment decisions.

Made by [MoleCare](https://www.molecare.co.uk), where it checks skin photos
before they are compared over time. It works for any close-up photo you want
to keep consistent.

## Install

```bash
npm install @molecare/photo-quality react-native-fs @react-native-community/image-editor react-native-device-info
```

Works with `@react-native-community/image-editor` 2.x, 3.x and 4.x.

## What it gives you

| | |
|---|---|
| `ImageQualityAnalyzer.analyze(asset)` | Resolution and file-size checks, then pixel measurements: exposure clipping, illumination evenness and sharpness. Returns warnings with configurable thresholds and messages. |
| `ImageQualityMetrics` | The measurements themselves, on decoded RGBA pixels. |
| `PhotoPixelSource.decode(base64)` | Resamples a JPEG to a fixed analysis size and decodes it. Returns `null` when a photo cannot be measured, so "could not measure" is never mistaken for "bad photo". |
| `CaptureMetadata` | A provenance record for a capture: image size, picker settings, platform, OS version, device model, app version. |
| `PhotoComparability` | Grades whether two photos were taken in comparable conditions. |

## Use

```js
import {configure, ImageQualityAnalyzer} from '@molecare/photo-quality';

configure({
  minWidth: 300,
  minHeight: 300,
  unevenLimit: 0.25,
  messages: {too_dark: 'A little more light, please.'},
});

const result = await ImageQualityAnalyzer.analyze(pickerAsset);
// result: {ok, warnings, critical, measured, metrics}
if (!result.ok) {
  // result.warnings is a list of messages; show them and let the person
  // retake or keep the photo.
}
if (!result.measured) {
  // The pixels could not be read. That is not a bad photo.
}
```

Sharpness is measured and reported, but not used as a warning by default: its
scale depends on the camera and needs a real capture set to calibrate.

## Privacy

- Photos are processed on the device. Decoding writes a temporary copy to the
  app's cache directory and deletes it when done.
- `CaptureMetadata` records the device **model** name, platform and OS version,
  app version and the picker timestamp. It does not read EXIF, GPS location or
  any unique device identifier. A model name plus a timestamp stored next to a
  health photo can still help identify someone, so treat the record as
  personal data.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Please never attach a real photo of a
person's skin to an issue or pull request.

Security problems: see [SECURITY.md](SECURITY.md).

## License

Apache-2.0 © MoleCare LTD
