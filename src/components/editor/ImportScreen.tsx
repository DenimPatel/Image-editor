import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ACCEPT_ATTR, MAX_INPUT_BYTES, SAMPLE_IMAGES } from '../../lib/accept'
import { convertBytes } from '../../lib/format'
import { describeOffline, isOnline, observeNetwork } from '../../lib/assets/network'
import { useIsTouchDevice } from '../ui/useMediaQuery'
import Onboarding from './Onboarding'
import { cdnDisclosure } from './privacy'
import styles from './editor.module.css'
import copy from './onboarding.module.css'

/**
 * Why each bundled photo is here.
 *
 * Three tiles captioned "Sample 1/2/3" are a choice with nothing to choose on:
 * the user picks one at random and learns nothing from which. Each note below
 * says what the photograph *shows*, in words a first-time user already has, so
 * the tile can be picked on purpose.
 *
 * The notes used to name what each photo is a *test case* for — "the exposure
 * test", "the passport framing test", "the looks test". That is the test suite's
 * vocabulary, not the user's: a word like "test" tells a first-time visitor that
 * this picture exists to prove a feature works, which is not what a sample is
 * for, and "exposure" and "looks" are the names of two of the thirteen tool tabs
 * before the reader has met either of them. What is left is the observable
 * property — a blown-out sky, a face off to one side, warm deep shade — which is
 * the reason to pick that tile, and which is the same thing the note always
 * meant.
 *
 * Keyed by file rather than by position, because position is the thing that
 * moves: a fourth sample inserted at the top would otherwise silently inherit
 * Sample 1's claim. `ImportScreen.test.tsx` asserts every sample in
 * `SAMPLE_IMAGES` has an entry here, so a sample added without one fails the
 * build rather than shipping a tile that argues nothing.
 */
const SAMPLE_NOTES: Record<string, string> = {
  'pexels-cesar-o-neill-26650613-34630144.jpg':
    'A bright sky and a shadowed face — try Brightness and Exposure.',
  'pexels-h-ng-quang-official-647624701-39127354.jpg':
    'One person, off to one side — try Passport or a 1:1 crop.',
  'pexels-lucasrvimieiro-16216147.jpg': 'Warm light and deep shade — try a film Look.',
}

/** The offline banner, and its one live region. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => isOnline())
  useEffect(() => observeNetwork(setOnline), [])
  if (online) return null
  return (
    <p role="status" aria-live="polite" className={styles.offlineBanner}>
      {describeOffline()}
    </p>
  )
}

export type ImportScreenProps = {
  onFile: (file: File) => void
  onSample: (url: string, label: string) => void
  error: string | null
  pending?: boolean
  resume?: ReactNode
}

/**
 * The front door: what this is, what it will and will not do to your photo, and
 * the only ways in.
 *
 * Three claims sit at the top, and all three used to be missing or incomplete.
 * There was no statement of what the app *is* — just a heading over a file
 * picker. The privacy claim said "nothing is uploaded", which is true, and said
 * nothing about the one control that fetches 42 MB from a third-party CDN: that
 * was disclosed only inside the Background panel, which is behind the button
 * that causes the fetch and therefore after the decision. The disclosure now
 * lives here, in the same sentence as the claim it qualifies, and `privacy.ts`
 * owns the wording so the two copies cannot drift.
 */
export function ImportScreen({
  onFile,
  onSample,
  error,
  pending = false,
  resume,
}: ImportScreenProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  // `capture` is honoured only where there is a camera to honour it with, so on
  // a desktop the button would be a second control that opens the same picker.
  const isTouch = useIsTouchDevice()

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      onFile(files[0])
    },
    [onFile],
  )

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) {
            onFile(file)
            break
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [onFile])

  return (
    <div className={styles.importScreen} data-testid="import-screen">
      <h1 className={styles.importTitle}>Edit an image</h1>
      <p className={copy.lede}>
        A photo editor that runs in your browser: crop, straighten, adjust colour, remove a
        background, add text, stickers, redaction and layers, then export.
      </p>
      <p className={copy.privacy}>{cdnDisclosure()}</p>
      <Onboarding />

      <div
        className={`${styles.importDrop}${isDragging ? ` ${styles.importDropActive}` : ''}`}
        aria-busy={pending}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          handleFiles(event.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
        }}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(event) => handleFiles(event.target.files)}
        />
        <p>Drop an image here, click to browse, or paste from the clipboard</p>
        {/* The accepted formats, and the one a phone will hand you that is not
            among them, in the same two lines. The HEIC note used to be a third
            paragraph at the very bottom of the screen — under the sample tiles
            and the attribution, where a user with an iPhone never sees it and
            concludes the app is broken rather than that their file is a format
            no browser can decode. It belongs next to the list it is an exception
            to, and the sentence says why: the browser, not this app. */}
        <p className={styles.importHint}>
          JPEG · PNG · WebP · AVIF · GIF · BMP · TIFF, up to {convertBytes(MAX_INPUT_BYTES)}
        </p>
        <p className={styles.importHint}>
          A HEIC/HEIF photo? No browser can open one — save it as JPEG and try again.
        </p>
      </div>

      {isTouch ? (
        <div className={styles.cameraRow}>
          <button
            type="button"
            className={styles.cameraButton}
            onClick={() => cameraRef.current?.click()}
          >
            Take a photo
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label="Take a photo"
            onChange={(event) => {
              handleFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={styles.errorText}>
          {error}
        </p>
      ) : null}

      {/* The pending state, where the user is looking.

          It used to be rendered by `Editor` as a sibling of `<main>`, *below*
          this screen — so on a 900 px-tall window the import screen filled the
          viewport, `document.scrollHeight === clientHeight` (there was nothing to
          scroll to) and the one sentence saying the app was working on their
          file sat below the fold, never painted. The sample tiles were `disabled`,
          and nothing in the stylesheet says what a disabled tile looks like, so
          they looked exactly as they had a moment earlier. The result was a
          decode that can take seconds on a 24-megapixel phone photo, announced
          by nothing at all: `aria-busy` went to a screen reader and to nobody
          else.

          It is here now, directly under the drop zone the user pressed, in the
          accent colour so it cannot be mistaken for one of the muted hints, and
          it is the same element that carries `role="status"` so the announcement
          and the visible sentence are one thing rather than two. */}
      {pending ? (
        <p
          role="status"
          aria-live="polite"
          className={styles.importHint}
          style={{ color: 'var(--ie-accent-bright)', fontWeight: 600 }}
        >
          Opening image…
        </p>
      ) : null}

      {resume}

      <OfflineBanner />

      <p className={styles.importHint}>Or try a sample image</p>
      <div className={styles.sampleGrid}>
        {SAMPLE_IMAGES.map(({ file, label }) => {
          const src = `${import.meta.env.BASE_URL}sample-images/${file}`
          return (
            <button
              key={file}
              type="button"
              className={`${styles.sampleItem} ${copy.sampleTile}`}
              disabled={pending}
              onClick={() => onSample(src, label)}
            >
              <img src={src} alt={label} loading="lazy" />
              <span className={copy.sampleLabel}>{label}</span>
              <span className={copy.sampleNote}>{SAMPLE_NOTES[file]}</span>
            </button>
          )
        })}
      </div>
      <p className={styles.importHint}>
        Photos courtesy of{' '}
        <a href="https://www.pexels.com/license/" target="_blank" rel="noreferrer">
          Pexels
        </a>
      </p>
    </div>
  )
}
