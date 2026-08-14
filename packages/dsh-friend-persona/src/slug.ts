const MAX_SLUG_LENGTH = 80

/**
 * Build a filesystem-usable slug from a display name.
 * Letters include CJK, so「小友」stays「小友」instead of becoming empty/hash.
 */
export function slugify(name: string): string {
  const parts = name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length > 0)
  const joined = parts.join('-')
  if (joined.length === 0) return 'character'
  if (joined.length <= MAX_SLUG_LENGTH) return joined
  return joined.slice(0, MAX_SLUG_LENGTH).replace(/-+$/u, '') || 'character'
}

/** First unused slug: `base`, then `base-2`, `base-3`, … */
export function allocateSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; n < Number.MAX_SAFE_INTEGER; n += 1) {
    const candidate = `${base}-${String(n)}`
    if (!used.has(candidate)) return candidate
  }
  throw new Error(`无法为 ${base} 分配 slug`)
}

export function assertSafeSlug(slug: string): void {
  if (
    slug.length === 0
    || slug.includes('/')
    || slug.includes('\\')
    || slug.includes('\0')
    || slug === '.'
    || slug === '..'
    || slug.includes('..')
  ) {
    throw new Error(`非法角色 slug：${slug}`)
  }
}
