import { mmToPx } from '../../lib/crop/geometry';
import type { PassportSpec } from './specs';

export type SheetName = '4x6' | '5x7' | 'a4';

export const SHEET_SIZES_MM: Record<SheetName, { widthMm: number; heightMm: number }> = {
  '4x6': { widthMm: 101.6, heightMm: 152.4 },
  '5x7': { widthMm: 127, heightMm: 177.8 },
  a4: { widthMm: 210, heightMm: 297 },
};

export type SheetPhoto = { x: number; y: number; width: number; height: number };

export type SheetLayout = {
  sheet: SheetName;
  sheetWidthPx: number;
  sheetHeightPx: number;
  dpi: number;
  columns: number;
  rows: number;
  count: number;
  gapPx: number;
  photos: SheetPhoto[];
};

export function planSheet(
  spec: PassportSpec,
  sheet: SheetName,
  copies: number,
  dpi: number = spec.dpi,
): SheetLayout {
  const sheetMm = SHEET_SIZES_MM[sheet];
  const gapPx = mmToPx(2, dpi);
  const photoW = mmToPx(spec.widthMm, dpi);
  const photoH = mmToPx(spec.heightMm, dpi);
  const sheetWidthPx = mmToPx(sheetMm.widthMm, dpi);
  const sheetHeightPx = mmToPx(sheetMm.heightMm, dpi);

  const columns = Math.max(0, Math.floor((sheetWidthPx + gapPx) / (photoW + gapPx)));
  const rows = Math.max(0, Math.floor((sheetHeightPx + gapPx) / (photoH + gapPx)));
  const count = Math.min(Math.max(0, copies), columns * rows);

  const usedW = columns > 0 ? columns * photoW + (columns - 1) * gapPx : 0;
  const usedH = rows > 0 ? rows * photoH + (rows - 1) * gapPx : 0;
  const originX = (sheetWidthPx - usedW) / 2;
  const originY = (sheetHeightPx - usedH) / 2;

  const photos: SheetPhoto[] = [];
  for (let i = 0; i < count; i += 1) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    photos.push({
      x: originX + column * (photoW + gapPx),
      y: originY + row * (photoH + gapPx),
      width: photoW,
      height: photoH,
    });
  }

  return {
    sheet,
    sheetWidthPx,
    sheetHeightPx,
    dpi,
    columns,
    rows,
    count,
    gapPx,
    photos,
  };
}