// Simulated weather: a small Markov chain. Spells last 20–90 minutes (real time).

export type WeatherKind = 'clear' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'downpour';

export interface Weather {
  kind: WeatherKind;
  /** 0..1, drives the rain particles. */
  rain: number;
  /** 0..1, extra fog in the client. */
  fog: number;
  since: number;
  until: number;
}

const PROPS: Record<WeatherKind, { rain: number; fog: number }> = {
  clear: { rain: 0, fog: 0 },
  overcast: { rain: 0, fog: 0.15 },
  fog: { rain: 0, fog: 0.8 },
  drizzle: { rain: 0.35, fog: 0.25 },
  rain: { rain: 0.8, fog: 0.3 },
  downpour: { rain: 1, fog: 0.45 },
};

// It's a rainy city: rain is the most common state.
const NEXT: Record<WeatherKind, [WeatherKind, number][]> = {
  clear: [['clear', 2], ['overcast', 3], ['fog', 1]],
  overcast: [['clear', 2], ['drizzle', 3], ['fog', 1], ['overcast', 1]],
  fog: [['overcast', 2], ['drizzle', 2], ['clear', 1]],
  drizzle: [['rain', 3], ['overcast', 2], ['drizzle', 1]],
  rain: [['rain', 2], ['drizzle', 2], ['downpour', 1.5]],
  downpour: [['rain', 3], ['downpour', 1]],
};

function pick(options: [WeatherKind, number][]): WeatherKind {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of options) { r -= w; if (r <= 0) return k; }
  return options[0][0];
}

export function makeWeather(kind: WeatherKind, now: number, speed: number): Weather {
  const minutes = 20 + Math.random() * 70;
  return { kind, ...PROPS[kind], since: now, until: now + (minutes * 60_000) / speed };
}

/** Returns a new Weather if the current spell is over, otherwise null. */
export function stepWeather(w: Weather, now: number, speed: number): Weather | null {
  if (now < w.until) return null;
  return makeWeather(pick(NEXT[w.kind]), now, speed);
}

export function describeWeather(w: Weather): string {
  return { clear: 'clear sky', overcast: 'overcast', fog: 'thick fog', drizzle: 'light drizzle', rain: 'rain', downpour: 'heavy downpour' }[w.kind];
}
