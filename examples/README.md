# Examples

Complete, copy-paste starting points. CI typechecks every file here against
the package, and runs the plain ones, so they stay in step with the API.

| File                                           | Shows                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`expoAnalyzer.ts`](expoAnalyzer.ts)           | An analyzer for Expo in one file, with your own warning text                          |
| [`CheckPhotoScreen.tsx`](CheckPhotoScreen.tsx) | Checking a photo after it is picked: suggestions, never a block unless it is unusable |
| [`photoRecord.ts`](photoRecord.ts)             | What to store next to each photo so it can be compared later                          |
| [`comparePhotos.ts`](comparePhotos.ts)         | How comparable two photos are, from the camera and light, never the subject           |

For bare React Native, swap `expoAnalyzer.ts` for the `imageEditorJpegLoader`
setup in the main README.
