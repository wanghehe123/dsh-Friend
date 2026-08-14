/**
 * Chrome Web Speech often prepends the last finalized utterance to the next
 * one (cumulative results, or one transcript that grows). Drop that prefix
 * so auto-listen sends only the new words.
 */
export function stripReplayPrefix(text: string, previous: string): string {
  const trimmed = text.trim()
  const echo = previous.trim()
  if (echo.length === 0) {
    return trimmed
  }
  if (trimmed === echo) {
    return ''
  }
  if (trimmed.startsWith(echo)) {
    // Preserve a leading word separator: the mode machine concatenates final
    // suffixes, so `hello` + ` world` must remain `hello world`.
    return trimmed.slice(echo.length).trimEnd()
  }
  return trimmed
}
