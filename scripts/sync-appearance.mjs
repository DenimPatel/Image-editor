/* Regenerate the inline appearance bootstrap script in `index.html` from
   `src/lib/appearance.ts`, and verify the result is what Prettier would emit.

   Run after changing the settings tables: `npm run appearance:sync`. The test
   in `src/lib/appearance.test.ts` fails if this is ever out of date, so a
   forgotten run is caught rather than shipped. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import prettier from 'prettier'
import { appearanceBootstrapScript } from '../src/lib/appearance.ts'

const root = resolve(import.meta.dirname, '..')
const indexPath = resolve(root, 'index.html')
const html = readFileSync(indexPath, 'utf8')

const start = html.indexOf('      // GENERATED from src/lib/appearance.ts')
if (start === -1) {
  console.error('Could not find the generated bootstrap script in index.html')
  process.exit(1)
}
// Anchor on the *start of the line* holding the open tag. `lastIndexOf(
// '<script>', start)` lands after the tag's existing indent, so slicing from
// there would leave that indent behind and nest the tag one level deeper on
// every run.
const openTag = html.lastIndexOf('<script>', start)
const scriptStart = html.lastIndexOf('\n', openTag) + 1 // End at this script's own closing tag. Scanning to the *next* `<script` would
// swallow the tags in between, and a half-finished earlier run left the next
// script dedented — which is exactly the kind of collateral damage this must
// not repeat.
const closing = html.indexOf('</script>', start)
if (closing === -1) {
  console.error('The generated bootstrap script in index.html is not closed')
  process.exit(1)
}
const scriptEnd = closing + '</script>'.length

const block =
  '    <script>\n' +
  '      /* prettier-ignore */\n' +
  appearanceBootstrapScript()
    .split('\n')
    .map((line) => (line ? '      ' + line : ''))
    .join('\n') +
  '\n    </script>'

const next = html.slice(0, scriptStart) + block + html.slice(scriptEnd)

// Two invariants, both checked rather than assumed:
//   1. the file we just wrote is byte-identical to what Prettier would emit, so
//      `npx prettier --write .` is a no-op and CI's `--check` stays green;
//   2. re-running is a no-op, so the script is a fixed point rather than a
//      thing that has to be watched.
// A generator that needs a follow-up `prettier --write` is a generator whose
// output the guard test would report as drift.
writeFileSync(indexPath, next)

const formatted = await prettier.format(next, {
  ...(await prettier.resolveConfig(indexPath)),
  filepath: indexPath,
})
if (formatted !== next) {
  console.error(
    'Generated index.html is not Prettier-stable.\n' +
      'The generator and the formatter disagree on the emitted indentation; ' +
      'fix appearanceBootstrapScript() rather than reformatting the file, or ' +
      'the guard test in src/lib/appearance.test.ts will fail as drift.',
  )
  process.exit(1)
}

console.log('index.html bootstrap script regenerated and Prettier-stable')
