#!/usr/bin/env node
/**
 * Download every pinned asset in `models.lock.json`: the ML weights and the
 * self-hosted fonts.
 *
 * The weights are intentionally not committed (tens of MB of ONNX belongs in an
 * HTTP cache, not a git object). The 24 look strips and the fonts *are*
 * committed — `scripts/gen-luts.mjs` explains why — so on a clean checkout this
 * script only has the model to fetch, and afterwards it is a repair path.
 *
 * Every file is verified against its pinned sha256 before it is written, and a
 * mismatch is a hard failure: the old `fileMatches` accepted a size match alone
 * and a fresh download skipped verification entirely, so `models.lock.json`
 * pinned nothing at all.
 *
 *   node scripts/fetch-models.mjs                    fetch what is missing
 *   REQUIRE_ASSETS=1 node scripts/fetch-models.mjs   hard-fail instead of warning
 *
 * `REQUIRE_ASSETS=1 npm run build` is therefore a real guard: the build runs
 * this first and stops, rather than shipping a bundle whose Look chips 404.
 */

import { fetchAll, readLock } from './lockfile.mjs'

const lock = await readLock()
const required = process.env.REQUIRE_ASSETS === '1'
const ok = await fetchAll([...lock.models, ...lock.fonts], {
  required,
  label: 'Some pinned assets could not be fetched',
})
if (!ok) process.exit(1)
