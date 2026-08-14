# dsh-Friend Live2D stage

`@wish233/dsh-friend-stage` provides the standalone companion viewer at
`/friend/pet`. It renders the official **Hiyori Momose - FREE** Cubism model
with PixiJS and `pixi-live2d-display`, rather than using a static image or a
mock animation.

## First run

1. Start DSH with this package mounted.
2. Open `http://127.0.0.1:<port>/friend/pet`.
3. Read and accept the applicable official Live2D terms in the page, then
   select **下载并启用 Live2D**.

The page downloads the Hiyori FREE model and the official Cubism 4 R7 Core to
`$DSH_HOME/friend/vendor/` (or `~/.dsh/friend/vendor/` when `DSH_HOME` is not
set). They are deliberately excluded from this package, Git, and npm. The
original model `ReadMe.txt` and an attribution `NOTICE.txt` remain alongside
the local files.

Progress is pushed as reentrant SSE snapshots on `GET /friend/events`
(`event: asset-progress`). A matching `GET /friend/live2d/progress` returns the
same snapshot so an `EventSource` reconnect can catch up.

Frame rate defaults to 30 FPS and is read from the `friend-stage` settings
namespace (`targetFps`).

## Updating official asset hashes

Install verifies sha256 **before** writing `vendor/`. Expected digests live in
[`vendor-integrity.json`](./vendor-integrity.json) so they can be updated
without changing TypeScript.

The checked-in values are `TODO` placeholders until someone hashes the real
official files (this environment cannot download them). A placeholder does
**not** pretend to be a real digest: install may still finish, but the JSON
result reports `integrity: "hash-pending"` / `hashPending: true`. A mismatch
never writes `vendor/` and leaves a retryable tree (only
`vendor/hiyori` and `vendor/cubism-core` are auto-cleaned).

To fill the placeholders:

1. Download the URLs recorded in `vendor-integrity.json`.
2. `shasum -a 256 hiyori_en.zip CubismSdkForWeb-4-r.7.zip`
3. Extract `CubismSdkForWeb-4-r.7/Core/live2dcubismcore.min.js` and hash that
   file too.
4. Replace each `"TODO"` with the lowercase 64-character hex digest.
5. Runtime override (no file edit): `FRIEND_LIVE2D_HIYORI_ZIP_SHA256`,
   `FRIEND_LIVE2D_CUBISM_SDK_ZIP_SHA256`, `FRIEND_LIVE2D_CUBISM_CORE_JS_SHA256`.

## Model upload

`POST /friend/models/upload` accepts a zip (`application/zip` or multipart
`file`). The archive must contain `*.model3.json`, stay under 200 MB, and
cannot use zip-slip paths. Files land in `models/<name>/` with a generated
`friend.map.json` when the zip does not already include one. Deleting the
current model falls back to built-in Hiyori.

## In-page float layer

The dsh web client half mounts a floating iframe of
`/friend/pet?transparent=1&embed=1`. Pixi stays inside the pet IIFE — never
inside `lib/client.js`. Position and size persist in the `friend-stage`
settings namespace.

## Included interaction surface

- Seven parameter-driven expressions: 平静、笑、尴尬、难过、惊讶、困倦、生气.
- Official Hiyori motions mapped to work cues such as idle, thinking, success,
  error, and sleepy.
- A ticker capped at the configured FPS (default 30; `friend-stage` /
  `targetFps`) which pauses when the page is hidden, plus a future-facing
  `dsh-friend:lipsync` event seam for mouth animation.

For local development, build the stage package and use
[`scripts/link-profile.mjs`](../../scripts/link-profile.mjs) so DSH resolves
the workspace packages in its profile.
