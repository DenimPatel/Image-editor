const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isJfifApp0(bytes: Uint8Array, offset: number, length: number): boolean {
  return (
    length >= 16 &&
    bytes[offset + 4] === 0x4a &&
    bytes[offset + 5] === 0x46 &&
    bytes[offset + 6] === 0x49 &&
    bytes[offset + 7] === 0x46 &&
    bytes[offset + 8] === 0x00
  );
}

function clampJpegDpi(dpi: number): number {
  if (!Number.isFinite(dpi)) return 1;
  return Math.min(65535, Math.max(1, Math.round(dpi)));
}

export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  if (!isJpeg(copy)) return copy;

  const value = clampJpegDpi(dpi);
  let offset = 2;
  while (offset + 4 <= copy.length) {
    if (copy[offset] !== 0xff) break;
    const marker = copy[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = (copy[offset + 2] << 8) | copy[offset + 3];
    if (length < 2 || offset + 2 + length > copy.length) break;
    if (marker === 0xe0 && isJfifApp0(copy, offset, length)) {
      copy[offset + 11] = 1;
      copy[offset + 12] = (value >> 8) & 0xff;
      copy[offset + 13] = value & 0xff;
      copy[offset + 14] = (value >> 8) & 0xff;
      copy[offset + 15] = value & 0xff;
      return copy;
    }
    offset += 2 + length;
  }

  const segment = new Uint8Array(18);
  segment[0] = 0xff;
  segment[1] = 0xe0;
  segment[2] = 0x00;
  segment[3] = 0x10;
  segment.set([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01], 4);
  segment[11] = 1;
  segment[12] = (value >> 8) & 0xff;
  segment[13] = value & 0xff;
  segment[14] = (value >> 8) & 0xff;
  segment[15] = value & 0xff;

  const out = new Uint8Array(copy.length + segment.length);
  out.set(copy.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(copy.subarray(2), 2 + segment.length);
  return out;
}

export function readJpegDpi(bytes: Uint8Array): number | null {
  if (!isJpeg(bytes)) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker === 0xe0 && isJfifApp0(bytes, offset, length)) {
      if (bytes[offset + 11] !== 1) return null;
      return (bytes[offset + 12] << 8) | bytes[offset + 13];
    }
    offset += 2 + length;
  }
  return null;
}

function buildPhysChunk(pixelsPerMeter: number): Uint8Array {
  const chunk = new Uint8Array(21);
  writeU32(chunk, 0, 9);
  chunk[4] = 0x70;
  chunk[5] = 0x48;
  chunk[6] = 0x59;
  chunk[7] = 0x73;
  writeU32(chunk, 8, pixelsPerMeter);
  writeU32(chunk, 12, pixelsPerMeter);
  chunk[16] = 1;
  writeU32(chunk, 17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

export function setPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  if (!hasPngSignature(copy)) return copy;

  const normalized = Number.isFinite(dpi) ? Math.max(1, Math.round(dpi)) : 1;
  const pixelsPerMeter = Math.round(normalized / 0.0254);

  let offset = 8;
  let ihdrEnd = -1;
  let physStart = -1;
  let physEnd = -1;
  while (offset + 8 <= copy.length) {
    const length = readU32(copy, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length + 4;
    if (chunkEnd > copy.length) break;
    const type = String.fromCharCode(
      copy[typeStart],
      copy[typeStart + 1],
      copy[typeStart + 2],
      copy[typeStart + 3],
    );
    if (type === 'IHDR') ihdrEnd = chunkEnd;
    if (type === 'pHYs') {
      physStart = offset;
      physEnd = chunkEnd;
    }
    if (type === 'IEND') break;
    offset = chunkEnd;
  }
  if (ihdrEnd < 0) return copy;

  const chunk = buildPhysChunk(pixelsPerMeter);
  if (physStart >= 0) {
    const out = new Uint8Array(copy.length - (physEnd - physStart) + chunk.length);
    out.set(copy.subarray(0, physStart), 0);
    out.set(chunk, physStart);
    out.set(copy.subarray(physEnd), physStart + chunk.length);
    return out;
  }

  const out = new Uint8Array(copy.length + chunk.length);
  out.set(copy.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(copy.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

export function readPngDpi(bytes: Uint8Array): number | null {
  if (!hasPngSignature(bytes)) return null;

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length + 4;
    if (chunkEnd > bytes.length) return null;
    const type = String.fromCharCode(
      bytes[typeStart],
      bytes[typeStart + 1],
      bytes[typeStart + 2],
      bytes[typeStart + 3],
    );
    if (type === 'pHYs' && length >= 9) {
      if (bytes[dataStart + 8] !== 1) return null;
      return Math.round(readU32(bytes, dataStart) * 0.0254);
    }
    if (type === 'IEND') return null;
    offset = chunkEnd;
  }
  return null;
}
