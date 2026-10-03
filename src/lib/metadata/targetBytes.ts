import { throwIfAborted } from './abort'

export type EncodedResult = {
  bytes: Uint8Array
  quality: number
  size: number
  /**
   * Whether this encoding is actually at or under the requested byte budget.
   * False whenever even `minQuality` overshoots — the search still returns the
   * smallest encoding it found, but saying so is the caller's job, not a lie
   * the caller has to guess at.
   */
  metTarget: boolean
}

export type FitOptions = {
  minQuality?: number
  maxQuality?: number
  maxIterations?: number
  tolerance?: number
  signal?: AbortSignal
  /** Called with 0..1 after each encode. */
  onProgress?: (progress: number) => void
}

export async function fitUnderTarget(
  encode: (quality: number) => Promise<Uint8Array>,
  targetBytes: number,
  options?: FitOptions,
): Promise<EncodedResult> {
  const minQuality = options?.minQuality ?? 0.05
  const maxQuality = options?.maxQuality ?? 0.95
  const maxIterations = options?.maxIterations ?? 7
  const tolerance = options?.tolerance ?? 0.02
  const budget = Math.max(1, maxIterations)

  let calls = 0
  const evaluate = async (quality: number): Promise<EncodedResult | null> => {
    throwIfAborted(options?.signal)
    if (calls >= budget) return null
    calls += 1
    const bytes = await encode(quality)
    throwIfAborted(options?.signal)
    options?.onProgress?.(Math.min(1, calls / budget))
    return { bytes, quality, size: bytes.length, metTarget: bytes.length <= targetBytes }
  }

  const maxResult = await evaluate(maxQuality)
  if (maxResult && maxResult.size <= targetBytes) return maxResult

  let best: EncodedResult | null = null
  let smallest: EncodedResult | null = maxResult

  const minResult = await evaluate(minQuality)
  if (minResult) {
    if (!smallest || minResult.quality < smallest.quality) smallest = minResult
    if (minResult.metTarget) best = minResult
  }

  let lo = minQuality
  let hi = maxQuality
  while (calls < budget && hi - lo > tolerance) {
    const mid = (lo + hi) / 2
    const result = await evaluate(mid)
    if (!result) break
    if (!smallest || result.quality < smallest.quality) smallest = result
    if (result.metTarget) {
      if (!best || result.quality > best.quality) best = result
      lo = mid
    } else {
      hi = mid
    }
  }

  const fallback = best ?? smallest
  if (fallback) return fallback
  return { bytes: new Uint8Array(0), quality: minQuality, size: 0, metTarget: false }
}
