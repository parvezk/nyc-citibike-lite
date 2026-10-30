# One day of Citi Bike (lite)

Every Citi Bike ride in Manhattan on one day, as a 27-second story with almost no words over the map: a title, a live counter of bikes moving, the clock, and a chart of bikes moving, minute by minute, drawn along the bottom. The clock holds on the quietest minute of the night (24 bikes moving), the morning rush (2,548) and the evening peak (3,276 bikes at once), and Midtown is outlined while it fills up and empties out. Made to be shared as a short clip on LinkedIn, X and Substack, and to load fast on a phone.

The light follows the sun. Night is a TRON-like grid of cyan streets, a neon coastline and orange light trails. At sunrise a glowing scan line sweeps up the frame and leaves a paper-white day behind it, with grey streets and vivid trails; at sunset it sweeps back down. Sunrise and sunset come from the date (`lib/sun.ts`).

It is a plain 2D canvas. There's no map library, no 3D buildings and no scrubber: the day's own routes, drawn faintly, are the map. The full interactive version, with the map, places and filters, lives in [nyc-urban-mobility-dev](https://github.com/parvezk/nyc-urban-mobility-dev).

## Run it

```bash
pnpm install
pnpm dev           # http://localhost:3000
pnpm test
```

URL options:

- `?day=<YYYY-MM-DD|busiest>` picks a day from `public/data/days/index.json`. The default is a typical weekday.
- `?rides=all` draws every ride (about 7 MB of hourly chunks). The default draws a routed 6,000-ride sample so phones load fast. The numbers always count every ride.

On wide screens the day's numbers sit beside the loop. On phones they open from "The day in numbers".

## Record the MP4s

Needs the app running, Playwright (`pnpm add -D playwright && npx playwright install chromium`) and ffmpeg.

```bash
pnpm build && pnpm start
node scripts/record.mjs                    # 4x5, 1x1, 16x9 and 9x16 into out/clips
node scripts/record.mjs --format 4x5 --stills 0,540   # PNGs of single frames
node scripts/poster.mjs                    # the stills from /poster?v=…: 4:5 cover, two map pairs, the chart, a 1200x630 link preview
```

The recorder steps the loop frame by frame (`window.__clip.seek`) and draws every ride, so the output is identical on every run.

## Data

`public/data/days/` holds Manhattan-scoped days: rides that started or ended in Manhattan, from the Citi Bike system data. Routes are estimated with OSRM. The ETL runs in GitHub Actions in nyc-urban-mobility-dev. To refresh:

```bash
node scripts/sync-data.mjs ../nyc-urban-mobility-dev
```

| File | What |
|:---|:---|
| `index.json` | the days and presets (`default`, `busiest`) |
| `<date>/day-stats.json` | the day in numbers, plus bikes in motion per minute |
| `<date>/trips.json` | the routed 6,000-ride sample |
| `<date>/rides/` | every ride, hourly `cbr1` binary chunks (see `lib/rides.ts`) |
| `<date>/flows.json` | Midtown (34th–59th St) arrivals and departures, 7–10 AM and 4–7 PM, written by `node scripts/flows.mjs` |
| `manhattan-outline.json` | the island's outline (NYC borough boundary, simplified) |

## Code

| Path | What |
|:---|:---|
| `lib/timeline.ts` | the beat sheet: clip seconds to hour of day, holds, light, chart series, and every on-screen word (`COPY`) |
| `lib/renderer.ts` | canvas renderer: night and day maps, fading trails, bike heads, the scan-line wipe |
| `lib/sun.ts` | sunrise and sunset in New York for a date |
| `lib/rides.ts` | loads the sample JSON or the cbr1 chunks into flat typed arrays |
| `components/LitePlayer.tsx` | the page: frame loop, words on screen, recorder hooks |
| `components/LiteStatsCard.tsx` | the compact day-in-numbers card |
| `components/Poster.tsx` | the stills: four maps (count and time only), map pairs, the annotated day chart, the link preview |
