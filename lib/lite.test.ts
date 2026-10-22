import { decodeCbr1, packJsonTrips, toX } from '@/lib/rides';
import { liteKeyframes, liteCaptions, hourAt, scopeToManhattan, LITE_SECONDS, clockLabel, lightPlan, dayFracAt, inkDayAt, timeForHour } from '@/lib/timeline';
import { sunTimes } from '@/lib/sun';
import type { DayStats } from '@/lib/story';

const start = Date.UTC(2026, 8, 23, 4); // midnight in New York (EDT)
const stats: DayStats = {
  date: '2026-09-23',
  totalTrips: 124300,
  peakMinute: '17:42',
  peakEpochMs: start + (17 * 60 + 42) * 60000,
  peakActive: 3276,
  nightLow: { minute: '03:15', epochMs: start + 195 * 60000, active: 24 },
  morningPeak: { minute: '08:49', epochMs: start + 529 * 60000, active: 2548 },
  straightLineKm: 271500,
};

describe('lite timeline', () => {
  it('runs forward from the quiet night to past midnight in 10 s', () => {
    const keys = liteKeyframes(stats, start);
    let prev = -Infinity;
    for (let t = 0; t <= LITE_SECONDS; t += 0.05) {
      const h = hourAt(keys, t);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
    expect(hourAt(keys, 2.0)).toBeCloseTo(3.25 + 0.03, 2);
    expect(hourAt(keys, 6.1)).toBeCloseTo(17.7, 2);
    expect(hourAt(keys, LITE_SECONDS)).toBe(24.5);
  });

  it('writes the captions from the day', () => {
    const lines = liteCaptions(stats).flatMap(c => c.lines);
    expect(lines).toContain('Only 24 Citi Bikes are moving.');
    expect(lines).toContain('Rush hour: 3,276 bikes at once.');
    expect(lines).toContain('124,300');
    expect(lines).toContain('6 times around the Earth.');
  });

  it('formats the clock', () => {
    expect(clockLabel(3.25)).toBe('3:15 AM');
    expect(clockLabel(17.7)).toBe('5:42 PM');
    expect(clockLabel(24.25)).toBe('12:15 AM');
  });

  it('knows when stats are Manhattan only', () => {
    expect(scopeToManhattan(stats).manhattan).toBe(false);
    expect(scopeToManhattan({ ...stats, scope: 'manhattan' } as DayStats).manhattan).toBe(true);
    const nested = scopeToManhattan({ ...stats, manhattan: { totalTrips: 5 } } as DayStats);
    expect(nested.manhattan).toBe(true);
    expect(nested.stats.totalTrips).toBe(5);
  });
});

describe('lite rides', () => {
  it('decodes cbr1', () => {
    const buf = new ArrayBuffer(8 + 14 + 6);
    const v = new DataView(buf);
    'CBR1'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
    v.setUint32(4, 1, true);
    v.setUint8(8, 1);          // e-bike
    v.setUint8(9, 2);          // two points
    v.setUint32(10, 3600, true);
    v.setInt32(14, -7398000, true);
    v.setInt32(18, 4075000, true);
    v.setInt16(22, 100, true);
    v.setInt16(24, -50, true);
    v.setUint16(26, 120, true);
    const b = { offsets: [0], xm: [] as number[], ym: [] as number[], ts: [] as number[], electric: [] as number[] };
    decodeCbr1(buf, b);
    expect(b.offsets).toEqual([0, 2]);
    expect(b.ts).toEqual([3600, 3720]);
    expect(b.electric).toEqual([1]);
    expect(b.xm[1] - b.xm[0]).toBeCloseTo(toX(-73.979) - toX(-73.98), 3);
  });

  it('packs the JSON sample', () => {
    const set = packJsonTrips([{ vendor_type: 'classic_bike', path: [[-73.98, 40.75, start + 1000], [-73.97, 40.76, start + 61000]] }], start);
    expect(set.count).toBe(1);
    expect(Array.from(set.ts)).toEqual([1, 61]);
  });
});

describe('light', () => {
  it('turns day at sunrise and night at sunset', () => {
    const keys = liteKeyframes(stats, start);
    const plan = lightPlan(keys, 6.8, 18.9);
    expect(plan.riseT).not.toBeNull();
    expect(plan.setT).not.toBeNull();
    expect(dayFracAt(plan, 1.0)).toBe(0);
    expect(dayFracAt(plan, (plan.riseT! + plan.setT!) / 2)).toBe(1);
    expect(dayFracAt(plan, 9.5)).toBe(0);
    expect(hourAt(keys, timeForHour(keys, 12)!)).toBeCloseTo(12, 3);
  });

  it('flips words when the scan line passes them', () => {
    expect(inkDayAt(0.5, 0.2)).toBe(0);  // line at mid-frame, words near the top: still night
    expect(inkDayAt(0.5, 0.9)).toBe(1);  // words near the bottom: day
  });

  it('finds sunrise and sunset for a September day', () => {
    const sun = sunTimes('2026-09-23');
    expect(sun.sunrise).toBeGreaterThan(6.5);
    expect(sun.sunrise).toBeLessThan(7.2);
    expect(sun.sunset).toBeGreaterThan(18.6);
    expect(sun.sunset).toBeLessThan(19.2);
  });
});
