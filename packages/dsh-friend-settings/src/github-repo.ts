/**
 * Single source for the GitHub repository used by update checks and
 * desktop-shell download links.
 *
 * PLACEHOLDER: `wish233/dsh-Friend` is not the final project repo.
 * Replace this constant before publishing; do not copy the owner/repo
 * string into other files.
 */
export const FRIEND_GITHUB_REPO = 'wish233/dsh-Friend' as const

export const FRIEND_GITHUB_RELEASES_API =
  `https://api.github.com/repos/${FRIEND_GITHUB_REPO}/releases/latest` as const

export const FRIEND_GITHUB_RELEASES_PAGE =
  `https://github.com/${FRIEND_GITHUB_REPO}/releases/latest` as const
