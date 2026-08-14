/**
 * Browser platform modules the dsh web shell seeds into the loader table.
 *
 * Client bundles must treat these as externals so React / cordis / slot
 * runtimes stay singletons. Keep this list as the only copy in-repo.
 */
export const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

export type PlatformModule = (typeof PLATFORM_MODULES)[number]
