#!/usr/bin/env node
/**
 * Generate a standard dsh-Friend plugin package skeleton.
 *
 * Usage:
 *   node scripts/dsh-plugin-new.mjs <short-name> [--no-client] [--dry-run]
 *
 * Writes `packages/dsh-friend-<short-name>/`. Existing files are left untouched
 * and reported on stdout. `--dry-run` prints the files that would be created
 * and does not touch the filesystem.
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCOPE = '@wishp3'
const VERSION = '0.1.0'

/** One-line README / package description for the known M0 package set. */
const DESCRIPTIONS = {
  shared: 'dsh-compat 收口、配置 schema 助手、SSE 基建、i18n',
  persona: '角色卡存取、预设注册、人格提示词分区',
  memory: 'Markdown 记忆存储、记忆工具、自动小结、夜间归纳',
  tts: 'TTS provider seam、队列缓存、文本预处理、播放与口型',
  asr: '语音输入引擎、三种收音模式、转写代理',
  stage: 'Live2D 渲染、资产管理、表情动作工具、悬浮层与 pet 页',
  growth: '人生故事流水线、story.md/beliefs.md 产物',
  reactions: '工作陪伴事件订阅、节流、反应指令',
  settings: '设置父卡片、配置中心整页壳与路由',
  perception: '视觉感知 seam 预留（v1 无实现）',
  all: '聚合 bundle（cordis.patch.yml + 依赖清单）',
}

function parseArgs(argv) {
  let noClient = false
  let dryRun = false
  const positionals = []

  for (const arg of argv) {
    if (arg === '--no-client') {
      noClient = true
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    if (arg.startsWith('-')) {
      console.error(`Unknown flag: ${arg}`)
      printUsage()
      process.exit(1)
    }
    positionals.push(arg)
  }

  if (positionals.length !== 1) {
    printUsage()
    process.exit(1)
  }

  const shortName = positionals[0]
  if (!/^[a-z][a-z0-9-]*$/.test(shortName)) {
    console.error('short-name must be kebab-case starting with a letter')
    process.exit(1)
  }

  return { shortName, noClient, dryRun }
}

function printUsage() {
  console.error('Usage: node scripts/dsh-plugin-new.mjs <short-name> [--no-client] [--dry-run]')
}

function packageName(shortName) {
  return `${SCOPE}/dsh-friend-${shortName}`
}

function descriptionFor(shortName) {
  return DESCRIPTIONS[shortName] ?? `dsh-Friend ${shortName} plugin`
}

function renderPackageJson(shortName, noClient) {
  const name = packageName(shortName)
  const exports = {
    '.': {
      types: './lib/index.d.ts',
      default: './lib/index.js',
    },
  }
  if (!noClient) {
    exports['./client'] = {
      types: './lib/client.d.ts',
      default: './lib/client.js',
    }
  }
  exports['./package.json'] = './package.json'

  const manifest = {
    name,
    version: VERSION,
    private: true,
    type: 'module',
    description: descriptionFor(shortName),
    main: './lib/index.js',
    types: './lib/index.d.ts',
    exports,
    files: ['lib'],
    scripts: {
      build: 'tsdown --config tsdown.config.ts',
      typecheck: 'tsc --noEmit -p tsconfig.json',
    },
  }

  if (!noClient) {
    manifest.dsh = {
      client: {
        platform: 'web',
        inject: [],
      },
    }
  }

  if (shortName !== 'shared' && shortName !== 'all') {
    manifest.dependencies = {
      '@wishp3/dsh-friend-shared': 'workspace:*',
    }
  }

  return `${JSON.stringify(manifest, null, 2)}\n`
}

function renderTsconfig() {
  return `${JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        rootDir: 'src',
        outDir: 'lib',
        noEmit: true,
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`
}

function renderTsdownConfig(shortName, noClient) {
  const name = packageName(shortName)
  const clientLine = noClient ? '' : ',\n  client: true'
  return `import { friendPluginConfig } from '../../shared/tsdown.client.ts'

export default friendPluginConfig({
  name: '${name}'${clientLine},
})
`
}

function renderIndex(shortName) {
  const name = packageName(shortName)
  return `import { logPluginMount } from '@wishp3/dsh-friend-shared'

export const name = '${name}'

export function apply(_ctx: unknown): void {
  // TODO: host-half implementation
  logPluginMount(name)
}
`
}

function renderClient(shortName) {
  const name = `${packageName(shortName)}/client`
  return `export const name = '${name}'
export const inject: string[] = []

export function apply(_ctx: unknown): void {
  // TODO: client-half implementation
  console.info(\`[\${name}] apply()\`)
}
`
}

function renderReadme(shortName, noClient) {
  const name = packageName(shortName)
  const halves = noClient
    ? 'This package is a dsh plugin with a host half only (`src/index.ts`).'
    : 'This package is a dsh plugin with a host half (`src/index.ts`) and a client half (`src/client.ts`).'
  return `# ${name}

${descriptionFor(shortName)}

${halves}
`
}

function planFiles(shortName, noClient) {
  const dir = join(ROOT, 'packages', `dsh-friend-${shortName}`)
  const files = [
    { path: join(dir, 'package.json'), contents: renderPackageJson(shortName, noClient) },
    { path: join(dir, 'tsconfig.json'), contents: renderTsconfig() },
    { path: join(dir, 'tsdown.config.ts'), contents: renderTsdownConfig(shortName, noClient) },
    { path: join(dir, 'src/index.ts'), contents: renderIndex(shortName) },
    { path: join(dir, 'README.md'), contents: renderReadme(shortName, noClient) },
  ]
  if (!noClient) {
    files.splice(4, 0, {
      path: join(dir, 'src/client.ts'),
      contents: renderClient(shortName),
    })
  }
  return { dir, files }
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  const { shortName, noClient, dryRun } = parseArgs(process.argv.slice(2))
  const { files } = planFiles(shortName, noClient)
  const created = []
  const skipped = []

  for (const file of files) {
    if (await pathExists(file.path)) {
      skipped.push(file.path)
      continue
    }
    created.push(file)
  }

  if (dryRun) {
    for (const file of created) {
      console.log(relative(ROOT, file.path))
    }
    return
  }

  for (const file of created) {
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.contents, 'utf8')
    console.log(`created ${relative(ROOT, file.path)}`)
  }

  for (const path of skipped) {
    console.log(`skipped ${relative(ROOT, path)} (already exists)`)
  }
}

await main()
