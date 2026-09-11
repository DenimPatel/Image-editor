/** Format a byte count as a human-readable string (Bytes / KB / MB). */
export function convertBytes(bytesSize: number): string {
  if (bytesSize < 1024) {
    return `${bytesSize} Bytes`;
  }
  if (bytesSize < 1048576) {
    return `${(bytesSize / 1024).toFixed(2)} KB`;
  }
  return `${(bytesSize / 1048576).toFixed(2)} MB`;
}

export type ParsedRatio = { width: number; height: number };

/**
 * Parse a "W:H" aspect ratio string. Returns null for malformed input,
 * non-finite values, or non-positive sides (e.g. "0:0", "-1:2", "abc") —
 * app.py divided by zero on these instead of rejecting them.
 */
export function parseRatio(input: string): ParsedRatio | null {
  const parts = input.split(':');
  if (parts.length !== 2) return null;

  const width = Number(parts[0].trim());
  const height = Number(parts[1].trim());

  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;

  return { width, height };
}
