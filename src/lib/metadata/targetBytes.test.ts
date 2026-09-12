import { describe, expect, it } from 'vitest';
import { fitUnderTarget } from './targetBytes';

function fakeEncoder(scale: number) {
  const calls: number[] = [];
  const encode = async (quality: number): Promise<Uint8Array> => {
    calls.push(quality);
    return new Uint8Array(Math.round(quality * scale));
  };
  return { encode, calls };
}

describe('fitUnderTarget', () => {
  it('returns the highest quality encoding at or under the target', async () => {
    const { encode } = fakeEncoder(1000);
    const result = await fitUnderTarget(encode, 500);
    expect(result.size).toBeLessThanOrEqual(500);
    expect(result.quality).toBe(0.5);
  });

  it('stays under the target when achievable', async () => {
    const { encode } = fakeEncoder(1000);
    const result = await fitUnderTarget(encode, 600);
    expect(result.size).toBeLessThanOrEqual(600);
  });

  it('never calls encode more than maxIterations times', async () => {
    const { encode, calls } = fakeEncoder(1000);
    await fitUnderTarget(encode, 500);
    expect(calls.length).toBeLessThanOrEqual(7);

    const custom = fakeEncoder(1000);
    await fitUnderTarget(custom.encode, 500, { maxIterations: 3 });
    expect(custom.calls.length).toBeLessThanOrEqual(3);
  });

  it('falls back to the minimum quality when the target is tiny', async () => {
    const { encode } = fakeEncoder(1000);
    const result = await fitUnderTarget(encode, 1);
    expect(result.quality).toBe(0.05);
    expect(result.size).toBeGreaterThan(1);
  });

  it('returns max quality when it already fits', async () => {
    const { encode, calls } = fakeEncoder(1000);
    const result = await fitUnderTarget(encode, 5000);
    expect(result.quality).toBe(0.95);
    expect(calls.length).toBe(1);
  });

  it('reports size as the byte length', async () => {
    const { encode } = fakeEncoder(1000);
    const result = await fitUnderTarget(encode, 500);
    expect(result.size).toBe(result.bytes.length);
  });
});
