import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PERSONA } from '../src/default-persona.ts'
import { beliefsFilePath, personaFilePath } from '../src/paths.ts'
import {
  CONDUCT_SECTION_NAME,
  CONDUCT_SECTION_ORDER,
  PERSONA_SECTION_NAME,
  PERSONA_SECTION_ORDER,
  formatConductSection,
  formatPersonaSection,
  registerPersonaSections,
  renderConductSectionText,
  renderPersonaSectionText,
  resolveCurrentPersonaSlug,
} from '../src/sections.ts'
import { serializePersona, type Persona } from '../src/schema.ts'
import { PersonaStore } from '../src/store.ts'
import { FRIEND_SECTION_MARKERS, MockPromptPipeline } from './helpers/prompt-pipeline.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-friend-persona-sections-'))
  temporaryRoots.push(dataDir)
  return dataDir
}

function fixturePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    name: '小夜',
    personality: '安静、会记住对方随口提过的小事。',
    background: '住在旧书店二楼的店员。',
    speakingStyle: '短句，偶尔用省略号。',
    language: 'zh-CN',
    nickname: '店长',
    greetings: ['又来了啊。', '茶还温着。'],
    tags: ['fixture'],
    ...overrides,
  }
}

async function writeCard(dataDir: string, slug: string, persona: Persona, beliefs?: string): Promise<void> {
  const store = new PersonaStore({ dataDir })
  await mkdir(join(store.charactersDir(), slug), { recursive: true })
  await writeFile(personaFilePath(dataDir, slug), serializePersona(persona), 'utf8')
  if (beliefs !== undefined) {
    await writeFile(beliefsFilePath(dataDir, slug), beliefs, 'utf8')
  }
}

describe('persona section rendering', () => {
  it('renders the character card without beliefs.md', async () => {
    const dataDir = await tempDataDir()
    const persona = fixturePersona()
    await writeCard(dataDir, 'xiaoye', persona)

    const text = renderPersonaSectionText({
      dataDir,
      getCurrentSlug: () => 'xiaoye',
    })

    expect(text).toMatchSnapshot()
    expect(text).toContain('小夜')
    expect(text).toContain('店长')
    expect(text).toContain('安静、会记住对方随口提过的小事。')
    expect(text).not.toContain('# 信念')
  })

  it('appends beliefs.md when the file exists', async () => {
    const dataDir = await tempDataDir()
    await writeCard(dataDir, 'xiaoye', fixturePersona(), '不轻易许诺。\n把别人的秘密放回书架。\n')

    const text = renderPersonaSectionText({
      dataDir,
      getCurrentSlug: () => 'xiaoye',
    })

    expect(text).toMatchSnapshot()
    expect(text).toContain('# 信念')
    expect(text).toContain('不轻易许诺。')
    expect(text).toContain('把别人的秘密放回书架。')
  })

  it('re-reads the card on each assemble instead of snapshotting at register time', async () => {
    const dataDir = await tempDataDir()
    await writeCard(dataDir, 'xiaoye', fixturePersona({ personality: 'before' }))
    const source = { dataDir, getCurrentSlug: () => 'xiaoye' }

    expect(renderPersonaSectionText(source)).toContain('性格：before')

    await writeFile(
      personaFilePath(dataDir, 'xiaoye'),
      serializePersona(fixturePersona({ personality: 'after-external-edit' })),
      'utf8',
    )
    expect(renderPersonaSectionText(source)).toContain('性格：after-external-edit')
  })

  it('renders conduct rules that mention the expression protocol and memory tools', () => {
    const text = formatConductSection(DEFAULT_PERSONA)
    expect(text).toMatchSnapshot()
    expect(text).toContain('表情标签协议')
    expect(text).toContain('[expr:')
    expect(text).toContain('memory_append')
    expect(text).toContain('语言约束')
    expect(text).toContain(DEFAULT_PERSONA.nickname)
  })

  it('falls back to the default card when the slug file is missing', async () => {
    const dataDir = await tempDataDir()
    const text = renderPersonaSectionText({ dataDir, getCurrentSlug: () => 'missing' })
    expect(text).toContain(DEFAULT_PERSONA.name)
  })
})

describe('scope mask — non-companion assemble has zero friend sections', () => {
  it('keeps friend sections off the global layer and out of a coding-preset assemble', async () => {
    const dataDir = await tempDataDir()
    await writeCard(dataDir, 'xiaoye', fixturePersona())
    const pipeline = new MockPromptPipeline()

    const codingCtx = pipeline.context()
    expect(codingCtx.systemPrompt.section).toBeTypeOf('function')

    const companionCtx = pipeline.context('friend-companion')
    const dispose = registerPersonaSections(companionCtx, {
      dataDir,
      getCurrentSlug: () => 'xiaoye',
    })

    const coding = pipeline.assemble('standard')
    expect(coding.names).not.toContain(PERSONA_SECTION_NAME)
    expect(coding.names).not.toContain(CONDUCT_SECTION_NAME)
    for (const marker of FRIEND_SECTION_MARKERS) {
      expect(coding.text, `coding assemble leaked ${marker}`).not.toContain(marker)
    }
    expect(pipeline.global).toEqual([])

    const companion = pipeline.assemble('friend-companion')
    expect(companion.names).toEqual([PERSONA_SECTION_NAME, CONDUCT_SECTION_NAME])
    expect(companion.text).toContain('小夜')
    expect(companion.text).toContain('表情标签协议')
    expect(PERSONA_SECTION_ORDER).toBeLessThan(CONDUCT_SECTION_ORDER)
    expect(PERSONA_SECTION_ORDER).toBeGreaterThan(0)
    expect(CONDUCT_SECTION_ORDER).toBeLessThan(100)

    dispose()
    expect(pipeline.assemble('friend-companion').names).toEqual([])
  })
})

describe('resolveCurrentPersonaSlug', () => {
  it('reads friend-persona.currentSlug and falls back to default', () => {
    expect(resolveCurrentPersonaSlug(undefined)).toBe('default')
    expect(resolveCurrentPersonaSlug({
      get: () => ({ currentSlug: 'xiaoye' }),
    })).toBe('xiaoye')
    expect(resolveCurrentPersonaSlug({
      get: () => ({ currentSlug: '   ' }),
    })).toBe('default')
  })
})

describe('registerPersonaSections', () => {
  it('registers function-form text so assemble follows the current card', async () => {
    const dataDir = await tempDataDir()
    await writeCard(dataDir, 'xiaoye', fixturePersona())
    const section = vi.fn(() => vi.fn())

    registerPersonaSections(
      { systemPrompt: { section } },
      { dataDir, getCurrentSlug: () => 'xiaoye' },
    )

    expect(section).toHaveBeenCalledTimes(2)
    const personaSpec = section.mock.calls[0]?.[0] as { name: string; text: (ctx: unknown) => string }
    const conductSpec = section.mock.calls[1]?.[0] as { name: string; text: (ctx: unknown) => string }
    expect(personaSpec.name).toBe(PERSONA_SECTION_NAME)
    expect(conductSpec.name).toBe(CONDUCT_SECTION_NAME)
    expect(typeof personaSpec.text).toBe('function')
    expect(personaSpec.text({})).toContain('小夜')
    expect(conductSpec.text({})).toContain('记忆记录守则')
  })
})

describe('formatPersonaSection', () => {
  it('omits an empty beliefs block', () => {
    const text = formatPersonaSection(fixturePersona(), undefined)
    expect(text).not.toContain('# 信念')
  })
})

describe('renderConductSectionText', () => {
  it('uses the current card language and nickname', async () => {
    const dataDir = await tempDataDir()
    await writeCard(dataDir, 'xiaoye', fixturePersona({ language: 'en', nickname: 'boss' }))
    expect(renderConductSectionText({
      dataDir,
      getCurrentSlug: () => 'xiaoye',
    })).toContain('称呼用户为「boss」')
  })
})
