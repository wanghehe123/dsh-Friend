/**
 * Host-only schemastery schema for `friend-memory`.
 * Imported from `index.ts` only — never from the client half.
 */
import { Schema, type FriendSchema } from '@wish233/dsh-friend-shared'

import { DEFAULT_MEMORY_SETTINGS } from './settings.ts'

export const DEFAULT_MEMORY_SETTINGS_ENTRY = {
  enabled: DEFAULT_MEMORY_SETTINGS.enabled,
  autoSummaryEnabled: DEFAULT_MEMORY_SETTINGS.autoSummaryEnabled,
  autoSummaryIdleMinutes: DEFAULT_MEMORY_SETTINGS.autoSummaryIdleMinutes,
  distillHour: DEFAULT_MEMORY_SETTINGS.distillHour,
  distillMinute: DEFAULT_MEMORY_SETTINGS.distillMinute,
  memoryMaxBytes: DEFAULT_MEMORY_SETTINGS.memoryMaxBytes,
  bootstrapBudgetBytes: DEFAULT_MEMORY_SETTINGS.bootstrapBudgetBytes,
}

export function createFriendMemorySettingsSchema(): FriendSchema {
  return Schema.object({
    enabled: Schema.boolean().default(DEFAULT_MEMORY_SETTINGS.enabled),
    autoSummaryEnabled: Schema.boolean().default(DEFAULT_MEMORY_SETTINGS.autoSummaryEnabled),
    autoSummaryIdleMinutes: Schema.number().default(DEFAULT_MEMORY_SETTINGS.autoSummaryIdleMinutes),
    distillHour: Schema.number().default(DEFAULT_MEMORY_SETTINGS.distillHour),
    distillMinute: Schema.number().default(DEFAULT_MEMORY_SETTINGS.distillMinute),
    memoryMaxBytes: Schema.number().default(DEFAULT_MEMORY_SETTINGS.memoryMaxBytes),
    bootstrapBudgetBytes: Schema.number().default(DEFAULT_MEMORY_SETTINGS.bootstrapBudgetBytes),
    summarizeModel: Schema.any(),
  })
}
