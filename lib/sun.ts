// Sunrise and sunset in New York for a date. Formulas follow suncalc
// (Vladimir Agafonkin, BSD-2), trimmed to what the loop needs.

import { nyMidnightEpochMs } from '@/lib/story';

const NYC = { lat: 40.725, lng: -73.99 };
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

// Degrees above the horizon (negative = below).
export function sunAltitude(epochMs: number, lat = NYC.lat, lng = NYC.lng): number {
  const d = epochMs / DAY_MS - 0.5 + J1970 - J2000;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lng - ra;
  const phi = RAD * lat;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / RAD;
}

export interface SunTimes {
  sunrise: number;  // hours after local midnight
  sunset: number;
}

// Scans the day minute by minute for the -0.833° crossings (standard
// sunrise/sunset). Falls back to 6:30 AM / 7 PM if the sun never crosses.
export function sunTimes(date: string): SunTimes {
  const midnight = nyMidnightEpochMs(date);
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let prev = sunAltitude(midnight);
  for (let m = 1; m <= 1440; m++) {
    const a = sunAltitude(midnight + m * 60_000);
    if (prev < -0.833 && a >= -0.833 && sunrise === null) sunrise = m / 60;
    if (prev >= -0.833 && a < -0.833) sunset = m / 60;
    prev = a;
  }
  return { sunrise: sunrise ?? 6.5, sunset: sunset ?? 19 };
}
