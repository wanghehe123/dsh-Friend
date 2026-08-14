import { logPluginMount } from '@wishp3/dsh-friend-shared'

export const name = '@wishp3/dsh-friend-all'

export function apply(_ctx: unknown): void {
  // TODO: host-half implementation
  logPluginMount(name)
}
