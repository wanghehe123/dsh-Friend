import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isPersona, validatePersona } from '../src/schema.ts'
import { PersonaStore } from '../src/store.ts'
import {
  TAVERN_DEFAULT_USER_NICKNAME,
  TAVERN_IMPORT_FALLBACKS,
  importTavernCard,
  importTavernCardJson,
  importTavernCardPng,
  parseCharacterCard,
  parseCharacterCardJSON,
  parseCharacterCardPNG,
  parseCharacterCardPngBuffer,
} from '../src/tavern-import.ts'
import { encodeCharaBase64, makePngWithTextChunk } from './helpers/png.ts'

/**
 * Behavioral cases reconstructed from Kokoro-Engine
 * `src/lib/character-card-parser.ts`. That file had no dedicated unit tests
 * (the only nearby spec, `CharacterManager.test.ts`, covers language presets).
 * These lock the original parse/map rules so a later rewrite cannot drift.
 */
const v1Card = {
  name: 'Hiyori',
  description: 'A cheerful student.',
  personality: 'Bright',
  scenario: 'Rooftop after school',
  first_mes: 'Hi there!',
  mes_example: '{{user}}: Hi\n{{char}}: Hello!',
  system_prompt: 'Stay in character.',
}

const v1AltKeys = {
  char_name: 'AltName',
  char_persona: 'Legacy persona text',
  world_scenario: 'Old world',
  char_greeting: 'Yo',
  example_dialogue: 'A: hi\nB: hey',
}

const v2Card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Hiyori',
    description: 'A cheerful student.',
    personality: 'Bright and energetic',
    scenario: 'After school rooftop',
    first_mes: 'Hi there!',
    alternate_greetings: ['Hey!', 'Yo!'],
    mes_example: '{{user}}: Hi\n{{char}}: Hello!',
    system_prompt: 'Stay in character.',
    post_history_instructions: 'Keep replies short.',
    tags: ['school', 'cheerful'],
    extensions: {
      language: 'ja-JP',
      nickname: 'せんせい',
      voice: 'ja-JP-NanamiNeural',
      live2dModel: 'hiyori_free',
    },
  },
}

const v3Card = {
  spec: 'chara_card_v3',
  data: {
    spec_version: '3.0',
    name: 'V3 Girl',
    description: 'Newer spec wrapper',
  },
}

describe('legacy character-card-parser (Kokoro behavior)', () => {
  it('assembles a v1 top-level card into the combined persona blob', () => {
    expect(parseCharacterCardJSON(JSON.stringify(v1Card))).toEqual({
      name: 'Hiyori',
      user_nickname: TAVERN_DEFAULT_USER_NICKNAME,
      source_format: 'tavern-v2',
      persona: [
        'Stay in character.',
        'A cheerful student.',
        'Personality: Bright',
        'Scenario: Rooftop after school',
        'First greeting: Hi there!',
        'Example dialogue:\n{{user}}: Hi\n{{char}}: Hello!',
      ].join('\n\n'),
    })
  })

  it('accepts v1 alternate field names', () => {
    const profile = parseCharacterCardJSON(JSON.stringify(v1AltKeys))
    expect(profile.name).toBe('AltName')
    expect(profile.persona).toContain('Legacy persona text')
    expect(profile.persona).toContain('Scenario: Old world')
    expect(profile.persona).toContain('First greeting: Yo')
    expect(profile.persona).toContain('Example dialogue:\nA: hi\nB: hey')
  })

  it('reads fields from the v2 data wrapper and stays tavern-v2', () => {
    const profile = parseCharacterCardJSON(JSON.stringify(v2Card))
    expect(profile.name).toBe('Hiyori')
    expect(profile.source_format).toBe('tavern-v2')
    expect(profile.user_nickname).toBe('{{user}}')
    expect(profile.persona).toContain('Stay in character.')
    expect(profile.persona).toContain('Personality: Bright and energetic')
  })

  it('marks chara_card_v3 / spec_version 3.0 as tavern-v3', () => {
    expect(parseCharacterCardJSON(JSON.stringify(v3Card)).source_format).toBe('tavern-v3')
    expect(parseCharacterCardJSON(JSON.stringify({
      data: { spec_version: '3.0', name: 'ByVersion' },
    })).source_format).toBe('tavern-v3')
  })

  it('falls back to Unnamed Character when name is missing', () => {
    expect(parseCharacterCardJSON('{}').name).toBe('Unnamed Character')
    expect(parseCharacterCardJSON('{}').persona).toBe('')
  })

  it('extracts a chara tEXt chunk that is base64 JSON', async () => {
    const png = makePngWithTextChunk('chara', encodeCharaBase64(v2Card))
    const file = new File([png], 'hiyori.png', { type: 'image/png' })
    const profile = await parseCharacterCardPNG(file)
    expect(profile.name).toBe('Hiyori')
    expect(profile.source_format).toBe('tavern-v2')
    expect(parseCharacterCardPngBuffer(png).name).toBe('Hiyori')
  })

  it('accepts a chara tEXt chunk that is already plain JSON', async () => {
    const png = makePngWithTextChunk('chara', JSON.stringify({ name: 'Plain' }))
    const profile = await parseCharacterCardPNG(new File([png], 'plain.png', { type: 'image/png' }))
    expect(profile.name).toBe('Plain')
  })

  it('recovers UTF-8 names from atob + percent-decode', async () => {
    const png = makePngWithTextChunk('chara', encodeCharaBase64({ name: '小友' }))
    const profile = await parseCharacterCardPNG(new File([png], 'utf8.png', { type: 'image/png' }))
    expect(profile.name).toBe('小友')
  })

  it('reads uncompressed iTXt chara metadata', async () => {
    const png = makePngWithTextChunk('chara', encodeCharaBase64({ name: 'iTXt Girl' }), 'iTXt')
    const profile = await parseCharacterCardPNG(new File([png], 'itxt.png', { type: 'image/png' }))
    expect(profile.name).toBe('iTXt Girl')
  })

  it('rejects a non-PNG buffer and a PNG without chara', async () => {
    await expect(parseCharacterCardPNG(new File([new Uint8Array([1, 2, 3])], 'x.png')))
      .rejects.toThrow('Not a valid PNG file')

    const empty = makePngWithTextChunk('Comment', 'hello')
    await expect(parseCharacterCardPNG(new File([empty], 'empty.png')))
      .rejects.toThrow(/No "chara" metadata/)
  })

  it('dispatches parseCharacterCard by file extension', async () => {
    const jsonFile = new File([JSON.stringify(v1Card)], 'card.json', { type: 'application/json' })
    const png = makePngWithTextChunk('chara', encodeCharaBase64(v1Card))
    const pngFile = new File([png], 'card.png', { type: 'image/png' })

    await expect(parseCharacterCard(jsonFile)).resolves.toMatchObject({ name: 'Hiyori' })
    await expect(parseCharacterCard(pngFile)).resolves.toMatchObject({ name: 'Hiyori' })
    await expect(parseCharacterCard(new File(['nope'], 'card.txt'))).rejects.toThrow(/Unsupported file format/)
  })
})

describe('tavern → persona field mapping', () => {
  it('maps a V2 card onto the persona schema with documented fallbacks', () => {
    const persona = importTavernCardJson(JSON.stringify(v2Card))
    expect(persona).toEqual({
      name: 'Hiyori',
      personality: 'Bright and energetic',
      background: 'A cheerful student.\n\nAfter school rooftop',
      speakingStyle: 'Stay in character.\n\nExample dialogue:\n{{user}}: Hi\n{{char}}: Hello!',
      language: 'ja-JP',
      nickname: 'せんせい',
      greetings: ['Hi there!', 'Hey!', 'Yo!'],
      live2dModel: 'hiyori_free',
      voice: 'ja-JP-NanamiNeural',
      tags: ['school', 'cheerful'],
    })
    expect(isPersona(persona)).toBe(true)
    expect(validatePersona(persona)).toEqual(persona)
  })

  it('fills documented fallbacks when optional tavern fields are missing', () => {
    const persona = importTavernCardJson(JSON.stringify({ spec: 'chara_card_v2', data: {} }))
    expect(persona).toEqual({
      name: TAVERN_IMPORT_FALLBACKS.name,
      personality: TAVERN_IMPORT_FALLBACKS.personality,
      background: TAVERN_IMPORT_FALLBACKS.background,
      speakingStyle: TAVERN_IMPORT_FALLBACKS.speakingStyle,
      language: TAVERN_IMPORT_FALLBACKS.language,
      nickname: TAVERN_IMPORT_FALLBACKS.nickname,
      greetings: [],
      tags: [],
    })
    expect(() => validatePersona(persona)).not.toThrow()
  })

  it('maps {{user}} nickname to the documented 你 fallback', () => {
    const persona = importTavernCardJson(JSON.stringify({
      data: { name: 'A', extensions: { nickname: '{{user}}' } },
    }))
    expect(persona.nickname).toBe('你')
  })

  it('uses post_history_instructions when system_prompt is absent', () => {
    const persona = importTavernCardJson(JSON.stringify({
      data: { name: 'A', post_history_instructions: 'Be brief.' },
    }))
    expect(persona.speakingStyle).toBe('Be brief.')
  })

  it('imports a PNG V2 fixture and the result can be stored', async () => {
    const png = makePngWithTextChunk('chara', encodeCharaBase64(v2Card))
    const persona = importTavernCardPng(png)
    expect(persona.name).toBe('Hiyori')
    expect(persona.greetings).toEqual(['Hi there!', 'Hey!', 'Yo!'])
    validatePersona(persona)

    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-friend-persona-import-'))
    try {
      const store = new PersonaStore({ dataDir })
      const record = await store.create(persona)
      expect(record.slug).toBe('hiyori')
      await expect(store.get('hiyori')).resolves.toMatchObject({ name: 'Hiyori', language: 'ja-JP' })
    } finally {
      const { rm } = await import('node:fs/promises')
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('importTavernCard follows the same extension dispatch as the legacy helper', async () => {
    const jsonFile = new File([JSON.stringify(v2Card)], 'v2.json', { type: 'application/json' })
    const png = makePngWithTextChunk('ccv3', encodeCharaBase64(v3Card))
    const pngFile = new File([png], 'v3.png', { type: 'image/png' })

    await expect(importTavernCard(jsonFile)).resolves.toMatchObject({ name: 'Hiyori' })
    await expect(importTavernCard(pngFile)).resolves.toMatchObject({ name: 'V3 Girl' })
  })
})
