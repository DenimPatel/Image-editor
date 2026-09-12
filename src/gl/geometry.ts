import type { Doc, Point, Size } from '../model/types';
import { orientationAffine } from '../lib/crop/geometry';

/**
 * 3x3 homogeneous matrix, row-major:
 *   [ m00 m01 m02
 *     m10 m11 m12
 *     m20 m21 m22 ]
 * Point transform divides by m20*x + m21*y + m22.
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return [...IDENTITY_MAT3];
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

export function translation(tx: number, ty: number): Mat3 {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}

export function scaling(sx: number, sy: number): Mat3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1];
}

export function rotation(theta: number): Mat3 {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
}

export function applyMat3(m: Mat3, point: Point): Point {
  const w = m[6] * point.x + m[7] * point.y + m[8] || 1;
  return {
    x: (m[0] * point.x + m[1] * point.y + m[2]) / w,
    y: (m[3] * point.x + m[4] * point.y + m[5]) / w,
  };
}

/** Map the unit square (tl,tr,br,bl) onto an arbitrary quad. */
export function squareToQuad(quad: [Point, Point, Point, Point]): Mat3 {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const denom = dx1 * dy2 - dx2 * dy1;

  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }
  if (Math.abs(denom) < 1e-12) return [...IDENTITY_MAT3];

  const g = (sx * dy2 - dx2 * sy) / denom;
  const hh = (dx1 * sy - sx * dy1) / denom;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + hh * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + hh * p3.y,
    p0.y,
    g,
    hh,
    1,
  ];
}

function orientationMat3(doc: Doc): Mat3 {
  const affine = orientationAffine(doc.geometry.orientation);
  return [affine[0], affine[2], affine[4], affine[1], affine[3], affine[5], 0, 0, 1];
}

/**
 * Matrix mapping *source* pixel coordinates to *output* pixel coordinates,
 * combining orientation, perspective, straighten and crop into one
 * projective transform.
 */
export function computeSourceToOutput(doc: Doc, source: Size, output: Size): Mat3 {
  const { orientation, straighten, perspective, crop } = doc.geometry;
  const swapped = orientation.quarterTurns % 2 === 1;
  const orientedW = swapped ? source.height : source.width;
  const orientedH = swapped ? source.width : source.height;

  const sourceToNorm = scaling(1 / source.width, 1 / source.height);
  const orientationM = orientationMat3(doc);

  const toOrientedPx = scaling(orientedW, orientedH);
  const fromOrientedPx = scaling(1 / orientedW, 1 / orientedH);
  const rotate = multiplyMat3(
    fromOrientedPx,
    multiplyMat3(
      translation(orientedW / 2, orientedH / 2),
      multiplyMat3(
        rotation((straighten * Math.PI) / 180),
        multiplyMat3(translation(-orientedW / 2, -orientedH / 2), toOrientedPx),
      ),
    ),
  );

  const quad: [Point, Point, Point, Point] = [
    { x: perspective.topLeft.x, y: perspective.topLeft.y },
    { x: 1 + perspective.topRight.x, y: perspective.topRight.y },
    { x: 1 + perspective.bottomRight.x, y: 1 + perspective.bottomRight.y },
    { x: perspective.bottomLeft.x, y: 1 + perspective.bottomLeft.y },
  ];
  const perspectiveM = squareToQuad(quad);

  // Forward maps source -> output, so the crop rect is undone (output u maps
  // to crop.x + u*crop.width, i.e. the inverse of the unit->crop transform).
  const cropInverse = multiplyMat3(scaling(1 / crop.width, 1 / crop.height), translation(-crop.x, -crop.y));
  const outputToNorm = scaling(output.width, output.height);

  return multiplyMat3(
    outputToNorm,
    multiplyMat3(
      cropInverse,
      multiplyMat3(perspectiveM, multiplyMat3(rotate, multiplyMat3(orientationM, sourceToNorm))),
    ),
  );
}

/**
 * Matrix mapping *output* pixel coordinates to *source* pixel coordinates.
 * The GL renderer samples through this, so orientation, perspective,
 * straighten and crop collapse into a single resample instead of the old
 * two-stage double-blur rotate-then-crop.
 */
export function computeOutputToSource(doc: Doc, source: Size, output: Size): Mat3 {
  return invertMat3(computeSourceToOutput(doc, source, output));
}

/** Convenience for the fallback: does the geometry need any work at all? */
export function geometryIsIdentity(doc: Doc): boolean {
  const { orientation, straighten, perspective, crop } = doc.geometry;
  return (
    orientation.quarterTurns === 0 &&
    !orientation.flipH &&
    !orientation.flipV &&
    straighten === 0 &&
    Object.values(perspective).every((p) => p.x === 0 && p.y === 0) &&
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === 1 &&
    crop.height === 1
  );
}