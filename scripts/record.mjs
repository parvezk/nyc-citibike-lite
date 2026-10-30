#!/usr/bin/env node
/**
 * record.mjs — render the loop to MP4, frame by frame.
 *
 * The page exposes window.__clip.seek(frame); we step through every frame,
 * screenshot it at the exact export size and pipe the PNGs into ffmpeg. The
 * output is identical on every run and never drops frames, however slow the
 * machine is.
 *
 * Needs: the app running (npm run build && npm start, or npm run dev),
 *        Playwright (npm i --no-save playwright && npx playwright install chromium)
 *        ffmpeg on PATH (brew install ffmpeg)
 *
 * Usage:
 *   node scripts/record.mjs                       # 4x5, 1x1, 16x9 and 9x16
 *   node scripts/record.mjs --format 4x5 --stills 0,300,510   # PNGs of those frames only
 *   node scripts/record.mjs --format 9x16
 *   node scripts/record.mjs --format 4x5 --cut long   # the 78 s cut with the moving camera
 *   node scripts/record.mjs --day busiest          # a date or preset from data/days/index.json
 *   node scripts/record.mjs --url http://localhost:3000 --out out/clips
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SIZES = { '4x5': [1080, 1350], '1x1': [1080, 1080], '16x9': [1920, 1080], '9x16': [1080, 1920] };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const baseUrl = arg('url', 'http://localhost:3000');
const outDir = arg('out', path.join('out', 'clips'));
const formatArg = arg('format', 'all');
const day = arg('day', '');
const cut = arg('cut', 'short');
const stills = arg('stills', '') ? arg('stills', '').split(',').map(Number) : null;
const formats = formatArg === 'all' ? Object.keys(SIZES) : [formatArg];
for (const f of formats) {
  if (!SIZES[f]) throw new Error(`Unknown format "${f}". Use 9x16, 1x1, 16x9 or all.`);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // A global install is reachable through NODE_PATH from CommonJS only.
  try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* below */ }
}
if (!chromium) {
  console.error('Playwright is missing. Run: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

// Use the GPU where there is one (macOS: Metal through ANGLE).
const gpuArgs = process.platform === 'darwin'
  ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: gpuArgs });

try {
  for (const format of formats) {
    const [width, height] = SIZES[format];
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.warn(`  page error: ${e.message}`));

    await page.goto(`${baseUrl}/?format=${format}&record=1${cut === 'long' ? '&cut=long' : ''}${day ? `&day=${encodeURIComponent(day)}` : ''}`);
    await page.waitForFunction(() => window.__clip?.isReady(), null, { timeout: 300000 });
    // Hide the Next.js dev badge if this is a dev server.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

    const { frames, fps } = await page.evaluate(() => ({ frames: window.__clip.frames, fps: window.__clip.fps }));
    const cdp = await page.context().newCDPSession(page);
    if (stills) {
      // One forward pass (each seek then only adds a frame), shooting the asked ones.
      const want = new Set(stills);
      for (let f = 0; f <= Math.max(...stills); f++) {
        await page.evaluate(n => window.__clip.seek(n), f);
        if (!want.has(f)) continue;
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(outDir, `still-${cut === 'long' ? 'long-' : ''}${format}-${String(f).padStart(4, '0')}.png`);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        console.log(`  ${file}`);
      }
      await page.close();
      continue;
    }
    const outFile = path.join(outDir, `one-day-of-citi-bike${day ? `-${day}` : ''}${cut === 'long' ? '-long' : ''}-${format}.mp4`);
    console.log(`🎬 ${format}: ${frames} frames at ${fps} fps -> ${outFile}`);

    const ffmpeg = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', cut === 'long' ? '20' : '18', '-preset', 'slow', '-r', String(fps),
      '-movflags', '+faststart', outFile,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => {
      ffmpeg.on('error', err => reject(new Error(`ffmpeg failed to start (${err.message}). Is it installed?`)));
      ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
    });

    // CDP screenshots skip Playwright's font/animation waits, which can stall
    // on a busy WebGL page; seek() has already waited for the frame.
    const started = Date.now();
    for (let f = 0; f < frames; f++) {
      await page.evaluate(n => window.__clip.seek(n), f);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      if (!ffmpeg.stdin.write(Buffer.from(data, 'base64'))) {
        await new Promise(r => ffmpeg.stdin.once('drain', r));
      }
      if (f % 30 === 29) process.stdout.write(`  ${f + 1}/${frames}\n`);
    }
    ffmpeg.stdin.end();
    await done;
    console.log(`  ✅ done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    await page.close();
  }
} finally {
  await browser.close();
}
