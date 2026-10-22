// Shared story helpers: the day-stats shape, time maths and plain-English
// comparisons. Pure functions, no DOM.

export interface StoryMoment {
  minute: string;   // "HH:MM", America/New_York
  epochMs: number;
  active: number;   // bikes in motion
}

// Shape of public/data/days/<date>/day-stats.json (written by the ETL in
// parvezk/nyc-urban-mobility-dev, stage 4).
export interface DayStats {
  scope?: string;      // "manhattan"
  date: string;        // ISO date, e.g. "2026-09-23"
  totalTrips: number;
  peakMinute: string;  // e.g. "17:42"
  peakEpochMs: number;
  peakActive: number;
  nightLow?: StoryMoment;
  morningPeak?: StoryMoment;
  straightLineKm?: number;
  ebikeShare?: number;        // 0..1
  memberShare?: number;       // 0..1
  medianRideMinutes?: number;
  medianRideKm?: number;
  activeByMinute?: { startEpochMs: number; stepMs: number; values: number[] };
}

const HOUR_MS = 3600000;

export interface Keyframe { t: number; hour: number }

export function hourOfDay(epochMs: number, dayStartMs: number): number {
  return (epochMs - dayStartMs) / HOUR_MS;
}

// Monotone cubic (Fritsch–Carlson): smooth speed changes, never runs backwards.
export function interpolateMonotone(keys: Keyframe[], t: number): number {
  const n = keys.length;
  if (t <= keys[0].t) return keys[0].hour;
  if (t >= keys[n - 1].t) return keys[n - 1].hour;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(keys[i + 1].t - keys[i].t);
    slope.push((keys[i + 1].hour - keys[i].hour) / dx[i]);
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) { m.push(0); continue; }
    const w1 = 2 * dx[i] + dx[i - 1];
    const w2 = dx[i] + 2 * dx[i - 1];
    m.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]));
  }
  m.push(slope[n - 2]);

  let i = 0;
  while (t > keys[i + 1].t) i++;
  const h = dx[i];
  const s = (t - keys[i].t) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * keys[i].hour +
    (s3 - 2 * s2 + s) * h * m[i] +
    (-2 * s3 + 3 * s2) * keys[i + 1].hour +
    (s3 - s2) * h * m[i + 1];
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export function formatStoryDate(date: string): string {
  // Anchor at noon so the weekday never rolls across a timezone boundary.
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  });
}

const MOON_KM = 384400;
const EARTH_KM = 40075;

// A plain-English comparison for the day's (straight-line, so minimum) distance.
export function distanceComparison(km: number): string {
  if (km >= 2 * MOON_KM) return 'To the Moon and back.';
  if (km >= MOON_KM) return 'Farther than the Moon.';
  if (km >= 2 * EARTH_KM) return `${Math.floor(km / EARTH_KM)} times around the Earth.`;
  if (km >= EARTH_KM) return 'Once around the Earth.';
  return `${fmtInt(km)} km of riding.`;
}

export function nyMidnightEpochMs(date: string): number {
  const offsetName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${date}T12:00:00Z`))
    .find(p => p.type === 'timeZoneName')?.value ?? 'GMT-05:00';
  const offset = offsetName.replace('GMT', '') || '+00:00';
  return new Date(`${date}T00:00:00${offset}`).getTime();
}
