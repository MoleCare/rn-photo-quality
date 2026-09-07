/**
 * Runtime configuration for @molecare/photo-quality.
 * Thresholds are injectable so apps can tune gates without forking.
 */

const DEFAULTS = Object.freeze({
  minWidth: 300,
  minHeight: 300,
  minBase64Length: 10000,
  clippedDarkLimit: 0.15,
  clippedBrightLimit: 0.15,
  unevenLimit: 0.25,
  sharpnessUnreliableClipping: 0.1,
  analysisSize: 512,
  darkLevel: 4,
  brightLevel: 251,
  exposureDiffLimit: 0.25,
  /** Optional message overrides keyed by WARNING_TYPES / REASON values */
  messages: null,
});

let config = {...DEFAULTS};

export function configure(partial = {}) {
  config = {
    ...config,
    ...partial,
    messages:
      partial.messages !== undefined
        ? {...(config.messages || {}), ...(partial.messages || {})}
        : config.messages,
  };
  return getConfig();
}

export function getConfig() {
  return {...config, messages: config.messages ? {...config.messages} : null};
}

export function resetConfig() {
  config = {...DEFAULTS};
}
