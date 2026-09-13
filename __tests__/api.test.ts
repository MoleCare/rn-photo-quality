import * as fs from 'node:fs';
import * as path from 'node:path';

import * as api from '../src';

const srcDir = path.join(__dirname, '..', 'src');
const sources = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, fs.readFileSync(path.join(srcDir, f), 'utf8')] as const);

describe('the public API', () => {
  it('has no classes of statics, no global configuration and no default export', () => {
    for (const gone of [
      'default',
      'ImageQualityAnalyzer',
      'ImageQualityMetrics',
      'PhotoPixelSource',
      'CaptureMetadata',
      'PhotoComparability',
      'configure',
      'getConfig',
      'resetConfig',
      'DEFAULT_OPTIONS',
    ]) {
      expect(api).not.toHaveProperty(gone);
    }
  });

  it('freezes its shared constants', () => {
    for (const frozen of [
      api.DEFAULT_THRESHOLDS,
      api.WARNING_TYPE,
      api.COMPARABILITY_LEVEL,
      api.COMPARABILITY_REASON,
      api.CAPTURE_SOURCE,
    ]) {
      expect(Object.isFrozen(frozen)).toBe(true);
    }
  });

  it('has no module-level variables in its source', () => {
    for (const [file, source] of sources) {
      expect([file, /^(export\s+)?(let|var)\s/m.test(source)]).toEqual([
        file,
        false,
      ]);
    }
  });

  it('imports no native module: the app passes them in', () => {
    // So the package works with any image and file-system library, including
    // Expo's, and loads in plain Node.
    const native =
      /from\s+['"](react-native[^'"]*|@react-native-community\/[^'"]+|expo-[^'"]+)['"]|require\(\s*['"](react-native|@react-native-community|expo-)/;
    for (const [file, source] of sources) {
      expect([file, native.test(source)]).toEqual([file, false]);
    }
  });
});
