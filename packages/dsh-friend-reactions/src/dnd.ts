import type { QuietWindow } from './settings.ts'

export function isInQuietHours(now: Date, windows: readonly QuietWindow[]): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes()
  return windows.some((window) => windowContains(minutes, parseHm(window.start), parseHm(window.end)))
}

export function cronMatches(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/u)
  if (parts.length !== 5) {
    return false
  }
  const [minute, hour, day, month, weekday] = parts
  return fieldMatches(minute, now.getMinutes(), 0, 59)
    && fieldMatches(hour, now.getHours(), 0, 23)
    && fieldMatches(day, now.getDate(), 1, 31)
    && fieldMatches(month, now.getMonth() + 1, 1, 12)
    && fieldMatches(weekday, now.getDay(), 0, 6)
}

export function isDoNotDisturb(now: Date, windows: readonly QuietWindow[], crons: readonly string[]): boolean {
  if (isInQuietHours(now, windows)) {
    return true
  }
  return crons.some((expr) => cronMatches(expr, now))
}

function parseHm(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(value.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return undefined
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) {
    return undefined
  }
  return hours * 60 + minutes
}

function windowContains(now: number, start: number | undefined, end: number | undefined): boolean {
  if (start === undefined || end === undefined) {
    return false
  }
  if (start === end) {
    return true
  }
  if (start < end) {
    return now >= start && now < end
  }
  return now >= start || now < end
}

function fieldMatches(field: string | undefined, value: number, min: number, max: number): boolean {
  if (field === undefined || field === '*') {
    return true
  }
  return field.split(',').some((part) => {
    const range = /^(\d+)-(\d+)$/u.exec(part)
    if (range !== null && range[1] !== undefined && range[2] !== undefined) {
      const from = Number(range[1])
      const to = Number(range[2])
      return value >= from && value <= to && from >= min && to <= max
    }
    const parsed = Number(part)
    return Number.isInteger(parsed) && parsed === value
  })
}
