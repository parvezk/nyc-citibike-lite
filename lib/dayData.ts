import type { DayStats } from '@/lib/story';

// Where a day's files live:
//   /data/days/index.json                  { days: [...], presets: { default, busiest } }
//   /data/days/<YYYY-MM-DD>/day-stats.json  the day in numbers
//   /data/days/<YYYY-MM-DD>/trips.json      routed 6,000-ride sample
//   /data/days/<YYYY-MM-DD>/rides/          every ride, hourly cbr1 chunks

export interface DaysIndex {
  days: Array<string | { date: string }>;
  presets?: { default?: string; busiest?: string; [name: string]: string | undefined };
}

export interface DaySources {
  date: string;
  statsUrl: string;
  tripsUrl: string;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// `requested` may be a date ("2026-09-23"), a preset name ("busiest") or empty.
export function pickDay(index: DaysIndex, requested?: string | null): string | null {
  const dates = index.days.map(d => (typeof d === 'string' ? d : d.date));
  if (requested && isDate(requested) && dates.includes(requested)) return requested;
  const preset = requested && index.presets?.[requested];
  if (preset && dates.includes(preset)) return preset;
  const fallback = index.presets?.default;
  if (fallback && dates.includes(fallback)) return fallback;
  return dates.length ? dates[dates.length - 1] : null;
}

export async function resolveDay(requested?: string | null): Promise<DaySources> {
  const res = await fetch('/data/days/index.json');
  if (!res.ok) throw new Error(`days index: ${res.status}`);
  const date = pickDay((await res.json()) as DaysIndex, requested);
  if (!date) throw new Error('No days in the index');
  return { date, statsUrl: `/data/days/${date}/day-stats.json`, tripsUrl: `/data/days/${date}/trips.json` };
}

export async function loadDayStats(sources: DaySources): Promise<DayStats> {
  const res = await fetch(sources.statsUrl);
  if (!res.ok) throw new Error(`day stats: ${res.status}`);
  return (await res.json()) as DayStats;
}
