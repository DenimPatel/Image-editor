/** A DOMException with the name `AbortError`, which is what every stage of the
 * export pipeline rejects with so callers can tell cancellation from failure. */
export function abortError(message = 'Export cancelled'): DOMException {
  return new DOMException(message, 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** No-op when there is no signal, so every stage can call it unconditionally. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

/**
 * Reject as soon as the signal fires, without waiting for `promise` to settle.
 * A cancelled export must finish its job immediately; the abandoned render
 * keeps running in the background and its result is discarded.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
