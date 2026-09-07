# @molecare/photo-quality

Local photo quality metrics (clipping, evenness, sharpness), capture provenance,
and pairwise comparability for React Native clinical photography.

**Status:** private package under the [MoleCare](https://github.com/MoleCare) org. Not published to npm yet.

## Features

- Decode JPEG payloads to pixels at a fixed analysis size (`PhotoPixelSource`)
- Laplacian sharpness, exposure clipping, illumination evenness (`ImageQualityMetrics`)
- Gateable capture warnings with configurable thresholds (`ImageQualityAnalyzer`)
- Capture provenance records (`CaptureMetadata`)
- Pairwise comparability grading (`PhotoComparability`)

## Install

```bash
npm install @molecare/photo-quality jpeg-js react-native-fs @react-native-community/image-editor react-native-device-info
```

## Configure

Defaults match the historical MoleCare phone gates. Override as needed:

```js
import {
  configure,
  ImageQualityAnalyzer,
  CaptureMetadata,
  PhotoComparability,
} from '@molecare/photo-quality';

configure({
  minWidth: 300,
  minHeight: 300,
  unevenLimit: 0.25,
  messages: {
    too_dark: 'Custom dark-photo tip…',
  },
});

const result = await ImageQualityAnalyzer.analyze(pickerAsset);
```

## What this package deliberately omits

- No backend / API clients
- No `PhotoValidationService` or remote validation
- No Firebase, CDN hosts, or patient media

## License

Apache-2.0 © MoleCare LTD
