import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DSH_HOME_ENV,
  FRIEND_DATA_DIR_ENV,
  resolveDshHome,
  resolveFriendDataDir,
} from '../src/friend-paths.ts'

describe('resolveFriendDataDir', () => {
  it('prefers FRIEND_DATA_DIR over DSH_HOME and resolves to an absolute path', () => {
    expect(resolveFriendDataDir({
      env: {
        [FRIEND_DATA_DIR_ENV]: '/tmp/friend-isolated',
        [DSH_HOME_ENV]: '/tmp/dsh-profile',
      },
      homedir: '/Users/example',
    })).toBe('/tmp/friend-isolated')
  })

  it('resolves a relative DSH_HOME against cwd', () => {
    expect(resolveFriendDataDir({
      env: { [DSH_HOME_ENV]: 'relative-dsh' },
      homedir: '/Users/example',
    })).toBe(join(resolve('relative-dsh'), 'friend'))
  })

  it('falls back to <homedir>/.dsh/friend', () => {
    expect(resolveFriendDataDir({
      env: {},
      homedir: '/Users/example',
    })).toBe(join('/Users/example', '.dsh', 'friend'))
  })
})

describe('resolveDshHome', () => {
  it('resolves a relative DSH_HOME against cwd', () => {
    expect(resolveDshHome({
      env: { [DSH_HOME_ENV]: 'relative-dsh' },
      homedir: '/Users/example',
    })).toBe(resolve('relative-dsh'))
  })
})
