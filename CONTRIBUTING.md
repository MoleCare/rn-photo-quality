# Contributing to @molecare/photo-quality

Thanks for being here. This package is small, pure JavaScript, and has a fast
test suite, so it is a good place for a first contribution.

## The one rule that is not negotiable

**This package measures photos. It never judges what is in them.**

It reports things like exposure clipping, uneven lighting, sharpness and
whether two photos were taken in comparable conditions. It is not a medical
device and makes no clinical claim. Any change that moves its output towards
"this skin looks fine" or "this mole has changed" will be declined, however
good the code is.

| Fine | Not fine |
|---|---|
| "This photo is too dark to compare with the last one." | "This lesion has grown." |
| A new, configurable quality threshold | A risk or urgency score |
| Better sharpness measurement | Anything that reads the content of a photo |

If you are unsure which side of the line a change sits on, open an issue and
ask before writing the code.

## Stateless by design

The package keeps no state and has no global settings. Every threshold and
message is an option passed with the call, with its default in
`src/defaults.js`. Module scope holds frozen constants only, and a test fails
on any module-level `let` or `var`. Please don't add a `configure()`, a cache
or a singleton; add an option instead.

## Getting set up

```bash
git clone https://github.com/MoleCare/rn-photo-quality.git
cd rn-photo-quality
npm ci
npm test
```

You need Node 20 or newer. The tests run in plain Node with the React Native
modules mocked, so no simulator or device is needed.

## Test images

**Never commit, attach or link a real photo of a person's skin**, in code,
tests, issues or pull requests. Tests build their pixels in code. If you need a
fixture file, use a synthetic image you made yourself (a gradient, a
checkerboard), and say so in the pull request.

## Pull requests

- One change per pull request, with a test for the behaviour you changed.
- `npm test` passes; CI runs it on Node 20 and 22.
- Keep defaults brand-neutral: no product names, hosts or IDs.
- Describe what changed and why in plain words.

## Releases

Maintainers publish to npm from a GitHub Release. The release workflow checks
that the tag matches `package.json`, runs the tests, and publishes with npm
provenance through GitHub's OIDC trusted publishing, so no npm token is stored
anywhere.

## Code of conduct

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
