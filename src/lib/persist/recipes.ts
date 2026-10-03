import { createDoc } from '../../model/defaults'
import { migrateDoc } from '../../model/migrate'
import type { Doc } from '../../model/types'

const CLIPBOARD_KEY = 'ie-clipboard-recipe'
const PRESET_PREFIX = 'ie-preset:'

/** The payload is plain JSON, so it only has to fit a clipboard and localStorage. */
export const MAX_RECIPE_CHARS = 128 * 1024
export const MAX_PRESET_NAME = 40

export type RecipeWrite = 'clipboard' | 'local' | 'too-large' | 'unavailable'
export type PresetResult = 'ok' | 'invalid-name' | 'too-large' | 'unavailable'

/** A recipe is the document's look, without the source asset or output prefs. */
export function serializeRecipe(doc: Doc): string {
  const { source: _source, output: _output, passport: _passport, ...recipe } = doc
  void _source
  void _output
  void _passport
  return JSON.stringify(recipe)
}

export function applyRecipe(doc: Doc, raw: unknown): Doc | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  if (!isRecipePayload(parsed)) return null
  // `schema` comes from the payload (or from createDoc's default), so a recipe
  // written by an older build still travels the whole migration chain.
  const migrated = migrateDoc({ ...createDoc(), ...(parsed as Record<string, unknown>) })
  if (!migrated) return null
  return { ...migrated, source: doc.source, output: doc.output, passport: doc.passport }
}

/**
 * Whether plain text is a recipe. Anything else on the clipboard — a URL, a
 * word of prose — must not turn "Paste edits" into a no-op that reports
 * success, and the same test keeps an unrelated JSON object from being applied
 * as a document whose edits are all silently reset to neutral.
 */
export function looksLikeRecipe(text: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  return isRecipePayload(parsed)
}

function isRecipePayload(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
  const record = parsed as Record<string, unknown>
  return (
    typeof record.schema === 'number' ||
    typeof record.adjust === 'object' ||
    typeof record.geometry === 'object' ||
    'brightness' in record
  )
}

function clipboardApi(): Clipboard | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { clipboard?: Clipboard }).clipboard ?? null
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/**
 * "Copy edits" has to mean the system clipboard: the payload is JSON, so it is
 * written as `text/plain` and can be pasted into another app, another tab or
 * another machine. `localStorage` is kept only as a mirror, because clipboard
 * *read* is permission-gated in several browsers and paste must still work.
 */
export async function writeClipboardRecipe(doc: Doc): Promise<RecipeWrite> {
  const text = serializeRecipe(doc)
  if (text.length > MAX_RECIPE_CHARS) return 'too-large'
  const api = clipboardApi()
  let onClipboard = false
  if (api?.writeText) {
    try {
      await api.writeText(text)
      onClipboard = true
    } catch {
      onClipboard = false
    }
  }
  const mirrored = writeLocal(CLIPBOARD_KEY, text)
  if (!onClipboard && !mirrored) return 'unavailable'
  return onClipboard ? 'clipboard' : 'local'
}

/** The recipe on the system clipboard, falling back to the localStorage mirror. */
export async function readClipboardRecipe(): Promise<string | null> {
  const api = clipboardApi()
  if (api?.readText) {
    try {
      const text = await api.readText()
      if (text && looksLikeRecipe(text)) return text
    } catch {
      // Permission denied or no user gesture: the mirror is the fallback.
    }
  }
  return readLocal(CLIPBOARD_KEY)
}

export async function hasClipboardRecipe(): Promise<boolean> {
  return (await readClipboardRecipe()) !== null
}

export function presetKey(name: string): string {
  return `${PRESET_PREFIX}${name}`
}

function isValidPresetName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_PRESET_NAME && !trimmed.includes(':')
}

export function savePreset(name: string, doc: Doc): PresetResult {
  if (!isValidPresetName(name)) return 'invalid-name'
  const recipe = serializeRecipe(doc)
  if (recipe.length > MAX_RECIPE_CHARS) return 'too-large'
  return writeLocal(presetKey(name.trim()), recipe) ? 'ok' : 'unavailable'
}

/** Every saved preset name, sorted; unusable rows are listed but not read. */
export function listPresets(): string[] {
  try {
    const names: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(PRESET_PREFIX) && key.length > PRESET_PREFIX.length) {
        names.push(key.slice(PRESET_PREFIX.length))
      }
    }
    return names.sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

export function readPreset(name: string): string | null {
  return readLocal(presetKey(name))
}

export function applyPreset(name: string, doc: Doc): Doc | null {
  const recipe = readPreset(name)
  return recipe === null ? null : applyRecipe(doc, recipe)
}

export function deletePreset(name: string): boolean {
  try {
    localStorage.removeItem(presetKey(name))
    return true
  } catch {
    return false
  }
}
