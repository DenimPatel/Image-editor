/**
 * Pure, DOM-free crop/geometry math. Everything here is deterministic and
 * unit-testable outside a browser, which is why it lives apart from any
 * canvas code.
 */
import type { NormRect, Orientation, Point } from '../../model/types';

/** Bounding box of an srcW x srcH rectangle after rotating by rotationDeg. */
export function getTransformedSize(
  srcWidth: number,
  srcHeight: number,
  rotationDeg: number,
): { width: number; height: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = Math.round(srcWidth * cos + srcHeight * sin);
  const height = Math.round(srcWidth * sin + srcHeight * cos);
  return { width, height };
}

export function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi;
}

export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * 25.4;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampInsideImage(rect: NormRect): NormRect {
  const width = clamp(rect.width, 0, 1);
  const height = clamp(rect.height, 0, 1);
  const x = clamp(rect.x, 0, 1 - width);
  const y = clamp(rect.y, 0, 1 - height);
  return { x, y, width, height };
}

/**
 * Resize a normalized rect to the given aspect ratio (w/h) around its center,
 * clamping it inside the unit square. A null aspect clears the lock only at
 * the call site; here it returns the rect unchanged.
 */
export function constrainToAspect(rect: NormRect, aspect: number | null): NormRect {
  if (aspect === null || !Number.isFinite(aspect) || aspect <= 0) return clampInsideImage(rect);

  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  // Fit the aspect box inside the same area, preferring no growth beyond the
  // unit square.
  let width = rect.width;
  let height = width / aspect;
  if (height > rect.height) {
    height = rect.height;
    width = height * aspect;
  }
  if (height > 1) {
    height = 1;
    width = height * aspect;
  }
  if (width > 1) {
    width = 1;
    height = width / aspect;
  }

  return clampInsideImage({ x: centerX - width / 2, y: centerY - height / 2, width, height });
}

/**
 * Largest centered axis-aligned rectangle of the given aspect that fits
 * inside a `width x height` rectangle rotated by `angleDeg`. Used to auto-zoom
 * while straightening so the crop keeps covering the image with no empty
 * corners. Implemented by bisection so it stays exact for any aspect and
 * angle rather than relying on a special-cased formula.
 */
export function largestInscribedRect(
  width: number,
  height: number,
  angleDeg: number,
  aspect = 1,
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || aspect <= 0) return { width: 0, height: 0 };

  const theta = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const halfW = width / 2;
  const halfH = height / 2;

  // A point (x, y) lies inside the rotated source rect if, after rotating it
  // back by -theta, its components fit in the source half-extents.
  const inside = (x: number, y: number): boolean => {
    const rx = x * cos + y * sin;
    const ry = -x * sin + y * cos;
    return Math.abs(rx) <= halfW + 1e-9 && Math.abs(ry) <= halfH + 1e-9;
  };

  let lo = 0;
  let hi = Math.hypot(width, height);
  for (let i = 0; i < 64; i += 1) {
    const mid = (lo + hi) / 2;
    const halfRectW = mid / 2;
    const halfRectH = mid / aspect / 2;
    const fits =
      inside(-halfRectW, -halfRectH) &&
      inside(halfRectW, -halfRectH) &&
      inside(-halfRectW, halfRectH) &&
      inside(halfRectW, halfRectH);
    if (fits) lo = mid;
    else hi = mid;
  }

  return { width: lo, height: lo / aspect };
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

export const MIN_CROP = 0.02;

/**
 * Apply a handle drag in normalized units. `dx`/`dy` are deltas in normalized
 * image space. When `aspect` is set the opposite axis follows the drag.
 */
export function rectForHandleDrag(
  rect: NormRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  aspect: number | null = null,
): NormRect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (handle === 'move') {
    return clampInsideImage({
      ...rect,
      x: clamp(rect.x + dx, 0, 1 - rect.width),
      y: clamp(rect.y + dy, 0, 1 - rect.height),
    });
  }

  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se';

  if (movesLeft) left = clamp(left + dx, 0, right - MIN_CROP);
  if (movesRight) right = clamp(right + dx, left + MIN_CROP, 1);
  if (movesTop) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (movesBottom) bottom = clamp(bottom + dy, top + MIN_CROP, 1);

  let next: NormRect = { x: left, y: top, width: right - left, height: bottom - top };

  if (aspect !== null && Number.isFinite(aspect) && aspect > 0) {
    next = constrainToAspect(next, aspect);
  }

  return clampInsideImage(next);
}

// --- Orientation transforms -------------------------------------------------

type Affine = [number, number, number, number, number, number];

function multiply(a: Affine, b: Affine): Affine {
  // Returns a ∘ b (apply b first, then a).
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function invert(m: Affine): Affine {
  // Orthogonal linear part, so the inverse linear part is the transpose.
  const [a, b, c, d, e, f] = m;
  return [a, c, b, d, -(a * e + b * f), -(c * e + d * f)];
}

function applyAffine(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function orientationAffine(orientation: Orientation): Affine {
  const { quarterTurns, flipH, flipV } = orientation;
  const flip: Affine = [flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, flipH ? 1 : 0, flipV ? 1 : 0];
  const q = ((quarterTurns % 4) + 4) % 4;
  const rotations: Affine[] = [
    [1, 0, 0, 1, 0, 0],
    [0, 1, -1, 0, 1, 0],
    [-1, 0, 0, -1, 1, 1],
    [0, -1, 1, 0, 0, 1],
  ];
  return multiply(rotations[q], flip);
}

/**
 * Map a normalized crop rect from one orientation to another so the same
 * content region stays selected across flip/rotate. Because the transform is a
 * dihedral (axis-aligned) map, a rect maps exactly to a rect.
 */
export function transformCropUnderOrientation(
  crop: NormRect,
  from: Orientation,
  to: Orientation,
): NormRect {
  const delta = multiply(orientationAffine(to), invert(orientationAffine(from)));
  const corners = [
    applyAffine(delta, { x: crop.x, y: crop.y }),
    applyAffine(delta, { x: crop.x + crop.width, y: crop.y }),
    applyAffine(delta, { x: crop.x, y: crop.y + crop.height }),
    applyAffine(delta, { x: crop.x + crop.width, y: crop.y + crop.height }),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Convert a normalized crop to pixels in a `width x height` image space. */
export function cropToPixels(
  crop: NormRect,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: crop.x * width,
    y: crop.y * height,
    width: crop.width * width,
    height: crop.height * height,
  };
}