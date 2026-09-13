/**
 * Constants and option handling only. Nothing in this package keeps state:
 * settings are passed to each call, and these are the values used when a
 * caller passes none.
 */

export const DEFAULT_OPTIONS = Object.freeze({
  minWidth: 300,
  minHeight: 300,
  minBase64Length: 10000,
  clippedDarkLimit: 0.15,
  clippedBrightLimit: 0.15,
  unevenLimit: 0.25,
  sharpnessUnreliableClipping: 0.1,
  // Changing it invalidates every threshold and every score already recorded.
  analysisSize: 512,
  darkLevel: 4,
  brightLevel: 251,
  exposureDiffLimit: 0.25,
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Per-call options over the defaults. A mistyped or meaningless option throws
 * rather than being ignored. `messages` (text keyed by warning type, reason or
 * level) is the one option that is not a number.
 *
 * @param {Object} [options]
 * @returns {Object}
 * @throws {TypeError}
 */
export function resolveOptions(options) {
  if (options === undefined || options === null) {
    return DEFAULT_OPTIONS;
  }
  if (typeof options !== 'object') {
    throw new TypeError('photo-quality options must be an object');
  }
  for (const key of Object.keys(options)) {
    const value = options[key];
    if (key === 'messages') {
      if (value !== undefined && value !== null && typeof value !== 'object') {
        throw new TypeError('photo-quality option "messages" must be an object');
      }
      continue;
    }
    if (!hasOwn(DEFAULT_OPTIONS, key)) {
      throw new TypeError(`Unknown photo-quality option "${key}"`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`photo-quality option "${key}" must be a non-negative number`);
    }
  }
  if (hasOwn(options, 'analysisSize') && !(Number.isInteger(options.analysisSize) && options.analysisSize >= 3)) {
    throw new TypeError('photo-quality option "analysisSize" must be a whole number of at least 3');
  }
  return {...DEFAULT_OPTIONS, ...options};
}

/** The caller's text for `key`, or null to use the built-in English. */
export function messageFor(messages, key) {
  return messages && typeof messages === 'object' && typeof messages[key] === 'string'
    ? messages[key]
    : null;
}
