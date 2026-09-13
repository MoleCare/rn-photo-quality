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
import {ImageQualityAnalyzer} from '@molecare/photo-quality';

const result = await ImageQualityAnalyzer.analyze(pickerAsset);
// result: {ok, warningTypes, warnings, critical, measured, metrics}
if (!result.ok) {
  // warningTypes are stable codes ('too_dark', 'small_file', ...) to map to
  // your own text; warnings is the built-in English for the same list.
}
if (!result.measured) {
  // The pixels could not be read. That is not a bad photo.
}
```

Sharpness is measured and reported, but not used as a warning by default: its
scale depends on the camera and needs a real capture set to calibrate.

## No state, no global settings

Nothing is kept between calls and there is no global configuration, so two
parts of an app can use different settings without affecting each other.
Settings go with the call, over the defaults in `DEFAULT_OPTIONS`:

```js
import {ImageQualityAnalyzer, PhotoComparability, DEFAULT_OPTIONS} from '@molecare/photo-quality';

const QUALITY = {
  ...DEFAULT_OPTIONS,
  minWidth: 600,
  messages: {too_dark: t('photo.tooDark')},
};

await ImageQualityAnalyzer.analyze(pickerAsset, QUALITY);
PhotoComparability.assess(entryA, entryB, {exposureDiffLimit: 0.3});
PhotoComparability.explain(reason, {from_library: t('photo.fromLibrary')});
PhotoComparability.summarise(level, {good: t('photo.good')});
```

An unknown option, or a value that is not a non-negative number, throws a
`TypeError` rather than being ignored.

`CaptureMetadata.build` takes the device details and capture time from your
app when you pass them, and only reads them itself when you don't:

```js
CaptureMetadata.build(asset, {
  source: CaptureMetadata.SOURCE.CAMERA,
  pickerOptions,
  device: null,          // record no device details at all
  capturedAt: new Date(), // or your own clock
});
```

## Privacy

- Photos are processed on the device. Decoding writes a temporary copy to the
  app's cache directory and deletes it when done.
- `CaptureMetadata` records the device **model** name, platform and OS version,
  app version and the picker timestamp. It does not read EXIF, GPS location or
  any unique device identifier. A model name plus a timestamp stored next to a
  health photo can still help identify someone, so treat the record as
  personal data. Pass `device: null` to record none, or pass only the fields
  you want.
- Nothing is stored by the package. Where a record or a result is kept is up
  to your app.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Please never attach a real photo of a
person's skin to an issue or pull request.

Security problems: see [SECURITY.md](SECURITY.md).

## License

Apache-2.0 © MoleCare LTD
