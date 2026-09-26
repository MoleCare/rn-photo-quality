## What this changes

<!-- One change per pull request. What does a user notice? -->

## Checklist

- [ ] A test for the behaviour I changed (100% coverage stays)
- [ ] A line in the top section of `CHANGELOG.md`, if a user would notice
- [ ] Stateless: no module-level `let` or `var`, no caches, no `configure()`
- [ ] No native imports (`react-native`, Expo modules)
- [ ] No real photos of people; test pixels are made in code
- [ ] The package still measures photos and never judges what is in them
- [ ] Stored fields (`v: 1` capture record, `metrics`) stay readable
