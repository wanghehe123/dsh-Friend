#!/usr/bin/env node
/**
 * Local npm release for the 11 @wishp3/dsh-friend-* packages.
 *
 *   export CI=true
 *   node scripts/publish-npm.mjs --dry-run
 *   node scripts/publish-npm.mjs
 *
 * Requires an npm login that can publish the @wishp3 scope
 * (`npm whoami`, then `pnpm publish -r`). Does not use provenance
 * (that is the GitHub Actions OIDC path in release.yml).
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function parseArgs(argv) {
  return { dryRun: argv.includes('--dry-run'), help: argv.includes('--help') || argv.includes('-h') }
}

export function usage() {
  return `Usage: node scripts/publish-npm.mjs [--dry-run]

Run the release gate, then publish all workspace packages to npm.
Set CI=true first (pnpm 11 aborts without a TTY).`
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
      ...options,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return 0
  }

  await run('pnpm', ['-r', '--if-present', 'run', 'build'])
  await run('pnpm', ['typecheck'])
  await run('pnpm', ['test'])
  await run('node', ['scripts/aggregate.mjs', '--check'])
  await run('node', ['scripts/release-scan.mjs', '--pack', '--check-versions', '--require-publishable'])

  const publishArgs = ['publish', '-r', '--access', 'public', '--no-git-checks']
  if (options.dryRun) publishArgs.push('--dry-run')
  await run('pnpm', publishArgs)
  return 0
}

const invocation = process.argv[1] === undefined ? undefined : fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === invocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
