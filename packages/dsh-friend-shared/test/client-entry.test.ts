import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  bindSettingsClient,
  FRIEND_EVENTS_PATH,
  FRIEND_SETTINGS_NAMESPACES,
} from '../src/client.ts'

const CLIENT_GRAPH = [
  '../src/client.ts',
  '../src/universal.ts',
  '../src/compat/settings-client.ts',
  '../src/compat/events.ts',
  '../src/compat/namespaces.ts',
] as const

describe('shared client entry', () => {
  it('exports settings-client, events, and kebab namespaces', () => {
    expect(FRIEND_EVENTS_PATH).toBe('/friend/events')
    expect(FRIEND_SETTINGS_NAMESPACES.core).toBe('friend-core')
    expect(typeof bindSettingsClient).toBe('function')
  })

  it('does not pull host-only node modules into the client graph', async () => {
    const forbidden = [
      /from ['"]node:/,
      /from ['"]@deepseek-ai\/dsh-host-webserver['"]/,
      /from ['"]@deepseek-ai\/dsh-tools['"]/,
      /from ['"]@deepseek-ai\/dsh-settings['"]/,
      /from ['"]@deepseek-ai\/schemastery['"]/,
      /from ['"]\.\/compat\/schema\.ts['"]/,
      /from ['"]\.\/compat\/push\.ts['"]/,
      /from ['"]\.\/compat\/route\.ts['"]/,
      /from ['"]\.\/compat\/tools\.ts['"]/,
      /from ['"]\.\/compat\/preset\.ts['"]/,
      /from ['"]\.\/compat\/prompt\.ts['"]/,
      /from ['"]\.\/compat\/settings-host\.ts['"]/,
      /from ['"]\.\/dsh-compat\.ts['"]/,
      /from ['"]\.\/friend-paths\.ts['"]/,
      /\bServerResponse\b/,
    ]

    for (const relative of CLIENT_GRAPH) {
      const source = await readFile(new URL(relative, import.meta.url), 'utf8')
      for (const pattern of forbidden) {
        expect(source, `${relative} matches ${pattern}`).not.toMatch(pattern)
      }
    }
  })
})
