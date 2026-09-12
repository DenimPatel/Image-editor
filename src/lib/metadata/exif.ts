export type MetadataPolicy = 'strip' | 'orientation' | 'all';

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isExifApp1(bytes: Uint8Array, dataStart: number, dataEnd: number): boolean {
  return (
    dataEnd - dataStart >= 6 &&
    bytes[dataStart] === 0x45 &&
    bytes[dataStart + 1] === 0x78 &&
    bytes[dataStart + 2] === 0x69 &&
    bytes[dataStart + 3] === 0x66 &&
    bytes[dataStart + 4] === 0x00 &&
    bytes[dataStart + 5] === 0x00
  );
}

function readOrientation(bytes: Uint8Array, dataStart: number, dataEnd: number): number | null {
  const tiff = dataStart + 6;
  if (tiff + 8 > dataEnd) return null;

  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return null;

  const readU16 = (at: number): number =>
    little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
  const readOffset = (at: number): number =>
    little
      ? (bytes[at] |
          (bytes[at + 1] << 8) |
          (bytes[at + 2] << 16) |
          (bytes[at + 3] << 24)) >>>
        0
      : ((bytes[at] << 24) |
          (bytes[at + 1] << 16) |
          (bytes[at + 2] << 8) |
          bytes[at + 3]) >>>
        0;

  const ifd = tiff + readOffset(tiff + 4);
  if (ifd + 2 > dataEnd) return null;
  const count = readU16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > dataEnd) return null;
    if (readU16(entry) === 0x0112) return readU16(entry + 8);
  }
  return null;
}

function minimalExifApp1(orientation: number): Uint8Array {
  const value = orientation & 0xffff;
  const chunk = new Uint8Array(36);
  chunk[0] = 0xff;
  chunk[1] = 0xe1;
  chunk[2] = 0x00;
  chunk[3] = 0x22;
  chunk.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);

  const tiff = 10;
  chunk[tiff] = 0x49;
  chunk[tiff + 1] = 0x49;
  chunk[tiff + 2] = 0x2a;
  chunk[tiff + 3] = 0x00;
  chunk[tiff + 4] = 0x08;
  chunk[tiff + 8] = 0x01;

  const entry = tiff + 10;
  chunk[entry] = 0x12;
  chunk[entry + 1] = 0x01;
  chunk[entry + 2] = 0x03;
  chunk[entry + 4] = 0x01;
  chunk[entry + 8] = value & 0xff;
  chunk[entry + 9] = (value >> 8) & 0xff;
  return chunk;
}

export function containsExif(bytes: Uint8Array): boolean {
  if (!isJpeg(bytes)) return false;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return false;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return false;
    if (marker === 0xe1 && isExifApp1(bytes, offset + 4, offset + 2 + length)) return true;
    offset += 2 + length;
  }
  return false;
}

export function stripJpegMetadata(bytes: Uint8Array, policy: MetadataPolicy): Uint8Array {
  const copy = new Uint8Array(bytes);
  if (policy === 'all') return copy;
  if (!isJpeg(copy)) return copy;

  const out: number[] = [copy[0], copy[1]];
  let offset = 2;
  let wroteOrientation = false;

  while (offset + 2 <= copy.length) {
    if (copy[offset] !== 0xff) return copy;
    const marker = copy[offset + 1];

    if (marker === 0xda || marker === 0xd9) {
      for (let i = offset; i < copy.length; i += 1) out.push(copy[i]);
      return new Uint8Array(out);
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(copy[offset], copy[offset + 1]);
      offset += 2;
      continue;
    }
    if (offset + 4 > copy.length) return copy;

    const length = (copy[offset + 2] << 8) | copy[offset + 3];
    if (length < 2 || offset + 2 + length > copy.length) return copy;

    const dataStart = offset + 4;
    const segEnd = offset + 2 + length;
    const exif = marker === 0xe1 && isExifApp1(copy, dataStart, segEnd);

    if (exif && policy === 'strip') {
      // dropped
    } else if (exif && policy === 'orientation') {
      if (!wroteOrientation) {
        const orientation = readOrientation(copy, dataStart, segEnd) ?? 1;
        const minimal = minimalExifApp1(orientation);
        for (let i = 0; i < minimal.length; i += 1) out.push(minimal[i]);
        wroteOrientation = true;
      }
    } else {
      for (let i = offset; i < segEnd; i += 1) out.push(copy[i]);
    }

    offset = segEnd;
  }

  return new Uint8Array(out);
}
