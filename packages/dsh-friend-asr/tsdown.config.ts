import { defineConfig } from 'tsdown'

import { dshClientBuild, hostBuild, universalBuild } from '../../shared/tsdown.client.ts'

/**
 * Three public halves:
 * - `.` / hostBuild → Node host (`lib/index.js`)
 * - `./browser` / universalBuild → naked ESM (`lib/browser.js`) for the pet IIFE
 * - `./client` / dshClientBuild → ModuleLoader payload (`lib/client.js`)
 */
export default defineConfig([
  hostBuild({ name: '@wish233/dsh-friend-asr' }),
  universalBuild({
    name: 'browser',
    entry: { browser: 'src/browser.ts' },
  }),
  dshClientBuild({ packageName: '@wish233/dsh-friend-asr' }),
])
