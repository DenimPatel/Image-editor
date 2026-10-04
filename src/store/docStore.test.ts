import { beforeEach, describe, expect, it } from 'vitest'
import { createTextLayer } from '../features/layers/factory'
import { createDoc, DOC_SCHEMA } from '../model/defaults'
import { liveAssetIds, structurallyEqual, useDocStore } from './docStore'

function state() {
  return useDocStore.getState()
}

beforeEach(() => {
  useDocStore.getState().load(createDoc())
})

describe('structurallyEqual', () => {
  it('compares primitives, null and NaN the way the store needs', () => {
    expect(structurallyEqual(1, 1)).toBe(true)
    expect(structurallyEqual(1, 2)).toBe(false)
    expect(structurallyEqual(null, null)).toBe(true)
    expect(structurallyEqual(null, {})).toBe(false)
    expect(structurallyEqual(Number.NaN, Number.NaN)).toBe(true)
  })

  it('compares nested objects and arrays by value', () => {
    expect(structurallyEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(structurallyEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false)
    expect(structurallyEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(structurallyEqual([1, 2], { 0: 1, 1: 2, length: 2 })).toBe(false)
  })

  it('is sensitive to added and removed keys', () => {
    expect(structurallyEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(structurallyEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    expect(structurallyEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false)
  })

  it('sees two independent copies of the same default doc as equal', () => {
    expect(structurallyEqual(createDoc(), createDoc())).toBe(true)
  })
})

describe('update: no-op guard', () => {
  it('ignores a recipe that rebuilds an identical document', () => {
    const before = state()
    before.update((doc) => ({ ...doc }))
    const after = state()
    expect(after.past).toHaveLength(0)
    expect(after.revision).toBe(before.revision)
  })

  it('ignores a recipe that changes only nested object identity', () => {
    const before = state().revision
    state().update((doc) => ({
      ...doc,
      adjust: { ...doc.adjust },
      geometry: { ...doc.geometry, crop: { ...doc.geometry.crop } },
      hsl: { ...doc.hsl, red: { ...doc.hsl.red } },
    }))
    expect(state().past).toHaveLength(0)
    expect(state().revision).toBe(before)
  })

  it('ignores setting a value to the value it already has', () => {
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 0 } }))
    state().update((doc) => ({ ...doc, output: { ...doc.output, dpi: doc.output.dpi } }))
    expect(state().past).toHaveLength(0)
  })

  it('still commits a real change and bumps revision', () => {
    const before = state().revision
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 0.5 } }))
    expect(state().past).toHaveLength(1)
    expect(state().revision).toBe(before + 1)
  })

  it('detects a change nested three levels down', () => {
    state().update((doc) => ({
      ...doc,
      geometry: { ...doc.geometry, crop: { ...doc.geometry.crop, x: 0.2 } },
    }))
    expect(state().past).toHaveLength(1)
  })

  it('detects an element change inside a layer array', () => {
    const doc = createDoc()
    state().load(doc)
    state().update((current) => ({
      ...current,
      layers: [
        {
          id: 'l1',
          kind: 'text',
          name: 'a',
          visible: true,
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
          text: 'hi',
          style: {
            fontId: 'inter',
            size: 8,
            color: '#ffffff',
            align: 'center',
            lineHeight: 1.2,
            tracking: 0,
            bold: false,
            italic: false,
            strokeColor: '#000000',
            strokeWidth: 0,
            shadow: false,
            pillBackground: null,
            arc: 0,
          },
        },
      ],
    }))
    expect(state().past).toHaveLength(1)
    state().update((current) => ({
      ...current,
      layers: current.layers.map((layer) => ({ ...layer, visible: false })),
    }))
    expect(state().past).toHaveLength(2)
  })
})

describe('update: recipe-only signature', () => {
  it('cannot be called with a partial patch — the shallow-merge footgun is gone', () => {
    const update = state().update
    // @ts-expect-error a partial patch would wipe `geometry.crop` and friends
    expect(() => update({ geometry: { straighten: 1 } })).toThrow(TypeError)
  })

  it('still accepts the recipe form', () => {
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, warmth: 10 } }))
    expect(state().present.adjust.warmth).toBe(10)
  })
})

describe('interactions', () => {
  it('collapses a bracketed edit run to one entry and reopens after', () => {
    state().beginInteraction('brightness')
    for (let i = 1; i <= 30; i += 1) {
      state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: i / 100 } }))
    }
    expect(state().past).toHaveLength(1)
    state().endInteraction()
    expect(state().interaction.key).toBeNull()
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 1 } }))
    expect(state().past).toHaveLength(2)
  })

  it('undo closes an open interaction', () => {
    state().beginInteraction('crop')
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 1 } }))
    state().undo()
    expect(state().interaction.key).toBeNull()
  })
})

describe('transient edits', () => {
  it('apply without an undo entry but still bump revision', () => {
    const before = state().revision
    state().update((doc) => ({ ...doc, output: { ...doc.output, dpi: 600 } }), { transient: true })
    expect(state().present.output.dpi).toBe(600)
    expect(state().past).toHaveLength(0)
    expect(state().revision).toBe(before + 1)
  })

  it('do not consume the 50 undo slots', () => {
    for (let i = 0; i < 200; i += 1) {
      state().update((doc) => ({ ...doc, output: { ...doc.output, dpi: 72 + (i % 1000) } }), {
        transient: true,
      })
    }
    expect(state().past).toHaveLength(0)
  })
})

describe('undo / redo', () => {
  it('round-trips and invalidates future on a new edit', () => {
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 1 } }))
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 2 } }))
    expect(state().past).toHaveLength(2)
    state().undo()
    expect(state().present.adjust.exposure).toBe(1)
    expect(state().future).toHaveLength(1)
    state().redo()
    expect(state().present.adjust.exposure).toBe(2)
    expect(state().future).toHaveLength(0)
    state().undo()
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 9 } }))
    expect(state().future).toHaveLength(0)
  })

  it('is a no-op on an empty stack', () => {
    const before = state()
    before.undo()
    expect(state().past).toHaveLength(0)
    expect(state().future).toHaveLength(0)
  })
})

describe('reset', () => {
  it('does not alias source/output between present and past', () => {
    const source = { assetId: 'a1', width: 10, height: 20, name: 'x.png', mime: 'image/png' }
    state().load(
      createDoc({ source, output: { ...createDoc().output, dpi: 150, resize: { mode: 'none' } } }),
    )
    const before = state().present
    state().reset()
    const after = state()
    expect(after.past).toHaveLength(1)
    expect(after.past[0]).toBe(before)
    expect(after.present.source).not.toBe(after.past[0].source)
    expect(after.present.output).not.toBe(after.past[0].output)
    expect(after.present.output.resize).not.toBe(after.past[0].output.resize)
    expect(after.present.source).toEqual(after.past[0].source)
  })

  it('clears edits but keeps the source and the export settings, and is undoable', () => {
    state().load(
      createDoc({
        source: { assetId: 'a1', width: 4, height: 8, name: 'x.png', mime: 'image/png' },
      }),
    )
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 2 } }))
    state().update((doc) => ({ ...doc, output: { ...doc.output, dpi: 72 } }))
    state().reset()
    expect(state().present.adjust.exposure).toBe(0)
    expect(state().present.output.dpi).toBe(72)
    expect(state().present.source?.assetId).toBe('a1')
    state().undo()
    expect(state().present.adjust.exposure).toBe(2)
  })

  it('closes a leaked interaction instead of swallowing the reset', () => {
    state().beginInteraction('stuck')
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 1 } }))
    state().reset()
    expect(state().interaction.key).toBeNull()
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 2 } }))
    expect(state().past).toHaveLength(3)
  })
})

describe('loadUnknown', () => {
  it('migrates a stale schema and clamps out-of-range values', () => {
    const ok = state().loadUnknown({
      schema: 2,
      adjust: { exposure: 999, warmth: 'nope' },
      geometry: { straighten: 999 },
      output: { quality: 5, dpi: -1 },
    })
    expect(ok).toBe(true)
    const present = state().present
    expect(present.schema).toBe(DOC_SCHEMA)
    expect(present.adjust.exposure).toBe(2)
    expect(Number.isFinite(present.adjust.warmth)).toBe(true)
    expect(present.geometry.straighten).toBe(45)
    expect(present.output.quality).toBe(1)
    expect(present.output.dpi).toBe(1)
  })

  it('resets history and the interaction on a successful load', () => {
    state().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 1 } }))
    state().beginInteraction('stuck')
    state().loadUnknown({ schema: DOC_SCHEMA, adjust: { exposure: 0.5 } })
    expect(state().past).toHaveLength(0)
    expect(state().future).toHaveLength(0)
    expect(state().interaction.key).toBeNull()
    expect(state().present.adjust.exposure).toBe(0.5)
  })

  it('folds a legacy flat state into the current schema', () => {
    expect(state().loadUnknown({ rotation: 90, brightness: 120, outWidth: 800 })).toBe(true)
    const present = state().present
    expect(present.schema).toBe(DOC_SCHEMA)
    expect(present.geometry.orientation.quarterTurns).toBe(1)
    expect(present.adjust.brightness).toBe(20)
    expect(present.output.resize).toEqual({ mode: 'width', width: 800 })
  })

  it('returns false and changes nothing for unrecognisable input', () => {
    const before = state().present
    const revision = state().revision
    expect(state().loadUnknown(null)).toBe(false)
    expect(state().loadUnknown('nope')).toBe(false)
    expect(state().loadUnknown({ nothing: true })).toBe(false)
    expect(state().loadUnknown([1, 2, 3])).toBe(false)
    expect(state().present).toBe(before)
    expect(state().revision).toBe(revision)
  })
})

describe('liveAssetIds', () => {
  it('unions the source across present and every history entry', () => {
    const source = (assetId: string) => ({
      assetId,
      width: 2,
      height: 2,
      name: 'n',
      mime: 'image/png',
    })
    state().load(createDoc({ source: source('one') }))
    state().update((doc) => ({ ...doc, source: source('two') }))
    state().undo()
    state().redo()
    expect([...liveAssetIds()].sort()).toEqual(['one', 'two'])
  })
})

describe('a fresh source replaces rather than merges', () => {
  /**
   * The singleton is what both the import path and a replacement go through, and the
   * difference between "open a new photograph" and "open a second photograph with the
   * first one's edits still on it" is one call to `load`. These are the properties
   * that call has to hold for a replacement to mean anything: nothing of the old
   * document survives it, in the document or in the history.
   */
  const source = (assetId: string, name: string) => ({
    assetId,
    width: 4,
    height: 4,
    name,
    mime: 'image/png',
  })

  it('drops the source, the layers, the edits and the undo stack', () => {
    state().load(
      createDoc({
        source: source('asset_a', 'a.png'),
        layers: [createTextLayer('first document')],
      }),
    )
    state().update((current) => ({ ...current, adjust: { ...current.adjust, exposure: 0.5 } }), {
      key: 'exposure',
    })
    expect(state().past).toHaveLength(1)

    state().load(createDoc({ source: source('asset_b', 'b.jpg') }))

    const after = state()
    expect(after.present.source?.assetId).toBe('asset_b')
    // A default document's layers and adjustments, not the previous one's. Asserted
    // against `createDoc()` rather than a literal, because the default *is* what
    // `src/model/defaults.ts` says it is and a hard-coded `[]` would go on passing
    // after the default changed.
    expect(after.present.layers).toEqual(createDoc().layers)
    expect(after.present.adjust).toEqual(createDoc().adjust)
    // No history: there is nothing to undo *to*. That is why the confirmation in
    // front of a replacement says the edits cannot come back, rather than promising
    // that Ctrl+Z will bring them.
    expect(after.past).toHaveLength(0)
    expect(after.future).toHaveLength(0)
    expect(after.revision).toBeGreaterThan(1)
  })

  it('a document with no source is the empty editor, and is not a photograph', () => {
    // What a replacement leaves behind, and what the editor's entry decision reads as
    // `no-document`: the import screen's answer rather than a broken photo.
    state().load(createDoc())
    const after = state().present
    expect(after.source).toBeNull()
    expect(after.layers).toEqual([])
    expect(after.geometry.crop).toEqual(createDoc().geometry.crop)
    expect([...liveAssetIds()]).toEqual([])
  })

  it('releases the replaced source from the live set, so its pixels can be closed', () => {
    // `assetStore.prune(liveAssetIds())` is what actually frees the old bitmap, and it
    // only works if the replacement really did drop the reference. A `load` that
    // merged would leave a full-resolution photograph pinned for the life of the tab.
    state().load(createDoc({ source: source('asset_a', 'a.png') }))
    expect([...liveAssetIds()]).toEqual(['asset_a'])
    state().load(createDoc({ source: source('asset_b', 'b.png') }))
    expect([...liveAssetIds()]).toEqual(['asset_b'])
  })

  it('resuming replaces too, because `loadUnknown` is the same door', () => {
    // The resume path adopts a document written by an older build and goes through
    // `load`, so it replaces the history as well. That is right rather than
    // convenient: a resumed session has no undo stack to carry, and keeping the
    // abandoned document on `past` would pin its pixels in the live set for the rest
    // of the tab. Asserted because it is the same property the replacement depends
    // on, reached by a different caller.
    state().load(createDoc({ source: source('asset_a', 'a.png') }))
    state().update((current) => ({ ...current, adjust: { ...current.adjust, exposure: 0.5 } }), {
      key: 'exposure',
    })

    expect(state().loadUnknown(createDoc({ source: source('asset_b', 'b.png') }))).toBe(true)

    const after = state()
    expect(after.present.source?.assetId).toBe('asset_b')
    expect(after.past).toHaveLength(0)
    expect([...liveAssetIds()]).toEqual(['asset_b'])
  })
})
