/**
 * Shared machinery for the asset scripts: read `models.lock.json`, verify a
 * file against its pinned size and sha256, and download one entry.
 *
 * The rule the whole tooling rests on: an entry with a `sha256` is *verified*,
 * never trusted. A file that exists but hashes differently is a corrupt or
 * tampered asset and must be re-fetched, not accepted because "the size looked
 * right" — that is the whole of D7-F07.
 *
 * @typedef {{ kind?: string, id?: string, target: string, url: string, bytes?: number, sha256: string, licence?: string }} LockEntry
 * @typedef {{ version: number, note: string, models: LockEntry[], fonts: LockEntry[] }} LockFile
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {Uint8Array | Buffer} bytes @returns {string} */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** @returns {Promise<LockFile>} */
export async function readLock() {
  const raw = await readFile(join(root, 'models.lock.json'), 'utf8')
  /** @type {LockFile} */
  const lock = JSON.parse(raw)
  for (const section of /** @type {const} */ (['models', 'fonts'])) {
    if (!Array.isArray(lock[section])) throw new Error(`models.lock.json is missing "${section}"`)
  }
  for (const entry of [...lock.models, ...lock.fonts]) {
    if (typeof entry.url !== 'string' || !/^https:\/\//.test(entry.url)) {
      throw new Error(`models.lock.json: ${entry.target} has no https url`)
    }
    // A null/absent hash is the defect D7-F07 named. Refusing the lock file
    // outright is louder than silently degrading to a size check.
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(
        `models.lock.json: ${entry.target} has no sha256 — nothing is pinned without one`,
      )
    }
  }
  return lock
}

/**
 * `true` only when the file exists and matches both the size and the hash.
 * @param {LockEntry} entry
 */
export async function fileMatches(entry) {
  const file = join(root, entry.target)
  /** @type {import('node:fs').Stats} */
  let info
  try {
    info = await stat(file)
  } catch {
    return false
  }
  if (entry.bytes && info.size !== entry.bytes) return false
  return sha256(await readFile(file)) === entry.sha256
}

/** @param {LockEntry} entry @returns {Promise<number>} bytes written */
export async function downloadEntry(entry) {
  const response = await fetch(entry.url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${entry.url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = sha256(bytes)
  if (actual !== entry.sha256) {
    throw new Error(
      `sha256 mismatch for ${entry.target}: expected ${entry.sha256}, got ${actual} (${bytes.length} bytes)`,
    )
  }
  if (entry.bytes && bytes.length !== entry.bytes) {
    throw new Error(
      `size mismatch for ${entry.target}: expected ${entry.bytes}, got ${bytes.length}`,
    )
  }
  const file = join(root, entry.target)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, bytes)
  return bytes.length
}

/**
 * Fetch every entry, verifying each. Returns false when something could not be
 * produced and `required` was set, so the caller can turn that into an exit code.
 *
 * @param {LockEntry[]} entries
 * @param {{ required: boolean, label: string }} options
 */
export async function fetchAll(entries, { required, label }) {
  /** @type {string[]} */
  const failed = []
  for (const entry of entries) {
    const name = entry.kind ?? entry.id ?? entry.target
    if (await fileMatches(entry)) {
      console.log(`✓ ${name} up to date`)
      continue
    }
    try {
      console.log(`↓ ${name} ← ${entry.url}`)
      const bytes = await downloadEntry(entry)
      console.log(`✓ ${name} (${bytes} bytes, sha256 verified)`)
    } catch (error) {
      failed.push(name)
      console.error(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failed.length > 0) {
    const message = `${label}: ${failed.join(', ')} could not be fetched.`
    if (required) {
      console.error(message)
      return false
    }
    console.warn(`${message} The app will fall back at runtime.`)
  }
  return true
}
