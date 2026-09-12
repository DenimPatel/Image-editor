import { describe, expect, it } from 'vitest';
import { readJpegDpi, readPngDpi, setJpegDpi, setPngDpi } from './dpi';

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

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function tinyPng(): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]);
  const iend = new Uint8Array(0);
  return concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', iend),
  ]);
}

function expectedPhys(dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  writeU32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  writeU32(chunk, 8, ppm);
  writeU32(chunk, 12, ppm);
  chunk[16] = 1;
  writeU32(chunk, 17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

function jfifApp0(units: number, density: number): Uint8Array {
  const app0 = new Uint8Array(18);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  app0[2] = 0x00;
  app0[3] = 0x10;
  app0.set([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01], 4);
  app0[11] = units;
  app0[12] = (density >> 8) & 0xff;
  app0[13] = density & 0xff;
  app0[14] = (density >> 8) & 0xff;
  app0[15] = density & 0xff;
  return app0;
}

const SOS = new Uint8Array([
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);

describe('setPngDpi', () => {
  it('inserts a golden pHYs chunk after IHDR with a correct CRC', () => {
    const png = tinyPng();
    const result = setPngDpi(png, 300);

    const expected = expectedPhys(300);
    const physOffset = 8 + 12 + 13;
    expect(result.subarray(physOffset, physOffset + expected.length)).toEqual(expected);
    expect(result.length).toBe(png.length + expected.length);
    expect(readPngDpi(result)).toBe(300);

    const chunk = result.subarray(physOffset, physOffset + 21);
    expect(writeU32Value(chunk, 17)).toBe(crc32(chunk.subarray(4, 17)));
  });

  it('rewrites an existing pHYs chunk instead of duplicating it', () => {
    const once = setPngDpi(tinyPng(), 300);
    const twice = setPngDpi(once, 300);
    expect(twice).toEqual(once);

    const changed = setPngDpi(once, 72);
    expect(changed.length).toBe(once.length);
    expect(readPngDpi(changed)).toBe(72);
  });

  it('leaves non-PNG input unchanged', () => {
    const input = new Uint8Array([1, 2, 3, 4]);
    expect(setPngDpi(input, 300)).toEqual(input);
    expect(readPngDpi(input)).toBeNull();
  });
});

describe('setJpegDpi', () => {
  it('overwrites the existing JFIF density with golden bytes', () => {
    const jpeg = concat([
      new Uint8Array([0xff, 0xd8]),
      jfifApp0(0, 1),
      SOS,
    ]);
    const result = setJpegDpi(jpeg, 300);

    expect(result.length).toBe(jpeg.length);
    expect(result[2 + 11]).toBe(1);
    expect(Array.from(result.subarray(2 + 12, 2 + 16))).toEqual([0x01, 0x2c, 0x01, 0x2c]);
    expect(readJpegDpi(result)).toBe(300);
  });

  it('inserts a JFIF APP0 immediately after SOI when none exists', () => {
    const jpeg = concat([
      new Uint8Array([0xff, 0xd8]),
      new Uint8Array([0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]),
      SOS,
    ]);
    const inserted = jfifApp0(1, 300);
    const result = setJpegDpi(jpeg, 300);

    expect(result.length).toBe(jpeg.length + inserted.length);
    expect(Array.from(result.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(result.subarray(2, 2 + inserted.length))).toEqual(Array.from(inserted));
    expect(Array.from(result.subarray(2 + inserted.length))).toEqual(Array.from(jpeg.subarray(2)));
    expect(readJpegDpi(result)).toBe(300);
  });

  it('clamps out-of-range dpi', () => {
    const jpeg = concat([new Uint8Array([0xff, 0xd8]), jfifApp0(0, 1), SOS]);
    expect(readJpegDpi(setJpegDpi(jpeg, 0))).toBe(1);
    expect(readJpegDpi(setJpegDpi(jpeg, 99999))).toBe(65535);
  });

  it('leaves non-JPEG input unchanged', () => {
    const input = new Uint8Array([1, 2, 3, 4]);
    expect(setJpegDpi(input, 300)).toEqual(input);
  });
});

describe('readPngDpi round trip', () => {
  it('returns the dpi for a range of values', () => {
    for (const dpi of [72, 96, 150, 300, 600]) {
      expect(readPngDpi(setPngDpi(tinyPng(), dpi))).toBe(dpi);
    }
  });
});

function writeU32Value(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}
