/* =========================================================
   Courbes : une courbe RVB commune, puis une par canal.
   Interpolation cubique monotone (Fritsch-Carlson) : la courbe
   passe par chaque point sans jamais dépasser entre deux points.
   Les quatre courbes sont combinées en une table de 1 024 valeurs
   (rouge = R(RVB(x)), etc.), lue par le shader de finition.
   ========================================================= */
import { toHalf } from './decode.js';

export const IDENTITY = [[0, 0], [1, 1]];
export const CHANNELS = [
  { id: 'rgb', label: 'RVB', color: '#ededee' },
  { id: 'r', label: 'Rouge', color: '#e6646e' },
  { id: 'g', label: 'Vert', color: '#5fbf8a' },
  { id: 'b', label: 'Bleu', color: '#6f9be8' },
];
export const SHAPES = [
  { label: 'Linéaire', pts: [[0, 0], [1, 1]] },
  { label: 'Contraste en S', pts: [[0, 0], [0.25, 0.19], [0.75, 0.81], [1, 1]] },
  { label: 'Contraste fort', pts: [[0, 0], [0.25, 0.13], [0.5, 0.5], [0.75, 0.87], [1, 1]] },
  { label: 'Mat', pts: [[0, 0.08], [0.25, 0.27], [0.75, 0.77], [1, 0.95]] },
];

export const isIdentity = (pts) => pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;

export function spline(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
    return Math.min(1, Math.max(0, y));
  };
}

const N = 1024;
let cache = { key: null, value: null };

// { key, active, data } : data en demi-flottants, RGBA × 1 024.
export function curveLut(curves) {
  const key = JSON.stringify(curves);
  if (cache.key === key) return cache.value;
  const active = !CHANNELS.every((c) => isIdentity(curves[c.id]));
  const f = Object.fromEntries(CHANNELS.map((c) => [c.id, spline(curves[c.id])]));
  const out = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const m = f.rgb(i / (N - 1));
    out[i * 4] = f.r(m);
    out[i * 4 + 1] = f.g(m);
    out[i * 4 + 2] = f.b(m);
    out[i * 4 + 3] = 1;
  }
  cache = { key, value: { key, active, data: toHalf(out) } };
  return cache.value;
}

/* ---------- Éditeur ----------
   Cliquer sur la courbe ajoute un point, le glisser le déplace,
   le sortir du cadre ou double-cliquer dessus le retire.
   Au clavier : flèches pour déplacer (Maj : plus vite), Suppr pour retirer. */

export function curveEditor({ points, color, bins, onLive, onCommit, readout }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'curve';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Courbe. Clic pour ajouter un point, glisser pour le déplacer, double-clic ou glisser hors du cadre pour le retirer. Flèches pour déplacer le point choisi, Suppr pour le retirer.');
  let sel = -1, hover = -1, removing = false;
  const PAD = 8;

  const geo = () => {
    const r = canvas.getBoundingClientRect();
    return { r, size: r.width - PAD * 2 };
  };
  const toCurve = (e) => {
    const { r, size } = geo();
    return [(e.clientX - r.left - PAD) / size, 1 - (e.clientY - r.top - PAD) / size];
  };
  const hit = (e) => {
    const { size } = geo();
    const [x, y] = toCurve(e);
    let best = -1, bd = 12 / size;
    points.forEach((p, i) => { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < bd) { bd = dd; best = i; } });
    return best;
  };
  const say = () => {
    const i = sel >= 0 ? sel : hover;
    readout.textContent = i >= 0 && points[i]
      ? `Entrée ${Math.round(points[i][0] * 255)}   Sortie ${Math.round(points[i][1] * 255)}`
      : 'Clic sur la courbe : nouveau point';
  };

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const css = canvas.clientWidth || 280;
    const W = Math.round(css * dpr);
    if (canvas.width !== W) { canvas.width = W; canvas.height = W; }
    const g = canvas.getContext('2d');
    const p = PAD * dpr, s = W - p * 2;
    const X = (x) => p + x * s, Y = (y) => p + (1 - y) * s;
    g.clearRect(0, 0, W, W);

    const b = bins();
    if (b) {
      let max = 1;
      for (let i = 2; i < 254; i++) max = Math.max(max, b[i]);
      g.fillStyle = 'rgb(237 237 238 / .07)';
      g.beginPath();
      g.moveTo(X(0), Y(0));
      for (let i = 0; i < 256; i++) g.lineTo(X(i / 255), Y(Math.min(1, Math.sqrt(b[i] / max)) * 0.9));
      g.lineTo(X(1), Y(0));
      g.fill();
    }
    g.strokeStyle = '#26262b';
    g.lineWidth = dpr;
    g.beginPath();
    for (let k = 1; k < 4; k++) { g.moveTo(X(k / 4), Y(0)); g.lineTo(X(k / 4), Y(1)); g.moveTo(X(0), Y(k / 4)); g.lineTo(X(1), Y(k / 4)); }
    g.stroke();
    g.strokeStyle = '#34343a';
    g.strokeRect(X(0), Y(1), s, s);
    g.setLineDash([4 * dpr, 4 * dpr]);
    g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(1), Y(1)); g.stroke();
    g.setLineDash([]);

    const live = removing ? points.filter((_, i) => i !== sel) : points;
    const f = spline(live);
    g.strokeStyle = color;
    g.lineWidth = 2 * dpr;
    g.beginPath();
    for (let i = 0; i <= 256; i++) { const x = i / 256; i ? g.lineTo(X(x), Y(f(x))) : g.moveTo(X(x), Y(f(x))); }
    g.stroke();

    points.forEach((pt, i) => {
      g.globalAlpha = removing && i === sel ? 0.3 : 1;
      g.beginPath();
      g.arc(X(pt[0]), Y(pt[1]), (i === sel || i === hover ? 6 : 5) * dpr, 0, Math.PI * 2);
      g.fillStyle = i === sel ? color : '#111113';
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 2 * dpr;
      g.stroke();
    });
    g.globalAlpha = 1;
    say();
  }

  // Déplace le point i sans qu'il double ses voisins ; les extrémités restent les extrémités.
  function place(i, x, y) {
    const lo = i > 0 ? points[i - 1][0] + 0.01 : 0;
    const hi = i < points.length - 1 ? points[i + 1][0] - 0.01 : 1;
    points[i][0] = Math.min(hi, Math.max(lo, x));
    points[i][1] = Math.min(1, Math.max(0, y));
  }
  const round = () => { for (const pt of points) { pt[0] = +pt[0].toFixed(4); pt[1] = +pt[1].toFixed(4); } };
  const interior = (i) => i > 0 && i < points.length - 1;

  canvas.addEventListener('pointerdown', (e) => {
    let i = hit(e);
    if (i < 0) {
      const [x] = toCurve(e);
      if (x <= 0 || x >= 1) return;
      const y = spline(points)(x);
      i = points.findIndex((p) => p[0] > x);
      points.splice(i, 0, [x, y]);
      onLive();
    }
    sel = i;
    canvas.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const [x, y] = toCurve(ev);
      removing = interior(sel) && (y < -0.12 || y > 1.12 || x < -0.12 || x > 1.12);
      place(sel, x, y);
      onLive();
      draw();
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      if (removing) { points.splice(sel, 1); sel = -1; removing = false; }
      round();
      onLive();
      onCommit();
      draw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up, { once: true });
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const i = hit(e);
    if (i !== hover) { hover = i; canvas.style.cursor = i >= 0 ? 'grab' : 'crosshair'; draw(); }
  });
  canvas.addEventListener('pointerleave', () => { hover = -1; draw(); });
  canvas.addEventListener('dblclick', (e) => {
    const i = hit(e);
    if (interior(i)) { points.splice(i, 1); sel = -1; onLive(); onCommit(); draw(); }
  });
  canvas.addEventListener('keydown', (e) => {
    if (sel < 0) {
      if (e.key.startsWith('Arrow')) { sel = 0; draw(); e.preventDefault(); }
      return;
    }
    const st = e.shiftKey ? 0.05 : 0.01;
    const [x, y] = points[sel];
    if (e.key === 'ArrowLeft') place(sel, x - st, y);
    else if (e.key === 'ArrowRight') place(sel, x + st, y);
    else if (e.key === 'ArrowUp') place(sel, x, y + st);
    else if (e.key === 'ArrowDown') place(sel, x, y - st);
    else if (e.key === 'Tab' && !e.shiftKey && sel < points.length - 1) { sel++; draw(); e.preventDefault(); return; }
    else if (e.key === 'Tab' && e.shiftKey && sel > 0) { sel--; draw(); e.preventDefault(); return; }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && interior(sel)) { points.splice(sel, 1); sel = Math.min(sel, points.length - 1); }
    else return;
    e.preventDefault();
    e.stopPropagation();
    round();
    onLive();
    onCommit();
    draw();
  });
  canvas.addEventListener('blur', () => { sel = -1; draw(); });

  requestAnimationFrame(draw);
  return { el: canvas, draw };
}
