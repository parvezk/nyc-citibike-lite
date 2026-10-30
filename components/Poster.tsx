"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadDayStats, resolveDay } from '@/lib/dayData';
import { hourOfDay, type DayStats } from '@/lib/story';
import { loadAllRides, type RideSet } from '@/lib/rides';
import { LiteRenderer, type Outline } from '@/lib/renderer';
import { sunTimes } from '@/lib/sun';
import { CHART_FROM_H, CHART_TO_H, activeAtHour, chartSeries, clockLabel, dayStartMs, middayLow, scopeToManhattan, storyText } from '@/lib/timeline';

// The stills, text-light: a title, maps labeled with a count and a time, the
// chart, and the source. scripts/poster.mjs screenshots each view:
//
//   /poster             2160x2700  four maps, 2x2 (the cover)
//   /poster?v=x3        1080x1080  3:15 AM and 8:49 AM side by side
//   /poster?v=x4        1080x1080  5:42 PM and 11 PM side by side
//   /poster?v=x5        1200x675   the minute-by-minute chart alone
//   /poster?v=preview   1200x630   link preview: title and the two rush hours
//
// The maps use the same trail settings as the video.

export type StillView = 'poster' | 'x3' | 'x4' | 'x5' | 'preview';
export const STILL_SIZES: Record<StillView, [number, number]> = {
  poster: [2160, 2700],
  x3: [1080, 1080],
  x4: [1080, 1080],
  x5: [1200, 675],
  preview: [1200, 630],
};

const PAPER = '#f4f3ef';
const INK = '#16181c';
const GREY = '#555b66';
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

interface Loaded { stats: DayStats; rides: RideSet; outline: Outline | null; startMs: number }
interface Moment { key: string; hour: number; night: boolean; active: number }

type Win = Window & { __panels?: number; __panelsNeeded?: number };

// One map, drawn once: fifteen minutes of story up to the moment. Keep it
// portrait (height > 1.15 x width) so the island stands up as in the video.
function Panel({ data, m, w, h, radius }: { data: Loaded; m: Moment; w: number; h: number; radius: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const r = new LiteRenderer(ref.current, data.rides, { width: w, height: h, dpr: 1 }, data.outline);
    const steps = 360, span = 15 / 60, dh = span / steps;
    r.clear();
    for (let k = 0; k < steps; k++) {
      const h0 = m.hour - span + k * dh;
      r.fade(dh);
      r.drawWindow(h0, h0 + dh);
    }
    // The night low has two dozen bikes: draw them as the video does at 3 AM.
    r.setHeadBoost(m.hour < 4 ? 2.5 : 1);
    r.present(m.night ? 0 : 1, true);
    const win = window as Win;
    win.__panels = (win.__panels ?? 0) + 1;
  }, [data, m, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h, display: 'block', borderRadius: radius }} />;
}

// A map with only its count (big) and its time (small) under it.
// inline: the time sits to the right of the count, on its baseline.
function MapCard({ data, m, w, h, count, time, gap, radius, inline = false }: { data: Loaded; m: Moment; w: number; h: number; count: number; time: number; gap: number; radius: number; inline?: boolean }) {
  const n = <span style={{ fontSize: count, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>{fmt(m.active)}</span>;
  const at = <span style={{ fontSize: time, fontWeight: 600, color: GREY }}>{clockLabel(m.hour)}</span>;
  return (
    <div style={{ width: w }}>
      <Panel data={data} m={m} w={w} h={h} radius={radius} />
      {inline ? (
        <div style={{ marginTop: gap, display: 'flex', alignItems: 'baseline', gap: time * 0.6 }}>{n}{at}</div>
      ) : (
        <>
          <div style={{ marginTop: gap }}>{n}</div>
          <div style={{ marginTop: time * 0.3 }}>{at}</div>
        </>
      )}
    </div>
  );
}

function viewFromUrl(): StillView {
  const q = new URLSearchParams(window.location.search).get('v');
  return q && q in STILL_SIZES ? (q as StillView) : 'poster';
}

// Rendered on the client only (see PosterLoader), so the URL is at hand.
export default function Poster() {
  const [v] = useState<StillView>(viewFromUrl);
  const [data, setData] = useState<Loaded | null>(null);
  useEffect(() => {
    (async () => {
      const sources = await resolveDay();
      const { stats } = scopeToManhattan(await loadDayStats(sources));
      const rides = await loadAllRides(sources.date);
      const outline = await fetch('/data/manhattan-outline.json').then(r => r.json()).then(j => j.rings as Outline).catch(() => null);
      if (rides) setData({ stats, rides, outline, startMs: dayStartMs(stats) });
    })();
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const s = data.stats;
    const hourOf = (ms: number) => hourOfDay(ms, data.startMs);
    const sun = sunTimes(s.date);
    const mid = middayLow(s, data.startMs);
    // The middle of each key minute, so the count matches the video's hold.
    const mm = (h: number) => (Math.floor(h * 60 + 1e-6) + 0.5) / 60;
    const mk = (key: string, hour: number): Moment => ({ key, hour, night: hour < sun.sunrise || hour > sun.sunset, active: activeAtHour(s, data.startMs, hour) ?? 0 });
    const low = mk('low', mm(s.nightLow ? hourOf(s.nightLow.epochMs) : 3.25));
    const am = mk('am', mm(s.morningPeak ? hourOf(s.morningPeak.epochMs) : 8.8));
    const peak = mk('peak', mm(hourOf(s.peakEpochMs)));
    const late = mk('late', 23 + 0.5 / 60);
    const marks = [low, am, ...(mid ? [mk('mid', mm(mid.hour))] : []), peak];
    return { low, am, peak, late, marks, text: storyText(s), series: chartSeries(s, data.startMs) };
  }, [data]);

  const panels = v === 'poster' ? 4 : v === 'x5' ? 0 : 2;
  useEffect(() => {
    if (view) (window as Win).__panelsNeeded = panels;
  }, [view, panels]);

  const [W, H] = STILL_SIZES[v];
  const page: React.CSSProperties = { width: W, height: H, background: PAPER, color: INK, position: 'relative', overflow: 'hidden', fontFamily: 'var(--font-sans)' };
  if (!data || !view) return <div style={page} />;
  const t = view.text;

  if (v === 'poster') {
    // Maps 720x860 (portrait), 2x2, centered.
    const mw = 720, mh = 860, gx = 120, left = (W - 2 * mw - gx) / 2;
    return (
      <div style={page}>
        <div style={{ position: 'absolute', left, top: 120 }}>
          <div style={{ fontSize: 160, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em' }}>{t.title}</div>
          <div style={{ fontSize: 68, fontWeight: 600, marginTop: 22, color: GREY }}>{t.subtitle}</div>
        </div>
        <div style={{ position: 'absolute', left, top: 430, width: 2 * mw + gx, display: 'grid', gridTemplateColumns: `${mw}px ${mw}px`, columnGap: gx, rowGap: 64 }}>
          {[view.low, view.am, view.peak, view.late].map(m => (
            <MapCard key={m.key} data={data} m={m} w={mw} h={mh} count={96} time={42} gap={24} radius={22} inline />
          ))}
        </div>
        <div style={{ position: 'absolute', left, bottom: 80, fontSize: 26, lineHeight: 1.4, color: GREY, whiteSpace: 'nowrap' }}>{t.footer}</div>
      </div>
    );
  }

  if (v === 'x3' || v === 'x4') {
    const pair = v === 'x3' ? [view.low, view.am] : [view.peak, view.late];
    const mw = 450, mh = 730, gx = 60, left = (W - 2 * mw - gx) / 2;
    return (
      <div style={page}>
        <div style={{ position: 'absolute', left, top: 50, display: 'flex', gap: gx }}>
          {pair.map(m => <MapCard key={m.key} data={data} m={m} w={mw} h={mh} count={84} time={34} gap={20} radius={16} />)}
        </div>
        <div style={{ position: 'absolute', left, right: left, bottom: 34 }}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{t.title} · {t.subtitle}</div>
          <div style={{ fontSize: 17, marginTop: 6, color: GREY, lineHeight: 1.35 }}>{t.footer}</div>
        </div>
      </div>
    );
  }

  if (v === 'preview') {
    const mw = 250, mh = 440;
    return (
      <div style={page}>
        <div style={{ position: 'absolute', left: 64, top: 64, width: 520 }}>
          <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em' }}>One day of<br />Citi Bike</div>
          <div style={{ fontSize: 44, fontWeight: 600, marginTop: 20, color: GREY }}>{t.subtitle}</div>
        </div>
        <div style={{ position: 'absolute', left: 64, width: 540, bottom: 52, fontSize: 16, lineHeight: 1.4, color: GREY }}>{t.footer}</div>
        <div style={{ position: 'absolute', right: 64, top: 40, display: 'flex', gap: 40 }}>
          {[view.am, view.peak].map(m => <MapCard key={m.key} data={data} m={m} w={mw} h={mh} count={54} time={24} gap={12} radius={14} />)}
        </div>
      </div>
    );
  }

  // x5: the chart alone.
  const cx0 = 70, cw = W - 140, cy0 = 150, ch = 400;
  const max = data.stats.peakActive / 0.86;
  const x = (h: number) => cx0 + ((h - CHART_FROM_H) / (CHART_TO_H - CHART_FROM_H)) * cw;
  const y = (n: number) => cy0 + ch - (n / max) * ch;
  const line = `M${view.series.map(([h, n]) => `${x(h).toFixed(1)} ${y(n).toFixed(1)}`).join(' L')}`;
  return (
    <div style={page}>
      <div style={{ position: 'absolute', left: cx0, top: 44, fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em' }}>{t.chartTitleLong}</div>
      <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
        <line x1={cx0} x2={cx0 + cw} y1={y(3000)} y2={y(3000)} stroke={INK} strokeOpacity={0.2} strokeDasharray="5 7" strokeWidth={1.5} />
        <text x={cx0 + cw} y={y(3000) - 8} fontSize={16} fill="#6b7280" textAnchor="end">3,000</text>
        <line x1={cx0} x2={cx0 + cw} y1={cy0 + ch} y2={cy0 + ch} stroke={INK} strokeOpacity={0.4} strokeWidth={1.5} />
        {[3, 6, 9, 12, 15, 18, 21, 24].map(h => (
          <text key={h} x={x(h)} y={cy0 + ch + 30} fontSize={18} fill={GREY} textAnchor={h === 3 ? 'start' : h === 24 ? 'end' : 'middle'}>{h === 12 ? 'Noon' : h === 24 ? 'Midnight' : clockLabel(h).replace(':00', '')}</text>
        ))}
        <path d={`${line} L${x(CHART_TO_H)} ${cy0 + ch} L${x(CHART_FROM_H)} ${cy0 + ch} Z`} fill="rgba(255,122,42,0.25)" />
        <path d={line} fill="none" stroke="#FF5A12" strokeWidth={3} strokeLinejoin="round" />
        {view.marks.map(m => {
          const dip = m.key === 'mid';
          const ty = dip ? cy0 + ch - 14 : y(m.active) - 16;
          return (
            <g key={m.key}>
              <circle cx={x(m.hour)} cy={y(m.active)} r={6} fill={INK} stroke={PAPER} strokeWidth={2.5} />
              <text x={m.key === 'low' ? x(m.hour) - 4 : x(m.hour)} y={ty} textAnchor={m.key === 'low' ? 'start' : 'middle'} fill={INK} style={{ paintOrder: 'stroke', stroke: PAPER, strokeWidth: 6, strokeLinejoin: 'round' }}>
                <tspan fontSize={dip ? 22 : 28} fontWeight={800}>{fmt(m.active)}</tspan>
                <tspan fontSize={dip ? 15 : 18} fontWeight={600} dx={6}>{clockLabel(m.hour)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ position: 'absolute', left: cx0, right: cx0, bottom: 22, fontSize: 15, color: GREY }}>{t.footer}</div>
    </div>
  );
}
