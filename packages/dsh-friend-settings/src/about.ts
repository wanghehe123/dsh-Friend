export const FRIEND_PACKAGE_VERSION = '0.1.0'

export type AboutNotice = {
  id: string
  title: string
  license: string
  note?: string
}

export const ABOUT_NOTICES: readonly AboutNotice[] = [
  {
    id: 'kokoro',
    title: 'Derived from Kokoro Engine',
    license: 'MIT',
    note: 'Copyright (c) 2026 chyinan',
  },
  {
    id: 'pixi',
    title: 'PixiJS 6.5.10',
    license: 'MIT',
  },
  {
    id: 'pixi-live2d',
    title: 'pixi-live2d-display 0.4.0',
    license: 'MIT',
  },
  {
    id: 'cubism-framework',
    title: 'Cubism Web Framework (embedded by pixi-live2d-display)',
    license: 'Live2D Open Software License',
  },
  {
    id: 'cubism-core',
    title: 'Live2D Cubism Core',
    license: 'Live2D proprietary',
    note: 'Downloaded at first run into vendor/; never shipped in the npm tarball',
  },
  {
    id: 'hiyori',
    title: 'Hiyori sample model',
    license: 'Live2D sample terms',
    note: 'NOTICE is written under vendor/ after the first-run installer finishes',
  },
]

export type AboutPayload = {
  version: string
  notices: readonly AboutNotice[]
  importLegacyPath: '/friend/memory/import'
}

export function createAboutPayload(version: string = FRIEND_PACKAGE_VERSION): AboutPayload {
  return {
    version,
    notices: ABOUT_NOTICES,
    importLegacyPath: '/friend/memory/import',
  }
}
