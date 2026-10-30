#!/usr/bin/env node
/**
 * flows.mjs — where the bikes go: net arrivals in Midtown, morning vs evening.
 *
 * Reads every ride of a day (rides/HH.bin.gz, cbr1) and the Manhattan outline,
 * and writes public/data/days/<date>/flows.json:
 *
 *   zone       Midtown, 34th St to 59th St (streets run perpendicular to the
 *              avenues, 29° east of north), inside the island outline
 *   windows    for 7–10 AM and 4–7 PM: rides ending in the zone (arrivals),
 *              rides starting in it (departures) and the net
 *   bands      the same for every band of the island, so the claim can be
 *              checked against the rest of Manhattan
 *
 *   node scripts/flows.mjs [2026-09-23]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const date = process.argv[2] ?? '2026-09-23';
const dayDir = path.resolve('public/data/days', date);
const rings = JSON.parse(fs.readFileSync(path.resolve('public/data/manhattan-outline.json'), 'utf8')).rings;

// Same metres as lib/rides.ts.
const ORIGIN_LNG = -73.97, ORIGIN_LAT = 40.73;
const M_LAT = 110540, M_LNG = 111320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);
const BEARING = (29 * Math.PI) / 180;
// Distance along the avenues, metres north-north-east of the origin.
const along = (lng, lat) => {
  const x = (lng - ORIGIN_LNG) * M_LNG, y = (lat - ORIGIN_LAT) * M_LAT;
  return x * Math.sin(BEARING) + y * Math.cos(BEARING);
};

// Street lines, measured where each street meets a landmark corner.
const STREETS = [
  ['Houston St', -73.9967, 40.7255],
  ['14th St', -73.9935, 40.7357],
  ['34th St', -73.9881, 40.7496],
  ['59th St', -73.9730, 40.7644],
  ['110th St', -73.9580, 40.7990],
].map(([name, lng, lat]) => ({ name, along: Math.round(along(lng, lat)) }));
const at = name => STREETS.find(s => s.name === name).along;

const BANDS = [
  { name: 'Below Houston St', from: -Infinity, to: at('Houston St') },
  { name: 'Houston St – 14th St', from: at('Houston St'), to: at('14th St') },
  { name: '14th St – 34th St', from: at('14th St'), to: at('34th St') },
  { name: 'Midtown (34th St – 59th St)', from: at('34th St'), to: at('59th St') },
  { name: '59th St – 110th St', from: at('59th St'), to: at('110th St') },
  { name: 'Above 110th St', from: at('110th St'), to: Infinity },
];

function inRing(lng, lat, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inManhattan = (lng, lat) => rings.some(r => inRing(lng, lat, r));
const bandOf = (lng, lat) => {
  if (!inManhattan(lng, lat)) return 'Outside Manhattan';
  const a = along(lng, lat);
  return BANDS.find(b => a >= b.from && a < b.to).name;
};

// Decode start and end of every ride (see lib/rides.ts for the format).
const rides = [];
for (let h = 0; h < 24; h++) {
  const file = path.join(dayDir, 'rides', `${String(h).padStart(2, '0')}.bin.gz`);
  if (!fs.existsSync(file)) continue;
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = v.getUint32(4, true);
  let o = 8;
  for (let r = 0; r < n; r++) {
    const k = v.getUint8(o + 1);
    let sec = v.getUint32(o + 2, true), lng = v.getInt32(o + 6, true), lat = v.getInt32(o + 10, true);
    const start = { sec, lng: lng / 1e5, lat: lat / 1e5 };
    o += 14;
    for (let i = 1; i < k; i++) {
      lng += v.getInt16(o, true); lat += v.getInt16(o + 2, true); sec += v.getUint16(o + 4, true);
      o += 6;
    }
    rides.push({ start, end: { sec, lng: lng / 1e5, lat: lat / 1e5 } });
  }
}

const WINDOWS = [
  { id: 'am', label: '7–10 AM', from: 7, to: 10 },
  { id: 'pm', label: '4–7 PM', from: 16, to: 19 },
];
const inWindow = (sec, w) => sec >= w.from * 3600 && sec < w.to * 3600;

// arrivals / departures: every ride ending / starting in the band.
// in / out: only rides that cross the band's edge (start outside and end
// inside, or the reverse); rides within the band cancel out of the net anyway.
const bands = {};
const cell = (b, w) => ((bands[b] ??= {})[w] ??= { arrivals: 0, departures: 0, in: 0, out: 0 });
for (const r of rides) {
  const s = bandOf(r.start.lng, r.start.lat), e = bandOf(r.end.lng, r.end.lat);
  for (const w of WINDOWS) {
    if (inWindow(r.start.sec, w)) {
      cell(s, w.id).departures++;
      if (s !== e) cell(s, w.id).out++;
    }
    if (inWindow(r.end.sec, w)) {
      cell(e, w.id).arrivals++;
      if (s !== e) cell(e, w.id).in++;
    }
  }
}
for (const b of Object.values(bands)) for (const w of Object.values(b)) w.net = w.arrivals - w.departures;

const MIDTOWN = 'Midtown (34th St – 59th St)';
const out = {
  date,
  rides: rides.length,
  zone: {
    name: 'Midtown',
    detail: '34th St to 59th St',
    bearingDeg: 29,
    origin: [ORIGIN_LNG, ORIGIN_LAT],
    alongFromM: at('34th St'),
    alongToM: at('59th St'),
  },
  windows: WINDOWS.map(w => ({ ...w, ...bands[MIDTOWN][w.id] })),
  bands,
  method: 'Arrivals: rides that end in the zone during the window. Departures: rides that start there. Net = arrivals - departures. in / out: rides that cross the zone edge (start outside, end inside / the reverse), by end / start time. Rides are kept if they start or end in Manhattan.',
};
fs.writeFileSync(path.join(dayDir, 'flows.json'), `${JSON.stringify(out, null, 2)}\n`);
for (const w of out.windows) console.log(`Midtown ${w.label}: ${w.arrivals} end there, ${w.departures} start there, net ${w.net > 0 ? '+' : ''}${w.net}; crossing the edge: ${w.in} in, ${w.out} out (${(Math.max(w.in, w.out) / Math.min(w.in, w.out)).toFixed(2)}x)`);
