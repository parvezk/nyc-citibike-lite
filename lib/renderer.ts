// Canvas 2D renderer for the lite view. No map library: the day's own routes,
// drawn thinly, are the streets, the island's outline frames them, and the
// moving bikes are drawn on top.
//
// The light follows the sun. Night is a TRON-like grid: cyan streets and
// outline, orange light trails added on black. Day is paper: grey streets,
// a soft island, vivid trails painted on. At sunrise and sunset a glowing
// scan line sweeps across the frame and swaps one for the other.
//
// Trails accumulate on one offscreen canvas (each frame fades it a little and
// adds what every bike rode since the last frame). Night shows it as light;
// day recolours it and paints it over the paper.

import { toX, toY, type RideSet } from './rides';

/** A band of the island between two cross streets, to light up. */
export interface Zone {
  bearingDeg: number;   // avenues, degrees east of north
  alongFromM: number;   // metres along the avenues from the rides origin
  alongToM: number;
}

export interface Highlight {
  amount: number;       // 0..1
  label: string;        // "MIDTOWN"
  day: number;          // 0 night ink, 1 day ink
}

export interface StageSize {
  width: number;   // CSS px
  height: number;  // CSS px
  dpr: number;
}

/** Outer rings of the island outline, [lng, lat]. */
export type Outline = Array<Array<[number, number]>>;

type RGB = [number, number, number];

const NIGHT = {
  bg: '#05070a',
  street: [64, 196, 255] as RGB,        // cyan, TRON
  coast: [80, 225, 255] as RGB,
  trail: [255, 150, 48] as RGB,         // orange light
  head: [255, 238, 205] as RGB,        // warm white: the same light, hotter
};

const DAY = {
  bg: '#efeee9',                        // paper, around the island
  land: '#fbfaf7',
  street: [138, 146, 158] as RGB,       // soft grey
  coast: [96, 104, 116] as RGB,
  trail: [255, 84, 18] as RGB,          // vivid orange-red
  head: [150, 24, 6] as RGB,           // deep red: the same ink, darker
};

const SCAN = [94, 234, 255] as RGB;

// Across-the-avenues offset of the Hudson shore at Midtown, metres (negative
// is west of the rides origin).
const WEST_SHORE_ACROSS_M = -4150;

// e-folding time of a trail, in story minutes (a ride's last ~5 minutes show).
const TRAIL_MINUTES = 2;
// The night streets are a basemap, not traffic: dimmer than any trail.
const NIGHT_STREET_DIM = 0.45;

// Midtown, ~13.7 km along the long side of the frame.
const CENTER_LNG = -73.989;
const CENTER_LAT = 40.748;
const SPAN_M = 13714;
const ANCHOR_Y = 0.54;

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a.toFixed(4)})`;

export class LiteRenderer {
  readonly size: StageSize;
  private rides: RideSet;
  private rx: Float32Array;  // screen CSS px
  private ry: Float32Array;
  private t0: Float32Array;
  private t1: Float32Array;
  private inFrame: Uint8Array;
  private project: (lng: number, lat: number) => [number, number];
  private ghostNight: HTMLCanvasElement;
  private ghostDay: HTMLCanvasElement;
  private trailCanvas: HTMLCanvasElement;
  private tint: HTMLCanvasElement;
  private trail: CanvasRenderingContext2D;
  private out: CanvasRenderingContext2D;
  private heads: number[] = [];
  private density: number;
  private scale: number;
  private streakCss: string;
  private streakOp: GlobalCompositeOperation;
  private streakWidth: number;
  private headRadius: number;
  private fromMetres: (x: number, y: number) => [number, number];
  private outline: Outline | null;
  private landscape: boolean;
  private font: string;
  private headBoost = 1;

  constructor(canvas: HTMLCanvasElement, rides: RideSet, size: StageSize, outline: Outline | null) {
    this.size = size;
    this.rides = rides;
    const { width: W, height: H, dpr } = size;
    const landscape = W > H * 1.15;
    // Manhattan's grid runs ~29° east of north: stand it up (or lay it flat
    // for landscape frames).
    const bearing = ((landscape ? -61 : 29) * Math.PI) / 180;
    const cb = Math.cos(bearing);
    const sb = Math.sin(bearing);
    // CSS px per metre. A wide frame zooms out so the island fits between the
    // words at the top and the chart at the bottom; a square frame sits the
    // island a little lower for the same reason.
    const square = Math.abs(W - H) < 0.15 * Math.max(W, H);
    const k = (Math.max(W, H) / SPAN_M) * (landscape ? 0.8 : 1);
    // Square: Midtown (34th-59th St) sits between the caption block and the
    // chart, so both of its edges show when it is outlined.
    const anchorY = square ? 0.67 : landscape ? 0.5 : ANCHOR_Y;
    const x0 = toX(CENTER_LNG), y0 = toY(CENTER_LAT);
    const cx = x0 * cb - y0 * sb, cy = x0 * sb + y0 * cb;
    const fromMetres = (x: number, y: number): [number, number] => [
      W / 2 + (x * cb - y * sb - cx) * k,
      H * anchorY - (x * sb + y * cb - cy) * k,
    ];
    this.project = (lng, lat) => fromMetres(toX(lng), toY(lat));
    this.fromMetres = fromMetres;
    this.outline = outline;
    this.landscape = landscape;
    this.font = getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif';

    // Project once into screen space; the camera never moves (the drift is a
    // CSS transform on the canvas).
    const n = rides.xm.length;
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [px, py] = fromMetres(rides.xm[i], rides.ym[i]);
      this.rx[i] = px;
      this.ry[i] = py;
    }
    this.t0 = new Float32Array(rides.count);
    this.t1 = new Float32Array(rides.count);
    for (let r = 0; r < rides.count; r++) {
      this.t0[r] = rides.ts[rides.offsets[r]];
      this.t1[r] = rides.ts[rides.offsets[r + 1] - 1];
    }
    this.inFrame = new Uint8Array(rides.count);
    for (let r = 0; r < rides.count; r++) this.inFrame[r] = this.visible(r) ? 1 : 0;

    const mk = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      return c;
    };
    this.ghostNight = mk();
    this.ghostDay = mk();
    this.trailCanvas = mk();
    this.tint = mk();
    this.trail = this.trailCanvas.getContext('2d')!;
    this.trail.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    this.out = canvas.getContext('2d', { alpha: false })!;

    // A full day has ~30x the sample's rides. The sample adds light (busy
    // streets glow white-hot); every ride would burn the island to white that
    // way, so it paints over instead and busy streets settle at the colour.
    this.density = Math.min(1, 6000 / Math.max(1, rides.count));
    this.scale = Math.max(W, H) / 768;  // sizes were tuned on a 432x768 frame
    // Trails add light, so a busy street glows brighter than a quiet one
    // and 900 bikes look clearly thinner than 3,000.
    this.streakOp = 'lighter';
    this.streakCss = rgba(NIGHT.trail, this.density < 1 ? 0.2 : 0.6);
    this.streakWidth = (this.density < 1 ? 1.5 : 1.7) * this.scale;
    this.headRadius = (this.density < 1 ? 1.3 : 1.5) * this.scale;

    this.drawGhost(this.ghostNight, 'night', outline);
    this.drawGhost(this.ghostDay, 'day', outline);
  }

  get rideCount(): number {
    return this.rides.count;
  }

  // Skip rides that start and end well outside the frame.
  private visible(r: number): boolean {
    const { width: W, height: H } = this.size;
    const i = this.rides.offsets[r], j = this.rides.offsets[r + 1] - 1;
    const off = (x: number, y: number) => x < -W * 0.1 || x > W * 1.1 || y < -H * 0.1 || y > H * 1.1;
    return !(off(this.rx[i], this.ry[i]) && off(this.rx[j], this.ry[j]));
  }

  private tracePath(g: CanvasRenderingContext2D, ring: Array<[number, number]>) {
    ring.forEach(([lng, lat], i) => {
      const [x, y] = this.project(lng, lat);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath();
  }

  // The static map: background, island, and every street the day's rides
  // used, thinned to ~12k rides (more adds nothing but noise).
  private drawGhost(c: HTMLCanvasElement, mode: 'night' | 'day', outline: Outline | null) {
    const { dpr } = this.size;
    const g = c.getContext('2d')!;
    const night = mode === 'night';
    const theme = night ? NIGHT : DAY;
    g.fillStyle = theme.bg;
    g.fillRect(0, 0, c.width, c.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = this.scale;

    if (outline && !night) {
      g.fillStyle = DAY.land;
      g.beginPath();
      for (const ring of outline) this.tracePath(g, ring);
      g.fill();
    }

    if (night) {
      // A faint TRON grid under everything.
      g.strokeStyle = rgba(NIGHT.street, 0.05);
      g.lineWidth = 0.6 * s;
      const step = 34 * s;
      g.beginPath();
      for (let x = (this.size.width % step) / 2; x < this.size.width; x += step) { g.moveTo(x, 0); g.lineTo(x, this.size.height); }
      for (let y = (this.size.height % step) / 2; y < this.size.height; y += step) { g.moveTo(0, y); g.lineTo(this.size.width, y); }
      g.stroke();
    }

    const stride = this.density < 1 ? Math.max(1, Math.floor(this.rides.count / 12000)) : 1;
    const shown = Math.ceil(this.rides.count / stride);
    const base = night ? (this.density < 1 ? 0.012 : 0.024) * NIGHT_STREET_DIM : (this.density < 1 ? 0.03 : 0.05);
    g.globalCompositeOperation = night ? 'lighter' : 'multiply';
    g.strokeStyle = rgba(theme.street, base * Math.min(1, Math.pow(6000 / shown, 0.6)));
    g.lineWidth = (night ? 0.8 : 0.7) * s;
    const { offsets } = this.rides;
    for (let r = 0; r < this.rides.count; r += stride) {
      if (!this.inFrame[r]) continue;
      const a = offsets[r], b = offsets[r + 1];
      g.beginPath();
      g.moveTo(this.rx[a], this.ry[a]);
      for (let i = a + 1; i < b; i++) g.lineTo(this.rx[i], this.ry[i]);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';

    if (outline) {
      g.beginPath();
      for (const ring of outline) this.tracePath(g, ring);
      if (night) {
        // Neon coastline: a wide soft glow, then a crisp core.
        g.strokeStyle = rgba(NIGHT.coast, 0.35);
        g.lineWidth = 1.2 * s;
        g.shadowColor = rgba(NIGHT.coast, 0.9);
        g.shadowBlur = 10 * s;
        g.stroke();
        g.shadowBlur = 0;
        g.strokeStyle = rgba(NIGHT.coast, 0.75);
        g.lineWidth = 0.7 * s;
        g.stroke();
      } else {
        g.strokeStyle = rgba(DAY.coast, 0.55);
        g.lineWidth = 0.9 * s;
        g.stroke();
      }
    }
  }

  clear() {
    this.trail.save();
    this.trail.setTransform(1, 0, 0, 1, 0, 0);
    this.trail.clearRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
    this.trail.restore();
    this.heads = [];
  }

  // Fade by story time: a trail keeps roughly the last ten minutes of each
  // ride, so what is on screen is the bikes moving now, whether the clock
  // crawls or races, and a held clock holds the picture. `extraKeep` < 1
  // fades faster (used to clear the hook after the cut).
  fade(storyHours: number, extraKeep = 1) {
    const keep = Math.exp(-(Math.max(0, storyHours) * 60) / TRAIL_MINUTES) * extraKeep;
    if (keep >= 0.9999) return;
    const g = this.trail;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0,0,0,${(1 - keep).toFixed(4)})`;
    g.fillRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
    g.restore();
  }

  // Draw what every bike rode between two clock times (hours of the day).
  drawWindow(h0: number, h1: number) {
    this.heads = [];
    if (h1 <= h0) return;
    const s0 = h0 * 3600, s1 = h1 * 3600;
    const { offsets, ts } = this.rides;
    const { rx, ry, t0, t1, inFrame } = this;
    const g = this.trail;
    g.globalCompositeOperation = this.streakOp;
    g.strokeStyle = this.streakCss;
    g.lineWidth = this.streakWidth;
    // Butt caps: consecutive frames' strokes meet without overlapping, so a
    // held clock does not brighten the heads.
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    for (let r = 0; r < this.rides.count; r++) {
      if (!inFrame[r] || t0[r] > s1 || t1[r] < s0) continue;
      const first = offsets[r], last = offsets[r + 1] - 1;
      const a = Math.max(s0, t0[r]), b = Math.min(s1, t1[r]);
      let j = first;
      while (j < last - 1 && ts[j + 1] < a) j++;
      let f = ts[j + 1] > ts[j] ? (a - ts[j]) / (ts[j + 1] - ts[j]) : 0;
      g.beginPath();
      g.moveTo(rx[j] + (rx[j + 1] - rx[j]) * f, ry[j] + (ry[j + 1] - ry[j]) * f);
      while (j < last - 1 && ts[j + 1] < b) {
        j++;
        g.lineTo(rx[j], ry[j]);
      }
      f = ts[j + 1] > ts[j] ? Math.min(1, (b - ts[j]) / (ts[j + 1] - ts[j])) : 1;
      const ex = rx[j] + (rx[j + 1] - rx[j]) * f, ey = ry[j] + (ry[j + 1] - ry[j]) * f;
      g.lineTo(ex, ey);
      g.stroke();
      if (t1[r] > s1) this.heads.push(ex, ey);
    }
    g.globalCompositeOperation = 'source-over';
  }

  /**
   * Night heads bigger and glowing (1 = normal). The story uses it at 3 AM,
   * when two dozen bikes would otherwise be specks.
   */
  setHeadBoost(k: number) {
    this.headBoost = Math.max(1, k);
  }

  private drawHeads(color: RGB, alpha: number, radius: number, glow = 0) {
    const o = this.out;
    o.fillStyle = rgba(color, alpha);
    if (glow > 0) {
      o.shadowColor = rgba(color, 1);
      o.shadowBlur = glow;
    }
    const h = this.heads;
    o.beginPath();
    for (let i = 0; i < h.length; i += 2) {
      o.moveTo(h[i] + radius, h[i + 1]);
      o.arc(h[i], h[i + 1], radius, 0, Math.PI * 2);
    }
    o.fill();
    o.shadowBlur = 0;
  }

  private paintNight() {
    const o = this.out;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.drawImage(this.ghostNight, 0, 0);
    o.globalCompositeOperation = 'lighter';
    o.drawImage(this.trailCanvas, 0, 0);
    o.setTransform(this.size.dpr, 0, 0, this.size.dpr, 0, 0);
    o.globalCompositeOperation = 'source-over';
    const b = this.headBoost;
    this.drawHeads(NIGHT.head, this.density < 1 ? 0.85 + 0.15 * Math.min(1, b - 1) : 0.95, this.headRadius * b, b > 1.01 ? 12 * (b - 1) / 1.5 * (this.scale / 1.4) : 0);
  }

  private paintDay() {
    const o = this.out;
    // Recolour the trails: same shapes and fade, day ink.
    const t = this.tint.getContext('2d')!;
    t.globalCompositeOperation = 'copy';
    t.drawImage(this.trailCanvas, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = rgba(DAY.trail, 1);
    t.fillRect(0, 0, this.tint.width, this.tint.height);
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.drawImage(this.ghostDay, 0, 0);
    o.globalCompositeOperation = 'multiply';
    o.drawImage(this.tint, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.setTransform(this.size.dpr, 0, 0, this.size.dpr, 0, 0);
    this.drawHeads(DAY.head, this.density < 1 ? 0.75 : 0.8, this.headRadius * 0.9);
  }

  // The scan line, with a band of TRON grid trailing on its night side.
  private paintScan(y: number, nightAbove: boolean) {
    const o = this.out;
    const { width: W } = this.size;
    const s = this.scale;
    o.setTransform(this.size.dpr, 0, 0, this.size.dpr, 0, 0);
    const band = 70 * s;
    const dir = nightAbove ? -1 : 1;
    const grad = o.createLinearGradient(0, y, 0, y + dir * band);
    grad.addColorStop(0, rgba(SCAN, 0.28));
    grad.addColorStop(1, rgba(SCAN, 0));
    o.globalCompositeOperation = 'lighter';
    o.strokeStyle = grad;
    o.lineWidth = 0.8 * s;
    const step = 11 * s;
    o.beginPath();
    for (let x = 0; x <= W; x += step) { o.moveTo(x, y); o.lineTo(x, y + dir * band); }
    for (let d = step; d < band; d += step) { o.moveTo(0, y + dir * d); o.lineTo(W, y + dir * d); }
    o.stroke();
    o.globalCompositeOperation = 'source-over';
    o.strokeStyle = rgba(SCAN, 1);
    o.shadowColor = rgba(SCAN, 1);
    o.shadowBlur = 18 * s;
    o.lineWidth = 2.2 * s;
    o.beginPath();
    o.moveTo(0, y);
    o.lineTo(W, y);
    o.stroke();
    o.shadowBlur = 0;
    o.strokeStyle = 'rgba(255,255,255,0.95)';
    o.lineWidth = 0.9 * s;
    o.stroke();
  }

  // Screen point for (along, across) metres in the zone's frame.
  private zonePoint(z: Zone, along: number, across: number): [number, number] {
    const b = (z.bearingDeg * Math.PI) / 180;
    return this.fromMetres(along * Math.sin(b) + across * Math.cos(b), along * Math.cos(b) - across * Math.sin(b));
  }

  // `fresh` false adds the band to the current path (for an even-odd cut-out).
  private bandPath(g: CanvasRenderingContext2D, z: Zone, fresh = true) {
    const far = 30000;
    const pts = [
      this.zonePoint(z, z.alongFromM, -far), this.zonePoint(z, z.alongFromM, far),
      this.zonePoint(z, z.alongToM, far), this.zonePoint(z, z.alongToM, -far),
    ];
    if (fresh) g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  }

  /** Light up a band of the island, with a label beside it. */
  drawHighlight(z: Zone, h: Highlight) {
    if (h.amount <= 0.002 || !this.outline) return;
    const o = this.out;
    const { width: W, height: H, dpr } = this.size;
    const s = this.scale;
    const a = h.amount;
    const ink = (alpha: number) => {
      const v = Math.round(255 + (24 - 255) * h.day);
      return `rgba(${v},${v},${v + Math.round(4 * h.day)},${(alpha * a).toFixed(4)})`;
    };
    o.save();
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Veil the rest of the island a little so the band stands out.
    o.save();
    o.beginPath();
    for (const ring of this.outline) this.tracePath(o, ring);
    o.clip();
    o.beginPath();
    o.rect(-W, -H, 3 * W, 3 * H);
    this.bandPath(o, z, false);
    o.fillStyle = h.day > 0.5 ? `rgba(239,238,233,${(0.55 * a).toFixed(4)})` : `rgba(0,0,0,${(0.5 * a).toFixed(4)})`;
    o.fill('evenodd');
    // The two cross streets.
    o.strokeStyle = ink(0.95);
    o.lineWidth = 1.6 * s;
    o.setLineDash([5 * s, 4 * s]);
    for (const along of [z.alongFromM, z.alongToM]) {
      const [x0, y0] = this.zonePoint(z, along, -6000);
      const [x1, y1] = this.zonePoint(z, along, 3000);
      o.beginPath();
      o.moveTo(x0, y0);
      o.lineTo(x1, y1);
      o.stroke();
    }
    o.restore();
    o.setLineDash([]);

    // The name sits just off the island's west shore (the Hudson is empty);
    // in a wide frame, where the west shore is under the words, on the band.
    const mid = (z.alongFromM + z.alongToM) / 2;
    const [lx, ly] = this.zonePoint(z, mid, this.landscape ? WEST_SHORE_ACROSS_M + 1500 : WEST_SHORE_ACROSS_M - 250);
    const m = Math.min(W, H);
    const size = Math.round(0.037 * m);
    o.font = `700 ${size}px ${this.font}`;
    o.textBaseline = 'middle';
    o.textAlign = this.landscape ? 'center' : 'right';
    const tw = o.measureText(h.label).width;
    const x = this.landscape ? lx : Math.max(0.06 * m + tw, lx);
    o.shadowColor = h.day > 0.5 ? 'rgba(239,238,233,0.95)' : 'rgba(0,0,0,0.9)';
    o.shadowBlur = 10 * s;
    o.fillStyle = ink(1);
    o.fillText(h.label, x, ly);
    o.restore();
  }

  /**
   * dayFrac: share of the frame, from the bottom up, that is in daylight.
   * nightAbove: true while the line moves up (sunrise), so the grid trails
   * into the night above it; false at sunset.
   */
  present(dayFrac = 0, rising = true) {
    const o = this.out;
    const { width: W, height: H, dpr } = this.size;
    if (dayFrac <= 0.0005) {
      this.paintNight();
      return;
    }
    if (dayFrac >= 0.9995) {
      this.paintDay();
      return;
    }
    const y = H * (1 - dayFrac);
    this.paintNight();
    o.save();
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.beginPath();
    o.rect(0, y * dpr, W * dpr, (H - y) * dpr);
    o.clip();
    this.paintDay();
    o.restore();
    this.paintScan(y, rising);
  }
}
