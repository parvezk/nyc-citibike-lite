# One day of Citi Bike (lite)

Every Citi Bike ride in Manhattan on one day, in a 10-second loop: the quiet night, the wake-up, rush hour, then the day's total. Made to be shared as a short clip on X, LinkedIn, Threads and Substack, and to load fast on a phone.

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
node scripts/record.mjs                    # 9x16, 1x1 and 16x9 into out/clips
node scripts/record.mjs --format 9x16 --day busiest
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

## Code

| Path | What |
|:---|:---|
| `lib/timeline.ts` | the 10-second beat sheet: clip seconds to hour of day, captions |
| `lib/renderer.ts` | canvas renderer: ghost network, fading trails, bike heads |
| `lib/rides.ts` | loads the sample JSON or the cbr1 chunks into flat typed arrays |
| `components/LitePlayer.tsx` | the page: frame loop, words on screen, recorder hooks |
| `components/LiteStatsCard.tsx` | the compact day-in-numbers card |
