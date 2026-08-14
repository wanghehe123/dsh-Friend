import { defineConfig } from 'tsdown'

import { dshClientBuild, hostBuild, universalBuild } from '../../shared/tsdown.client.ts'

/**
 * Three public halves:
 * - `.` / hostBuild → Node host (`lib/index.js`)
 * - `./browser` / universalBuild → naked ESM (`lib/browser.js`) for the pet IIFE
 * - `./client` / dshClientBuild → ModuleLoader payload (`lib/client.js`)
 */
export default defineConfig([
  hostBuild({ name: '@wishp3/dsh-friend-asr' }),
  universalBuild({
    name: 'browser',
    entry: { browser: 'src/browser.ts' },
  }),
  dshClientBuild({ packageName: '@wishp3/dsh-friend-asr' }),
])
