export type EncodedResult = {
  bytes: Uint8Array;
  quality: number;
  size: number;
};

export async function fitUnderTarget(
  encode: (quality: number) => Promise<Uint8Array>,
  targetBytes: number,
  options?: {
    minQuality?: number;
    maxQuality?: number;
    maxIterations?: number;
    tolerance?: number;
  },
): Promise<EncodedResult> {
  const minQuality = options?.minQuality ?? 0.05;
  const maxQuality = options?.maxQuality ?? 0.95;
  const maxIterations = options?.maxIterations ?? 7;
  const tolerance = options?.tolerance ?? 0.02;
  const budget = Math.max(1, maxIterations);

  let calls = 0;
  const evaluate = async (quality: number): Promise<EncodedResult | null> => {
    if (calls >= budget) return null;
    calls += 1;
    const bytes = await encode(quality);
    return { bytes, quality, size: bytes.length };
  };

  const maxResult = await evaluate(maxQuality);
  if (maxResult && maxResult.size <= targetBytes) return maxResult;

  let best: EncodedResult | null = null;
  let smallest: EncodedResult | null = maxResult;

  const minResult = await evaluate(minQuality);
  if (minResult) {
    if (!smallest || minResult.quality < smallest.quality) smallest = minResult;
    if (minResult.size <= targetBytes) best = minResult;
  }

  let lo = minQuality;
  let hi = maxQuality;
  while (calls < budget && hi - lo > tolerance) {
    const mid = (lo + hi) / 2;
    const result = await evaluate(mid);
    if (!result) break;
    if (!smallest || result.quality < smallest.quality) smallest = result;
    if (result.size <= targetBytes) {
      if (!best || result.quality > best.quality) best = result;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const fallback = best ?? smallest ?? maxResult;
  if (fallback) return fallback;
  return { bytes: new Uint8Array(0), quality: minQuality, size: 0 };
}
