import type { NormRect, Point, Size } from '../../model/types';
import { clamp, mmToPx } from '../../lib/crop/geometry';
import type { PassportSpec } from './specs';

export type FaceLandmarks = {
  chin: Point;
  crown: Point;
  leftEye: Point;
  rightEye: Point;
};

export type AutoFrameResult = {
  crop: NormRect;
  headHeightPx: number;
  eyeLineFromBottomPx: number;
  scale: number;
};

export function autoFrame(
  landmarks: FaceLandmarks,
  spec: PassportSpec,
  source: Size,
): AutoFrameResult {
  const midHeadMm = (spec.headHeightMm.min + spec.headHeightMm.max) / 2;
  const midEyeMm = (spec.eyeLineMmFromBottom.min + spec.eyeLineMmFromBottom.max) / 2;

  const specHeadPx = mmToPx(midHeadMm, spec.dpi);
  const specWidthPx = mmToPx(spec.widthMm, spec.dpi);
  const specHeightPx = mmToPx(spec.heightMm, spec.dpi);

  const measuredHeadPx = Math.abs(landmarks.chin.y - landmarks.crown.y) * source.height;
  const scale = measuredHeadPx > 0 ? specHeadPx / measuredHeadPx : 0;

  const srcCropW = scale > 0 ? specWidthPx / scale : source.width;
  const srcCropH = scale > 0 ? specHeightPx / scale : source.height;

  const eyeMidX = (landmarks.leftEye.x + landmarks.rightEye.x) / 2;
  const eyeY = (landmarks.leftEye.y + landmarks.rightEye.y) / 2;

  const desiredEyeFromBottomPx = mmToPx(midEyeMm, spec.dpi);
  const eyeLineFractionFromTop = 1 - desiredEyeFromBottomPx / specHeightPx;

  const normalizedW = clamp(srcCropW / source.width, 0, 1);
  const normalizedH = clamp(srcCropH / source.height, 0, 1);

  const crop: NormRect = {
    x: clamp((eyeMidX * source.width - srcCropW / 2) / source.width, 0, 1 - normalizedW),
    y: clamp((eyeY * source.height - eyeLineFractionFromTop * srcCropH) / source.height, 0, 1 - normalizedH),
    width: normalizedW,
    height: normalizedH,
  };

  const eyeFromBottomSourcePx = ((crop.y + crop.height) * source.height - eyeY * source.height) * scale;

  return {
    crop,
    headHeightPx: measuredHeadPx * scale,
    eyeLineFromBottomPx: eyeFromBottomSourcePx,
    scale,
  };
}