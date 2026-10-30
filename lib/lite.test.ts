import { decodeCbr1, packJsonTrips, toX } from '@/lib/rides';
import { CUTS, cameraAt, highlightAt, liteClock, storyText, hourAt, scopeToManhattan, LITE_SECONDS, CUT_T, clockLabel, lightPlan, dayFracAt, inkDayAt, timeForHour, activeAtHour, type Flows } from '@/lib/timeline';
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

// Minute-by-minute counts: 24 at 3:15, 2,548 at 8:49, 3,276 at 17:42, ~1,000 otherwise.
const values = Array.from({ length: 1500 }, (_, m) => (m === 195 ? 24 : m === 529 ? 2548 : m === 1062 ? 3276 : 1000));
stats.activeByMinute = { startEpochMs: start, stepMs: 60000, values };

const flows: Flows = {
  zone: { name: 'Midtown', detail: '34th St to 59th St', bearingDeg: 29, origin: [-73.97, 40.73], alongFromM: 1155, alongToM: 3203 },
  windows: [
    { id: 'am', label: '7–10 AM', from: 7, to: 10, arrivals: 6645, departures: 4610, in: 4318, out: 2255, net: 2035 },
    { id: 'pm', label: '4–7 PM', from: 16, to: 19, arrivals: 6291, departures: 8474, in: 3246, out: 5438, net: -2183 },
  ],
};

describe('lite timeline', () => {
  it('opens on the peak, then runs forward from the night to midnight', () => {
    const clock = liteClock(stats, start);
    expect(clockLabel(hourAt(clock, 0))).toBe('5:42 PM');
    expect(clockLabel(hourAt(clock, CUT_T - 0.01))).toBe('5:42 PM');
    let prev = -Infinity;
    for (let t = CUT_T; t <= LITE_SECONDS; t += 0.05) {
      const h = hourAt(clock, t);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
    expect(hourAt(clock, LITE_SECONDS)).toBe(24);
  });

  it('holds the clock inside each key minute, so the counter matches the chart label', () => {
    const clock = liteClock(stats, start);
    // The holds: 3:15 AM (24), 8:49 AM (2,548), 5:42 PM (3,276).
    const holds: Array<[number, number, number]> = [[4.2, 5.4, 24], [9.7, 11.1, 2548], [17.2, 18.7, 3276]];
    for (const [from, to, n] of holds) {
      let frames = 0;
      for (let t = from + 0.02; t <= to - 0.02; t += 1 / 30) {
        expect(activeAtHour(stats, start, hourAt(clock, t))).toBe(n);
        frames++;
      }
      expect(frames).toBeGreaterThanOrEqual(30);
    }
  });

  it('keeps the words to a title, the numbers and the source', () => {
    const text = storyText(stats, flows, sunTimes(stats.date), lightPlan(liteClock(stats, start), sunTimes(stats.date).sunrise, sunTimes(stats.date).sunset));
    expect(text.title).toBe('One day of Citi Bike');
    expect(text.subtitle).toBe('Manhattan');
    // No caption sentences: only the sunrise and sunset tags under the clock.
    expect(text.captions.map(c => c.id).sort()).toEqual(['sunrise', 'sunset']);
    for (const c of text.captions) expect(c.text).toMatch(/^Sun(rise|set) \d{1,2}:\d{2} (AM|PM)$/);
    expect(text.card).toEqual({ big: '124,300 rides' });
    expect(text.chartTitleLong).toBe('Bikes moving in Manhattan, minute by minute');
    expect(text.footer).toContain('Wed, Sep 23, 2026');
    expect(text.footer).toContain('Parvez Kose');
  });

  it('plays the long cut as the same story, slower, with ~5 s holds', () => {
    const long = CUTS.long;
    expect(long.frames).toBe(long.seconds * 30);
    expect(long.seconds).toBeGreaterThanOrEqual(60);
    expect(long.toStory(0)).toBe(0);
    expect(long.toStory(long.seconds)).toBe(27);
    let prev = -1;
    for (let t = 0; t <= long.seconds; t += 1 / 30) {
      const s = long.toStory(t);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    const clock = liteClock(stats, start);
    for (const n of [24, 2548, 3276]) {
      let frames = 0;
      for (let t = 0; t <= long.seconds; t += 1 / 30) {
        if (activeAtHour(stats, start, hourAt(clock, long.toStory(t))) === n) frames++;
      }
      expect(frames / 30).toBeGreaterThanOrEqual(4);
    }
  });

  it('frames Midtown while it is outlined in the long cut, and the whole island at both ends', () => {
    const long = CUTS.long;
    const metres = (a: { lng: number; lat: number }, b: [number, number]) =>
      Math.hypot((a.lng - b[0]) * 84400, (a.lat - b[1]) * 111000);
    for (let t = 0; t <= long.seconds; t += 0.1) {
      if (highlightAt(long.toStory(t)).amount > 0.5) {
        const cam = cameraAt(t);
        expect(metres(cam, [-73.983, 40.757])).toBeLessThan(400);
        expect(cam.zoom).toBeGreaterThan(2.2);
      }
    }
    expect(cameraAt(0).zoom).toBeCloseTo(1);
    expect(cameraAt(long.seconds).zoom).toBeCloseTo(1);
    // No jumps: the camera moves less than 1% of the island per frame.
    for (let t = 0; t < long.seconds; t += 1 / 30) {
      expect(metres(cameraAt(t), [cameraAt(t + 1 / 30).lng, cameraAt(t + 1 / 30).lat])).toBeLessThan(60);
    }
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
  it('opens in daylight, cuts to night, then follows the sun', () => {
    const clock = liteClock(stats, start);
    const plan = lightPlan(clock, 6.8, 18.9);
    expect(plan.startDay).toBe(true);
    expect(plan.wipes.map(w => w.toDay)).toEqual([false, true, false]);
    expect(dayFracAt(plan, 0)).toBe(1);
    expect(dayFracAt(plan, 4.5)).toBe(0);
    expect(dayFracAt(plan, 12)).toBe(1);
    expect(dayFracAt(plan, LITE_SECONDS - 1)).toBe(0);
    expect(hourAt(clock, timeForHour(clock, 12)!)).toBeCloseTo(12, 3);
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
