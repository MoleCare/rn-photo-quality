# Contributing to @molecare/photo-quality

Thanks for being here. This package is a small TypeScript library with a fast
test suite and no native code, so it is a good place for a first contribution.

## The one rule that is not negotiable

**This package measures photos. It never judges what is in them.**

It reports things like exposure clipping, uneven lighting, sharpness and
whether two photos were taken in comparable conditions. It is not a medical
device and makes no clinical claim. Any change that moves its output towards
"this skin looks fine" or "this mole has changed" will be declined, however
good the code is.

| Fine                                                   | Not fine                                   |
| ------------------------------------------------------ | ------------------------------------------ |
| "This photo is too dark to compare with the last one." | "This lesion has grown."                   |
| A new, configurable quality threshold                  | A risk or urgency score                    |
| Better sharpness measurement                           | Anything that reads the content of a photo |

If you are unsure which side of the line a change sits on, open an issue and
ask before writing the code.

## Design rules

- **Stateless.** Pure functions and frozen results; no module-level `let` or
  `var` (a test checks), no caches, no singletons, no `configure()`. A setting
  is a threshold or option with its default in `src/options.ts`.
- **No native imports.** The package never imports `react-native`, an Expo
  module or a native library (a test checks). Native work goes through
  functions the app passes in, such as `loadAnalysisJpeg`.
- **A photo that can't be measured is a result, not an error.** Only
  programming errors throw.
- **Stored data stays readable.** The capture record (`v: 1`) and the
  `metrics` field names are stored by apps next to photos. Adding a field is
  fine; renaming or removing one needs a new record version and a migration
  story.

## Getting set up

```bash
git clone https://github.com/MoleCare/rn-photo-quality.git
cd rn-photo-quality
npm ci
```

You need Node 20.19 or newer to work on it. Tests run in plain Node with real
JPEGs made in code, so no simulator, device or mock is needed.

| Command                           | What it does                                                                |
| --------------------------------- | --------------------------------------------------------------------------- |
| `npm test`                        | Jest tests (TypeScript, via Babel), 100% coverage required                  |
| `npm run typecheck`               | `tsc` in strict mode                                                        |
| `npm run lint` / `npm run format` | ESLint (typescript-eslint, strict) and Prettier                             |
| `npm run build`                   | Builds `lib/` with react-native-builder-bob: CommonJS, ES modules and types |
| `npm run check:package`           | Builds, then publint and arethetypeswrong on the packed package             |
| `npm run check:consumer -- pnpm`  | Installs the packed package with that package manager and loads it          |

CI runs all of these on every pull request.

## Test images

**Never commit, attach or link a real photo of a person's skin**, in code,
tests, issues or pull requests. Tests build their pixels in code (flat fields,
gradients, noise) and encode them with `jpeg-js`. If you need a fixture file,
use a synthetic image you made yourself, and say so in the pull request.

## Pull requests

- One change per pull request, with a test for the behaviour you changed.
- Add a line to the top section of `CHANGELOG.md` for anything a user would notice.
- Keep defaults brand-neutral: no product names, hosts or IDs.

## Releases

Maintainers bump the version in `package.json`, add its `CHANGELOG.md`
section, and publish a GitHub Release tagged `v<version>`. The release workflow
checks the tag and the changelog, runs every check, builds once, and publishes
to npm with provenance through GitHub's OIDC trusted publishing, so no npm
token is stored anywhere.

## Code of conduct

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
