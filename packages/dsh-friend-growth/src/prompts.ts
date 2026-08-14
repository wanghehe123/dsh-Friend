import type { GrowthNode, GrowthProfile, OutlineEvent, ParsedBeat } from './pure.ts'

export function languageRule(language: string): string {
  return `LANGUAGE: Write all human-readable string values (title, summary, narrative, trait_effect, life_story_summary) in ${language}. JSON field names and the JSON structure must remain exactly as specified in English.`
}

export function outlinePrompts(
  profile: GrowthProfile,
  nodes: readonly GrowthNode[],
  language: string,
): { system: string; user: string } {
  const system = [
    'You are a character-life architect for an AI companion.',
    '',
    'Your task is Stage 1 only: sketch a chronological skeleton of this character\'s life. Do NOT write full scenes or first-person memoir yet. Each event is a short title plus one concrete sentence.',
    '',
    'Hard constraints:',
    '1. Output 8–15 events, sorted by age ascending.',
    '2. Every user-provided growth node MUST be represented by at least one event whose node_id equals that node\'s id.',
    '3. You MAY insert transitional events between nodes so the life feels continuous. Transitional events have node_id = null.',
    '4. Each age MUST be an integer, strictly increasing, >= 0, and MUST NOT exceed the character\'s current_age when current_age is given.',
    '5. Stay faithful to base_attributes and world_setting. Do not replace the character with a different person. Do not invent a contradictory world.',
    '6. Titles: short, specific, at most 20 characters. Summaries: one sentence naming a place, a relationship, or a turning action — not an abstract theme.',
    '7. Return ONLY JSON. No markdown fences, no commentary.',
    '',
    languageRule(language),
  ].join('\n')

  const currentAge = profile.currentAge === undefined ? 'unknown' : String(profile.currentAge)
  const birthYear = profile.birthYear === undefined ? 'unknown' : String(profile.birthYear)
  const user = [
    '## Character',
    `- current_age: ${currentAge}`,
    `- birth_year: ${birthYear}`,
    '- world_setting:',
    emptyAsPlaceholder(profile.worldSetting, '(unspecified)'),
    '',
    '- base_attributes (JSON):',
    emptyAsPlaceholder(profile.baseAttributes, '{}'),
    '',
    '## Growth nodes the skeleton MUST cover',
    formatNodesForPrompt(nodes),
    '',
    'Return ONLY JSON of this shape:',
    '{"events":[{"age":8,"title":"...","summary":"...","node_id":1}]}',
    '',
    'Use node_id: null for interpolated events that are not one of the user nodes.',
  ].join('\n')
  return { system, user }
}

export function expandPrompts(
  profile: GrowthProfile,
  batch: readonly OutlineEvent[],
  prior: readonly ParsedBeat[],
  language: string,
): { system: string; user: string } {
  const system = [
    'You are writing autobiographical memories for an AI companion who will later recall these as long-term memories.',
    '',
    'This is Stage 2: expand the given skeleton events into lived scenes.',
    '',
    'Hard constraints:',
    '1. First person ("I" / 「我」). Write a specific scene (time of day, place, one or two concrete actions, a felt emotion). Do NOT write a plot synopsis or a year-in-review.',
    '2. Each narrative is 200–400 characters if the language is Chinese, Japanese, or Korean; roughly 120–250 words for other languages.',
    '3. Keep the provided age and node_id unchanged. Keep chronological identity with the skeleton titles.',
    '4. Stay consistent with "prior life so far". Do not contradict earlier trait_effect notes or repeat the same scene.',
    '5. trait_effect: one sentence on the lasting dent this episode left on personality, values, habits, or how they treat people.',
    '6. importance: a number from 0.0 to 1.0. Character-defining turning points >= 0.80; texture / daily-life scenes 0.40–0.65.',
    '7. Return ONLY JSON. No markdown fences, no commentary.',
    '',
    languageRule(language),
  ].join('\n')

  const user = [
    '## Character',
    '- world_setting:',
    emptyAsPlaceholder(profile.worldSetting, '(unspecified)'),
    '- base_attributes:',
    emptyAsPlaceholder(profile.baseAttributes, '{}'),
    '',
    '## Prior life so far (compressed; do not repeat; do not contradict)',
    compressPriorLife(prior),
    '',
    '## Skeleton events to expand in this batch (in order)',
    JSON.stringify(batch.map(outlineForJson), null, 2),
    '',
    'Return ONLY JSON of this shape:',
    '{"beats":[{"age":8,"title":"...","narrative":"...","trait_effect":"...","importance":0.82,"node_id":1}]}',
  ].join('\n')
  return { system, user }
}

export function reflectPrompts(
  profile: GrowthProfile,
  episodes: readonly ParsedBeat[],
  language: string,
): { system: string; user: string } {
  const system = [
    'You are reflecting on a life already lived, naming what it made this character.',
    '',
    'This is Stage 3: reflection (the generative-agent move from a stream of episodes to higher-level self-knowledge). Abstract many concrete episodes into a few core beliefs / character roots. Also write a short life-story resume.',
    '',
    'Hard constraints:',
    '1. Produce 3–5 reflections. Write each reflection in first person as the character. It is a belief or character root grounded in the episodes (refer to the kind of event, not a newly invented scene). Do not invent new biographical facts.',
    '2. Each reflection narrative is 1–3 sentences. importance MUST be >= 0.90.',
    '3. title: a short name for the belief (for example "I do not ask for help").',
    '4. life_story_summary: a third-person resume of this life, at most 400 characters in Chinese (or about 80–120 words otherwise), suitable to pin into a system prompt. Cover origin → turning points → who they are now. No bullet list.',
    '5. Return ONLY JSON. No markdown fences, no commentary.',
    '',
    languageRule(language),
  ].join('\n')

  const currentAge = profile.currentAge === undefined ? 'unknown' : String(profile.currentAge)
  const user = [
    '## Character',
    `- current_age: ${currentAge}`,
    '- world_setting:',
    emptyAsPlaceholder(profile.worldSetting, '(unspecified)'),
    '- base_attributes:',
    emptyAsPlaceholder(profile.baseAttributes, '{}'),
    '',
    '## Lived episodes (chronological)',
    formatEpisodesForReflect(episodes),
    '',
    'Return ONLY JSON of this shape:',
    '{"reflections":[{"title":"...","narrative":"...","importance":0.93}],"life_story_summary":"..."}',
  ].join('\n')
  return { system, user }
}

function outlineForJson(event: OutlineEvent): Record<string, unknown> {
  return {
    age: event.age,
    title: event.title,
    summary: event.summary,
    node_id: event.nodeId ?? null,
  }
}

function emptyAsPlaceholder(value: string, placeholder: string): string {
  return value.trim().length === 0 ? placeholder : value
}

function formatNodesForPrompt(nodes: readonly GrowthNode[]): string {
  if (nodes.length === 0) {
    return '[]\n(No user nodes were provided. Invent a plausible 8–15 event life from base_attributes alone.)'
  }
  return JSON.stringify(nodes.map((node) => ({
    id: node.id,
    age_from: node.ageFrom ?? null,
    age_to: node.ageTo ?? null,
    stage_label: node.stageLabel,
    title: node.title,
    note: node.note,
  })), null, 2)
}

function compressPriorLife(beats: readonly ParsedBeat[]): string {
  if (beats.length === 0) {
    return 'None yet. This batch is the beginning of the character\'s remembered life.'
  }
  return beats.map((beat) => {
    const age = beat.age === undefined ? '?' : String(beat.age)
    const trait = beat.traitEffect.trim().length === 0 ? '(unspecified)' : beat.traitEffect.trim()
    return `- age ${age} · ${beat.title} · trait_effect: ${trait}`
  }).join('\n')
}

function formatEpisodesForReflect(episodes: readonly ParsedBeat[]): string {
  return episodes.map((beat) => {
    const age = beat.age === undefined ? '未知年龄' : `${beat.age}岁`
    const trait = beat.traitEffect.trim().length === 0 ? '(unspecified)' : beat.traitEffect
    return `### ${age} · ${beat.title} (importance ${beat.importance.toFixed(2)})\ntrait_effect: ${trait}\n${beat.narrative}`
  }).join('\n\n')
}
