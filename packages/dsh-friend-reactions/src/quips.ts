import type { WorkEventKind } from './observe.ts'
import type { ReactionLevel } from './settings.ts'

export const QUIP_WINDOW = 3

const QUIPS_ZH: Record<WorkEventKind, readonly string[]> = {
  'turn-start': [
    '我看着你敲下第一行。',
    '嗯，开始了。',
    '我在旁边，不打扰。',
    '你先想，我托着腮等。',
    '这一轮我跟着听。',
    '好，进入工作状态。',
    '我把灯调暗一点。',
    '慢慢来，我在。',
  ],
  'tool-error': [
    '咦，这一下撞墙了。',
    '没事，报错很常见。',
    '我在，慢慢看日志。',
    '别皱眉，再试一次。',
    '这条路不通，换一条。',
    '失败也算信息。',
    '我帮你盯着红字。',
    '深呼吸，我们还能改。',
  ],
  'turn-success': [
    '做成了！',
    '漂亮，这一轮干净。',
    '我看见绿灯了。',
    '值得拍一下手。',
    '收工这一下很利落。',
    '嗯，过了。',
    '给你比个耶。',
    '今天的你很稳。',
  ],
}

const QUIPS_EN: Record<WorkEventKind, readonly string[]> = {
  'turn-start': [
    'I am watching the first keystroke.',
    'Okay, we are starting.',
    'I will stay quiet beside you.',
    'Think first. I can wait.',
    'Listening in this turn.',
    'Work mode on.',
    'I dimmed the lamp a little.',
    'Take your time. I am here.',
  ],
  'tool-error': [
    'Ah, that one hit a wall.',
    'It is okay. Errors happen.',
    'I am here. Read the log slowly.',
    'Do not frown. Try once more.',
    'This path is closed. Another one.',
    'Failure is still information.',
    'I will watch the red text with you.',
    'Breathe. We can still change it.',
  ],
  'turn-success': [
    'You did it!',
    'Clean finish.',
    'I saw the green light.',
    'That deserves a clap.',
    'Neat wrap-up.',
    'Passed.',
    'A little cheer for you.',
    'Steady work today.',
  ],
}

export type QuipBank = Record<WorkEventKind, readonly string[]>

export function quipsFor(language: string): QuipBank {
  return language.toLowerCase().startsWith('en') ? QUIPS_EN : QUIPS_ZH
}

export type QuipPicker = {
  pick(kind: WorkEventKind, language: string): string
}

export function createQuipPicker(random: () => number = Math.random): QuipPicker {
  const recent = new Map<WorkEventKind, string[]>()
  return {
    pick(kind, language) {
      const bank = quipsFor(language)[kind]
      if (bank.length < 8) {
        throw new Error(`dsh-friend-reactions: quip bank for ${kind} has ${bank.length} lines; need ≥ 8`)
      }
      const used = recent.get(kind) ?? []
      const available = bank.filter((line) => !used.includes(line))
      const pool = available.length > 0 ? available : [...bank]
      const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
      const chosen = pool[index] ?? bank[0] ?? ''
      const next = [...used, chosen].slice(-QUIP_WINDOW)
      recent.set(kind, next)
      return chosen
    },
  }
}

export function attachQuip(
  level: ReactionLevel,
  kind: WorkEventKind,
  language: string,
  picker: QuipPicker,
): string | undefined {
  if (level === 'action') {
    return undefined
  }
  return picker.pick(kind, language)
}

export { QUIPS_ZH, QUIPS_EN }
