import { describe, expect, it } from 'vitest'
import { MODELS } from '../../features/ml/ModelLoader'
import { cdnDisclosure, mattingMegabytes } from './privacy'

describe('the one privacy sentence this product makes', () => {
  it('numbers the download from the model catalogue, not from memory', () => {
    // A disclosure whose size is a second copy of another number is a number
    // that goes stale the next time the measured download changes, and a stale
    // privacy figure is worse than none because it is still believed.
    expect(mattingMegabytes.fast).toBe(Math.round(MODELS['matting-quint8'].bytes / (1024 * 1024)))
    expect(mattingMegabytes.best).toBe(Math.round(MODELS['matting-fp16'].bytes / (1024 * 1024)))
    expect(mattingMegabytes.fast).toBe(42)
    expect(mattingMegabytes.best).toBe(84)
    expect(cdnDisclosure()).toContain(`${mattingMegabytes.fast} MB`)
  })

  it('qualifies the claim in the same sentence rather than footnoting it', () => {
    const first = cdnDisclosure().split('. ')[0] as string
    // One sentence carries both halves, so a reader who stops after the first
    // clause has still been told the exception.
    expect(first).toContain('Nothing is uploaded')
    expect(first).toContain('but Remove Background is not local')
    expect(first).toContain('imgly CDN')
    expect(first).toContain('IP address')
    expect(first).toContain('browser')
  })

  it('states the conditional, because only that claim is unconditionally true', () => {
    // "Nothing leaves this tab" and "nothing is downloaded from anyone" are
    // different claims: this page, the samples and the fonts are all fetched
    // from somewhere. Saying so is what lets the first one stand.
    expect(cdnDisclosure()).toContain(
      'If you never use that tool, nothing is downloaded from anyone at all.',
    )
  })

  it('does not promise the original file survives export, only that nothing writes to it', () => {
    expect(cdnDisclosure()).toContain('the file on your disk is never written to')
    expect(cdnDisclosure()).not.toContain('never leaves')
  })
})
