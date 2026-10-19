export const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

export function hash(...parts: (string | number)[]): number {
  let value = 2166136261;
  for (const ch of parts.join(':')) value = Math.imul(value ^ ch.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function intersectsRange(from: number, to: number, center: number, radius: number): boolean {
  return Math.min(from, to) <= center + radius && Math.max(from, to) >= center - radius;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
