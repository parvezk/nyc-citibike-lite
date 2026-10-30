#!/usr/bin/env node
/**
 * poster.mjs — screenshot the text-light stills from /poster?v=...
 *
 *   node scripts/poster.mjs [--url http://localhost:3000] [--out out/poster] [--views poster,x3,x4,x5,preview]
 *
 * Writes poster-v2-4x5.png (2160x2700), x3-maps-1x1.png, x4-maps-1x1.png
 * (1080x1080), x5-chart-16x9.png (1200x675) and link-preview-v2-1200x630.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const baseUrl = arg('url', 'http://localhost:3000');
const outDir = arg('out', path.join('out', 'poster'));
const VIEWS = {
  poster: { size: [2160, 2700], file: 'poster-v2-4x5.png' },
  x3: { size: [1080, 1080], file: 'x3-maps-1x1.png' },
  x4: { size: [1080, 1080], file: 'x4-maps-1x1.png' },
  x5: { size: [1200, 675], file: 'x5-chart-16x9.png' },
  preview: { size: [1200, 630], file: 'link-preview-v2-1200x630.png' },
};
const views = arg('views', Object.keys(VIEWS).join(',')).split(',');
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const v of views) {
    const { size: [width, height], file } = VIEWS[v];
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/poster?v=${v}`);
    await page.waitForFunction(() => window.__panelsNeeded !== undefined && (window.__panels ?? 0) >= window.__panelsNeeded, null, { timeout: 300000 });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.waitForTimeout(500);
    const out = path.join(outDir, file);
    await page.screenshot({ path: out });
    console.log(out);
    await page.close();
  }
} finally {
  await browser.close();
}
