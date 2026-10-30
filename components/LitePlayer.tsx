"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadDayStats, resolveDay } from '@/lib/dayData';
import type { DayStats } from '@/lib/story';
import { hourOfDay } from '@/lib/story';
import { loadAllRides, loadSampleRides, type RideSet } from '@/lib/rides';
import { LiteRenderer, type Outline } from '@/lib/renderer';
import { sunTimes } from '@/lib/sun';
import {
  CHART_FROM_H,
  CHART_TO_H,
  CUT_T,
  LITE_FPS,
  LITE_FRAMES,
  LITE_SECONDS,
  activeAtHour,
  cardOpacity,
  chartGhost,
  chartSeries,
  clockLabel,
  counterOpacity,
  dayFracAt,
  dayStartMs,
  dimAt,
  driftAt,
  fadeWindow,
  headBoostAt,
  highlightAt,
  hourAt,
  inkDayAt,
  legendOpacity,
  lightPlan,
  liteClock,
  middayLow,
  risingAt,
  scopeToManhattan,
  storyText,
  type Flows,
} from '@/lib/timeline';
import LiteStatsCard, { sparkX } from './LiteStatsCard';

// One day of Citi Bike in Manhattan: a 24-second story on a canvas, plus the
// day's numbers. No map library, no buildings, no scrubber. The animation runs
// outside React: the frame loop paints the canvas and moves text through refs.

export type RidesMode = 'all' | 'sample';

interface Props {
  day?: string;
  record: boolean;
  rides?: RidesMode;
}

interface Loaded {
  outline: Outline | null;
  stats: DayStats;
  manhattan: boolean;
  rides: RideSet;
  startMs: number;
  flows: Flows | null;
}

interface ClipApi {
  frames: number;
  fps: number;
  isReady: () => boolean;
  seek: (frame: number) => Promise<void>;
}

// Words are white with a dark halo at night and near-black at day.
const INK_NIGHT = { '--ink': '255,255,255', '--halo': '0,0,0,0.8', '--paper': '5,7,10' } as React.CSSProperties;
function setInk(el: HTMLElement | SVGElement | null, day: number) {
  if (!el) return;
  const v = Math.round(255 + (20 - 255) * day);
  el.style.setProperty('--ink', `${v},${v + Math.round(2 * day)},${v + Math.round(6 * day)}`);
  // The halo turns from a dark shadow into a paper glow, so words stay
  // readable over busy streets either way.
  const p = [239, 238, 233].map(c => Math.round(c * day));
  el.style.setProperty('--halo', `${p[0]},${p[1]},${p[2]},${(0.8 + 0.15 * day).toFixed(3)}`);
  const bg = [5, 7, 10].map((c, i) => Math.round(c + ([239, 238, 233][i] - c) * day));
  el.style.setProperty('--paper', bg.join(','));
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

type Layout = 'tall' | 'square' | 'wide';

// ---------------------------------------------------------------------------
// Layout, in pixels for the stage. u = 1% of the short side (10.8 px on every
// 1080-wide export), so type sizes match across 4:5, 1:1, 16:9 and 9:16.
// ---------------------------------------------------------------------------

interface Mark { hour: number; v: number; value: string; time: string; place: 'above' | 'dip' }

interface Geom {
  u: number;
  pad: number;
  // Type sizes for the top band: the title is the largest word on screen.
  title: number;
  subtitle: number;
  count: number;
  counterTop: number;   // y of the counter row
  bandBottom: number;   // y under the counter row (and the legend)
  chart: {
    left: number;
    top: number;
    width: number;
    height: number;
    base: number;     // y of the baseline
    x: (hour: number) => number;
    y: (v: number) => number;
    area: string;
    line: string;
  };
  footerLines: number;
}

function geom(layout: Layout, w: number, h: number, series: Array<[number, number]>, peak: number): Geom {
  const u = Math.min(w, h) / 100;
  const pad = 6 * u;
  const footerLines = layout === 'wide' ? 1 : 2;
  const footerH = 3.2 * u + footerLines * 2.4 * u * 1.3;
  const chartH = Math.max(19 * u, Math.min(28 * u, 0.2 * h));
  const top = h - footerH - chartH - 1.5 * u;
  const width = w - 2 * pad;
  const base = chartH - 4.6 * u;
  const plotTop = 4.2 * u;
  // Headroom above the peak for its label.
  const max = peak / 0.74;
  const x = (hour: number) => ((hour - CHART_FROM_H) / (CHART_TO_H - CHART_FROM_H)) * width;
  const y = (v: number) => base - (v / max) * (base - plotTop);
  const pts = series.map(([hr, v]) => `${x(hr).toFixed(1)} ${y(v).toFixed(1)}`);
  const line = pts.length ? `M${x(CHART_FROM_H).toFixed(1)} ${y(series[0][1]).toFixed(1)} L${pts.join(' L')}` : '';
  const area = line ? `${line} L${x(CHART_TO_H).toFixed(1)} ${base} L${x(CHART_FROM_H).toFixed(1)} ${base} Z` : '';
  const title = 7.4 * u;
  const subtitle = 4 * u;
  const count = 5.6 * u;
  const counterTop = pad * 0.8 + title * 1.05 + subtitle * 1.25 + 2.6 * u;
  return {
    u,
    pad,
    title,
    subtitle,
    count,
    counterTop,
    bandBottom: counterTop + count + 3.2 * u * 1.3 + 0.8 * u,
    chart: { left: pad, top, width, height: chartH, base, x, y, area, line },
    footerLines,
  };
}

export default function LitePlayer({ day, record, rides: ridesParam }: Props) {
  const ridesMode: RidesMode = ridesParam ?? (record ? 'all' : 'sample');
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const driftRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const captionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const nowRef = useRef<SVGLineElement>(null);
  const nowRefSide = useRef<SVGLineElement>(null);
  const topInkRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const bottomScrimRef = useRef<HTMLDivElement>(null);
  const fineInkRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartClipRef = useRef<SVGRectElement>(null);
  const chartGhostRef = useRef<SVGGElement>(null);
  const chartDotRef = useRef<SVGCircleElement>(null);
  const markRefs = useRef<Array<SVGGElement | null>>([]);

  const rendererRef = useRef<LiteRenderer | null>(null);
  const clock = useRef({ t: 0, prevT: -1, prevHour: 0, playing: true, frame: -1 });

  // ---- data -------------------------------------------------------------
  useEffect(() => {
    let dead = false;
    (async () => {
      const sources = await resolveDay(day);
      const { stats, manhattan } = scopeToManhattan(await loadDayStats(sources));
      const startMs = dayStartMs(stats);
      let rides: RideSet | null = null;
      if (ridesMode === 'all' && sources.date) {
        rides = await loadAllRides(sources.date).catch(() => null);
      }
      rides ??= await loadSampleRides(sources.tripsUrl, startMs);
      const [outline, flows] = await Promise.all([
        fetch('/data/manhattan-outline.json')
          .then(r => (r.ok ? r.json() : null))
          .then(j => (j?.rings ?? null) as Outline | null)
          .catch(() => null),
        fetch(`/data/days/${sources.date}/flows.json`).then(r => (r.ok ? (r.json() as Promise<Flows>) : null)).catch(() => null),
      ]);
      if (!dead) setData({ stats, manhattan, rides, startMs, outline, flows });
    })().catch(e => !dead && setError(String(e?.message ?? e)));
    return () => { dead = true; };
  }, [day, ridesMode]);

  // ---- stage size -----------------------------------------------------------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      setSize(s => (s && Math.abs(s.w - w) < 2 && Math.abs(s.h - h) < 2 ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout: Layout = !size ? 'tall' : size.w > size.h * 1.15 ? 'wide' : size.h > size.w * 1.15 ? 'tall' : 'square';

  const story = useMemo(() => {
    if (!data) return null;
    const keys = liteClock(data.stats, data.startMs);
    const sun = sunTimes(data.stats.date);
    const light = lightPlan(keys, sun.sunrise, sun.sunset);
    const hourOf = (ms: number) => hourOfDay(ms, data.startMs);
    const s = data.stats;
    const mid = middayLow(s, data.startMs);
    const marks: Mark[] = [];
    if (s.nightLow) marks.push({ hour: hourOf(s.nightLow.epochMs), v: s.nightLow.active, value: fmt(s.nightLow.active), time: clockLabel(hourOf(s.nightLow.epochMs)), place: 'above' });
    if (s.morningPeak) marks.push({ hour: hourOf(s.morningPeak.epochMs), v: s.morningPeak.active, value: fmt(s.morningPeak.active), time: clockLabel(hourOf(s.morningPeak.epochMs)), place: 'above' });
    if (mid) marks.push({ hour: mid.hour, v: mid.active, value: fmt(mid.active), time: clockLabel(mid.hour), place: 'dip' });
    marks.push({ hour: hourOf(s.peakEpochMs), v: s.peakActive, value: fmt(s.peakActive), time: clockLabel(hourOf(s.peakEpochMs)), place: 'above' });
    return {
      keys,
      light,
      text: storyText(s, data.flows, sun, light),
      series: chartSeries(s, data.startMs),
      marks,
    };
  }, [data]);

  const g = useMemo(() => {
    if (!story || !size || !data || !story.series.length) return null;
    return geom(layout, size.w, size.h, story.series, data.stats.peakActive);
  }, [story, size, data, layout]);

  // ---- one frame: advance the trails, then paint canvas and words ---------
  const step = useCallback((t: number, paint: boolean) => {
    const r = rendererRef.current;
    if (!r || !story || !data) return;
    const c = clock.current;
    const hour = hourAt(story.keys, t);
    if (c.prevT < 0 || t < c.prevT) {
      // From the top: pre-roll fifteen minutes of story so the first frame
      // already has full trails.
      r.clear();
      const steps = 360, span = 15 / 60;
      const dh = span / steps;
      for (let k = 0; k < steps; k++) {
        const h0 = hour - span + k * dh;
        r.fade(dh);
        r.drawWindow(h0, h0 + dh);
      }
      c.prevHour = hour;
    } else if (hour < c.prevHour) {
      // The cut back to the night.
      c.prevHour = hour;
    }
    // Clear the hook's trails over the first half second after the cut.
    r.fade(Math.max(0, hour - c.prevHour), t >= CUT_T && t < CUT_T + 0.5 ? 0.82 : 1);
    r.drawWindow(c.prevHour, hour);
    c.prevHour = hour;
    c.prevT = t;
    if (!paint) return;

    const dayFrac = dayFracAt(story.light, t);
    r.setHeadBoost(headBoostAt(t, hour));
    r.present(dayFrac, risingAt(story.light, t));
    const hl = highlightAt(t);
    if (data.flows && hl.amount > 0) {
      r.drawHighlight(data.flows.zone, { amount: hl.amount, label: data.flows.zone.name.toUpperCase(), day: inkDayAt(dayFrac, 0.5) });
    }
    const H = size?.h ?? 1;
    setInk(topInkRef.current, inkDayAt(dayFrac, 0.08));
    setInk(scrimRef.current, inkDayAt(dayFrac, 0.1));
    setInk(legendRef.current, inkDayAt(dayFrac, g ? (g.bandBottom + 2 * g.u) / H : 0.3));
    setInk(chartRef.current, inkDayAt(dayFrac, g ? (g.chart.top + g.chart.height / 2) / H : 0.85));
    setInk(bottomScrimRef.current, inkDayAt(dayFrac, 0.88));
    setInk(fineInkRef.current, inkDayAt(dayFrac, 0.97));
    const d = driftAt(t);
    if (driftRef.current) driftRef.current.style.transform = `scale(${d.scale.toFixed(4)}) rotate(${d.rotateDeg.toFixed(3)}deg)`;
    if (dimRef.current) dimRef.current.style.opacity = dimAt(t).toFixed(3);
    if (clockRef.current) clockRef.current.textContent = clockLabel(hour);
    const active = activeAtHour(data.stats, data.startMs, hour);
    if (countRef.current && active !== null) countRef.current.textContent = fmt(active);
    if (counterRef.current) counterRef.current.style.opacity = (active === null ? 0 : counterOpacity(t)).toFixed(3);
    if (legendRef.current) legendRef.current.style.opacity = legendOpacity(t).toFixed(3);
    if (cardRef.current) cardRef.current.style.opacity = cardOpacity(t).toFixed(3);
    for (const cap of story.text.captions) {
      const el = captionRefs.current[cap.id];
      if (el) el.style.opacity = fadeWindow(t, cap.from, cap.to, 0.25).toFixed(3);
    }

    // The chart: the whole day ghosted, drawn solid up to the story clock.
    if (g && chartRef.current) {
      chartRef.current.style.opacity = '1';
      const h = t < CUT_T ? CHART_FROM_H : Math.min(CHART_TO_H, Math.max(CHART_FROM_H, hour));
      const x = g.chart.x(h);
      chartClipRef.current?.setAttribute('width', Math.max(0, x + 2).toFixed(1));
      chartGhostRef.current?.setAttribute('opacity', chartGhost(t).toFixed(3));
      const v = activeAtHour(data.stats, data.startMs, h) ?? 0;
      if (chartDotRef.current) {
        chartDotRef.current.setAttribute('cx', x.toFixed(1));
        chartDotRef.current.setAttribute('cy', g.chart.y(v).toFixed(1));
        chartDotRef.current.style.opacity = t < CUT_T || h >= CHART_TO_H ? '0' : '1';
      }
      story.marks.forEach((m, i) => {
        const el = markRefs.current[i];
        if (el) el.style.opacity = t >= CUT_T && hour >= m.hour ? '1' : '0';
      });
    }

    const sx = sparkX(hour).toFixed(1);
    for (const line of [nowRef.current, nowRefSide.current]) {
      line?.setAttribute('x1', sx);
      line?.setAttribute('x2', sx);
    }
  }, [story, data, g, size]);

  // ---- renderer (rebuilt when the stage or the data changes) --------------
  useEffect(() => {
    if (!data || !size || !canvasRef.current || size.w < 10 || size.h < 10) return;
    const dpr = record ? 1 : Math.min(2, window.devicePixelRatio || 1);
    rendererRef.current = new LiteRenderer(canvasRef.current, data.rides, { width: size.w, height: size.h, dpr }, data.outline);
    clock.current.prevT = -1;
    clock.current.frame = -1;
    return () => { rendererRef.current = null; };
  }, [data, size, record]);

  // ---- live playback ------------------------------------------------------------
  useEffect(() => {
    if (record || !story) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const c = clock.current;
      if (c.playing) {
        c.t = (c.t + dt) % LITE_SECONDS;
        step(c.t, true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [record, story, step]);

  // ---- recorder hooks: deterministic frame stepping ---------------------------
  useEffect(() => {
    if (!record) return;
    const dt = 1 / LITE_FPS;
    const api: ClipApi = {
      frames: LITE_FRAMES,
      fps: LITE_FPS,
      isReady: () => rendererRef.current !== null && story !== null && g !== null,
      seek: async (frame: number) => {
        const c = clock.current;
        const target = ((frame % LITE_FRAMES) + LITE_FRAMES) % LITE_FRAMES;
        if (target !== c.frame + 1) {
          // Replay from the top so the trails are exactly what playback shows.
          c.prevT = -1;
          for (let f = 0; f < target; f++) step(f * dt, false);
        }
        step(target * dt, true);
        c.frame = target;
        await nextFrame();
        await nextFrame();
      },
    };
    (window as unknown as { __clip?: ClipApi }).__clip = api;
    return () => { delete (window as unknown as { __clip?: ClipApi }).__clip; };
  }, [record, story, step, g]);

  const togglePlay = () => {
    clock.current.playing = !clock.current.playing;
    setPaused(!clock.current.playing);
  };
  const restart = () => {
    clock.current.t = 0;
    clock.current.prevT = -1;
    clock.current.playing = true;
    setPaused(false);
  };

  const stats = data?.stats;
  const text = story?.text;
  const fine = text
    ? `${text.footer}${data && !data.manhattan ? ' (all of NYC)' : ''}${data && data.rides.source === 'sample' ? ` · ${fmt(data.rides.count)} rides drawn` : ''}`
    : '';
  const u = g?.u ?? 0;
  const halo = '0 1px 12px rgba(var(--halo)), 0 0 3px rgba(var(--halo))';
  const stage = (
    <div
      ref={stageRef}
      className="relative overflow-hidden bg-[#0b0c0f] text-white"
      style={{
        containerType: 'size',
        ...(record
          ? { position: 'fixed', inset: 0 }
          : { width: '100%', height: '100%' }),
      }}
    >
      <div ref={driftRef} className="absolute inset-0" style={{ transformOrigin: '50% 55%' }}>
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      </div>
      {/* Soft washes behind the words at the top and the chart at the bottom. */}
      <div
        ref={scrimRef}
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{ ...INK_NIGHT, height: g ? g.bandBottom + 8 * u : '35%', background: 'linear-gradient(to bottom, rgba(var(--paper),0.85) 0%, rgba(var(--paper),0.7) 60%, rgba(var(--paper),0) 100%)' }}
      />
      <div
        ref={bottomScrimRef}
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{ ...INK_NIGHT, height: g ? (size?.h ?? 0) - g.chart.top + 4 * u : '30%', background: 'linear-gradient(to top, rgba(var(--paper),0.9) 0%, rgba(var(--paper),0.85) 82%, rgba(var(--paper),0) 100%)' }}
      />
      <div ref={dimRef} className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: 0 }} />

      {g && text && story && (
        <div className="pointer-events-none absolute inset-0">
          {/* Top band: the title, then the live count and the clock. */}
          <div ref={topInkRef} className="absolute" style={{ ...INK_NIGHT, top: g.pad * 0.8, left: g.pad, right: g.pad, color: 'rgb(var(--ink))', textShadow: halo }}>
            <h1 className="font-extrabold" style={{ fontSize: g.title, lineHeight: 1.05, letterSpacing: '-0.025em' }}>{text.title}</h1>
            <div className="font-semibold" style={{ fontSize: g.subtitle, lineHeight: 1.25, color: 'rgba(var(--ink),0.8)' }}>{text.subtitle}</div>
            <div ref={counterRef} className="absolute flex items-start justify-between" style={{ top: g.counterTop - g.pad * 0.8, left: 0, right: 0, opacity: 0 }}>
              <div>
                <div className="font-extrabold tabular-nums" style={{ fontSize: g.count, lineHeight: 1, letterSpacing: '-0.02em' }}>
                  <span ref={countRef} />
                </div>
                <div className="font-medium" style={{ fontSize: 3.2 * u, marginTop: 0.8 * u, color: 'rgba(var(--ink),0.85)' }}>{text.counterLabel}</div>
              </div>
              <div className="text-right">
                <div ref={clockRef} className="font-extrabold tabular-nums" style={{ fontSize: g.count, lineHeight: 1, letterSpacing: '-0.01em' }} />
                <div className="relative" style={{ height: 3.2 * u * 1.3, marginTop: 0.8 * u }}>
                  {text.captions.map(c => (
                    <div key={c.id} ref={el => { captionRefs.current[c.id] = el; }} className="absolute right-0 top-0 whitespace-nowrap font-semibold" style={{ fontSize: 3.2 * u, opacity: 0 }}>
                      {c.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* How to read, small, while the night shows its two dozen bikes. */}
          <div
            ref={legendRef}
            className="absolute flex flex-wrap items-center font-medium"
            style={{ ...INK_NIGHT, top: g.bandBottom + 0.6 * u, left: g.pad, right: g.pad, gap: `${1 * u}px ${2.6 * u}px`, fontSize: 2.8 * u, color: 'rgba(var(--ink),0.88)', textShadow: halo, opacity: 0 }}
          >
            <span className="inline-flex items-center" style={{ gap: 1 * u }}>
              <svg width={7 * u} height={1.6 * u} viewBox="0 0 90 20" aria-hidden="true" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="streak" gradientUnits="userSpaceOnUse" x1="2" x2="80" y1="10" y2="10">
                    <stop offset="0" stopColor="rgb(255,150,48)" stopOpacity="0" />
                    <stop offset="1" stopColor="rgb(255,150,48)" stopOpacity="1" />
                  </linearGradient>
                  <filter id="head-glow" x="-1" y="-1" width="3" height="3">
                    <feGaussianBlur stdDeviation="3" />
                  </filter>
                </defs>
                <path d="M2 10 L76 10" stroke="url(#streak)" strokeWidth="4" strokeLinecap="round" />
                <circle cx="80" cy="10" r="8" fill="rgb(255,238,205)" filter="url(#head-glow)" />
                <circle cx="80" cy="10" r="5.5" fill="rgb(255,238,205)" />
              </svg>
              = {text.legendRide}
            </span>
            <span className="inline-flex items-center" style={{ gap: 1 * u }}>
              <svg width={5 * u} height={1.6 * u} viewBox="0 0 60 20" aria-hidden="true">
                <path d="M2 10 L58 10" stroke="rgba(64,196,255,0.7)" strokeWidth="3" />
              </svg>
              = {text.legendStreet}
            </span>
          </div>

          {/* End card. */}
          <div
            ref={cardRef}
            className="absolute flex flex-col items-center justify-center text-center text-white"
            style={{ top: g.bandBottom, bottom: (size?.h ?? 0) - g.chart.top, left: g.pad, right: g.pad, opacity: 0, textShadow: '0 1px 14px rgba(0,0,0,0.9)' }}
          >
            <div className="font-extrabold tabular-nums" style={{ fontSize: 7 * u, lineHeight: 1, letterSpacing: '-0.02em' }}>{text.card.big}</div>
            <div className="font-semibold" style={{ fontSize: 3.6 * u, marginTop: 2.6 * u, color: 'rgba(255,255,255,0.92)' }}>{text.card.credit}</div>
          </div>

          {/* The chart of bikes moving. */}
          <div ref={chartRef} className="absolute" style={{ ...INK_NIGHT, left: g.chart.left, top: g.chart.top, width: g.chart.width, height: g.chart.height, color: 'rgb(var(--ink))', opacity: 0 }}>
            <svg width={g.chart.width} height={g.chart.height} style={{ overflow: 'visible' }} role="img" aria-label={`${text.chartTitle}, from 3 AM to midnight`}>
              <defs>
                <clipPath id="chart-reveal">
                  <rect ref={chartClipRef} x={-10} y={-g.chart.height} width={0} height={g.chart.height * 3} />
                </clipPath>
              </defs>
              <text x={0} y={2.6 * u} fontSize={2.8 * u} fontWeight={600} fill="rgba(var(--ink),0.8)" style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {layout === 'square' ? text.chartTitleShort : text.chartTitle}
              </text>
              <line x1={0} x2={g.chart.width} y1={g.chart.y(3000)} y2={g.chart.y(3000)} stroke="rgba(var(--ink),0.25)" strokeWidth={1.5} strokeDasharray={`${0.6 * u} ${0.8 * u}`} />
              <text x={g.chart.width} y={g.chart.y(3000) - 0.8 * u} fontSize={2.6 * u} fill="rgba(var(--ink),0.6)" textAnchor="end">3,000</text>
              <line x1={0} x2={g.chart.width} y1={g.chart.base} y2={g.chart.base} stroke="rgba(var(--ink),0.4)" strokeWidth={1.5} />
              {[6, 12, 18].map(hr => (
                <g key={hr}>
                  <line x1={g.chart.x(hr)} x2={g.chart.x(hr)} y1={g.chart.base} y2={g.chart.base + 0.9 * u} stroke="rgba(var(--ink),0.5)" strokeWidth={1.5} />
                  <text x={g.chart.x(hr)} y={g.chart.base + 3.6 * u} fontSize={3.2 * u} fill="rgba(var(--ink),0.72)" textAnchor="middle">
                    {hr === 12 ? 'Noon' : clockLabel(hr).replace(':00', '')}
                  </text>
                </g>
              ))}
              <g ref={chartGhostRef} opacity={0.35}>
                <path d={g.chart.line} fill="none" stroke="rgb(var(--ink))" strokeWidth={Math.max(2, 0.3 * u)} strokeLinejoin="round" />
              </g>
              <g clipPath="url(#chart-reveal)">
                <path d={g.chart.area} fill="rgba(255,122,42,0.3)" />
                <path d={g.chart.line} fill="none" stroke="#FF7A2A" strokeWidth={Math.max(3, 0.5 * u)} strokeLinejoin="round" />
              </g>
              {story.marks.map((m, i) => {
                const x = g.chart.x(m.hour);
                const y = g.chart.y(m.v);
                const anchor = x < g.chart.width * 0.08 ? 'start' : x > g.chart.width * 0.92 ? 'end' : 'middle';
                const dip = m.place === 'dip';
                const ty = dip ? g.chart.base - 1.2 * u : y - 1.6 * u;
                return (
                  <g key={m.hour} ref={el => { markRefs.current[i] = el; }} style={{ opacity: 0 }}>
                    <circle cx={x} cy={y} r={0.75 * u} fill="rgb(var(--ink))" stroke="rgb(var(--paper))" strokeWidth={0.3 * u} />
                    <text x={anchor === 'start' ? x - 0.5 * u : x} y={ty} textAnchor={anchor} fill="rgb(var(--ink))" style={{ paintOrder: 'stroke', stroke: 'rgb(var(--paper))', strokeWidth: 1.5 * u, strokeLinejoin: 'round' }}>
                      <tspan fontSize={(dip ? 3.4 : 4.2) * u} fontWeight={800}>{m.value}</tspan>
                      <tspan fontSize={(dip ? 2.8 : 3.2) * u} fontWeight={600} dx={0.8 * u}>{m.time}</tspan>
                    </text>
                  </g>
                );
              })}
              <circle ref={chartDotRef} r={1 * u} fill="#FF7A2A" stroke="rgb(var(--ink))" strokeWidth={0.3 * u} cx={0} cy={g.chart.base} />
            </svg>
          </div>

          <div ref={fineInkRef} className="absolute text-center font-medium" style={{ ...INK_NIGHT, left: g.pad * 0.6, right: g.pad * 0.6, bottom: 2.4 * u, fontSize: 2.4 * u, lineHeight: 1.3, color: 'rgba(var(--ink),0.78)' }}>
            {fine}
          </div>
        </div>
      )}

      {!data && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-white/80">
          {error ? 'The trip data could not be loaded.' : 'Loading one day of rides…'}
        </div>
      )}
    </div>
  );

  if (record) return stage;

  const button = 'h-9 min-w-[44px] rounded-full bg-[#1d2026] px-3.5 text-[13px] font-semibold text-white hover:bg-[#2a2e36] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';

  return (
    <main className="flex min-h-[100svh] w-full items-center justify-center gap-8 bg-[#050608] text-white lg:p-6">
      {/* Phones: the story fills the screen. Wider screens: a 4:5 column. */}
      <div className="relative flex h-[100svh] w-full flex-col lg:h-[min(92svh,1100px)] lg:w-auto lg:aspect-[4/5.3]">
        <div className="relative min-h-0 flex-1 lg:overflow-hidden lg:rounded-xl">{stage}</div>
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-3.5">
          <button type="button" className={button} onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
            {paused ? 'Play' : 'Pause'}
          </button>
          <button type="button" className={button} onClick={restart} aria-label="Restart the story">Restart</button>
          {stats && (
            <button
              type="button"
              className={`${button} ml-auto lg:hidden`}
              onClick={() => setStatsOpen(o => !o)}
              aria-expanded={statsOpen}
              aria-controls="lite-stats-sheet"
            >
              {statsOpen ? 'Close' : 'The day in numbers'}
            </button>
          )}
          <div className="ml-auto hidden text-xs text-white/60 lg:block">{LITE_SECONDS} s story</div>
        </div>
        {stats && data && statsOpen && (
          <div id="lite-stats-sheet" className="absolute inset-x-3 bottom-16 flex justify-center lg:hidden">
            <LiteStatsCard stats={stats} dayStartMs={data.startMs} nowRef={nowRef} scope={data.manhattan ? 'Manhattan' : undefined} />
          </div>
        )}
      </div>

      {stats && data && (
        <aside className="hidden lg:block">
          <LiteStatsCard stats={stats} dayStartMs={data.startMs} nowRef={nowRefSide} scope={data.manhattan ? 'Manhattan' : undefined} />
        </aside>
      )}
    </main>
  );
}
