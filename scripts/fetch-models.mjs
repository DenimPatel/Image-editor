#!/usr/bin/env node
/**
 * Download the pinned ML weights in models.lock.json into public/models/.
 *
 * Weights are intentionally not committed. Running this is a no-op when the
 * files already match the lock, so it is safe to call repeatedly. It fails
 * loudly with REQUIRE_MODELS=1 (used when a deploy must ship a working AI
 * button) and otherwise warns so a plain build still succeeds without weights.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(join(root, 'models.lock.json'), 'utf8'));
const requireModels = process.env.REQUIRE_MODELS === '1';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fileMatches(entry) {
  try {
    const info = await stat(join(root, entry.target));
    if (entry.bytes && info.size !== entry.bytes) return false;
    if (!entry.sha256) return true;
    const buffer = await readFile(join(root, entry.target));
    return sha256(buffer) === entry.sha256;
  } catch {
    return false;
  }
}

let failed = false;
for (const entry of lock.models) {
  if (await fileMatches(entry)) {
    console.log(`✓ ${entry.kind} up to date`);
    continue;
  }
  try {
    console.log(`↓ ${entry.kind} ← ${entry.url}`);
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (entry.sha256 && sha256(buffer) !== entry.sha256) throw new Error('sha256 mismatch');
    await mkdir(join(root, dirname(entry.target)), { recursive: true });
    await writeFile(join(root, entry.target), buffer);
    console.log(`✓ ${entry.kind} (${buffer.length} bytes)`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${entry.kind}: ${error.message}`);
  }
}

if (failed) {
  const message = 'Some models could not be fetched.';
  if (requireModels) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} The AI features will show a manual fallback.`);
}
