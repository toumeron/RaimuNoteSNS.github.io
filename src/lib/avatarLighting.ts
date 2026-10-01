export type AvatarLuminance = {
  median: number;
  upper: number;
  highlight: number;
  clipped: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Measure rendered sRGB pixels, excluding transparent background and antialiased edges. */
export function measureAvatarLuminance(pixels: Uint8ClampedArray): AvatarLuminance | null {
  const values: number[] = [];
  let clipped = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 230) continue;
    const value = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    values.push(value);
    if (value > 0.96) clipped++;
  }
  if (values.length < 24) return null;
  values.sort((a, b) => a - b);
  const percentile = (p: number) => values[Math.floor((values.length - 1) * p)];
  return { median: percentile(0.5), upper: percentile(0.7), highlight: percentile(0.95), clipped: clipped / values.length };
}

/** Bounded feedback with a dead band avoids flicker from blinking and small movements. */
export function nextAvatarExposure(current: number, stats: AvatarLuminance): number {
  let ratio = 0.74 / Math.max(0.035, stats.upper);
  if (stats.highlight > 0.94) ratio = Math.min(ratio, 0.94 / stats.highlight);
  if (stats.clipped > 0.05) ratio = Math.min(ratio, 0.88);
  if (Math.abs(ratio - 1) < 0.055) return current;
  return clamp(current * Math.pow(clamp(ratio, 0.65, 1.5), 0.55), 0.12, 3.5);
}

/** Keep the background quieter than the model, while preserving the selected theme. */
export function avatarBackgroundLightness(stats: AvatarLuminance | null, night: boolean): number {
  const model = stats?.median ?? 0.5;
  return night ? clamp(0.25 - model * 0.28, 0.08, 0.20) : clamp(0.66 - model * 0.65, 0.25, 0.40);
}

/** Time-based interpolation with a speed limit; exposure is interpolated in stops. */
export function animateAvatarLight(current: number, target: number, dt: number, logarithmic = false): number {
  const time = clamp(dt, 0, 0.05);
  const a = logarithmic ? Math.log(Math.max(0.001, current)) : current;
  const b = logarithmic ? Math.log(Math.max(0.001, target)) : target;
  const change = (b - a) * (1 - Math.exp(-1.6 * time));
  const limit = (logarithmic ? 0.4 : 0.08) * time;
  const next = a + clamp(change, -limit, limit);
  return logarithmic ? Math.exp(next) : next;
}
