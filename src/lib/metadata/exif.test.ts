import { describe, expect, it } from 'vitest';
import { containsExif, stripJpegMetadata } from './exif';

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

function buildApp1Exif(orientation: number, little: boolean): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff[0] = little ? 0x49 : 0x4d;
  tiff[1] = little ? 0x49 : 0x4d;
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x0112, little);
  view.setUint16(12, 3, little);
  view.setUint32(14, 1, little);
  view.setUint16(18, orientation, little);

  const chunk = new Uint8Array(4 + 6 + tiff.length);
  chunk[0] = 0xff;
  chunk[1] = 0xe1;
  const length = 6 + tiff.length + 2;
  chunk[2] = (length >> 8) & 0xff;
  chunk[3] = length & 0xff;
  chunk.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
  chunk.set(tiff, 10);
  return chunk;
}

const SOI = new Uint8Array([0xff, 0xd8]);
const APP0 = new Uint8Array([
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
  0x01, 0x00, 0x00,
]);
const SOS = new Uint8Array([
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);

function sampleJpeg(orientation: number, little: boolean): { bytes: Uint8Array; app1: Uint8Array } {
  const app1 = buildApp1Exif(orientation, little);
  return { bytes: concat([SOI, APP0, app1, SOS]), app1 };
}

function tailFromSos(bytes: Uint8Array): Uint8Array {
  for (let i = 2; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xda) return bytes.subarray(i);
  }
  return new Uint8Array(0);
}

describe('containsExif', () => {
  it('detects EXIF APP1 segments', () => {
    expect(containsExif(sampleJpeg(6, false).bytes)).toBe(true);
    expect(containsExif(concat([SOI, APP0, SOS]))).toBe(false);
    expect(containsExif(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe('stripJpegMetadata', () => {
  it('strips APP1 EXIF and keeps APP0 and the image data byte-for-byte', () => {
    const { bytes } = sampleJpeg(6, false);
    const result = stripJpegMetadata(bytes, 'strip');

    expect(containsExif(result)).toBe(false);
    expect(result.subarray(0, 2)).toEqual(SOI);
    expect(result.subarray(2, 2 + APP0.length)).toEqual(APP0);
    expect(tailFromSos(result)).toEqual(tailFromSos(bytes));
  });

  it('keeps only a minimal little-endian orientation APP1', () => {
    const bigEndian = buildApp1Exif(6, false);
    const { bytes } = sampleJpeg(6, false);
    const result = stripJpegMetadata(bytes, 'orientation');

    const expectedMinimal = buildApp1Exif(6, true);
    expect(containsExif(result)).toBe(true);
    expect(Array.from(result.subarray(2 + APP0.length, 2 + APP0.length + expectedMinimal.length))).toEqual(
      Array.from(expectedMinimal),
    );
    expect(result.length).toBe(bytes.length - bigEndian.length + expectedMinimal.length);
    expect(tailFromSos(result)).toEqual(tailFromSos(bytes));
  });

  it('preserves the orientation value when rebuilding', () => {
    const { bytes } = sampleJpeg(8, true);
    const result = stripJpegMetadata(bytes, 'orientation');
    const expectedMinimal = buildApp1Exif(8, true);
    expect(Array.from(result.subarray(2 + APP0.length, 2 + APP0.length + expectedMinimal.length))).toEqual(
      Array.from(expectedMinimal),
    );
  });

  it('returns an identical copy for policy all', () => {
    const { bytes } = sampleJpeg(6, false);
    const result = stripJpegMetadata(bytes, 'all');
    expect(result).toEqual(bytes);
    expect(result).not.toBe(bytes);
  });

  it('returns a copy for malformed input', () => {
    const malformed = new Uint8Array([1, 2, 3, 4, 5]);
    const result = stripJpegMetadata(malformed, 'strip');
    expect(result).toEqual(malformed);
    expect(result).not.toBe(malformed);

    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1]);
    expect(stripJpegMetadata(truncated, 'strip')).toEqual(truncated);
  });
});
