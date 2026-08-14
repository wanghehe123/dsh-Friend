import { defineConfig } from 'tsdown'

import { dshClientBuild, hostBuild, universalBuild } from '../../shared/tsdown.client.ts'

export default defineConfig([
  hostBuild(),
  universalBuild({
    name: 'tags',
    entry: { tags: 'src/tags.ts' },
  }),
  dshClientBuild({ packageName: '@wishp3/dsh-friend-stage' }),
  {
    name: '@wishp3/dsh-friend-stage/pet',
    entry: { pet: 'src/pet.ts' },
    outDir: 'lib',
    platform: 'browser',
    format: 'iife',
    globalName: 'DshFriendPet',
    target: 'es2020',
    dts: false,
    clean: false,
    sourcemap: false,
    deps: {
      alwaysBundle: [
        'pixi.js',
        /^pixi-live2d-display(?:\/|$)/u,
        '@wishp3/dsh-friend-asr/browser',
        '@wishp3/dsh-friend-shared/universal',
      ],
    },
  },
])
