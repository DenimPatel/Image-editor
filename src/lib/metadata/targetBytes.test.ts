import { describe, expect, it } from 'vitest'
import { fitUnderTarget } from './targetBytes'

function fakeEncoder(scale: number) {
  const calls: number[] = []
  const encode = async (quality: number): Promise<Uint8Array> => {
    calls.push(quality)
    return new Uint8Array(Math.round(quality * scale))
  }
  return { encode, calls }
}

describe('fitUnderTarget', () => {
  it('returns the highest quality encoding at or under the target', async () => {
    const { encode } = fakeEncoder(1000)
    const result = await fitUnderTarget(encode, 500)
    expect(result.size).toBeLessThanOrEqual(500)
    expect(result.quality).toBe(0.5)
  })

  it('stays under the target when achievable', async () => {
    const { encode } = fakeEncoder(1000)
    const result = await fitUnderTarget(encode, 600)
    expect(result.size).toBeLessThanOrEqual(600)
  })

  it('never calls encode more than maxIterations times', async () => {
    const { encode, calls } = fakeEncoder(1000)
    await fitUnderTarget(encode, 500)
    expect(calls.length).toBeLessThanOrEqual(7)

    const custom = fakeEncoder(1000)
    await fitUnderTarget(custom.encode, 500, { maxIterations: 3 })
    expect(custom.calls.length).toBeLessThanOrEqual(3)
  })

  it('falls back to the minimum quality when the target is tiny', async () => {
    const { encode } = fakeEncoder(1000)
    const result = await fitUnderTarget(encode, 1)
    expect(result.quality).toBe(0.05)
    expect(result.size).toBeGreaterThan(1)
  })

  it('returns max quality when it already fits', async () => {
    const { encode, calls } = fakeEncoder(1000)
    const result = await fitUnderTarget(encode, 5000)
    expect(result.quality).toBe(0.95)
    expect(calls.length).toBe(1)
  })

  it('reports size as the byte length', async () => {
    const { encode } = fakeEncoder(1000)
    const result = await fitUnderTarget(encode, 500)
    expect(result.size).toBe(result.bytes.length)
  })
})

describe('fitUnderTarget metTarget (D7-F14)', () => {
  it('is false when even the lowest quality is over the target', async () => {
    const { encode } = fakeEncoder(1000)
    const result = await fitUnderTarget(encode, 1)
    expect(result.size).toBeGreaterThan(1)
    expect(result.metTarget).toBe(false)
  })

  it('is true when the search lands under the target', async () => {
    const { encode } = fakeEncoder(1000)
    const result = await fitUnderTarget(encode, 500)
    expect(result.metTarget).toBe(true)
    expect(result.size).toBeLessThanOrEqual(500)
  })

  it('is true when the first attempt already fits', async () => {
    const { encode } = fakeEncoder(1000)
    expect((await fitUnderTarget(encode, 5000)).metTarget).toBe(true)
  })

  it('reports progress that only increases', async () => {
    const { encode } = fakeEncoder(1000)
    const seen: number[] = []
    await fitUnderTarget(encode, 500, { onProgress: (value) => seen.push(value) })
    expect(seen.length).toBeGreaterThan(0)
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen[seen.length - 1]).toBeLessThanOrEqual(1)
  })
})

describe('fitUnderTarget cancellation (D7-F16)', () => {
  it('rejects with an AbortError once the signal fires', async () => {
    const controller = new AbortController()
    const encode = async (quality: number) => {
      controller.abort()
      return new Uint8Array(Math.round(quality * 1000))
    }
    await expect(fitUnderTarget(encode, 500, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('rejects immediately for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const encode = async () => new Uint8Array(10)
    await expect(fitUnderTarget(encode, 500, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
