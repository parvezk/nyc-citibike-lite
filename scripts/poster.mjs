#!/usr/bin/env node
/**
 * poster.mjs — screenshot /poster at 2160x2700, plus a 1200x630 link-preview crop.
 *
 *   node scripts/poster.mjs [--url http://localhost:3000] [--out out/poster]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const baseUrl = arg('url', 'http://localhost:3000');
const outDir = arg('out', path.join('out', 'poster'));
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 2160, height: 2700 }, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/poster`);
  await page.waitForFunction(() => window.__posterMoments && window.__panels >= window.__posterMoments, null, { timeout: 300000 });
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForTimeout(500);
  const poster = path.join(outDir, 'poster-4x5.png');
  await page.screenshot({ path: poster });
  console.log(poster);
  // Link preview: the title and the five panels' upper halves, 1200x630.
  const preview = path.join(outDir, 'link-preview-1200x630.png');
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', poster, '-vf', 'crop=2160:1134:0:60,scale=1200:630', preview], { stdio: 'inherit' });
  console.log(preview);
} finally {
  await browser.close();
}
