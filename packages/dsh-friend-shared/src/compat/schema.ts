/**
 * Runtime schemastery constructor.
 *
 * `@deepseek-ai/schemastery` may be imported at runtime only from this
 * package. Feature packages build their settings schemas through this
 * re-export — never by importing `@deepseek-ai/*` themselves.
 *
 * Host barrel only. Do not add this file to `./universal` or `./client`.
 */
export { default as Schema } from '@deepseek-ai/schemastery'
import type z from '@deepseek-ai/schemastery'
export type { z as FriendSchema }
