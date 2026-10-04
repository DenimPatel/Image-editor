import { describe, expect, it } from 'vitest'
import { TOOL_IDS, type ToolId } from '../store/uiStore'
import {
  HUB_DOORS,
  editorEntryTool,
  newImageBlockedReason,
  newImageRequest,
  resolveEditorEntry,
} from './editorEntry'

/**
 * What a door into the editor means, and what "New image" costs.
 *
 * `useDocStore` is a module singleton, so these two functions are the whole defence
 * against a page that renders a photograph nobody asked for. The table tests below
 * are the invariant stated as data: every combination of "what the URL said",
 * "what the singleton holds" and "what the asset store can hand back", with the
 * substitution — a different photograph from the one that was named — named as the
 * failure it is.
 */

describe('the tool a door names', () => {
  it('reads every tool segment and nothing else', () => {
    for (const tool of TOOL_IDS) {
      expect(editorEntryTool(`/editor/${tool}`, TOOL_IDS)).toBe(tool)
    }
    expect(editorEntryTool('/editor', TOOL_IDS)).toBeNull()
    expect(editorEntryTool('/editor/', TOOL_IDS)).toBeNull()
    expect(editorEntryTool('/', TOOL_IDS)).toBeNull()
  })

  it('answers nothing for a segment that is not a tool, rather than a neighbour', () => {
    // `/editor/:tool` matches any string, so this is the case the route cannot
    // answer. Guessing is what made a card pointing at `/editor/transform` look
    // like it worked: the photo rendered, no tab was marked, no panel opened.
    expect(editorEntryTool('/editor/transform', TOOL_IDS)).toBeNull()
    expect(editorEntryTool('/editor/CROP', TOOL_IDS)).toBeNull()
    expect(editorEntryTool('/editor/crop/extra', TOOL_IDS)).toBeNull()
  })

  it('answers from the list it is given, not from a second list of its own', () => {
    // The point of passing `tools` in: the editor's answer comes from `TOOL_IDS`,
    // and a test with a one-item list proves the parameter is load-bearing rather
    // than decorative.
    const one: ToolId[] = ['crop']
    expect(editorEntryTool('/editor/crop', one)).toBe('crop')
    expect(editorEntryTool('/editor/adjust', one)).toBeNull()
  })
})

describe('the doors the Hub renders', () => {
  it('every one of them is a real route the editor can answer for', () => {
    expect(HUB_DOORS).toHaveLength(8)
    for (const door of HUB_DOORS) {
      const tool = editorEntryTool(door.to, TOOL_IDS)
      expect(tool).toBe(door.tool)
    }
  })

  it('names only tools the editor has, so no card points at a dead route', () => {
    const named = HUB_DOORS.filter((door) => door.tool !== null).map((door) => door.tool)
    expect(named.sort()).toEqual([...new Set(named)].sort())
    for (const tool of named) expect(TOOL_IDS).toContain(tool)
  })

  it('names the seven tools the Hub features, and the workspace once', () => {
    // Six more of the editor's thirteen tools — retouch, text, draw, stickers,
    // redact, frame — have no card, by design: the Hub features the ones a first
    // visit wants and the editor's own tab bar carries the rest. What this table
    // must never contain is a card whose segment the editor cannot answer for, and
    // that is the case above.
    expect(
      HUB_DOORS.filter((door) => door.tool !== null)
        .map((door) => door.tool)
        .sort(),
    ).toEqual(['adjust', 'background', 'crop', 'export', 'filters', 'layers', 'passport'])
    expect(HUB_DOORS.filter((door) => door.tool === null).map((door) => door.to)).toEqual([
      '/editor',
    ])
  })
})

describe('which document a door is allowed to open', () => {
  const holds = (available: string[]) => (assetId: string) => available.includes(assetId)

  it('opens the document the singleton holds when its pixels are there', () => {
    expect(
      resolveEditorEntry({
        tool: 'crop',
        held: { assetId: 'asset_a' },
        holds: holds(['asset_a']),
      }),
    ).toEqual({ action: 'open', tool: 'crop', sourceAssetId: 'asset_a' })
  })

  it('shows the import screen when there is no document at all', () => {
    expect(resolveEditorEntry({ tool: 'crop', held: null, holds: holds([]) })).toEqual({
      action: 'import',
      tool: 'crop',
      reason: 'no-document',
    })
  })

  it('shows the import screen for a document with no source', () => {
    // `createDoc()` with no source is not a photograph; it is the empty editor, and
    // it is what a replacement leaves behind.
    expect(
      resolveEditorEntry({ tool: null, held: { assetId: null }, holds: holds(['asset_a']) }),
    ).toEqual({ action: 'import', tool: null, reason: 'no-document' })
  })

  it('reports a source the asset store cannot hand back instead of opening anything', () => {
    // The never-substitute rule. A document whose pixels are gone still holds every
    // edit in it, and `Editor` raises an error naming the asset rather than showing
    // a different photograph — so this plan must never be `open`, and must never be
    // silently `import` either, because "nothing was loaded" reads as "you have no
    // photo" when the truth is "this one is broken".
    expect(
      resolveEditorEntry({ tool: 'adjust', held: { assetId: 'asset_gone' }, holds: holds([]) }),
    ).toEqual({ action: 'import', tool: 'adjust', reason: 'source-unavailable' })
  })

  it('does not treat a different available asset as a substitute', () => {
    // The specific shape of the bug: the store holds *a* photograph, just not this
    // one. Anything that asked "is there any photo?" instead of "is there this
    // photo?" opens it, and the user is handed someone else's edit session.
    const plan = resolveEditorEntry({
      tool: null,
      held: { assetId: 'asset_gone' },
      holds: holds(['asset_other']),
    })
    expect(plan).not.toEqual({ action: 'open', tool: null, sourceAssetId: 'asset_other' })
    expect(plan.action).toBe('import')
  })

  it('carries the tool through on both branches, so a deep link to a tool is not lost', () => {
    // `/editor/crop` with no photo has to remember it asked for crop: the import
    // screen appears without the request being discarded.
    expect(resolveEditorEntry({ tool: 'crop', held: null, holds: holds([]) })).toMatchObject({
      tool: 'crop',
    })
    expect(
      resolveEditorEntry({ tool: 'crop', held: { assetId: 'gone' }, holds: holds([]) }),
    ).toMatchObject({ tool: 'crop' })
  })
})

describe('what New image costs', () => {
  it('asks nothing when there is nothing to lose', () => {
    // A dialog in front of an action that destroys nothing is the dialog that
    // teaches people to press through dialogs.
    expect(newImageRequest(0)).toBeNull()
    expect(newImageRequest(-1)).toBeNull()
  })

  it('names the number of edits that are going, and says they cannot come back', () => {
    // `past.length` is a number the reader can check afterwards by pressing Undo
    // that many times — which is also why the swap itself cannot be undoable, and
    // why the sentence says so rather than implying an Undo would fix it.
    const one = newImageRequest(1)
    expect(one?.body).toContain('1 edit.')
    expect(one?.body).not.toContain('1 edits')
    expect(one?.body).toContain('cannot be undone')
    expect(newImageRequest(7)?.body).toContain('7 edits')
  })

  it('does not tell the user their file is affected, because it is not', () => {
    // The photograph on disk is never written, and a warning that says otherwise
    // teaches people to distrust the one control that is safe to press.
    expect(newImageRequest(3)?.body).toContain('photo file itself is not touched')
  })

  it('is a destructive request whose control names the action', () => {
    const request = newImageRequest(4)
    expect(request?.tone).toBe('destructive')
    expect(request?.confirmLabel).toBe('Start new image')
    expect(request?.title).toBe('Start a new image?')
    expect(['OK', 'Yes']).not.toContain(request?.confirmLabel)
  })
})

describe('why New image cannot be pressed', () => {
  it('says nothing when there is no reason', () => {
    expect(newImageBlockedReason(false)).toBeNull()
  })

  it('names the export when one is running', () => {
    // The encoder is reading the document; replacing it underneath would hand the
    // encode a photograph the user never asked to export.
    const reason = newImageBlockedReason(true)
    expect(reason).toContain('export')
  })
})
