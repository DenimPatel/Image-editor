#!/usr/bin/env node
/**
 * Write the PWA icons: `public/icon-192.png`, `public/icon-512.png` (maskable
 * and any) and `public/apple-touch-icon.png`.
 *
 * Generated rather than hand-drawn so the mark, the corner radius and the
 * background colour are one expression that every browser's icon request agrees
 * on — a mis-sized `apple-touch-icon` is the classic "installed app shows the
 * page screenshot" bug. Drawn with the same PNG writer as the look strips.
 *
 *   node scripts/gen-icons.mjs
 *   node scripts/gen-icons.mjs --check
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { encodeRgbPng } from './png.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

const BACKGROUND = [18, 18, 20]
const ACCENT = [255, 209, 102]

/** Smooth coverage across a signed distance, so the mark is not stair-stepped. */
/** @param {number} distance @param {number} feather @returns {number} */
function coverage(distance, feather) {
  return Math.max(0, Math.min(1, 0.5 - distance / feather))
}

/**
 * Full-bleed on purpose. A rounded or transparent icon is re-masked differently
 * by every launcher and by iOS, and the classic result is an installed app
 * showing a black box or the page screenshot. A maskable icon is a square of
 * background with the mark inside the 80% safe zone, so one file serves both
 * `any` and `maskable` purposes.
 */
/** @param {number} size @returns {Uint8Array} */
function renderIcon(size) {
  const rgb = new Uint8Array(size * size * 3)
  const centre = (size - 1) / 2
  const feather = Math.max(1, size / 96)
  const scale = size * 0.3
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x - centre, y - centre) / scale
      // An aperture ring with a solid centre: two annuli, so the glyph still
      // reads at 48px in a launcher grid.
      const ring = coverage(Math.abs(r - 0.82) - 0.14, feather / scale)
      const dot = coverage(r - 0.32, feather / scale)
      const mark = Math.min(1, Math.max(ring, dot))
      const offset = (y * size + x) * 3
      for (let c = 0; c < 3; c += 1) {
        rgb[offset + c] = Math.round(BACKGROUND[c] * (1 - mark) + ACCENT[c] * mark)
      }
    }
  }
  return encodeRgbPng(size, size, rgb)
}

/** @type {{ file: string, size: number }[]} */
const TARGETS = [
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  { file: 'public/apple-touch-icon.png', size: 180 },
]

await mkdir(join(root, 'public'), { recursive: true })

/** @type {number} */
let drifted = 0
for (const { file, size } of TARGETS) {
  const png = renderIcon(size)
  if (check) {
    let current
    try {
      current = await readFile(join(root, file))
    } catch {
      current = undefined
    }
    if (!current || !current.equals(png)) {
      console.error(`✗ ${file} differs from the generated icon — run \`npm run icons:gen\``)
      drifted += 1
      continue
    }
  } else {
    await writeFile(join(root, file), png)
  }
  console.log(`✓ ${file} (${size}x${size}, ${png.length} bytes)`)
}

if (drifted > 0) process.exit(1)
