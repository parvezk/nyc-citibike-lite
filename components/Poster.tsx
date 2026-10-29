"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadDayStats, resolveDay } from '@/lib/dayData';
import { hourOfDay, type DayStats } from '@/lib/story';
import { loadAllRides, type RideSet } from '@/lib/rides';
import { LiteRenderer, type Outline } from '@/lib/renderer';
import { sunTimes } from '@/lib/sun';
import { CHART_FROM_H, CHART_TO_H, COPY, activeAtHour, chartSeries, clockLabel, dayStartMs, middayLow, scopeToManhattan, storyText } from '@/lib/timeline';

// The poster: five moments of the day as small multiples, the day's rhythm
// as an annotated chart, and the source. Rendered at 2160x2700 (4:5) by
// scripts/poster.mjs, with the same trail settings as the video.

const W = 2160;
const H = 2700;
// The canvas font for map labels comes from the page; nothing to set here.
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

interface Loaded { stats: DayStats; rides: RideSet; outline: Outline | null; startMs: number }

function Panel({ data, hour, night }: { data: Loaded; hour: number; night: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const r = new LiteRenderer(ref.current, data.rides, { width: 384, height: 860, dpr: 1 }, data.outline);
    // Fifteen minutes of story up to the moment, as the video draws it.
    const steps = 360, span = 15 / 60, dh = span / steps;
    r.clear();
    for (let k = 0; k < steps; k++) {
      const h0 = hour - span + k * dh;
      r.fade(dh);
      r.drawWindow(h0, h0 + dh);
    }
    r.present(night ? 0 : 1, true);
    (window as unknown as { __panels?: number }).__panels = ((window as unknown as { __panels?: number }).__panels ?? 0) + 1;
  }, [data, hour, night]);
  return <canvas ref={ref} style={{ width: 384, height: 860, display: 'block', borderRadius: 18 }} />;
}

export default function Poster() {
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
    const mm = (h: number) => (Math.floor(h * 60 + 1e-6) + 0.5) / 60;
    const moments = [
      { hour: mm(s.nightLow ? hourOf(s.nightLow.epochMs) : 3.25), label: 'Night low' },
      { hour: mm(s.morningPeak ? hourOf(s.morningPeak.epochMs) : 8.8), label: 'Morning rush' },
      { hour: mm(mid ? mid.hour : 11.2), label: 'Midday lull' },
      { hour: mm(hourOf(s.peakEpochMs)), label: 'Evening peak' },
      { hour: 23.0 + 0.5 / 60, label: 'Late night' },
    ].map(m => ({ ...m, night: m.hour < sun.sunrise || m.hour > sun.sunset, active: activeAtHour(s, data.startMs, m.hour) ?? 0 }));
    return { moments, text: storyText(s), series: chartSeries(s, data.startMs), mid, hourOf };
  }, [data]);

  // Chart geometry.
  const cx0 = 140, cw = W - 280, cy0 = 1940, ch = 440;
  const max = data ? data.stats.peakActive / 0.8 : 1;
  const x = (h: number) => cx0 + ((h - CHART_FROM_H) / (CHART_TO_H - CHART_FROM_H)) * cw;
  const y = (v: number) => cy0 + ch - (v / max) * ch;
  const line = view ? `M${view.series.map(([h, v]) => `${x(h).toFixed(1)} ${y(v).toFixed(1)}`).join(' L')}` : '';

  useEffect(() => {
    if (view) (window as unknown as { __posterMoments?: number }).__posterMoments = view.moments.length;
  }, [view]);

  return (
    <div style={{ width: W, height: H, background: '#f4f3ef', color: '#16181c', position: 'relative', overflow: 'hidden', fontFamily: 'var(--font-sans)' }}>
      <div style={{ position: 'absolute', left: 140, top: 120, right: 140 }}>
        <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#555b66' }}>One day of Citi Bike · Manhattan</div>
        <div style={{ fontSize: 112, fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.02em', marginTop: 28 }}>{COPY.posterTitle}</div>
        {view && (
          <div style={{ fontSize: 50, fontWeight: 500, marginTop: 30, color: '#333842', lineHeight: 1.25 }}>
            Every Citi Bike ride that started or ended in Manhattan on {view.text.footer.split(' · ')[1]}: {fmt(data!.stats.totalTrips)} rides. Bikes moving at once, from {fmt(data!.stats.nightLow?.active ?? 0)} at night to {fmt(data!.stats.peakActive)} at the evening peak.
          </div>
        )}
      </div>

      {data && view && (
        <div style={{ position: 'absolute', left: 140, right: 140, top: 640, display: 'flex', justifyContent: 'space-between' }}>
          {view.moments.map(m => (
            <div key={m.hour}>
              <Panel data={data} hour={m.hour} night={m.night} />
              <div style={{ marginTop: 22, fontSize: 34, fontWeight: 600, color: '#555b66' }}>{m.label} · {clockLabel(m.hour)}</div>
              <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1 }}>{fmt(m.active)}</div>
              <div style={{ fontSize: 30, color: '#555b66' }}>bikes moving</div>
            </div>
          ))}
        </div>
      )}

      {data && view && (
        <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
          <text x={cx0} y={cy0 - 70} fontSize={38} fontWeight={600} fill="#555b66" style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>Bikes moving, minute by minute</text>
          <line x1={cx0} x2={cx0 + cw} y1={y(3000)} y2={y(3000)} stroke="#16181c" strokeOpacity={0.2} strokeDasharray="8 10" strokeWidth={2} />
          <text x={cx0 + cw} y={y(3000) - 12} fontSize={30} fill="#6b7280" textAnchor="end">3,000</text>
          <line x1={cx0} x2={cx0 + cw} y1={cy0 + ch} y2={cy0 + ch} stroke="#16181c" strokeOpacity={0.4} strokeWidth={2} />
          {[3, 6, 9, 12, 15, 18, 21, 24].map(h => (
            <text key={h} x={x(h)} y={cy0 + ch + 50} fontSize={32} fill="#555b66" textAnchor={h === 3 ? 'start' : h === 24 ? 'end' : 'middle'}>{h === 12 ? 'Noon' : h === 24 ? 'Midnight' : clockLabel(h).replace(':00', '')}</text>
          ))}
          <path d={`${line} L${x(CHART_TO_H)} ${cy0 + ch} L${x(CHART_FROM_H)} ${cy0 + ch} Z`} fill="rgba(255,122,42,0.25)" />
          <path d={line} fill="none" stroke="#FF5A12" strokeWidth={5} strokeLinejoin="round" />
          {view.moments.map(m => (
            <g key={m.hour}>
              <circle cx={x(m.hour)} cy={y(m.active)} r={10} fill="#16181c" stroke="#f4f3ef" strokeWidth={4} />
              <text x={x(m.hour)} y={y(m.active) - 26} textAnchor={m.hour < 4 ? 'start' : 'middle'} fill="#16181c" style={{ paintOrder: 'stroke', stroke: '#f4f3ef', strokeWidth: 10, strokeLinejoin: 'round' }}>
                <tspan fontSize={48} fontWeight={800}>{fmt(m.active)}</tspan>
                <tspan fontSize={32} fontWeight={600} dx={10}>{clockLabel(m.hour)}</tspan>
              </text>
            </g>
          ))}
        </svg>
      )}

      {view && (
        <div style={{ position: 'absolute', left: 140, right: 140, bottom: 90, fontSize: 30, lineHeight: 1.45, color: '#4b5160' }}>
          <div><b style={{ color: '#16181c' }}>How to read:</b> each orange streak is one bike riding right now (about its last five minutes); grey and cyan lines are the streets the day’s rides used. {data?.stats.morningPeak ? ` The evening peak is ${Math.round((data.stats.peakActive / data.stats.morningPeak.active - 1) * 100)}% above the morning peak.` : ''}</div>
          <div style={{ marginTop: 14 }}>{view.text.footer}</div>
        </div>
      )}
    </div>
  );
}
