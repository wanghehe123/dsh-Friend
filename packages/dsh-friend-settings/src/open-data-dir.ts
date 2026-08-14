import { spawn } from 'node:child_process'

export type OpenDataDirResult = {
  ok: boolean
  command: string
  detail?: string
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
) => { unref?: () => void }

export function openDataDirectory(
  dataDir: string,
  platform: NodeJS.Platform = process.platform,
  spawnImpl: SpawnLike = spawn as SpawnLike,
): OpenDataDirResult {
  const plan = openCommand(platform, dataDir)
  try {
    const child = spawnImpl(plan.command, plan.args)
    child.unref?.()
    return { ok: true, command: plan.command }
  } catch (error) {
    return {
      ok: false,
      command: plan.command,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export function openCommand(
  platform: NodeJS.Platform,
  dataDir: string,
): { command: string; args: string[] } {
  if (platform === 'darwin') {
    return { command: 'open', args: [dataDir] }
  }
  if (platform === 'win32') {
    return { command: 'explorer', args: [dataDir] }
  }
  return { command: 'xdg-open', args: [dataDir] }
}
