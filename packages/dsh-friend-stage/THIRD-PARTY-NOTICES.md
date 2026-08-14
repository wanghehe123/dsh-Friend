# Third-party notices

`lib/pet.iife.js` is a standalone browser bundle. The following third-party
code is compiled into that IIFE at build time. They are **not** runtime
`dependencies` of this package — installing `@wishp3/dsh-friend-stage` does
not pull them from npm.

## Runtime dependency (not bundled into the pet IIFE)

### fflate 0.8.3

Used by the host installer to unzip official archives in-process (no system
`unzip`). MIT. https://github.com/101arrowz/fflate

## Bundled into `lib/pet.iife.js`

### PixiJS (`pixi.js` 6.5.10)

- License: MIT
- Copyright (c) 2013-2017 Mathew Groves, Chad Engler
- https://github.com/pixijs/pixijs

### pixi-live2d-display 0.4.0

- License: MIT
- Copyright (c) 2020 Guan
- https://github.com/guansss/pixi-live2d-display

### Cubism Web Framework (vendored by pixi-live2d-display)

pixi-live2d-display ships a rewritten/embedded copy of the official Cubism
Web Framework used to drive Cubism 3/4 models.

- License: Live2D Open Software License
- https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html

## Not bundled — downloaded at first run

### Live2D Cubism Core (`live2dcubismcore.min.js`)

Cubism Core is proprietary Live2D software. It is **not** distributed in this
package, in Git, or on npm. On first visit to `/friend/pet` the user accepts
the applicable Live2D terms and the host downloads Core into the local friend
data root (`$FRIEND_DATA_DIR` or `$DSH_HOME/friend` or `~/.dsh/friend`) under
`vendor/`. See `src/live2d/asset-store.ts` and the on-page installer.

The official Hiyori Momose - FREE sample model is downloaded the same way and
is also kept only in that local `vendor/` tree.
