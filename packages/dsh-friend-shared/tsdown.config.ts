import { defineConfig } from 'tsdown'

import { dshClientBuild, hostBuild, universalBuild } from '../../shared/tsdown.client.ts'

/**
 * Three public halves, one source of platform-neutral constants:
 * - `.` / hostBuild → Node host (`lib/index.js`), re-exports `./universal`
 * - `./universal` / universalBuild → naked ESM (`lib/universal.js`)
 * - `./client` / dshClientBuild → ModuleLoader payload (`lib/client.js`)
 */
export default defineConfig([
  hostBuild(),
  universalBuild(),
  dshClientBuild({ packageName: '@wishp3/dsh-friend-shared' }),
])
