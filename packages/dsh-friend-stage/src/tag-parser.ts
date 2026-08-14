import {
  isHiyoriExpression,
  isStageCueName,
  isStageMotionGroup,
} from './tag-vocab.ts'

/**
 * Longest portable tag is `[motion:Embarrassed]` (21). 48 is enough for a
 * well-formed unknown word we still want to strip, and short enough that an
 * unclosed `[` cannot swallow a paragraph of body text.
 */
export const MAX_STAGE_TAG_LENGTH = 48

export const STAGE_TAG_KINDS = ['expr', 'motion', 'cue'] as const
export type StageTagKind = (typeof STAGE_TAG_KINDS)[number]

export type StageTagEvent = Readonly<{
  kind: StageTagKind
  value: string
  /** True only when `value` is in that kind's vocabulary. Unknown words are stripped, not applied. */
  applied: boolean
}>

export type TagParseDelta = Readonly<{
  displayText: string
  ttsText: string
  events: readonly StageTagEvent[]
}>

const CLOSED_TAG = /^\[(expr|motion|cue):([^\]]*)\]$/u
const PROTOCOL_VALUE = /^[A-Za-z][A-Za-z0-9_]*$/u

function emptyDelta(): TagParseDelta {
  return { displayText: '', ttsText: '', events: [] }
}

function textDelta(text: string): TagParseDelta {
  if (text.length === 0) return emptyDelta()
  return { displayText: text, ttsText: text, events: [] }
}

function mergeDeltas(parts: readonly TagParseDelta[]): TagParseDelta {
  let displayText = ''
  let ttsText = ''
  const events: StageTagEvent[] = []
  for (const part of parts) {
    displayText += part.displayText
    ttsText += part.ttsText
    events.push(...part.events)
  }
  return { displayText, ttsText, events }
}

export function isKnownStageTagValue(kind: StageTagKind, value: string): boolean {
  switch (kind) {
    case 'expr':
      return isHiyoriExpression(value)
    case 'motion':
      return isStageMotionGroup(value)
    case 'cue':
      return isStageCueName(value)
  }
}

/**
 * Closed-tag policy:
 *
 * - Well-formed `[expr|motion|cue:<token>]` is **always stripped** from display
 *   and TTS (zero protocol leak), even when the token is unknown.
 * - Unknown tokens emit `{ applied: false }` so the stage does not change.
 * - Anything else (`[foo:bar]`, empty value, spaces/punctuation in the value,
 *   missing colon) is **illegal** and passed through as ordinary text, matching
 *   the spec's 非法透传 rule so we do not hide real prose that happened to use
 *   brackets.
 */
export function classifyClosedStageTag(raw: string):
  | { mode: 'strip'; event: StageTagEvent }
  | { mode: 'passthrough' } {
  const match = CLOSED_TAG.exec(raw)
  if (match === null) return { mode: 'passthrough' }
  const kind = match[1]
  const value = match[2]?.trim() ?? ''
  if (kind !== 'expr' && kind !== 'motion' && kind !== 'cue') return { mode: 'passthrough' }
  if (value.length === 0 || !PROTOCOL_VALUE.test(value)) return { mode: 'passthrough' }
  return {
    mode: 'strip',
    event: {
      kind,
      value,
      applied: isKnownStageTagValue(kind, value),
    },
  }
}

/**
 * Stream-safe parser for `[expr:*]` / `[motion:*]` / `[cue:*]`.
 *
 * Holds an incomplete `[…` in an internal buffer so a tag split across chunks
 * (`[ex` + `pr:happy]`) never flashes in the UI or TTS. Unclosed buffers are
 * released as plain text on `flush()`, or earlier if they exceed
 * {@link MAX_STAGE_TAG_LENGTH}.
 */
export class StreamingTagParser {
  private tagBuffer = ''

  push(chunk: string): TagParseDelta {
    if (chunk.length === 0) return emptyDelta()
    let displayText = ''
    const events: StageTagEvent[] = []

    for (const char of chunk) {
      if (this.tagBuffer.length === 0) {
        if (char === '[') {
          this.tagBuffer = '['
        } else {
          displayText += char
        }
        continue
      }

      if (char === '[') {
        displayText += this.tagBuffer
        this.tagBuffer = '['
        continue
      }

      this.tagBuffer += char

      if (this.tagBuffer.length > MAX_STAGE_TAG_LENGTH) {
        displayText += this.tagBuffer
        this.tagBuffer = ''
        continue
      }

      if (char !== ']') continue

      const classified = classifyClosedStageTag(this.tagBuffer)
      if (classified.mode === 'passthrough') {
        displayText += this.tagBuffer
      } else {
        events.push(classified.event)
      }
      this.tagBuffer = ''
    }

    return { displayText, ttsText: displayText, events }
  }

  flush(): TagParseDelta {
    if (this.tagBuffer.length === 0) return emptyDelta()
    const leftover = this.tagBuffer
    this.tagBuffer = ''
    return textDelta(leftover)
  }
}

export function parseStageTags(text: string): TagParseDelta {
  const parser = new StreamingTagParser()
  return mergeDeltas([parser.push(text), parser.flush()])
}

export function concatTagParseDeltas(parts: readonly TagParseDelta[]): TagParseDelta {
  return mergeDeltas(parts)
}
