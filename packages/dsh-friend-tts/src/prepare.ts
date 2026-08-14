/**
 * Host-side TTS text prep: strip stage protocol tags, markdown, and
 * parenthetical stage directions, then split sentences so the first clause
 * can be enqueued first (lower first-sound latency).
 *
 * Protocol tags go through `@wishp3/dsh-friend-stage/tags` so TTS strip
 * and stage `ttsText` cannot drift. Streaming replies use
 * {@link StreamingTagParser} so a tag
 * split across chunks never reaches speakable text. This file is host-only;
 * the client half does not import it.
 */
import {
  StreamingTagParser,
  concatTagParseDeltas,
  type StageTagEvent,
} from '@wishp3/dsh-friend-stage/tags'

export { FRIEND_TTS_PREVIEW_SENTENCE } from './preview-sentence.ts'

export type PrepareTtsTextOptions = {
  /** When false, keep `（…）` / `(…)` asides. Protocol tags are always stripped. */
  stripStageDirections?: boolean
}

export type PreparedTtsText = {
  /** Full speakable string after stripping. */
  speakable: string
  /** Sentence segments in order; first item is the first-sound short-circuit. */
  sentences: readonly string[]
  /** Stage display text (tags stripped, parentheticals kept). */
  displayText: string
}

const SENTENCE_END = /[。！？.!?]/u

export type StreamingTtsPrepareDelta = {
  displayDelta: string
  displayText: string
  ttsDelta: string
  events: readonly StageTagEvent[]
  sentences: readonly string[]
}

export type StreamingTtsPreparer = {
  push(chunk: string): StreamingTtsPrepareDelta
  flush(): StreamingTtsPrepareDelta
}

export function stripStageProtocolTags(text: string): string {
  const parser = new StreamingTagParser()
  return concatTagParseDeltas([parser.push(text), parser.flush()]).ttsText
}

/**
 * Stream-safe prepare: tags are stripped per chunk via
 * {@link StreamingTagParser}; markdown / parentheticals run only on a
 * completed sentence so a `（挥` + `手）` split cannot leak.
 */
export function createStreamingTtsPreparer(
  options: PrepareTtsTextOptions = {},
): StreamingTtsPreparer {
  const parser = new StreamingTagParser()
  let displayText = ''
  let ttsBuffer = ''

  const emit = (
    parsed: { displayText: string; ttsText: string; events: readonly StageTagEvent[] },
    flushAll: boolean,
  ): StreamingTtsPrepareDelta => {
    displayText += parsed.displayText
    ttsBuffer += parsed.ttsText
    return {
      displayDelta: parsed.displayText,
      displayText,
      ttsDelta: parsed.ttsText,
      events: parsed.events,
      sentences: drainSpeakableSentences(ttsBuffer, flushAll, options, (rest) => {
        ttsBuffer = rest
      }),
    }
  }

  return {
    push(chunk) {
      return emit(parser.push(chunk), false)
    },
    flush() {
      return emit(parser.flush(), true)
    },
  }
}

function drainSpeakableSentences(
  buffer: string,
  flushAll: boolean,
  options: PrepareTtsTextOptions,
  setRest: (rest: string) => void,
): string[] {
  const parts = splitSentences(buffer)
  if (parts.length === 0) {
    if (flushAll) {
      setRest('')
    }
    return []
  }
  const complete = flushAll || sentenceTerminator.test(buffer.trim().slice(-1))
  const ready = complete ? parts : parts.slice(0, -1)
  const rest = complete ? '' : (parts[parts.length - 1] ?? '')
  setRest(rest)
  const sentences: string[] = []
  for (const part of ready) {
    const speakable = finalizeSpeakableSentence(part, options)
    if (speakable !== undefined) {
      sentences.push(speakable)
    }
  }
  return sentences
}

function finalizeSpeakableSentence(raw: string, options: PrepareTtsTextOptions): string | undefined {
  let text = stripMarkdown(raw)
  if (options.stripStageDirections !== false) {
    text = stripParentheticalStageDirections(text)
  }
  text = normalizeSpeakableWhitespace(text)
  return isSpeakableText(text) ? text : undefined
}

const sentenceTerminator = SENTENCE_END

export function prepareTtsText(raw: string, options: PrepareTtsTextOptions = {}): PreparedTtsText {
  const displayText = stripStageProtocolTags(raw)
  let text = stripMarkdown(displayText)
  if (options.stripStageDirections !== false) {
    text = stripParentheticalStageDirections(text)
  }
  text = normalizeSpeakableWhitespace(text)
  const sentences = splitSentences(text).filter(isSpeakableText)
  return {
    speakable: sentences.join('') || text,
    sentences,
    displayText,
  }
}

/**
 * Old-repo `prepareTextForTts`: drop full-width and half-width parenthetical
 * stage directions, then collapse leftover whitespace.
 */
export function stripParentheticalStageDirections(text: string): string {
  let next = text.replace(/（[^）]*）/gu, '')
  next = next.replace(/\([^)]*\)/gu, '')
  return normalizeSpeakableWhitespace(next)
}

export function stripMarkdown(text: string): string {
  let next = text.replace(/```[\s\S]*?```/gu, ' ')
  next = next.replace(/`([^`]+)`/gu, '$1')
  next = next.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
  next = next.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
  next = next.replace(/\*\*([^*]+)\*\*/gu, '$1')
  next = next.replace(/__([^_]+)__/gu, '$1')
  next = next.replace(/\*([^*]+)\*/gu, '$1')
  next = next.replace(/(^|[\s（(])_([^_]+)_/gu, '$1$2')
  next = next.replace(/^#{1,6}\s+/gmu, '')
  return next
}

export function splitSentences(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return []
  }
  const result: string[] = []
  let last = 0
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === undefined || !SENTENCE_END.test(char)) {
      continue
    }
    const end = index + 1
    const segment = trimmed.slice(last, end).trim()
    if (segment.length > 0) {
      result.push(segment)
    }
    last = end
  }
  const remaining = trimmed.slice(last).trim()
  if (remaining.length > 0) {
    result.push(remaining)
  }
  return result
}

export function isSpeakableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

export function normalizeSpeakableWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[ \t]+([，。！？、；：,.!?;:])/gu, '$1')
    .trim()
}
