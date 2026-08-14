import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DSH_HOME_ENV,
  FRIEND_DATA_DIR_ENV,
  beliefsFilePath,
  resolveDshHome,
  resolveFriendDataDir,
  userAgentPresetsDir,
} from '../src/paths.ts'

describe('resolveFriendDataDir', () => {
  it('prefers override over env and dshHome', () => {
    expect(resolveFriendDataDir({
      override: '/tmp/friend-override',
      dshHome: '/tmp/dsh-home',
      env: {
        [DSH_HOME_ENV]: '/tmp/env-dsh',
        [FRIEND_DATA_DIR_ENV]: '/tmp/env-friend',
      },
      homedir: '/Users/example',
    })).toBe('/tmp/friend-override')
  })

  it('uses FRIEND_DATA_DIR before DSH_HOME', () => {
    expect(resolveFriendDataDir({
      dshHome: '/tmp/dsh-home',
      env: {
        [DSH_HOME_ENV]: '/tmp/env-dsh',
        [FRIEND_DATA_DIR_ENV]: '/tmp/env-friend',
      },
      homedir: '/Users/example',
    })).toBe('/tmp/env-friend')
  })

  it('uses an injected dshHome before DSH_HOME', () => {
    expect(resolveFriendDataDir({
      dshHome: '/tmp/dsh-home',
      env: { [DSH_HOME_ENV]: '/tmp/env-dsh' },
      homedir: '/Users/example',
    })).toBe(join('/tmp/dsh-home', 'friend'))
  })

  it('maps DSH_HOME to <DSH_HOME>/friend for isolated smoke profiles', () => {
    expect(resolveFriendDataDir({
      env: { [DSH_HOME_ENV]: '/tmp/dsh-profile' },
      homedir: '/Users/example',
    })).toBe(join('/tmp/dsh-profile', 'friend'))
  })

  it('falls back to <homedir>/.dsh/friend without reading a hard-coded path', () => {
    expect(resolveFriendDataDir({
      env: {},
      homedir: '/Users/example',
    })).toBe(join('/Users/example', '.dsh', 'friend'))
  })

  it('resolves dshHome for Plan B publish without reading a hard-coded path', () => {
    expect(resolveDshHome({
      dshHome: '/tmp/dsh-home',
      env: { [DSH_HOME_ENV]: '/tmp/env-dsh' },
      homedir: '/Users/example',
    })).toBe('/tmp/dsh-home')
    expect(resolveDshHome({
      env: { [DSH_HOME_ENV]: '/tmp/env-dsh' },
      homedir: '/Users/example',
    })).toBe('/tmp/env-dsh')
    expect(resolveDshHome({
      env: {},
      homedir: '/Users/example',
    })).toBe(join('/Users/example', '.dsh'))
    expect(userAgentPresetsDir('/tmp/dsh-home')).toBe(join('/tmp/dsh-home', '.agent-presets'))
    expect(beliefsFilePath('/tmp/friend', 'default')).toBe(join('/tmp/friend', 'characters', 'default', 'beliefs.md'))
  })

  it('treats blank override and env values as missing', () => {
    expect(resolveFriendDataDir({
      override: '   ',
      env: { [DSH_HOME_ENV]: '', [FRIEND_DATA_DIR_ENV]: '  ' },
      homedir: '/Users/example',
    })).toBe(join('/Users/example', '.dsh', 'friend'))
  })
})
