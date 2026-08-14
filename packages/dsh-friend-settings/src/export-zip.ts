/**
 * Zip the friend data root, excluding cache/ and vendor/.
 * STORE method only — no extra compression dependency.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export const EXPORT_EXCLUDED_DIR_NAMES = ['cache', 'vendor'] as const

export type ExportEntry = {
  name: string
  data: Uint8Array
}

export function isExcludedExportPath(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/u).filter((part) => part.length > 0)
  return parts.some((part) => (EXPORT_EXCLUDED_DIR_NAMES as readonly string[]).includes(part))
}

export async function listExportEntries(root: string): Promise<ExportEntry[]> {
  const files: string[] = []
  await walkFiles(root, root, files)
  const entries: ExportEntry[] = []
  for (const absolute of files) {
    const name = posixRel(root, absolute)
    if (isExcludedExportPath(name)) {
      continue
    }
    entries.push({ name, data: new Uint8Array(await readFile(absolute)) })
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

export function buildZipStore(files: readonly ExportEntry[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(file.data)
    const local = localFileHeader(nameBytes, file.data.byteLength, crc)
    locals.push(local, file.data)
    centrals.push(centralDirectoryHeader(nameBytes, file.data.byteLength, crc, offset))
    offset += local.byteLength + file.data.byteLength
  }
  const centralSize = centrals.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const eocd = endOfCentralDirectory(files.length, centralSize, offset)
  return concat([
    ...locals,
    ...centrals,
    eocd,
  ])
}

export function zipEntryNames(zip: Uint8Array): string[] {
  const names: string[] = []
  let offset = 0
  while (offset + 30 <= zip.byteLength) {
    const view = new DataView(zip.buffer, zip.byteOffset + offset, zip.byteLength - offset)
    if (view.getUint32(0, true) !== 0x04034b50) {
      break
    }
    const nameLength = view.getUint16(26, true)
    const extraLength = view.getUint16(28, true)
    const size = view.getUint32(18, true)
    const name = decoder.decode(zip.subarray(offset + 30, offset + 30 + nameLength))
    names.push(name)
    offset += 30 + nameLength + extraLength + size
  }
  return names
}

async function walkFiles(root: string, current: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(current, entry.name)
    const rel = posixRel(root, full)
    if (isExcludedExportPath(rel)) {
      continue
    }
    if (entry.isDirectory()) {
      await walkFiles(root, full, out)
      continue
    }
    if (entry.isFile()) {
      out.push(full)
    }
  }
}

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join('/')
}

function localFileHeader(name: Uint8Array, size: number, crc: number): Uint8Array {
  const header = new Uint8Array(30 + name.byteLength)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0, true)
  view.setUint32(14, crc, true)
  view.setUint32(18, size, true)
  view.setUint32(22, size, true)
  view.setUint16(26, name.byteLength, true)
  header.set(name, 30)
  return header
}

function centralDirectoryHeader(name: Uint8Array, size: number, crc: number, offset: number): Uint8Array {
  const header = new Uint8Array(46 + name.byteLength)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0, true)
  view.setUint16(14, 0, true)
  view.setUint32(16, crc, true)
  view.setUint32(20, size, true)
  view.setUint32(24, size, true)
  view.setUint16(28, name.byteLength, true)
  view.setUint32(42, offset, true)
  header.set(name, 46)
  return header
}

function endOfCentralDirectory(count: number, centralSize: number, centralOffset: number): Uint8Array {
  const header = new Uint8Array(22)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, count, true)
  view.setUint16(10, count, true)
  view.setUint32(12, centralSize, true)
  view.setUint32(16, centralOffset, true)
  return header
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const CRC_TABLE = makeCrcTable()

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let crc = index
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    table[index] = crc >>> 0
  }
  return table
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
