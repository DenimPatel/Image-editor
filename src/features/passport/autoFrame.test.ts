import { describe, expect, it } from 'vitest'
import { mmToPx, pxToMm } from '../../lib/crop/geometry'
import { autoFrame } from './autoFrame'
import type { FaceLandmarks } from './autoFrame'
import { PASSPORT_SPECS, EYE_HEIGHT_IN_HEAD, getSpec } from './specs'

const SOURCE = { width: 600, height: 800 }

function landmarksWithHeadFraction(headFraction: number): FaceLandmarks {
  return {
    crown: { x: 0.5, y: 0.55 - headFraction },
    chin: { x: 0.5, y: 0.55 },
    leftEye: { x: 0.4, y: 0.35 },
    rightEye: { x: 0.6, y: 0.35 },
  }
}

/** Source-pixel bounds of the face inside the returned crop. */
function faceInCrop(landmarks: FaceLandmarks, crop: ReturnType<typeof autoFrame>['crop']) {
  const top = crop.y * SOURCE.height
  const bottom = (crop.y + crop.height) * SOURCE.height
  return {
    crownY: landmarks.crown.y * SOURCE.height,
    chinY: landmarks.chin.y * SOURCE.height,
    eyeY: ((landmarks.leftEye.y + landmarks.rightEye.y) / 2) * SOURCE.height,
    top,
    bottom,
  }
}

/** A face that fills `headFraction` of the source height and stays inside it. */
function faceInsideSource(
  headFraction: number,
  eyeInHead = EYE_HEIGHT_IN_HEAD,
  centerX = 0.5,
): FaceLandmarks {
  const crown = (1 - headFraction) / 2
  const eye = crown + eyeInHead * headFraction
  return {
    crown: { x: centerX, y: crown },
    chin: { x: centerX, y: crown + headFraction },
    leftEye: { x: centerX - 0.08, y: eye },
    rightEye: { x: centerX + 0.08, y: eye },
  }
}

describe('autoFrame', () => {
  const landmarks = landmarksWithHeadFraction(0.35)

  it('frames a US 2x2 photo with the head inside 1–1.375 in at 300 DPI', () => {
    const spec = getSpec('us-2x2')
    if (!spec) throw new Error('missing us-2x2')

    const result = autoFrame(landmarks, spec, SOURCE)

    expect(result.headHeightPx).toBeGreaterThanOrEqual(mmToPx(25.4, 300))
    expect(result.headHeightPx).toBeLessThanOrEqual(mmToPx(34.925, 300))
    expect(result.eyeLineFromBottomPx).toBeGreaterThanOrEqual(
      mmToPx(spec.eyeLineMmFromBottom.min, spec.dpi),
    )
    expect(result.eyeLineFromBottomPx).toBeLessThanOrEqual(
      mmToPx(spec.eyeLineMmFromBottom.max, spec.dpi),
    )
  })

  it.each(['uk-35x45', 'schengen-35x45', 'india-2x2'])(
    'frames %s with a head height inside the spec range',
    (id) => {
      const spec = getSpec(id)
      if (!spec) throw new Error(`missing ${id}`)

      const result = autoFrame(landmarks, spec, SOURCE)

      expect(result.headHeightPx).toBeGreaterThanOrEqual(mmToPx(spec.headHeightMm.min, spec.dpi))
      expect(result.headHeightPx).toBeLessThanOrEqual(mmToPx(spec.headHeightMm.max, spec.dpi))
    },
  )

  it('centres the crop on the eye midpoint and keeps the requested aspect', () => {
    const spec = getSpec('uk-35x45')
    if (!spec) throw new Error('missing uk-35x45')

    const result = autoFrame(landmarks, spec, SOURCE)
    const eyeMidX = (landmarks.leftEye.x + landmarks.rightEye.x) / 2

    expect(result.crop.x + result.crop.width / 2).toBeCloseTo(eyeMidX, 6)
    const cropPixelAspect =
      (result.crop.width * SOURCE.width) / (result.crop.height * SOURCE.height)
    expect(cropPixelAspect).toBeCloseTo(spec.widthMm / spec.heightMm, 6)
  })

  it('clamps an oversized crop inside the unit square', () => {
    const spec = getSpec('us-2x2')
    if (!spec) throw new Error('missing us-2x2')

    const result = autoFrame(landmarksWithHeadFraction(0.9), spec, SOURCE)

    expect(result.crop.x).toBeGreaterThanOrEqual(0)
    expect(result.crop.y).toBeGreaterThanOrEqual(0)
    expect(result.crop.width).toBeGreaterThanOrEqual(0)
    expect(result.crop.height).toBeGreaterThanOrEqual(0)
    expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(1)
    expect(result.crop.y + result.crop.height).toBeLessThanOrEqual(1)
  })

  // D5-F11. The old assertions above could not fail: `headHeightPx` is a ratio
  // the function sets by construction and `eyeLineFromBottomPx` is read back
  // out of the crop the function itself chose. These ones are checks against
  // the *input* landmarks, so a framing that drops the crown fails them.
  describe('D5-F11: the crown is inside the crop', () => {
    it('keeps crown, eyes and chin inside the crop for every spec', () => {
      for (const spec of PASSPORT_SPECS) {
        const result = autoFrame(landmarks, spec, SOURCE)
        const box = faceInCrop(landmarks, result.crop)

        expect(box.crownY, `${spec.id}: crown below the crop top`).toBeGreaterThanOrEqual(
          box.top - 1e-9,
        )
        expect(box.eyeY, `${spec.id}: eyes outside the crop`).toBeGreaterThanOrEqual(box.top)
        expect(box.eyeY, `${spec.id}: eyes outside the crop`).toBeLessThanOrEqual(box.bottom)
        expect(box.chinY, `${spec.id}: chin below the crop`).toBeLessThanOrEqual(box.bottom)
        // The reported clearance is the millimetres above the crown, so it
        // must equal the pixel gap the landmark assertions just checked.
        expect(result.crownClearanceMm, `${spec.id}: crown clearance`).toBeGreaterThanOrEqual(0)
        expect(result.crownClearanceMm).toBeCloseTo(
          pxToMm((box.crownY - box.top) * result.scale, spec.dpi),
          6,
        )
      }
    })

    it.each([0.12, 0.2, 0.35, 0.55, 0.8])(
      'keeps the crown inside for a head covering %s of the frame height',
      (headFraction) => {
        const face = faceInsideSource(headFraction)
        for (const spec of PASSPORT_SPECS) {
          const result = autoFrame(face, spec, SOURCE)
          const box = faceInCrop(face, result.crop)

          expect(
            box.crownY,
            `${spec.id} @ ${headFraction}: crown above the crop top`,
          ).toBeGreaterThanOrEqual(box.top - 1e-9)
          expect(
            box.chinY,
            `${spec.id} @ ${headFraction}: chin below the crop`,
          ).toBeLessThanOrEqual(box.bottom)
        }
      },
    )

    // The face that broke it: an eye line above mid-head. Targeting the midpoint
    // of each range put the crown a whole head-height above the eyes, which for
    // four specs lands the crown outside a 45 mm frame — the guides clamped that
    // same impossibility away with `Math.max(0, …)` instead of showing it.
    it.each([0.4, 0.45, 0.5, 0.55, 0.6])(
      'keeps the crown inside when the eye line sits %s of the way up the head',
      (eyeInHead) => {
        for (const headFraction of [0.2, 0.35, 0.6]) {
          const face = faceInsideSource(headFraction, eyeInHead)
          for (const spec of PASSPORT_SPECS) {
            const result = autoFrame(face, spec, SOURCE)
            const box = faceInCrop(face, result.crop)

            expect(
              box.crownY,
              `${spec.id} @ eye ${eyeInHead} / head ${headFraction}: crown clipped`,
            ).toBeGreaterThanOrEqual(box.top - 1e-9)
            expect(
              box.chinY,
              `${spec.id} @ eye ${eyeInHead} / head ${headFraction}: chin clipped`,
            ).toBeLessThanOrEqual(box.bottom + 1e-9)
            expect(result.crownClearanceMm).toBeGreaterThanOrEqual(0)
          }
        }
      },
    )

    it('keeps the crown inside when the face sits low and off-centre in the source', () => {
      const face: FaceLandmarks = {
        crown: { x: 0.72, y: 0.62 },
        chin: { x: 0.72, y: 0.92 },
        leftEye: { x: 0.64, y: 0.75 },
        rightEye: { x: 0.8, y: 0.75 },
      }
      for (const spec of PASSPORT_SPECS) {
        const result = autoFrame(face, spec, SOURCE)

        expect(face.crown.y * SOURCE.height).toBeGreaterThanOrEqual(
          result.crop.y * SOURCE.height - 1e-9,
        )
        expect(face.chin.y * SOURCE.height).toBeLessThanOrEqual(
          (result.crop.y + result.crop.height) * SOURCE.height + 1e-9,
        )
      }
    })

    it('never reports a head height inside the spec range while the crown is clipped', () => {
      // The old failure mode: compliance said "pass" on a photo whose crown sat
      // outside the frame, because the head height was on target either way.
      for (const spec of PASSPORT_SPECS) {
        const result = autoFrame(landmarks, spec, SOURCE)
        const insideRange =
          result.headHeightMm >= spec.headHeightMm.min &&
          result.headHeightMm <= spec.headHeightMm.max

        expect(insideRange && result.crownClearanceMm < 0).toBe(false)
      }
    })
  })
})
