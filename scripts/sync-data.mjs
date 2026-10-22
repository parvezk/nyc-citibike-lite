#!/usr/bin/env node
/**
 * sync-data.mjs — copy the day files this app needs from a checkout of
 * parvezk/nyc-urban-mobility-dev, where the Citi Bike ETL runs (GitHub
 * Actions, scripts/etl). Only what the loop reads is copied: index.json and,
 * for each day, day-stats.json, trips.json and rides/.
 *
 *   node scripts/sync-data.mjs ../nyc-urban-mobility-dev
 */
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] ?? '../nyc-urban-mobility-dev', 'public/data/days');
const dst = path.resolve('public/data/days');
if (!fs.existsSync(path.join(src, 'index.json'))) {
  console.error(`No index.json in ${src}. Pass the path to a nyc-urban-mobility-dev checkout.`);
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(path.join(src, 'index.json'), 'utf8'));
const dates = index.days.map(d => (typeof d === 'string' ? d : d.date));
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
fs.copyFileSync(path.join(src, 'index.json'), path.join(dst, 'index.json'));
for (const date of dates) {
  const from = path.join(src, date);
  const to = path.join(dst, date);
  fs.mkdirSync(to, { recursive: true });
  for (const f of ['day-stats.json', 'trips.json']) {
    if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
  if (fs.existsSync(path.join(from, 'rides'))) fs.cpSync(path.join(from, 'rides'), path.join(to, 'rides'), { recursive: true });
  const stats = JSON.parse(fs.readFileSync(path.join(to, 'day-stats.json'), 'utf8'));
  console.log(`${date}: ${stats.totalTrips.toLocaleString('en-US')} rides${stats.scope ? ` (${stats.scope})` : ''}`);
}
