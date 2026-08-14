import { logPluginMount } from '@wish233/dsh-friend-shared'

export const name = '@wish233/dsh-friend-all'

export function apply(_ctx: unknown): void {
  // TODO: host-half implementation
  logPluginMount(name)
}
