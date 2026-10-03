import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc, DOC_SCHEMA } from '../../model/defaults'
import type { Doc } from '../../model/types'
import {
  applyPreset,
  applyRecipe,
  deletePreset,
  looksLikeRecipe,
  listPresets,
  MAX_RECIPE_CHARS,
  readClipboardRecipe,
  savePreset,
  serializeRecipe,
  writeClipboardRecipe,
} from './recipes'

type ClipboardStub = {
  text: string | null
  writeText: ReturnType<typeof vi.fn>
  readText: ReturnType<typeof vi.fn>
}

function stubClipboard(options: { failWrite?: boolean; failRead?: boolean } = {}): ClipboardStub {
  const stub: ClipboardStub = {
    text: null,
    writeText: vi.fn(async (text: string) => {
      if (options.failWrite) throw new DOMException('denied', 'NotAllowedError')
      stub.text = text
    }),
    readText: vi.fn(async () => {
      if (options.failRead) throw new DOMException('denied', 'NotAllowedError')
      return stub.text ?? ''
    }),
  }
  vi.stubGlobal('navigator', { clipboard: stub })
  return stub
}

function edited(): Doc {
  const doc = createDoc({
    source: { assetId: 'a1', width: 10, height: 10, name: 'x', mime: 'image/png' },
  })
  return { ...doc, adjust: { ...doc.adjust, exposure: 1.5, saturation: -20 } }
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('serializeRecipe / applyRecipe', () => {
  it('carries the edits and none of the source, output or passport state', () => {
    const doc = edited()
    const recipe = serializeRecipe(doc)
    const parsed = JSON.parse(recipe) as Record<string, unknown>
    expect(parsed.adjust).toMatchObject({ exposure: 1.5, saturation: -20 })
    expect(parsed.source).toBeUndefined()
    expect(parsed.output).toBeUndefined()
    expect(parsed.passport).toBeUndefined()
  })

  it('applies onto the current source and output', () => {
    const target = createDoc({
      source: { assetId: 'b2', width: 4, height: 4, name: 'y', mime: 'image/jpeg' },
    })
    const next = applyRecipe(target, serializeRecipe(edited()))
    expect(next?.adjust.exposure).toBe(1.5)
    expect(next?.source?.assetId).toBe('b2')
    expect(next?.output).toEqual(target.output)
  })

  it('takes the schema from the payload so an older recipe still migrates', () => {
    const payload = JSON.stringify({
      ...JSON.parse(serializeRecipe(edited())),
      schema: 2,
      geometry: { straighten: 999 },
    })
    const next = applyRecipe(createDoc(), payload)
    expect(next?.schema).toBe(DOC_SCHEMA)
    expect(next?.geometry.straighten).toBe(45)
  })

  it('rejects junk rather than half-applying it', () => {
    const doc = createDoc()
    expect(applyRecipe(doc, 'not json')).toBeNull()
    expect(applyRecipe(doc, '"a string"')).toBeNull()
    expect(applyRecipe(doc, '{"unrelated":true}')).toBeNull()
    expect(applyRecipe(doc, JSON.stringify({ ...createDoc(), schema: DOC_SCHEMA + 1 }))).toBeNull()
  })
})

describe('looksLikeRecipe', () => {
  it('accepts a recipe payload and nothing else on the clipboard', () => {
    expect(looksLikeRecipe(serializeRecipe(createDoc()))).toBe(true)
    expect(looksLikeRecipe('https://example.com/image.jpg')).toBe(false)
    expect(looksLikeRecipe('just some words')).toBe(false)
    expect(looksLikeRecipe('[1,2,3]')).toBe(false)
    expect(looksLikeRecipe('"quoted"')).toBe(false)
  })
})

describe('D2-F14 clipboard', () => {
  it('writes the recipe to the system clipboard as plain text', async () => {
    const clipboard = stubClipboard()
    expect(await writeClipboardRecipe(edited())).toBe('clipboard')
    expect(clipboard.writeText).toHaveBeenCalledOnce()
    expect(clipboard.text).toBe(serializeRecipe(edited()))
    // And the payload is text/plain JSON another app could parse.
    expect(looksLikeRecipe(clipboard.text ?? '')).toBe(true)
  })

  it('reads a recipe another app or browser put on the clipboard', async () => {
    const clipboard = stubClipboard()
    clipboard.text = serializeRecipe({
      ...createDoc(),
      adjust: { ...createDoc().adjust, contrast: 30 },
    })
    const raw = await readClipboardRecipe()
    expect(raw).toBe(clipboard.text)
    expect(applyRecipe(createDoc(), raw ?? '')?.adjust.contrast).toBe(30)
  })

  it('falls back to the mirror when the clipboard is blocked', async () => {
    stubClipboard({ failWrite: true, failRead: true })
    expect(await writeClipboardRecipe(edited())).toBe('local')
    expect(await readClipboardRecipe()).toBe(serializeRecipe(edited()))
  })

  it('falls back to the mirror when there is no clipboard API at all', async () => {
    vi.stubGlobal('navigator', {})
    expect(await writeClipboardRecipe(edited())).toBe('local')
    expect(await readClipboardRecipe()).not.toBeNull()
  })

  it('ignores unrelated clipboard text instead of reporting a paste that cannot work', async () => {
    const clipboard = stubClipboard()
    clipboard.text = 'https://example.com/photo.jpg'
    expect(await readClipboardRecipe()).toBeNull()
  })

  it('refuses a payload too large for a clipboard', async () => {
    const clipboard = stubClipboard()
    const doc = createDoc()
    const heavy = {
      ...doc,
      curves: { ...doc.curves, rgb: Array.from({ length: 12000 }, () => ({ x: 1, y: 1 })) },
    }
    expect(await writeClipboardRecipe(heavy)).toBe('too-large')
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })
})

describe('D2-F15 presets', () => {
  it('saves, lists, applies and deletes a preset', () => {
    expect(savePreset('Punchy', edited())).toBe('ok')
    expect(listPresets()).toEqual(['Punchy'])
    const next = applyPreset('Punchy', createDoc())
    expect(next?.adjust.exposure).toBe(1.5)
    expect(deletePreset('Punchy')).toBe(true)
    expect(listPresets()).toEqual([])
    expect(applyPreset('Punchy', createDoc())).toBeNull()
  })

  it('lists every saved preset, sorted, and nothing else in localStorage', () => {
    savePreset('Warm', edited())
    savePreset('Airy', edited())
    localStorage.setItem('ie-clipboard-recipe', 'ignored')
    localStorage.setItem('unrelated', 'ignored')
    expect(listPresets()).toEqual(['Airy', 'Warm'])
  })

  it('refuses an unusable name instead of writing a key that cannot be listed', () => {
    expect(savePreset('', edited())).toBe('invalid-name')
    expect(savePreset('   ', edited())).toBe('invalid-name')
    expect(savePreset('has:colon', edited())).toBe('invalid-name')
    expect(savePreset('x'.repeat(41), edited())).toBe('invalid-name')
    expect(listPresets()).toEqual([])
  })

  it('refuses a recipe too large to store rather than throwing', () => {
    const doc = createDoc()
    const heavy = {
      ...doc,
      curves: { ...doc.curves, rgb: Array.from({ length: 12000 }, () => ({ x: 1, y: 1 })) },
    }
    expect(serializeRecipe(heavy).length).toBeGreaterThan(MAX_RECIPE_CHARS)
    expect(savePreset('Heavy', heavy)).toBe('too-large')
    expect(listPresets()).toEqual([])
  })
})
