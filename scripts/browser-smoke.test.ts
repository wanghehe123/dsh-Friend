import { describe, expect, it } from 'vitest'

import {
  BROWSER_SMOKE_SKIP_NO_BROWSER,
  BROWSER_SMOKE_SKIP_NO_DSH,
  FAILED_TO_LOAD_PLUGINS,
  FRIEND_CLIENT_PACKAGES,
  FRIEND_PACKAGES,
  LOADING_PLUGINS,
  assertClientHalvesLoaded,
  classifyBootPage,
  formatClientLoadFailure,
  listBootEntryIds,
  parseArgs,
  parseClientLoadFailures,
  resolveBrowserSmokePlan,
} from './browser-smoke.mjs'

const REAL_APPLY_ERROR = 'failed to apply loader entry 800dcc2e (@wish233/dsh-friend-tts): cannot get property "speechSynthesis" without inject'

const FAILED_PAGE = [
  'HARNESS',
  FAILED_TO_LOAD_PLUGINS,
  '@wish233/dsh-friend-tts',
  '@wish233/dsh-friend-asr',
  '@wish233/dsh-friend-reactions',
  '@wish233/dsh-friend-settings',
  REAL_APPLY_ERROR,
].join('\n')

const DIALOG_PAGE = [
  '内测声明',
  '添加一个 API Key 开始使用',
].join('\n')

function bootIds(names: readonly string[] = FRIEND_CLIENT_PACKAGES) {
  return [...names]
}

describe('parseArgs', () => {
  it('defaults to skip-friendly browser smoke', () => {
    expect(parseArgs([])).toMatchObject({
      help: false,
      requireDsh: false,
      requireBrowser: false,
      useUserHome: false,
      timeoutMs: 60_000,
      profile: 'web',
    })
  })

  it('parses --require-browser with the smoke-style flags', () => {
    expect(parseArgs(['--require-dsh', '--require-browser', '--port', '3411'])).toMatchObject({
      requireDsh: true,
      requireBrowser: true,
      port: 3411,
    })
  })
})

describe('resolveBrowserSmokePlan', () => {
  const browser = { executablePath: '/tmp/chromium' }

  it('skips with a Chinese explanation when dsh is missing', () => {
    expect(resolveBrowserSmokePlan({ dshBin: null, browser, requireDsh: false })).toEqual({
      action: 'skip',
      message: BROWSER_SMOKE_SKIP_NO_DSH,
    })
  })

  it('fails when --require-dsh and dsh is missing', () => {
    expect(resolveBrowserSmokePlan({ dshBin: null, browser, requireDsh: true })).toEqual({
      action: 'fail',
      message: 'dsh CLI not found on PATH (--require-dsh).',
    })
  })

  it('skips when Chromium is missing', () => {
    expect(resolveBrowserSmokePlan({
      dshBin: '/usr/local/bin/dsh',
      browser: null,
      requireBrowser: false,
    })).toEqual({
      action: 'skip',
      message: BROWSER_SMOKE_SKIP_NO_BROWSER,
    })
  })

  it('fails when --require-browser and Chromium is missing', () => {
    expect(resolveBrowserSmokePlan({
      dshBin: '/usr/local/bin/dsh',
      browser: null,
      requireBrowser: true,
    })).toMatchObject({
      action: 'fail',
    })
  })

  it('runs when both dsh and Chromium are available', () => {
    expect(resolveBrowserSmokePlan({ dshBin: '/usr/local/bin/dsh', browser })).toEqual({
      action: 'run',
    })
  })
})

describe('classifyBootPage', () => {
  it('treats the fail-loud title as failed even when dialog copy is also present', () => {
    expect(classifyBootPage(`${DIALOG_PAGE}\n${FAILED_TO_LOAD_PLUGINS}`)).toBe('failed')
  })

  it('does not treat 内测声明 / API Key dialogs as a load failure', () => {
    expect(classifyBootPage(DIALOG_PAGE)).toBe('settled')
    expect(classifyBootPage(DIALOG_PAGE)).not.toBe('failed')
  })

  it('stays loading while the harness spinner is up', () => {
    expect(classifyBootPage(`HARNESS\n${LOADING_PLUGINS}`)).toBe('loading')
  })
})

describe('parseClientLoadFailures', () => {
  it('extracts the package, property, and verbatim apply error', () => {
    const parsed = parseClientLoadFailures(FAILED_PAGE)
    expect(parsed.failed).toBe(true)
    expect(parsed.packages).toContain('@wish233/dsh-friend-tts')
    expect(parsed.namedPackage).toBe('@wish233/dsh-friend-tts')
    expect(parsed.property).toBe('speechSynthesis')
    expect(parsed.applyError).toBe(REAL_APPLY_ERROR)
  })

  it('is clean when only the first-run dialogs are on screen', () => {
    expect(parseClientLoadFailures(DIALOG_PAGE)).toEqual({
      failed: false,
      packages: [],
      applyError: null,
      property: null,
      namedPackage: null,
    })
  })
})

describe('listBootEntryIds', () => {
  it('reads window.__DSH_BOOT__.entries[].id', () => {
    expect(listBootEntryIds({
      rev: 'x',
      entries: [
        { id: '@wish233/dsh-friend-tts', url: '/plugins/tts', rev: '1' },
        { id: '@wish233/dsh-friend-asr', url: '/plugins/asr', rev: '1' },
      ],
    })).toEqual([
      '@wish233/dsh-friend-tts',
      '@wish233/dsh-friend-asr',
    ])
  })

  it('returns [] for a missing or malformed boot graph', () => {
    expect(listBootEntryIds(undefined)).toEqual([])
    expect(listBootEntryIds(null)).toEqual([])
    expect(listBootEntryIds({ entries: 'nope' })).toEqual([])
  })
})

describe('assertClientHalvesLoaded', () => {
  it('accepts a settled page with every friend client half in the boot graph', () => {
    expect(() => assertClientHalvesLoaded({
      pageText: DIALOG_PAGE,
      bootEntryIds: bootIds(),
    })).not.toThrow()
  })

  it('does not require dismissing 内测声明 / API Key dialogs', () => {
    expect(() => assertClientHalvesLoaded({
      pageText: DIALOG_PAGE,
      bootEntryIds: bootIds(),
    })).not.toThrow()
    expect(DIALOG_PAGE).toContain('内测声明')
    expect(DIALOG_PAGE).toContain('添加一个 API Key 开始使用')
    expect(DIALOG_PAGE).not.toContain(FAILED_TO_LOAD_PLUGINS)
  })

  it('fails naming the package and property, keeping the real apply error verbatim', () => {
    expect(() => assertClientHalvesLoaded({
      pageText: FAILED_PAGE,
      bootEntryIds: bootIds(),
    })).toThrow(REAL_APPLY_ERROR)

    try {
      assertClientHalvesLoaded({ pageText: FAILED_PAGE, bootEntryIds: bootIds() })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain('@wish233/dsh-friend-tts')
      expect(message).toContain('speechSynthesis')
      expect(message).toContain(REAL_APPLY_ERROR)
      expect(formatClientLoadFailure(parseClientLoadFailures(FAILED_PAGE))).toContain(REAL_APPLY_ERROR)
      return
    }
    throw new Error('expected assertClientHalvesLoaded to throw')
  })

  it('fails when a client half is absent from the boot graph even if the page looks settled', () => {
    const withoutTts = FRIEND_CLIENT_PACKAGES.filter((name) => name !== '@wish233/dsh-friend-tts')
    expect(() => assertClientHalvesLoaded({
      pageText: DIALOG_PAGE,
      bootEntryIds: withoutTts,
    })).toThrow(/missing friend client halves: @wish233\/dsh-friend-tts/)
  })

  it('covers every package that ships a client half, not the host-only two', () => {
    expect(FRIEND_PACKAGES).toHaveLength(11)
    expect(FRIEND_CLIENT_PACKAGES).toHaveLength(9)
    expect(FRIEND_CLIENT_PACKAGES).not.toContain('@wish233/dsh-friend-all')
    expect(FRIEND_CLIENT_PACKAGES).not.toContain('@wish233/dsh-friend-perception')
  })
})
