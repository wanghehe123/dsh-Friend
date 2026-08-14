/**
 * Single source for the GitHub repository used by update checks and
 * desktop-shell download links.
 */
export const FRIEND_GITHUB_REPO = 'wanghehe123/dsh-Friend' as const

export const FRIEND_GITHUB_RELEASES_API =
  `https://api.github.com/repos/${FRIEND_GITHUB_REPO}/releases/latest` as const

export const FRIEND_GITHUB_RELEASES_PAGE =
  `https://github.com/${FRIEND_GITHUB_REPO}/releases/latest` as const
