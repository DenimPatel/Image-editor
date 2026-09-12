import { describe, expect, it } from 'vitest';
import { mmToPx } from '../../lib/crop/geometry';
import { autoFrame } from './autoFrame';
import type { FaceLandmarks } from './autoFrame';
import { getSpec } from './specs';

const SOURCE = { width: 600, height: 800 };

function landmarksWithHeadFraction(headFraction: number): FaceLandmarks {
  return {
    crown: { x: 0.5, y: 0.55 - headFraction },
    chin: { x: 0.5, y: 0.55 },
    leftEye: { x: 0.4, y: 0.35 },
    rightEye: { x: 0.6, y: 0.35 },
  };
}

describe('autoFrame', () => {
  const landmarks = landmarksWithHeadFraction(0.35);

  it('frames a US 2x2 photo with the head inside 1–1.375 in at 300 DPI', () => {
    const spec = getSpec('us-2x2');
    if (!spec) throw new Error('missing us-2x2');

    const result = autoFrame(landmarks, spec, SOURCE);

    expect(result.headHeightPx).toBeGreaterThanOrEqual(mmToPx(25.4, 300));
    expect(result.headHeightPx).toBeLessThanOrEqual(mmToPx(34.925, 300));
    expect(result.eyeLineFromBottomPx).toBeGreaterThanOrEqual(
      mmToPx(spec.eyeLineMmFromBottom.min, spec.dpi),
    );
    expect(result.eyeLineFromBottomPx).toBeLessThanOrEqual(
      mmToPx(spec.eyeLineMmFromBottom.max, spec.dpi),
    );
  });

  it.each(['uk-35x45', 'schengen-35x45', 'india-2x2'])(
    'frames %s with a head height inside the spec range',
    (id) => {
      const spec = getSpec(id);
      if (!spec) throw new Error(`missing ${id}`);

      const result = autoFrame(landmarks, spec, SOURCE);

      expect(result.headHeightPx).toBeGreaterThanOrEqual(
        mmToPx(spec.headHeightMm.min, spec.dpi),
      );
      expect(result.headHeightPx).toBeLessThanOrEqual(
        mmToPx(spec.headHeightMm.max, spec.dpi),
      );
    },
  );

  it('centres the crop on the eye midpoint and keeps the requested aspect', () => {
    const spec = getSpec('uk-35x45');
    if (!spec) throw new Error('missing uk-35x45');

    const result = autoFrame(landmarks, spec, SOURCE);
    const eyeMidX = (landmarks.leftEye.x + landmarks.rightEye.x) / 2;

    expect(result.crop.x + result.crop.width / 2).toBeCloseTo(eyeMidX, 6);
    const cropPixelAspect =
      (result.crop.width * SOURCE.width) / (result.crop.height * SOURCE.height);
    expect(cropPixelAspect).toBeCloseTo(spec.widthMm / spec.heightMm, 6);
  });

  it('clamps an oversized crop inside the unit square', () => {
    const spec = getSpec('us-2x2');
    if (!spec) throw new Error('missing us-2x2');

    const result = autoFrame(landmarksWithHeadFraction(0.9), spec, SOURCE);

    expect(result.crop.x).toBeGreaterThanOrEqual(0);
    expect(result.crop.y).toBeGreaterThanOrEqual(0);
    expect(result.crop.width).toBeGreaterThanOrEqual(0);
    expect(result.crop.height).toBeGreaterThanOrEqual(0);
    expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(1);
    expect(result.crop.y + result.crop.height).toBeLessThanOrEqual(1);
  });
});