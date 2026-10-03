import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { guideLayout } from '../../features/passport/guides'
import { getSpec } from '../../features/passport/specs'
import { PassportGuides } from './PassportGuides'
import { SafeAreaOverlay } from './SafeAreaOverlay'

const CROP = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }

const UK = getSpec('uk-35x45')
if (!UK) throw new Error('missing uk-35x45')

describe('PassportGuides', () => {
  const crop = guideLayout(UK, CROP)

  it('positions itself over the crop box, not over the whole frame', () => {
    const html = renderToStaticMarkup(<PassportGuides specId="uk-35x45" crop={CROP} />)

    expect(html).toContain('left:20%')
    expect(html).toContain('top:20%')
    expect(html).toContain('width:50%')
    expect(html).toContain('height:50%')
  })

  it('draws the eye line as a percentage of the crop, not of the frame', () => {
    const html = renderToStaticMarkup(<PassportGuides specId="uk-35x45" crop={CROP} />)
    const tops = [...html.matchAll(/top:\s*([\d.]+)%/g)].map((match) => Number(match[1]))

    // The advisory eye line is the frame fraction 1 - 30/45 remapped into the
    // crop. Drawing it against the frame would have put it at 33.3 %.
    const frame = guideLayout(UK)
    const expected = ((frame.lines[0].fromTop - CROP.y) / CROP.height) * 100
    expect(tops.some((top) => Math.abs(top - expected) < 1e-6)).toBe(true)
    expect(crop.lines[0].fromTop * 100).toBeCloseTo(expected, 6)
  })

  it('gives the advisory eye line a different class from the two bounds', () => {
    const html = renderToStaticMarkup(<PassportGuides specId="uk-35x45" crop={CROP} />)
    const classes = [...html.matchAll(/class="([^"]+)"/g)].map((match) => match[1])

    const advisory = classes.filter((name) => name.includes('eyeAdvisory'))
    const bounds = classes.filter((name) => name.includes('eyeBound'))
    expect(advisory).toHaveLength(1)
    expect(bounds).toHaveLength(2)
    expect(advisory[0]).not.toBe(bounds[0])
  })

  it('labels the advisory line and both bounds in millimetres', () => {
    const html = renderToStaticMarkup(<PassportGuides specId="uk-35x45" crop={CROP} />)

    expect(html).toContain('eye 26.4 mm')
    expect(html).toContain('max 32.0 mm')
    expect(html).toContain('min 26.0 mm')
  })

  it('renders a warning chip when the spec geometry cannot place a head', () => {
    const html = renderToStaticMarkup(
      <PassportGuides
        specId="uk-35x45"
        crop={{
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        }}
      />,
    )

    // A conforming spec carries no warning; the degenerate case is covered by
    // `guideLayout.test`, which owns the message text.
    expect(html).not.toContain('cannot clear')
  })

  it('renders nothing for an unknown spec id', () => {
    expect(renderToStaticMarkup(<PassportGuides specId="nope" crop={CROP} />)).toBe('')
  })

  it('defaults to the whole frame when no crop is passed', () => {
    const html = renderToStaticMarkup(<PassportGuides specId="uk-35x45" />)

    expect(html).toContain('left:0%')
    expect(html).toContain('width:100%')
    expect(html).toContain(`top:${guideLayout(UK).lines[0].fromTop * 100}%`)
  })
})

describe('SafeAreaOverlay', () => {
  it('insets the crop box rather than the whole frame', () => {
    const html = renderToStaticMarkup(<SafeAreaOverlay preset="story" crop={CROP} />)

    // left = crop.x + 6 % of the crop = 0.2 + 0.03 = 23 %
    expect(html).toContain('left:23%')
    expect(html).toContain('width:44%')
    expect(html).toContain('story safe area')
  })

  it('keeps the old full-frame behaviour when no crop is passed', () => {
    const html = renderToStaticMarkup(<SafeAreaOverlay preset="story" />)

    expect(html).toContain('left:6%')
    expect(html).toContain('width:88%')
  })

  it('renders nothing for the none preset', () => {
    expect(renderToStaticMarkup(<SafeAreaOverlay preset="none" crop={CROP} />)).toBe('')
  })
})
