import { describe, expect, it } from 'vitest';
import { convertBytes, parseRatio } from './format';

describe('convertBytes', () => {
  it('formats bytes below 1024 as Bytes', () => {
    expect(convertBytes(0)).toBe('0 Bytes');
    expect(convertBytes(1023)).toBe('1023 Bytes');
  });

  it('formats 1024 and up (but below 1MB) as KB', () => {
    expect(convertBytes(1024)).toBe('1.00 KB');
    expect(convertBytes(1048575)).toBe('1024.00 KB');
  });

  it('formats 1MB and up as MB', () => {
    expect(convertBytes(1048576)).toBe('1.00 MB');
    expect(convertBytes(5242880)).toBe('5.00 MB');
  });
});

describe('parseRatio', () => {
  it('parses a valid "W:H" ratio', () => {
    expect(parseRatio('3:2')).toEqual({ width: 3, height: 2 });
    expect(parseRatio('1:1')).toEqual({ width: 1, height: 1 });
    expect(parseRatio('16.5:9')).toEqual({ width: 16.5, height: 9 });
  });

  it('rejects "0:0" instead of allowing a divide-by-zero', () => {
    expect(parseRatio('0:0')).toBeNull();
  });

  it('rejects negative values', () => {
    expect(parseRatio('-1:2')).toBeNull();
    expect(parseRatio('1:-2')).toBeNull();
  });

  it('rejects non-numeric input without throwing', () => {
    expect(() => parseRatio('abc')).not.toThrow();
    expect(parseRatio('abc')).toBeNull();
    expect(parseRatio('abc:2')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseRatio('3')).toBeNull();
    expect(parseRatio('3:2:1')).toBeNull();
    expect(parseRatio('')).toBeNull();
  });
});
