// The story: one day of Citi Bike in Manhattan, in 27 seconds.
//
//    0.0– 2.4 s  hook        5:42 PM, the busiest minute, with the title
//    2.4– 6.0 s  how to read rewind to 3 AM; hold on 3:15 AM: 24 bikes; legend
//    6.0– 8.6 s  sunrise     the clock speeds up; the scan line brings the day
//    8.6–11.2 s  morning     hold on 8:49 AM: 2,548 bikes
//   11.2–13.8 s  midtown in  nearly twice as many ride into Midtown as out
//   13.8–15.4 s  midday      passes quickly; the chart dips to ~900
//   15.4–19.0 s  peak        hold on 5:42 PM: 3,276 bikes, 29% above the morning
//   19.0–21.6 s  midtown out 1.7x as many ride out as in
//   21.6–23.0 s  sunset      back to night
//   23.0–27.0 s  end card    the day in one line, source, credit
//
// The counter shows activeByMinute for the minute on the clock, and every
// hold sits inside one minute, so counter and caption always agree.
//
// All on-screen words live in COPY below, so they can be edited in one place.
// Pure functions only, so the same timeline drives the live page and the
// frame-by-frame recorder.

import {
  hourOfDay,
  interpolateMonotone,
  nyMidnightEpochMs,
  type DayStats,
  type Keyframe,
} from '@/lib/story';

export const LITE_SECONDS = 27;
export const LITE_FPS = 30;
export const LITE_FRAMES = Math.round(LITE_SECONDS * LITE_FPS);

// The hook ends here and the clock jumps back to the night.
export const CUT_T = 2.4;

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------
// Words. {placeholders} are filled from the day's data.
// ---------------------------------------------------------------------------
export const COPY = {
  kicker: 'One day of Citi Bike · Manhattan',
  counterLabel: 'bikes moving right now',
  hookTitle: 'Two rush hours.\nThe evening one is bigger.',
  hookSub: 'Every Citi Bike ride in Manhattan on {dateLong}: from {low} bikes moving at {lowTime} to {peak} at {peakTime}',
  night: 'The quietest minute: only {low} bikes moving',
  legendRide: 'one bike riding right now',
  legendStreet: 'streets',
  // Captions with a number come in two parts: the second part appears when
  // the counter reaches the number (the hold).
  morning: 'Morning rush',
  morningRest: ': {am} bikes at {amTime}',
  midtownIn: 'Midtown pulls riders in: nearly twice as many arrive as leave',
  peak: 'Evening rush',
  peakRest: ': {peak} bikes at {peakTime}, the day’s peak, {pct}% above the morning',
  tallyAm: '{in} rides in · {out} out · {label}',
  tallyPm: '{out} rides out · {in} in · {label}',
  midtownOut: 'Then Midtown pushes them out: {ratio}× as many leave as arrive',
  sunrise: 'Sunrise {time}',
  sunset: 'Sunset {time}',
  cardBig: '{rides} rides',
  cardLine: 'Low: {low} bikes at {lowTime}\nPeak: {peak} at {peakTime}',
  cardSmall: 'Evening rush {pct}% above the morning',
  footer: 'Data: Citi Bike System Data · {date} · rides starting or ending in Manhattan · routes estimated · Parvez Kose',
  chartTitle: 'Bikes moving, minute by minute',
  chartTitleShort: 'Bikes moving',
  posterTitle: 'Two rush hours. The evening one is {pct}% bigger.',
};

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function dayStartMs(stats: DayStats): number {
  if (stats.date) return nyMidnightEpochMs(stats.date);
  return stats.activeByMinute?.startEpochMs ?? stats.peakEpochMs - (stats.peakEpochMs % 86400000);
}

// Two pieces of clock: the hook (a crawl through the peak minute) and the day
// itself, from 3 AM to past midnight. Each runs only forward; equal hours on
// neighbouring keys hold the clock still.
export interface StoryClock {
  open: Keyframe[];
  main: Keyframe[];
}

// The middle of a minute, so a hold never shows the next minute's count.
const midMinute = (hour: number) => (Math.floor(hour * 60 + 1e-6) + 0.5) / 60;

export function liteClock(stats: DayStats, startMs: number): StoryClock {
  const low = midMinute(stats.nightLow ? hourOfDay(stats.nightLow.epochMs, startMs) : 3.25);
  const am = midMinute(stats.morningPeak ? hourOfDay(stats.morningPeak.epochMs, startMs) : 8.8);
  const peak = midMinute(hourOfDay(stats.peakEpochMs, startMs));
  const m = 1 / 60;
  const open: Keyframe[] = [
    { t: 0, hour: peak - 0.45 * m },
    { t: CUT_T, hour: peak + 0.45 * m },
  ];
  const main: Keyframe[] = [
    { t: CUT_T, hour: low - 15 * m },
    { t: 4.2, hour: low - 0.4 * m },
    { t: 5.4, hour: low + 0.4 * m },
    { t: 6.4, hour: low + 15 * m },
    { t: 8.6, hour: am - 22 * m },
    { t: 9.7, hour: am - 0.4 * m },
    { t: 11.1, hour: am + 0.4 * m },
    { t: 13.8, hour: Math.max(am + 70 * m, 10) },
    { t: 15.4, hour: peak - 85 * m },
    { t: 17.2, hour: peak - 0.4 * m },
    { t: 18.7, hour: peak + 0.4 * m },
    { t: 21.6, hour: Math.max(peak + 60 * m, 18.75) },
    { t: 22.3, hour: 19.25 },
    { t: 23.0, hour: 21.5 },
    { t: LITE_SECONDS, hour: 24 },
  ];
  return { open, main };
}

export function hourAt(clock: StoryClock, t: number): number {
  return t < CUT_T ? interpolateMonotone(clock.open, t) : interpolateMonotone(clock.main, t);
}

export interface Flows {
  zone: { name: string; detail: string; bearingDeg: number; origin: [number, number]; alongFromM: number; alongToM: number };
  windows: Array<{ id: string; label: string; from: number; to: number; arrivals: number; departures: number; in: number; out: number; net: number }>;
}

export type CaptionId = 'night' | 'morning' | 'midtownIn' | 'peak' | 'midtownOut' | 'sunrise' | 'sunset';

export interface LiteCaption {
  id: CaptionId;
  from: number;
  to: number;
  text: string;
  // Appended at restFrom, when the counter reaches the caption's number.
  rest?: string;
  restFrom?: number;
  // The Midtown counts under a caption.
  tally?: string;
}

export interface StoryText {
  kicker: string;
  counterLabel: string;
  hookTitle: string;
  hookSub: string;
  legendRide: string;
  legendStreet: string;
  captions: LiteCaption[];
  card: { big: string; line: string; small: string };
  footer: string;
  chartTitle: string;
  chartTitleShort: string;
  posterTitle: string;
}

export function storyText(
  stats: DayStats,
  flows?: Flows | null,
  sun?: { sunrise: number; sunset: number } | null,
  plan?: LightPlan | null,
): StoryText {
  const start = nyMidnightEpochMs(stats.date);
  const at = (ms: number) => clockLabel(hourOfDay(ms, start));
  const weekday = new Date(`${stats.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  const date = new Date(`${stats.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const noon = new Date(`${stats.date}T12:00:00`);
  const month = noon.getMonth() === 8 ? 'Sept' : noon.toLocaleDateString('en-US', { month: 'short' });
  const dateLong = `${noon.toLocaleDateString('en-US', { weekday: 'short' })}, ${month} ${noon.getDate()}, ${noon.getFullYear()}`;
  const low = stats.nightLow;
  const am = stats.morningPeak;
  const vars: Record<string, string | number> = {
    weekday,
    date,
    dateLong,
    peak: fmtInt(stats.peakActive),
    peakTime: at(stats.peakEpochMs),
    rides: fmtInt(stats.totalTrips),
    low: low ? fmtInt(low.active) : '',
    lowTime: low ? at(low.epochMs) : '',
    am: am ? fmtInt(am.active) : '',
    amTime: am ? at(am.epochMs) : '',
    pct: am ? Math.round((stats.peakActive / am.active - 1) * 100) : '',
    x: low ? Math.floor(stats.peakActive / low.active) : '',
  };
  const pm = flows?.windows.find(w => w.id === 'pm');
  if (pm) vars.ratio = (pm.out / pm.in).toFixed(1);

  const amFlow = flows?.windows.find(w => w.id === 'am');
  const tally = (tpl: string, w: { in: number; out: number; label: string }) => fill(tpl, { in: fmtInt(w.in), out: fmtInt(w.out), label: w.label });
  const captions: LiteCaption[] = [];
  // The night caption starts with the 3:15 hold, when the counter reads 24.
  if (low) captions.push({ id: 'night', from: 4.2, to: 6.7, text: fill(COPY.night, vars) });
  if (am) captions.push({ id: 'morning', from: 8.7, to: 11.25, text: fill(COPY.morning, vars), rest: fill(COPY.morningRest, vars), restFrom: 9.7 });
  if (flows && amFlow) captions.push({ id: 'midtownIn', from: 11.3, to: 13.9, text: fill(COPY.midtownIn, vars), tally: tally(COPY.tallyAm, amFlow) });
  if (am) captions.push({ id: 'peak', from: 15.5, to: 19.7, text: fill(COPY.peak, vars), rest: fill(COPY.peakRest, vars), restFrom: 17.2 });
  else captions.push({ id: 'peak', from: 15.5, to: 19.7, text: fill('Rush hour: {peak} bikes at {peakTime}', vars) });
  if (flows && pm) captions.push({ id: 'midtownOut', from: 19.75, to: 22.4, text: fill(COPY.midtownOut, vars), tally: tally(COPY.tallyPm, pm) });
  if (sun && plan) {
    // The wipes start when the clock reaches sunrise / sunset; the tags ride along.
    const rise = plan.wipes.find(w => w.toDay);
    const set = plan.wipes.filter(w => !w.toDay).pop();
    const half = WIPE_SECONDS / 2;
    if (rise) captions.push({ id: 'sunrise', from: rise.t - half, to: rise.t + half + 0.6, text: fill(COPY.sunrise, { time: clockLabel(sun.sunrise) }) });
    if (set && set.t > CUT_T + 1) captions.push({ id: 'sunset', from: set.t - half, to: set.t + half + 0.6, text: fill(COPY.sunset, { time: clockLabel(sun.sunset) }) });
  }

  return {
    kicker: COPY.kicker,
    counterLabel: COPY.counterLabel,
    hookTitle: fill(COPY.hookTitle, vars),
    hookSub: low ? fill(COPY.hookSub, vars) : '',
    legendRide: COPY.legendRide,
    legendStreet: COPY.legendStreet,
    captions,
    card: { big: fill(COPY.cardBig, vars), line: low ? fill(COPY.cardLine, vars) : '', small: low ? fill(COPY.cardSmall, vars) : '' },
    footer: fill(COPY.footer, vars),
    chartTitle: COPY.chartTitle,
    chartTitleShort: COPY.chartTitleShort,
    posterTitle: fill(COPY.posterTitle, vars),
  };
}

export function fadeWindow(t: number, from: number, to: number, fade = 0.2): number {
  if (t < from || t > to) return 0;
  return Math.max(0, Math.min(1, (t - from) / fade, (to - t) / fade));
}

export const HOOK_TO = CUT_T - 0.05;
export const CARD_FROM = 23.0;

// Hook title, then the counter row from the night to the end card.
export function hookOpacity(t: number): number {
  return t <= 0.25 ? 1 : fadeWindow(t, 0, HOOK_TO, 0.25);
}
export function counterOpacity(t: number): number {
  return fadeWindow(t, CUT_T + 0.2, CARD_FROM + 0.1, 0.3);
}
export function legendOpacity(t: number): number {
  return fadeWindow(t, 4.2, 6.7, 0.3);
}
export function cardOpacity(t: number): number {
  return fadeWindow(t, CARD_FROM, LITE_SECONDS + 1, 0.4);
}

// The chart: the whole day ghosted in the hook, then drawn up to the clock.
export function chartGhost(t: number): number {
  return t < CUT_T ? 0.35 : 0.12;
}

// Midtown lights up while its captions are on screen.
export function highlightAt(t: number): { amount: number; window: 'am' | 'pm' } {
  if (t < 16) return { amount: fadeWindow(t, 11.3, 13.9, 0.35), window: 'am' };
  return { amount: fadeWindow(t, 19.75, 22.4, 0.35), window: 'pm' };
}

// Night heads grow and glow while the clock is near 3 AM (story hours).
export function headBoostAt(t: number, hour: number): number {
  if (t < CUT_T) return 1;
  const ease = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
  if (hour < 2.9) return 1;
  if (hour <= 3 + 35 / 60) return 2.5;
  return 1 + 1.5 * (1 - ease((hour - (3 + 35 / 60)) / (25 / 60)));
}

// Darken the map under the end card so the words read.
export function dimAt(t: number): number {
  return 0.5 * fadeWindow(t, CARD_FROM - 0.2, LITE_SECONDS + 1, 0.5);
}

// A slow drift so the close-up never sits still.
export function driftAt(t: number): { scale: number; rotateDeg: number } {
  const p = (2 * Math.PI * t) / LITE_SECONDS;
  return { scale: 1 + 0.02 * (1 - Math.cos(p)), rotateDeg: 0.6 * Math.sin(p) };
}

export function activeAtHour(stats: DayStats, startMs: number, hour: number): number | null {
  const c = stats.activeByMinute;
  if (!c || !c.values.length) return null;
  const i = Math.floor((startMs + hour * 3600000 - c.startEpochMs) / c.stepMs);
  return c.values[Math.max(0, Math.min(c.values.length - 1, i))];
}

export function clockLabel(hour: number): string {
  const m = ((Math.floor(hour * 60 + 1e-6) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  return `${h24 % 12 || 12}:${mm < 10 ? '0' : ''}${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

// The story is Manhattan only. When the day's stats carry a Manhattan scope
// (rides that start or end in Manhattan), every number on screen uses it.
export function scopeToManhattan(stats: DayStats): { stats: DayStats; manhattan: boolean } {
  const s = stats as DayStats & { scope?: string; manhattan?: Partial<DayStats> };
  if (s.scope === 'manhattan') return { stats, manhattan: true };
  const m = s.manhattan;
  if (!m || typeof m.totalTrips !== 'number') return { stats, manhattan: false };
  return { stats: { ...stats, ...m, date: stats.date } as DayStats, manhattan: true };
}

// ---------------------------------------------------------------------------
// Light: the story follows the sun. The hook is day; the rewind to 3 AM sweeps
// a scan line down to night; at sunrise it sweeps up and leaves day behind
// it; at sunset it sweeps back down.
// ---------------------------------------------------------------------------

// Clip second at which the main clock first reaches `hour`.
export function timeForHour(clock: StoryClock, hour: number): number | null {
  let lo = CUT_T, hi = LITE_SECONDS;
  if (hour < hourAt(clock, lo) || hour > hourAt(clock, hi)) return null;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (hourAt(clock, mid) < hour) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface LightPlan {
  startDay: boolean;
  // Clip seconds at which the scan line crosses mid-frame, and which way.
  wipes: Array<{ t: number; toDay: boolean }>;
}

export const WIPE_SECONDS = 0.8;

export function lightPlan(clock: StoryClock, sunrise: number, sunset: number): LightPlan {
  const peak = hourAt(clock, 0);
  const openDay = peak > sunrise && peak < sunset;
  const wipes: LightPlan['wipes'] = [];
  if (openDay) wipes.push({ t: CUT_T + WIPE_SECONDS / 2, toDay: false });
  const rise = timeForHour(clock, sunrise);
  const set = timeForHour(clock, sunset);
  // Centre each wipe half a wipe after the moment, so the line starts moving
  // when the clock reads sunrise or sunset.
  if (rise !== null) wipes.push({ t: rise + WIPE_SECONDS / 2, toDay: true });
  if (set !== null) wipes.push({ t: set + WIPE_SECONDS / 2, toDay: false });
  return { startDay: openDay, wipes };
}

const smoothstep = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

// Share of the frame, from the bottom up, that is in daylight. The scan line
// sits at 1 - dayFrac of the frame height.
export function dayFracAt(plan: LightPlan, t: number): number {
  let f = plan.startDay ? 1 : 0;
  for (const w of plan.wipes) {
    const p = smoothstep((t - w.t) / WIPE_SECONDS + 0.5);
    f += w.toDay ? p : -p;
  }
  return Math.max(0, Math.min(1, f));
}

// Which way the nearest wipe runs (the scan line trails its grid into the night).
export function risingAt(plan: LightPlan, t: number): boolean {
  let best: { t: number; toDay: boolean } | null = null;
  for (const w of plan.wipes) if (!best || Math.abs(w.t - t) < Math.abs(best.t - t)) best = w;
  return best ? best.toDay : true;
}

// How "day" the ink should be for words at a given height (0 = top, 1 =
// bottom): they flip when the scan line passes them.
export function inkDayAt(dayFrac: number, yFrac: number): number {
  return smoothstep((dayFrac - (1 - yFrac)) / 0.08 + 0.5);
}

// ---------------------------------------------------------------------------
// The chart: bikes moving, minute by minute, 3 AM to midnight (the counts
// before ~0:30 miss rides that began the day before, and the clock starts at 3).
// ---------------------------------------------------------------------------

export const CHART_FROM_H = 3;
export const CHART_TO_H = 24;

// 5-minute maxima keep the peaks and drop the jitter. Returns [hour, value].
export function chartSeries(stats: DayStats, startMs: number, bucketMin = 5): Array<[number, number]> {
  const c = stats.activeByMinute;
  if (!c?.values.length) return [];
  const pts: Array<[number, number]> = [];
  for (let m = CHART_FROM_H * 60; m < CHART_TO_H * 60; m += bucketMin) {
    let v = 0;
    for (let k = 0; k < bucketMin; k++) {
      const i = Math.floor((startMs + (m + k) * 60000 - c.startEpochMs) / c.stepMs);
      if (i >= 0 && i < c.values.length) v = Math.max(v, c.values[i]);
    }
    pts.push([(m + bucketMin / 2) / 60, v]);
  }
  return pts;
}

// The midday low: the quietest minute between 10 AM and 3 PM.
export function middayLow(stats: DayStats, startMs: number): { hour: number; active: number } | null {
  const c = stats.activeByMinute;
  if (!c?.values.length) return null;
  let best: { hour: number; active: number } | null = null;
  for (let m = 600; m < 900; m++) {
    const i = Math.floor((startMs + m * 60000 - c.startEpochMs) / c.stepMs);
    if (i < 0 || i >= c.values.length) continue;
    if (!best || c.values[i] < best.active) best = { hour: m / 60, active: c.values[i] };
  }
  return best;
}
