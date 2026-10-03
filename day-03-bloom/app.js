/* =========================================================
   Bloom, jour 03 : une chambre noire dans le navigateur.
   L'état tient dans un objet P (réglages + couches de bloom),
   converti à chaque image en valeurs prêtes pour la carte graphique.
   Tout est non destructif : la source n'est jamais modifiée,
   l'historique garde des copies de P.
   ========================================================= */
import { Engine, fit } from './gpu.js';
import { decodeFile, makeDemo, ACCEPT } from './decode.js';
import { CHANNELS, SHAPES, IDENTITY, isIdentity, curveLut, curveEditor } from './curves.js';
import { Denoiser } from './denoise.js';
import { knob, arcDial } from './dials.js';
import { ADJ, KINDS, MAX_LAYERS, newLayer, packLayers, handles } from './locals.js';
import { parseCube, parseHald, lutHalf, toCube, BUILTIN, loadUserLuts, saveUserLut, deleteUserLut } from './lut.js';

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) el.append(k);
  return el;
};
const icon = (name) => h('i', { className: 'ph ' + name, ariaHidden: 'true' });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- Réglages ---------- */

const DEFAULTS = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temp: 0, tint: 0, vibrance: 0, saturation: 0,
  recovery: 0, bloomGain: 1,
  off: {},
  denoise: { mode: 'off', strength: 0.3, luma: 1, chroma: 1 },
  tonemap: 'standard', vignette: 0, grain: 0, grainSize: 0.3,
  // Quatre tableaux distincts : structuredClone garderait un tableau partagé, partagé.
  lut: { id: null, amount: 1, space: 'display' },
  curves: Object.fromEntries(CHANNELS.map((c) => [c.id, structuredClone(IDENTITY)])),
  layers: [],
  locals: [],
};

const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v * 100));
const CTL = {
  exposure: { label: 'Exposition', min: -4, max: 4, step: 0.01, fmt: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + ' EV' },
  contrast: { label: 'Contraste', min: -1, max: 1, step: 0.01, fmt: signed },
  highlights: { label: 'Hautes lumières', min: -1, max: 1, step: 0.01, fmt: signed },
  shadows: { label: 'Ombres', min: -1, max: 1, step: 0.01, fmt: signed },
  whites: { label: 'Blancs', min: -1, max: 1, step: 0.01, fmt: signed },
  blacks: { label: 'Noirs', min: -1, max: 1, step: 0.01, fmt: signed },
  temp: { label: 'Température', min: -1, max: 1, step: 0.01, fmt: signed, cls: 'temp' },
  tint: { label: 'Teinte', min: -1, max: 1, step: 0.01, fmt: signed, cls: 'tint' },
  vibrance: { label: 'Vibrance', min: -1, max: 1, step: 0.01, fmt: signed },
  saturation: { label: 'Saturation', min: -1, max: 1, step: 0.01, fmt: signed },
  recovery: { label: 'Énergie des hautes lumières', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + ' %' },
  vignette: { label: 'Vignette', min: -1, max: 1, step: 0.01, fmt: signed },
  grain: { label: 'Grain', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
  grainSize: { label: 'Taille du grain', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
};

/* Types de couches. « halo » : chaîne de réductions puis de remontées ;
   « streak » : traînées de Kawase dans une ou plusieurs directions. */
const TYPES = {
  halo: { label: 'Halo', icon: 'ph-sun-dim', kind: 'halo', lv: [3, 9], gain: 1,
    def: { intensity: 0.6, threshold: 1, knee: 0.5, size: 0.6, tint: '#ffffff', blend: 'add' } },
  anamorphique: { label: 'Anamorphique', icon: 'ph-arrows-out-line-horizontal', kind: 'streak', passes: 5, gain: 0.5,
    def: { intensity: 0.6, threshold: 1.5, knee: 0.5, size: 0.7, tint: '#8fb8ff', blend: 'add', angle: 0 } },
  etoile: { label: 'Étoile', icon: 'ph-star-four', kind: 'streak', passes: 4, gain: 0.8,
    def: { intensity: 0.6, threshold: 4, knee: 0.4, size: 0.35, tint: '#ffffff', blend: 'add', angle: 15, branches: 6 } },
  halation: { label: 'Halation', icon: 'ph-film-strip', kind: 'halo', lv: [2, 5], gain: 1,
    def: { intensity: 0.7, threshold: 0.7, knee: 0.3, size: 0.35, tint: '#ff5a2a', blend: 'add' } },
  brume: { label: 'Brume', icon: 'ph-cloud-fog', kind: 'halo', lv: [5, 9], gain: 1,
    def: { intensity: 0.45, threshold: 0, knee: 0.3, size: 0.8, tint: '#ffffff', blend: 'screen' } },
};
const LCTL = {
  intensity: { label: 'Intensité', min: 0, max: 3, step: 0.01, fmt: (v) => v.toFixed(2) },
  threshold: { label: 'Seuil', min: 0, max: 4, step: 0.01, fmt: (v) => v.toFixed(2) },
  knee: { label: 'Douceur du seuil', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
  size: { label: 'Rayon', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
  angle: { label: 'Angle', min: -90, max: 90, step: 1, fmt: (v) => Math.round(v) + '°' },
};

const layer = (type, o = {}) => ({ ...TYPES[type].def, type, on: true, ...o });
const LOOKS = [
  { id: 'none', label: 'Sans bloom', layers: () => [] },
  { id: 'soft', label: 'Halo doux', layers: () => [layer('halo')] },
  { id: 'neon', label: 'Néon', layers: () => [layer('halo', { intensity: 0.9, threshold: 0.9, size: 0.55 }), layer('anamorphique', { intensity: 0.35 })] },
  { id: 'ana', label: 'Anamorphique', layers: () => [layer('anamorphique', { intensity: 1.1, size: 0.85 }), layer('halo', { intensity: 0.3, size: 0.35 })] },
  { id: 'star', label: 'Étoile', layers: () => [layer('etoile'), layer('halo', { intensity: 0.35, size: 0.4 })] },
  { id: 'film', label: 'Pellicule', layers: () => [layer('halation'), layer('brume', { intensity: 0.15 })] },
  { id: 'dream', label: 'Rêve', layers: () => [layer('brume', { intensity: 0.75, size: 0.9 }), layer('halo', { intensity: 0.4, size: 0.7 })] },
  { id: 'all', label: 'Tout à la fois', layers: () => [layer('halation', { intensity: 0.4 }), layer('halo', { intensity: 0.5 }), layer('anamorphique', { intensity: 0.4 }), layer('etoile', { intensity: 0.4 })] },
];

const TABS = [
  { id: 'light', label: 'Lumière', icon: 'ph-sun', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { id: 'color', label: 'Couleur', icon: 'ph-palette', keys: ['temp', 'tint', 'vibrance', 'saturation'] },
  { id: 'curves', label: 'Courbes', icon: 'ph-bezier-curve', keys: ['curves'] },
  { id: 'locals', label: 'Calques', icon: 'ph-stack', keys: ['locals'] },
  { id: 'lut', label: 'LUT', icon: 'ph-swatches', keys: ['lut'] },
  { id: 'detail', label: 'Bruit', ai: true, icon: 'ph-magic-wand', keys: ['denoise'] },
  { id: 'bloom', label: 'Bloom', icon: 'ph-sparkle', keys: ['bloomGain', 'recovery', 'layers'] },
  { id: 'render', label: 'Rendu', icon: 'ph-aperture', keys: ['tonemap', 'vignette', 'grain', 'grainSize'] },
  { id: 'info', label: 'Infos', icon: 'ph-info', keys: [] },
];

let P = structuredClone(DEFAULTS);
let defaults = structuredClone(DEFAULTS);   // valeurs par défaut pour l'image en cours
let src = null;                             // { w, h, name, meta, sdr, baseline }
let tab = 'bloom';
let compare = false, split = 0.5, holdBefore = false;
// Deux interfaces : « lum » (épurée, à la Luminar) et « dark » (chambre noire). Vue « edit » ou « presets ».
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } } };
let theme = store.get('bloom.theme') === 'dark' ? 'dark' : 'lum';
let panelView = 'edit';
let engine = null, denoiser = null;

/* ---------- Conversion vers la carte graphique ---------- */

const hexLin = (hex) => [1, 3, 5].map((i) => {
  const c = parseInt(hex.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

// Couleur d'un corps noir (lieu de Planck, approximation de Kim et al.), en sRGB linéaire.
function kelvin(T) {
  const t = 1e3 / T, t2 = t * t, t3 = t2 * t;
  const x = T <= 4000 ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.17991 : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.24039;
  const x2 = x * x, x3 = x2 * x;
  const y = T <= 2222 ? -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683
    : T <= 4000 ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  const X = x / y, Z = (1 - x - y) / y;
  return [3.2406 * X - 1.5372 - 0.4986 * Z, -0.9689 * X + 1.8758 + 0.0415 * Z, 0.0557 * X - 0.204 + 1.057 * Z];
}
const REF = kelvin(6500);

// Température : on « suppose » une lumière plus froide ou plus chaude et on la compense.
function whiteBalance(temp, tint) {
  const k = kelvin(clamp(6500 * 2 ** temp, 2000, 20000));
  const m = REF.map((r, i) => r / k[i]);
  m[1] *= 2 ** (-tint * 0.45);
  const l = 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  return m.map((v) => v / l);
}

// Un module éteint garde ses réglages mais n'agit plus : on lui substitue ses valeurs par défaut.
function effective(p) {
  const o = p.off || {};
  if (!Object.values(o).some(Boolean)) return p;
  const q = { ...p };
  const d = defaults;
  for (const id of ['light', 'color']) if (o[id]) for (const k of TABS.find((t) => t.id === id).keys) q[k] = d[k];
  if (o.curves) q.curves = d.curves;
  if (o.lut) q.lut = { ...p.lut, id: null };
  if (o.bloom) q.layers = [];
  if (o.locals) q.locals = [];
  if (o.render) { q.tonemap = d.tonemap; q.vignette = 0; q.grain = 0; }
  return q;
}

function resolve(p0 = P) {
  const p = effective(p0);
  const layers = p.layers.filter((l) => l.on && l.intensity > 0).map((l) => {
    const T = TYPES[l.type];
    const color = hexLin(l.tint).map((c) => c * l.intensity * T.gain * (p.bloomGain ?? 1));
    const base = { kind: T.kind, threshold: l.threshold, knee: l.knee, blend: l.blend };
    if (T.kind === 'halo') {
      return { ...base, color, levels: Math.round(T.lv[0] + l.size * (T.lv[1] - T.lv[0])), scatter: 0.55 + 0.4 * l.size };
    }
    const n = l.type === 'etoile' ? l.branches : 2;
    const a0 = (l.angle * Math.PI) / 180;
    return {
      ...base, color: color.map((c) => (c * 2) / n),
      dirs: Array.from({ length: n }, (_, i) => a0 + (i * 2 * Math.PI) / n),
      passes: T.passes, atten: 1 - 10 ** -(1 + l.size * 1.6),
    };
  });
  const baseline = src?.baseline || 0;
  return {
    wb: whiteBalance(p.temp, p.tint), gain: 2 ** (p.exposure + baseline), recovery: p.recovery,
    tonemap: { standard: 0, doux: 1, agx: 2 }[p.tonemap],
    blacks: p.blacks, whites: p.whites, shadows: p.shadows, highlights: p.highlights,
    contrast: p.contrast, saturation: p.saturation, vibrance: p.vibrance, vignette: p.vignette,
    grain: p.grain, grainSize: p.grainSize, layers, curves: curveLut(p.curves), lut: lutFor(p.lut),
    locals: packLayers(p.locals, p0 === P && showMask && tab === 'locals' ? localSel : null, whiteBalance),
    beforeGain: 2 ** baseline, beforeTonemap: src?.sdr ? 0 : 1,
  };
}

/* ---------- Rendu ---------- */

const stage = $('#stage'), frame = $('#frame'), view = $('#view');
let dirty = false, cw = 0, ch = 0;

function requestRender() {
  if (dirty) return;
  dirty = true;
  requestAnimationFrame(() => {
    dirty = false;
    if (!engine || !src) return;
    layout();
    const t0 = performance.now();
    engine.render(resolve(), cw, ch, holdBefore ? 2 : compare ? split : -1);
    engine.device.queue.onSubmittedWorkDone().then(() => {
      $('#perf').textContent = (performance.now() - t0).toFixed(1) + ' ms';
    });
    if (tab === 'detail') renderLoupe();
  });
}

// L'aperçu remplit la scène ; sa définition suit l'écran, sans dépasser la base (4096 px).
function layout() {
  const cs = getComputedStyle(stage);
  const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const s = Math.min(aw / src.w, ah / src.h);
  const css = [Math.max(1, Math.floor(src.w * s)), Math.max(1, Math.floor(src.h * s))];
  const dpr = window.devicePixelRatio || 1;
  const [pw, ph] = fit(src.w, src.h, Math.min(4096, Math.max(css[0], css[1]) * dpr));
  if (view.style.width !== css[0] + 'px' || view.style.height !== css[1] + 'px') {
    view.style.width = css[0] + 'px';
    view.style.height = css[1] + 'px';
  }
  if (view.width !== pw || view.height !== ph) { view.width = pw; view.height = ph; }
  cw = pw; ch = ph;
  $('#split').style.left = split * 100 + '%';
  placeMark();
  syncHandles();
}
new ResizeObserver(requestRender).observe(stage);

/* ---------- Histogramme ---------- */

let lastBins = null, curveView = null, arcView = null;
function drawHisto(bins) {
  lastBins = bins;
  curveView?.draw();
  arcView?.draw();
  drawLumHisto();
}

function drawLumHisto() {
  const c = $('#lum-histo');
  if (!c || !lastBins) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
  if (!W || !H) return;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  let max = 1;
  for (let k = 0; k < 3; k++) for (let i = 2; i < 254; i++) max = Math.max(max, lastBins[k * 256 + i]);
  g.globalCompositeOperation = 'lighter';
  ['rgb(230 90 100 / .55)', 'rgb(90 200 130 / .5)', 'rgb(100 140 240 / .6)'].forEach((col, k) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H);
    for (let i = 0; i < 256; i++) g.lineTo((i / 255) * W, H - Math.min(1, Math.sqrt(lastBins[k * 256 + i] / max)) * H * 0.92);
    g.lineTo(W, H);
    g.fill();
  });
  g.globalCompositeOperation = 'source-over';
}

/* ---------- Historique ---------- */

const hist = { stack: [], i: -1 };
function commit() {
  const s = JSON.stringify(P);
  if (s === hist.stack[hist.i]) return;
  hist.stack.splice(hist.i + 1);
  hist.stack.push(s);
  if (hist.stack.length > 200) hist.stack.shift();
  hist.i = hist.stack.length - 1;
  syncHistory();
  markLooks();
  syncDots();
  scheduleDenoise();
}
function resetHistory() { hist.stack = [JSON.stringify(P)]; hist.i = 0; syncHistory(); }
function go(delta) {
  const i = hist.i + delta;
  if (i < 0 || i >= hist.stack.length) return;
  hist.i = i;
  P = JSON.parse(hist.stack[i]);
  renderTab();
  syncHistory();
  requestRender();
  scheduleDenoise();
}
function syncHistory() {
  $('#undo').disabled = hist.i <= 0;
  $('#redo').disabled = hist.i >= hist.stack.length - 1;
}

/* ---------- Contrôles ---------- */

// Curseur générique : obj[key] ; la piste se remplit depuis la valeur par défaut.
function slider(obj, key, def, spec, onLive) {
  const id = 'c-' + Math.random().toString(36).slice(2, 8);
  const input = h('input', { type: 'range', id, min: spec.min, max: spec.max, step: spec.step, value: obj[key] });
  const out = h('output', { htmlFor: id });
  const wrap = h('div', { className: 'ctl' + (spec.cls ? ' ' + spec.cls : '') },
    h('div', { className: 'ctl-head' }, h('label', { htmlFor: id, textContent: spec.label }), out), input);
  const paint = () => {
    const v = obj[key];
    const p = ((v - spec.min) / (spec.max - spec.min)) * 100;
    const p0 = ((clamp(def, spec.min, spec.max) - spec.min) / (spec.max - spec.min)) * 100;
    input.style.setProperty('--a', Math.min(p, p0) + '%');
    input.style.setProperty('--b', Math.max(p, p0) + '%');
    out.value = spec.fmt(v);
    wrap.classList.toggle('changed', Math.abs(v - def) > 1e-9);
  };
  input.addEventListener('input', () => { obj[key] = +input.value; paint(); onLive?.(); requestRender(); });
  input.addEventListener('change', commit);
  // Double-clic : retour à la valeur par défaut, comme dans Lightroom.
  input.addEventListener('dblclick', () => { obj[key] = def; input.value = def; paint(); onLive?.(); requestRender(); commit(); });
  paint();
  return wrap;
}

function chips(options, current, onPick, label) {
  const row = h('div', { className: 'chips', role: 'group', ariaLabel: label });
  for (const [value, text, ic] of options) {
    const b = h('button', { type: 'button', className: 'chip' }, ic ? icon(ic) : null, text);
    b.setAttribute('aria-pressed', String(value === current));
    b.addEventListener('click', () => {
      for (const x of row.children) x.setAttribute('aria-pressed', String(x === b));
      onPick(value);
    });
    row.append(b);
  }
  return row;
}

const group = (title, i, ...kids) => {
  const g = h('section', { className: 'group' }, title ? h('h3', { textContent: title }) : null, ...kids);
  g.style.setProperty('--i', i);
  return g;
};
const note = (text) => h('p', { className: 'group-note', textContent: text });
const ctl = (key) => slider(P, key, defaults[key], CTL[key]);

/* ---------- Modules ----------
   Une pile de cartes repliables ; une seule ouverte à la fois. Chaque module a
   un bouton marche/arrêt (il garde ses réglages) et un point quand il est modifié. */

const controls = $('#controls');
const modChanged = (T) => T.keys.some((k) => JSON.stringify(P[k]) !== JSON.stringify(defaults[k]));
const syncDots = () => { for (const T of TABS) { const d = $('#dot-' + T.id); if (d) d.hidden = !modChanged(T); } };

function renderTab() {
  curveView = null;
  arcView = null;
  loupeEl = null;
  looksEl = null;
  $('#loupe-mark').hidden = tab !== 'detail';
  frame.classList.toggle('pick', tab === 'detail');
  const scroll = controls.scrollTop;
  if (theme === 'lum') { renderLum(); controls.scrollTop = scroll; return; }
  const list = h('div', { className: 'mods' });
  for (const T of TABS) {
    const open = T.id === tab, off = !!P.off[T.id];
    const mod = h('section', { className: 'mod' + (open ? ' open' : '') + (off ? ' off' : ''), id: 'mod-' + T.id });
    const head = h('button', { type: 'button', className: 'mod-head', id: 'tab-' + T.id },
      h('span', { className: 'mod-title' }, T.label, T.ai ? h('sup', { textContent: 'IA' }) : null),
      h('span', { className: 'mod-dot', id: 'dot-' + T.id, title: 'Modifié', hidden: !modChanged(T) }));
    head.setAttribute('aria-expanded', String(open));
    head.addEventListener('click', () => { tab = open ? null : T.id; renderTab(); if (tab) requestAnimationFrame(() => mod.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); });
    const bar = h('div', { className: 'mod-bar' }, head);
    if (T.keys.length) {
      const pw = h('button', { type: 'button', className: 'power', title: off ? 'Activer le module' : 'Désactiver le module', ariaLabel: `${off ? 'Activer' : 'Désactiver'} le module ${T.label}` }, icon('ph-power'));
      pw.setAttribute('aria-pressed', String(!off));
      pw.addEventListener('click', () => { P.off = { ...P.off, [T.id]: !off }; renderTab(); requestRender(); commit(); });
      bar.append(pw);
    }
    mod.append(bar);
    if (open) {
      const pane = h('div', { className: 'mod-body tabpane' });
      renderBody(T.id, pane);
      if (T.keys.length) {
        const reset = h('button', { type: 'button', className: 'btn ghost' }, icon('ph-arrow-counter-clockwise'), 'Réinitialiser');
        reset.addEventListener('click', () => {
          for (const k of T.keys) P[k] = structuredClone(defaults[k]);
          renderTab();
          requestRender();
          commit();
        });
        pane.append(h('div', { className: 'mod-foot' }, reset));
      }
      mod.append(pane);
    }
    list.append(mod);
  }
  controls.replaceChildren(list);
  controls.scrollTop = scroll;
  syncHandles();
}

/* ---------- Interface épurée ----------
   Comme Luminar : deux vues (Préréglages, Retouche) ; en retouche, les outils sont
   rangés par familles, une ligne par outil, qui se déplie sur place. */

const SECTIONS = [
  ['Essentiels', ['light', 'color', 'detail']],
  ['Créatif', ['bloom', 'lut', 'render']],
  ['Professionnel', ['curves', 'locals']],
  ['Fichier', ['info']],
];
const LUM_LABEL = { locals: 'Réglages locaux', light: 'Lumière', color: 'Couleur', detail: 'Réduction du bruit', bloom: 'Bloom', lut: 'Ambiance (LUT)', render: 'Finition', curves: 'Courbes', info: 'Infos' };
const LUM_ICON = { locals: 'ph-selection-plus', light: 'ph-sun', color: 'ph-drop-half', detail: 'ph-magic-wand', bloom: 'ph-sparkle', lut: 'ph-swatches', render: 'ph-film-strip', curves: 'ph-chart-line', info: 'ph-info' };

function renderLum() {
  for (const [id, v] of [['#mode-edit', 'edit'], ['#mode-presets', 'presets']]) $(id).setAttribute('aria-selected', String(panelView === v));
  const wrap = h('div', { className: 'lum' });
  wrap.append(h('div', { className: 'lum-top' }, h('canvas', { id: 'lum-histo', ariaLabel: 'Histogramme' })));
  if (panelView === 'presets') {
    wrap.append(
      group('Bloom', 0, bloomLooks()),
      group('Ambiance (LUT)', 1, lutGallery()),
    );
    markLooks();
    if (src && lutThumbs.size < allLuts().length + 1) makeLutThumbs();
  } else {
    for (const [title, ids] of SECTIONS) {
      wrap.append(h('h4', { className: 'lum-sec', textContent: title }));
      for (const id of ids) wrap.append(lumTool(TABS.find((t) => t.id === id)));
    }
  }
  controls.replaceChildren(wrap);
  requestAnimationFrame(drawLumHisto);
  syncHandles();
}

function lumTool(T) {
  const open = T.id === tab, off = !!P.off[T.id];
  const row = h('section', { className: 'lt' + (open ? ' open' : '') + (off ? ' off' : '') });
  const head = h('button', { type: 'button', className: 'lt-head', id: 'tab-' + T.id },
    icon(LUM_ICON[T.id]), h('span', { className: 'lt-name' }, LUM_LABEL[T.id], T.ai ? h('sup', { textContent: 'IA' }) : null),
    h('span', { className: 'mod-dot', id: 'dot-' + T.id, title: 'Modifié', hidden: !modChanged(T) }),
    h('i', { className: 'ph ph-caret-down lt-caret', ariaHidden: 'true' }));
  head.setAttribute('aria-expanded', String(open));
  head.addEventListener('click', () => { tab = open ? null : T.id; renderTab(); });
  const bar = h('div', { className: 'lt-bar' }, head);
  if (T.keys.length) {
    const eye = h('button', { type: 'button', className: 'lt-act', title: off ? 'Activer l\'outil' : 'Masquer l\'effet de l\'outil', ariaLabel: `${off ? 'Activer' : 'Désactiver'} ${LUM_LABEL[T.id]}` }, icon(off ? 'ph-eye-slash' : 'ph-eye'));
    eye.setAttribute('aria-pressed', String(!off));
    eye.addEventListener('click', () => { P.off = { ...P.off, [T.id]: !off }; renderTab(); requestRender(); commit(); });
    const reset = h('button', { type: 'button', className: 'lt-act', title: 'Réinitialiser', ariaLabel: `Réinitialiser ${LUM_LABEL[T.id]}` }, icon('ph-arrow-counter-clockwise'));
    reset.addEventListener('click', () => { for (const k of T.keys) P[k] = structuredClone(defaults[k]); renderTab(); requestRender(); commit(); });
    bar.append(reset, eye);
  }
  row.append(bar);
  if (open) {
    const body = h('div', { className: 'lt-body tabpane' });
    renderBody(T.id, body);
    row.append(body);
  }
  return row;
}

function setTheme(t) {
  theme = t;
  store.set('bloom.theme', t);
  document.body.classList.toggle('theme-lum', t === 'lum');
  document.body.classList.toggle('theme-dark', t === 'dark');
  $('#theme-label').textContent = t === 'lum' ? 'Interface chambre noire' : 'Interface épurée';
  renderTab();
  requestRender();
}
for (const [id, v] of [['#mode-edit', 'edit'], ['#mode-presets', 'presets']]) {
  $(id).addEventListener('click', () => { panelView = v; renderTab(); });
}

function renderBody(id, pane) {
  if (id === 'light' && theme === 'lum') {
    pane.append(
      group('Exposition', 0, ctl('exposure'), ctl('contrast')),
      group('Tonalité', 1, ctl('highlights'), ctl('shadows'), ctl('whites'), ctl('blacks')),
    );
  } else if (id === 'light') {
    arcView = arcDial({
      obj: P, key: 'exposure', def: defaults.exposure, spec: CTL.exposure,
      onLive: requestRender, onCommit: commit, bins: () => lastBins,
    });
    pane.append(
      group(null, 0, arcView.el),
      group('Tonalité', 1, ctl('contrast'), ctl('highlights'), ctl('shadows'), ctl('whites'), ctl('blacks')),
    );
  } else if (id === 'color') {
    pane.append(
      group('Balance des blancs', 0, ctl('temp'), ctl('tint'),
        note('Calculée dans la lumière de la scène, avant le bloom : les halos prennent la même teinte que l\'image.')),
      group('Présence', 1, ctl('vibrance'), ctl('saturation')),
    );
  } else if (id === 'curves') {
    renderCurves(pane);
  } else if (id === 'locals') {
    renderLocals(pane);
  } else if (id === 'lut') {
    renderLut(pane);
    if (src && lutThumbs.size < allLuts().length + 1) makeLutThumbs();
  } else if (id === 'detail') {
    renderDetail(pane);
  } else if (id === 'bloom') {
    renderBloom(pane);
  } else if (id === 'render') {
    pane.append(
      group('Rendu des hautes lumières', 0,
        chips([['standard', 'Standard'], ['doux', 'Doux'], ['agx', 'AgX']], P.tonemap, (v) => { P.tonemap = v; requestRender(); commit(); }, 'Rendu des hautes lumières'),
        note('Standard coupe net au blanc, comme un JPEG. Doux arrondit les hautes lumières et laisse le cœur du bloom partir vers le blanc. AgX reproduit la réponse d\'un film, plus douce et moins saturée.')),
      group('Finition', 1, ctl('vignette'), ctl('grain'), ctl('grainSize')),
    );
  } else {
    renderInfo(pane);
  }
}

const hero = (el) => h('div', { className: 'hero' }, el);
// Le réglage principal d'un module : une molette en chambre noire, un simple curseur en interface épurée.
const bigCtl = (obj, key, def, spec) => (theme === 'lum'
  ? slider(obj, key, def, spec)
  : hero(knob({ obj, key, def, spec, onLive: requestRender, onCommit: commit })));

/* ---------- Calques locaux ---------- */

let localSel = 0, showMask = false, picking = false;
const signedFmt = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v * 100));
const layerIcon = (L) => (L.range === 'color' ? 'ph-eyedropper' : L.range === 'luma' ? 'ph-circle-half-tilt' : L.geo === 'radial' ? 'ph-circle-dashed' : L.geo === 'linear' ? 'ph-gradient' : 'ph-square');

function syncHandles() {
  const L = tab === 'locals' && !compare && !holdBefore ? P.locals[localSel] : null;
  handles($('#handles'), L, requestRender, commit);
  frame.classList.toggle('picking', picking);
}

function toggleRow(label, on, onChange) {
  const b = h('button', { type: 'button', className: 'chip' }, label);
  b.setAttribute('aria-pressed', String(on));
  b.addEventListener('click', () => { onChange(!on); });
  return b;
}

function renderLocals(pane) {
  const Ls = P.locals;
  localSel = clamp(localSel, 0, Math.max(0, Ls.length - 1));
  const list = h('div', { className: 'llist' });
  Ls.forEach((L, i) => {
    const pick = h('button', { type: 'button', className: 'lrow-name' }, icon(layerIcon(L)), h('span', { textContent: L.name }));
    pick.setAttribute('aria-pressed', String(i === localSel));
    pick.addEventListener('click', () => { localSel = i; picking = false; renderTab(); requestRender(); });
    const eye = h('button', { type: 'button', className: 'btn icon ghost', title: L.on ? 'Masquer le calque' : 'Afficher le calque', ariaLabel: (L.on ? 'Masquer' : 'Afficher') + ' ' + L.name }, icon(L.on ? 'ph-eye' : 'ph-eye-slash'));
    eye.addEventListener('click', () => { L.on = !L.on; renderTab(); requestRender(); commit(); });
    const del = h('button', { type: 'button', className: 'btn icon ghost', title: 'Supprimer', ariaLabel: 'Supprimer ' + L.name }, icon('ph-trash'));
    del.addEventListener('click', () => { Ls.splice(i, 1); localSel = Math.min(localSel, Ls.length - 1); renderTab(); requestRender(); commit(); });
    list.append(h('div', { className: 'lrow' + (i === localSel ? ' sel' : '') + (L.on ? '' : ' off') }, pick, eye, del));
  });
  if (!Ls.length) list.append(h('p', { className: 'empty' }, icon('ph-selection-plus'), 'Aucun calque. Ajoute-en un : un dégradé pour le ciel, un cercle pour le sujet, une plage de couleur pour les néons…'));
  const add = chips(KINDS.map(([k, t, ic]) => [k, t, ic]), null, (kind) => {
    if (Ls.length >= MAX_LAYERS) { toast(`${MAX_LAYERS} calques au plus`); return; }
    Ls.push(newLayer(kind, Ls.length + 1));
    localSel = Ls.length - 1;
    picking = kind === 'neon';
    if (picking) toast('Clique sur la photo pour choisir la couleur');
    renderTab();
    requestRender();
    commit();
  }, 'Ajouter un calque');
  pane.append(group('Calques', 0, list, h('div', { className: 'ctl' }, h('div', { className: 'ctl-head', textContent: 'Ajouter' }), add)));

  const L = Ls[localSel];
  if (!L) return;
  const re = () => { renderTab(); requestRender(); commit(); };
  const geo = chips([['none', 'Partout'], ['radial', 'Radial', 'ph-circle-dashed'], ['linear', 'Dégradé', 'ph-gradient']], L.geo, (v) => { L.geo = v; re(); }, 'Forme du masque');
  const range = chips([['none', 'Tout'], ['luma', 'Luminance', 'ph-circle-half-tilt'], ['color', 'Couleur', 'ph-eyedropper']], L.range, (v) => { L.range = v; picking = v === 'color'; re(); }, 'Plage du masque');
  const mask = [
    h('div', { className: 'ctl' }, h('div', { className: 'ctl-head', textContent: 'Forme' }), geo),
    h('div', { className: 'ctl' }, h('div', { className: 'ctl-head', textContent: 'Plage' }), range),
  ];
  if (L.geo === 'radial') mask.push(slider(L.radial, 'feather', 0.6, { label: 'Adoucissement', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) }));
  if (L.geo === 'linear') mask.push(slider(L.linear, 'width', 0.18, { label: 'Transition', min: 0.005, max: 0.8, step: 0.005, fmt: (v) => Math.round(v * 100) }));
  if (L.range === 'luma') {
    mask.push(
      slider(L.luma, 'lo', 0, { label: 'À partir de', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) }),
      slider(L.luma, 'hi', 0.35, { label: 'Jusqu\'à', min: 0, max: 1.05, step: 0.01, fmt: (v) => Math.round(v * 100) }),
      slider(L.luma, 'soft', 0.1, { label: 'Douceur', min: 0.01, max: 0.4, step: 0.01, fmt: (v) => Math.round(v * 100) }),
    );
  }
  if (L.range === 'color') {
    const pip = h('button', { type: 'button', className: 'btn' + (picking ? ' amber' : '') }, icon('ph-eyedropper'), picking ? 'Clique sur la photo…' : 'Pipette');
    pip.addEventListener('click', () => { picking = !picking; renderTab(); });
    const hue = slider(L.color, 'hue', 0.92, { label: 'Teinte', min: 0, max: 1, step: 0.002, fmt: (v) => Math.round(v * 360) + '°', cls: 'hue' });
    mask.push(pip, hue,
      slider(L.color, 'width', 0.06, { label: 'Étendue', min: 0.01, max: 0.3, step: 0.005, fmt: (v) => Math.round(v * 360) + '°' }),
      slider(L.color, 'sat', 0.2, { label: 'Saturation minimale', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) }));
  }
  mask.push(
    h('div', { className: 'chips' },
      toggleRow('Inverser', L.invert, (v) => { L.invert = v; re(); }),
      toggleRow('Afficher le masque (M)', showMask, (v) => { showMask = v; renderTab(); requestRender(); })),
    slider(L, 'opacity', 1, { label: 'Opacité', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + ' %' }),
  );
  pane.append(group('Masque', 1, ...mask,
    note(L.geo === 'none' ? 'La forme limite le calque à une zone ; la plage, à certaines luminances ou couleurs. Les deux se multiplient.' : 'Glisse les poignées sur la photo : le centre, les bords, et le point extérieur pour tourner.')));
  pane.append(group('Réglages du calque', 2, ...Object.entries(ADJ).map(([k, spec]) => slider(L.adj, k, 0, { ...spec, fmt: spec.fmt || signedFmt }))));
}

// Pipette : la couleur sous le pointeur, lue à 100 % dans la source développée.
async function pickColor(e) {
  const L = P.locals[localSel];
  if (!L) { picking = false; return; }
  const r = view.getBoundingClientRect();
  const x = clamp(Math.round(((e.clientX - r.left) / r.width) * src.w) - 2, 0, src.w - 4);
  const y = clamp(Math.round(((e.clientY - r.top) / r.height) * src.h) - 2, 0, src.h - 4);
  const img = await engine.region({ ...resolve(), locals: null }, x, y, 4, 4, null);
  let R = 0, G = 0, B = 0;
  for (let i = 0; i < 64; i += 4) { R += img.data[i]; G += img.data[i + 1]; B += img.data[i + 2]; }
  [R, G, B] = [R / 4080, G / 4080, B / 4080];
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  let hue = 0;
  if (d > 1e-5) hue = (mx === R ? (G - B) / d : mx === G ? 2 + (B - R) / d : 4 + (R - G) / d) / 6;
  L.color.hue = +(((hue % 1) + 1) % 1).toFixed(3);
  L.color.sat = +Math.max(0.05, (mx ? d / mx : 0) * 0.5).toFixed(2);
  L.range = 'color';
  picking = false;
  renderTab();
  requestRender();
  commit();
  toast(`Couleur choisie : ${Math.round(L.color.hue * 360)}°`);
}

/* ---------- Courbes ---------- */

let channel = 'rgb';

function renderCurves(pane) {
  const C = CHANNELS.find((c) => c.id === channel);
  const pts = P.curves[channel];
  const readout = h('p', { className: 'curve-readout mono' });
  const live = () => requestRender();
  curveView = curveEditor({
    points: pts, color: C.color, readout, onLive: live,
    onCommit: () => { commit(); sync(); },
    // Histogramme de fond : luminance pour RVB, sinon le canal lui-même (cases 0, 256 et 512).
    bins: () => {
      if (!lastBins) return null;
      const at = channel === 'rgb' ? 768 : (CHANNELS.indexOf(C) - 1) * 256;
      return lastBins.subarray(at, at + 256);
    },
  });

  const tabs = h('div', { className: 'seg curve-tabs', role: 'group', ariaLabel: 'Canal' });
  const dots = [];
  for (const c of CHANNELS) {
    const dot = h('span', { className: 'cdot' });
    dot.style.background = c.color;
    const b = h('button', { type: 'button' }, dot, c.label);
    b.setAttribute('aria-pressed', String(c.id === channel));
    b.addEventListener('click', () => { channel = c.id; renderTab(); });
    dots.push([c.id, b]);
    tabs.append(b);
  }
  const reset = h('button', { type: 'button', className: 'btn ghost' }, icon('ph-arrow-counter-clockwise'), 'Remettre ' + (channel === 'rgb' ? 'la courbe RVB' : 'le ' + C.label.toLowerCase()) + ' à plat');
  reset.addEventListener('click', () => { P.curves[channel] = structuredClone(IDENTITY); renderTab(); requestRender(); commit(); });
  const shapes = chips(SHAPES.map((sh) => [sh.label, sh.label]), null, (label) => {
    P.curves[channel] = structuredClone(SHAPES.find((sh) => sh.label === label).pts);
    renderTab(); requestRender(); commit();
  }, 'Formes de courbe');

  // Après chaque retouche : repère sur les canaux modifiés, bouton de remise à plat, forme reconnue.
  const sync = () => {
    for (const [id, b] of dots) b.classList.toggle('edited', !isIdentity(P.curves[id]));
    reset.disabled = isIdentity(pts);
    const cur = JSON.stringify(pts);
    SHAPES.forEach((sh, i) => shapes.children[i].setAttribute('aria-pressed', String(JSON.stringify(sh.pts) === cur)));
  };
  sync();

  pane.append(group('Canal', 0, tabs, curveView.el, readout, reset));
  pane.append(group('Formes', 1, shapes,
    note('Les courbes agissent sur l\'image affichée, après le rendu des hautes lumières : la courbe RVB d\'abord, puis celle de chaque canal. Clique pour ajouter un point, glisse-le hors du cadre ou double-clique pour le retirer.')));
}

/* ---------- Détail : débruitage par IA ----------
   Deux vitesses : la loupe (une zone à 100 %) est débruitée à la volée,
   pendant que toute l'image se calcule en arrière-plan, tuile par tuile.
   Le résultat remplace la source pour l'aperçu et l'export. */

let loupeEl = null, loupeAt = { x: 0.5, y: 0.5 }, loupeBefore = false;
let loupeBusy = false, loupeAgain = false, loupeSize = [0, 0];
const dnState = { job: null, key: 'off', progress: 0, error: false };

const dnParams = () => ({
  gain: 2 ** (src?.baseline || 0),
  sigma: (P.denoise.strength * 50) / 255,
  luma: P.denoise.luma,
  chroma: P.denoise.chroma,
});

// Force par défaut selon l'ISO : à peine à 100 ISO, franche à 6 400.
const isoStrength = (iso) => +clamp(0.12 + 0.07 * Math.log2(Math.max(iso || 100, 100) / 100), 0.1, 0.7).toFixed(2);

function scheduleDenoise() {
  if (!engine || !src) return;
  const on = P.denoise.mode === 'ai' && !P.off.detail;
  const key = on ? JSON.stringify([P.denoise, src.name, src.w, src.baseline]) : 'off';
  if (key === dnState.key) return;
  dnState.key = key;
  if (dnState.job) dnState.job.cancelled = true;
  dnState.job = null;
  if (!on) { engine.clearDenoise(); syncDenoiseStatus(); requestRender(); return; }
  const job = dnState.job = { cancelled: false };
  dnState.progress = 0;
  dnState.error = false;
  syncDenoiseStatus();
  job.done = (async () => {
    try {
      await denoiser.load();
      const t0 = performance.now();
      const tex = await denoiser.full(dnParams(), (p) => { if (!job.cancelled) { dnState.progress = p; syncDenoiseStatus(); } }, job);
      if (job.cancelled || !tex) return;
      engine.setDenoised(tex);
      dnState.job = null;
      dnState.ms = performance.now() - t0;
      syncDenoiseStatus();
      requestRender();
    } catch (err) {
      console.error(err);
      if (job.cancelled) return;
      dnState.job = null;
      dnState.error = true;
      syncDenoiseStatus();
    }
  })();
}

function syncDenoiseStatus() {
  const running = !!dnState.job;
  const dock = $('#dn-dock');
  dock.hidden = !running;
  $('#dn-line').hidden = !running;
  $('#dn-line').style.setProperty('--p', dnState.progress);
  if (running) $('#dn-dock-text').textContent = 'Débruitage ' + Math.round(dnState.progress * 100) + ' %';
  const el = $('#dn-status');
  if (!el) return;
  const bar = $('#dn-bar');
  el.classList.toggle('err', dnState.error);
  if (dnState.error) el.lastChild.textContent = 'Le calcul a échoué. Réessaie avec une force différente ou recharge la page.';
  else if (P.denoise.mode !== 'ai' || P.off.detail) el.lastChild.textContent = 'Désactivé. La loupe montre l\'original.';
  else if (running) el.lastChild.textContent = `Calcul en pleine résolution… ${Math.round(dnState.progress * 100)} %`;
  else el.lastChild.textContent = `Appliqué à toute l'image${dnState.ms ? ` en ${(dnState.ms / 1000).toFixed(1)} s` : ''}.`;
  bar.hidden = !running;
  bar.style.setProperty('--p', dnState.progress);
}

function renderDetail(pane) {
  const on = P.denoise.mode === 'ai';
  const mode = chips([['off', 'Désactivé'], ['ai', 'IA (FFDNet)', 'ph-magic-wand']], P.denoise.mode, (v) => {
    P.denoise.mode = v;
    renderTab();
    commit();
  }, 'Réduction du bruit');
  const dn = P.denoise, dd = defaults.denoise;
  const sliders = h('div', { className: 'stack' + (on ? '' : ' muted') },
    bigCtl(dn, 'strength', dd.strength, { label: 'Force', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) }),
    slider(dn, 'luma', dd.luma, { label: 'Luminance', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + ' %' }),
    slider(dn, 'chroma', dd.chroma, { label: 'Couleur', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + ' %' }),
  );
  if (!on) for (const i of sliders.querySelectorAll('input')) i.disabled = true;
  if (!on) sliders.inert = true;
  const status = h('p', { className: 'dn-status', id: 'dn-status' }, h('span', { className: 'dn-bar', id: 'dn-bar', hidden: true }), h('span'));
  loupeEl = h('canvas', { className: 'loupe pending', ariaLabel: 'Loupe à 100 %. Glisse pour te déplacer.' });
  const before = h('button', { type: 'button', className: 'btn ghost hold' }, icon('ph-eye'), 'Maintenir pour voir l\'original');
  const hold = (v) => () => { if (loupeBefore !== v) { loupeBefore = v; renderLoupe(); } };
  before.addEventListener('pointerdown', hold(true));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) before.addEventListener(ev, hold(false));
  loupeEl.addEventListener('pointerdown', (e) => {
    loupeEl.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    const move = (ev) => {
      const k = loupeSize[0] / loupeEl.clientWidth;
      loupeAt.x = clamp(loupeAt.x - ((ev.clientX - lx) * k) / src.w, 0, 1);
      loupeAt.y = clamp(loupeAt.y - ((ev.clientY - ly) * k) / src.h, 0, 1);
      lx = ev.clientX; ly = ev.clientY;
      placeMark();
      renderLoupe();
    };
    loupeEl.addEventListener('pointermove', move);
    loupeEl.addEventListener('pointerup', () => loupeEl.removeEventListener('pointermove', move), { once: true });
  });
  pane.append(group('Loupe à 100 %', 0, loupeEl, before,
    note('Clique sur la photo pour choisir l\'endroit, ou glisse dans la loupe. Le bruit se juge à 100 % : l\'aperçu réduit le cache presque toujours.')));
  pane.append(group('Réduction du bruit', 1, mode, sliders, status,
    note('Un réseau de neurones (FFDNet) entraîné à retirer le bruit, qui tourne sur ta carte graphique. Les curseurs s\'appliquent au relâchement : la loupe se met à jour tout de suite, l\'image entière suit en arrière-plan.')));
  syncDenoiseStatus();
  placeMark();
  requestAnimationFrame(renderLoupe);
}

// Zone de la loupe, en pixels de la source (bords pairs pour le réseau).
function loupeRect() {
  const dpr = window.devicePixelRatio || 1;
  const side = Math.min(640, Math.round((loupeEl?.clientWidth || 300) * dpr));
  const w = Math.min(side, src.w) & ~1, hh = Math.min(side, src.h) & ~1;
  const x0 = clamp(Math.round(loupeAt.x * src.w - w / 2), 0, src.w - w) & ~1;
  const y0 = clamp(Math.round(loupeAt.y * src.h - hh / 2), 0, src.h - hh) & ~1;
  return [x0, y0, w, hh];
}

function placeMark() {
  const mark = $('#loupe-mark');
  if (!src || tab !== 'detail') { mark.hidden = true; return; }
  const [x0, y0, w, hh] = loupeRect();
  mark.hidden = false;
  Object.assign(mark.style, { left: (x0 / src.w) * 100 + '%', top: (y0 / src.h) * 100 + '%', width: (w / src.w) * 100 + '%', height: (hh / src.h) * 100 + '%' });
}

async function renderLoupe() {
  if (!loupeEl || !src) return;
  if (loupeBusy) { loupeAgain = true; return; }
  loupeBusy = true;
  try {
    const [x0, y0, w, hh] = loupeRect();
    const live = P.denoise.mode === 'ai' && !P.off.detail && !loupeBefore;
    if (live) await denoiser.load();
    const img = await engine.region(resolve(), x0, y0, w, hh, live ? denoiser : null, dnParams());
    if (loupeEl) {
      if (loupeEl.width !== w || loupeEl.height !== hh) { loupeEl.width = w; loupeEl.height = hh; }
      loupeEl.getContext('2d').putImageData(img, 0, 0);
      loupeEl.classList.remove('pending');
      loupeSize = [w, hh];
    }
  } catch (err) {
    console.error(err);
  } finally {
    loupeBusy = false;
    if (loupeAgain) { loupeAgain = false; renderLoupe(); }
  }
}

/* ---------- LUT ----------
   Galerie : les LUT intégrées, puis celles qu'on importe (gardées dans le navigateur).
   « La LUT attend » dit d'où part la LUT : une image d'affichage (sRGB, Rec.709),
   ou une image Log de caméra, auquel cas elle remplace le rendu des hautes lumières. */

const SPACES = [['display', 'sRGB / Rec.709'], ['slog3', 'S-Log3'], ['logc3', 'LogC3'], ['vlog', 'V-Log']];
const SPACE_MODE = { display: 1, slog3: 2, logc3: 3, vlog: 4 };
let userLuts = [];
const lutThumbs = new Map();
const allLuts = () => [...BUILTIN, ...userLuts];

function lutFor(l) {
  const lut = l.id && allLuts().find((x) => x.id === l.id);
  if (!lut || l.amount <= 0) return null;
  return { key: lut.id, N: lut.N, data: lutHalf(lut), mode: SPACE_MODE[l.space], amount: l.amount };
}

async function importLut(file) {
  try {
    const parsed = /\.cube$/i.test(file.name) ? parseCube(await file.text(), file.name) : await parseHald(file);
    const lut = { ...parsed, id: 'u:' + Date.now().toString(36) };
    userLuts.push(lut);
    saveUserLut(lut);
    P.lut = { ...P.lut, id: lut.id };
    tab = 'lut';
    renderTab();
    requestRender();
    commit();
    makeLutThumbs();
    toast(`LUT « ${lut.name} » ajoutée (${lut.N}³)`);
  } catch (err) {
    console.error(err);
    alertBox(`Impossible de lire ${file.name} : ce n'est ni un .cube ni une HaldCLUT (une image carrée de L³ pixels de côté).`);
  }
}

const lutInput = h('input', { type: 'file', accept: '.cube,image/png', hidden: true });
lutInput.addEventListener('change', () => { if (lutInput.files[0]) importLut(lutInput.files[0]); lutInput.value = ''; });
document.body.append(lutInput);

function lutGallery() {
  const grid = h('div', { className: 'looks' });
  const card = (id, name, user) => {
    const img = h('img', { alt: '' });
    if (id === null) img.src = lutThumbs.get('none') || '';
    else if (lutThumbs.has(id)) img.src = lutThumbs.get(id);
    if (!img.getAttribute('src')) img.removeAttribute('src');
    const b = h('button', { type: 'button', className: 'look' }, h('span', { className: 'thumb' }, img), h('span', { textContent: name }));
    b.dataset.lut = id ?? '';
    b.setAttribute('aria-pressed', String(P.lut.id === id));
    b.addEventListener('click', () => { P.lut = { ...P.lut, id }; renderTab(); requestRender(); commit(); });
    if (!user) return b;
    const del = h('button', { type: 'button', className: 'btn icon ghost look-del', title: 'Retirer cette LUT', ariaLabel: `Retirer la LUT ${name}` }, icon('ph-x'));
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      userLuts = userLuts.filter((l) => l.id !== id);
      deleteUserLut(id);
      if (P.lut.id === id) { P.lut = { ...P.lut, id: null }; requestRender(); commit(); }
      renderTab();
    });
    return h('div', { className: 'look-wrap' }, b, del);
  };
  grid.append(card(null, 'Aucune'));
  for (const l of BUILTIN) grid.append(card(l.id, l.name));
  for (const l of userLuts) grid.append(card(l.id, l.name, true));
  const imp = h('button', { type: 'button', className: 'look look-add' }, h('span', { className: 'thumb' }, icon('ph-plus')), h('span', { textContent: 'Importer…' }));
  imp.addEventListener('click', () => lutInput.click());
  grid.append(imp);
  return grid;
}

function renderLut(pane) {
  const grid = lutGallery();
  pane.append(group('Galerie', 0, grid, note('Importe un fichier .cube (3D ou 1D) ou une HaldCLUT en PNG. Tu peux aussi glisser un .cube sur la photo. Les LUT importées restent dans ce navigateur.')));

  const on = !!P.lut.id;
  const wrap = h('div', { className: 'stack' + (on ? '' : ' muted') },
    bigCtl(P.lut, 'amount', defaults.lut.amount, { label: 'Intensité', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + ' %' }),
    h('div', { className: 'ctl' }, h('div', { className: 'ctl-head', textContent: 'La LUT attend' }),
      chips(SPACES, P.lut.space, (v) => { P.lut.space = v; requestRender(); commit(); }, 'Espace d\'entrée de la LUT')));
  if (!on) { for (const i of wrap.querySelectorAll('input, button')) i.disabled = true; wrap.inert = true; }
  pane.append(group('Réglage', 1, wrap,
    note('La plupart des LUT créatives attendent une image d\'affichage : elles s\'appliquent après tous les réglages. Une LUT de conversion pour caméra (S-Log3, LogC3, V-Log) attend une image Log : elle part alors de la lumière de la scène et remplace le rendu des hautes lumières.')));

  const dl = h('button', { type: 'button', className: 'btn' }, icon('ph-download-simple'), 'Télécharger en .cube');
  dl.addEventListener('click', exportCube);
  pane.append(group('Exporter l\'étalonnage', 2, dl,
    note('Lumière, couleur, courbes, rendu et LUT, cuits dans une LUT 33³ réutilisable dans DaVinci Resolve, Premiere ou Final Cut, pour des images en sRGB ou Rec.709. Le bloom, la vignette, le grain et le débruitage n\'y entrent pas : ils dépendent de la position dans l\'image.')));
}

async function exportCube() {
  if (!src) return;
  const r = { ...resolve(), gain: 2 ** P.exposure, layers: [], vignette: 0, grain: 0, locals: null };
  const data = await engine.bake(r, 33);
  const name = (src.name.replace(/\.[^.]+$/, '') || 'bloom') + '-etalonnage';
  const blob = new Blob([toCube(name, 33, data)], { type: 'text/plain' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name + '.cube' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Étalonnage exporté en LUT 33³');
  requestRender();
}

let lutJob = 0;
async function makeLutThumbs() {
  const job = ++lutJob;
  const s = Math.max(240 / src.w, 160 / src.h);
  const W = Math.round(src.w * s), H = Math.round(src.h * s);
  const c = h('canvas', { width: W, height: H });
  for (const [id, lut] of [['none', null], ...allLuts().map((l) => [l.id, l])]) {
    if (lutThumbs.has(id)) continue;
    const r = resolve({ ...P, lut: { id: lut?.id ?? null, amount: 1, space: 'display' } });
    const data = await engine.snapshot(r, W, H);
    if (job !== lutJob) return;
    c.getContext('2d').putImageData(data, 0, 0);
    const url = c.toDataURL('image/jpeg', 0.85);
    lutThumbs.set(id, url);
    const img = document.querySelector(`.look[data-lut="${id === 'none' ? '' : id}"] img`);
    if (img) img.src = url;
  }
  requestRender();
}

/* ---------- Bloom ---------- */

let looksEl = null;
const collapsed = new WeakSet();
const thumbs = new Map();

function bloomLooks() {
  looksEl = h('div', { className: 'looks' });
  for (const L of LOOKS) {
    const img = h('img', { alt: '' });
    if (thumbs.has(L.id)) img.src = thumbs.get(L.id);
    const b = h('button', { type: 'button', className: 'look' }, h('span', { className: 'thumb' }, img), h('span', { textContent: L.label }));
    b.dataset.look = L.id;
    b.addEventListener('click', () => { P.layers = L.layers(); renderTab(); requestRender(); commit(); });
    looksEl.append(b);
  }
  return looksEl;
}

function renderBloom(pane) {
  pane.append(group(null, 0, bigCtl(P, 'bloomGain', defaults.bloomGain, { label: 'Quantité', min: 0, max: 2, step: 0.01, fmt: (v) => Math.round(v * 100) + ' %' })));
  pane.append(group('Préréglages', 0, bloomLooks()));
  markLooks();

  const list = h('div', { className: 'layers' });
  P.layers.forEach((l, i) => list.append(layerCard(l, i)));
  if (!P.layers.length) list.append(h('p', { className: 'empty' }, icon('ph-sparkle'), 'Aucune couche. Choisis un préréglage ou ajoute une couche ci-dessous.'));
  const add = chips(Object.entries(TYPES).map(([k, T]) => [k, T.label, T.icon]), null, (type) => {
    P.layers.push(layer(type));
    renderTab();
    requestRender();
    commit();
  }, 'Ajouter une couche');
  pane.append(group('Couches', 1, list, h('div', { className: 'ctl' }, h('div', { className: 'ctl-head', textContent: 'Ajouter une couche' }), add)));

  pane.append(group('Source du bloom', 2, ctl('recovery'),
    note('Un JPEG plafonne au blanc : une lampe et un mur blanc y ont la même valeur. Ce réglage redonne de l\'énergie à ce qui frôle le blanc, pour le bloom seulement ; l\'image elle-même ne change pas.')));
}

function layerCard(l, i) {
  const T = TYPES[l.type];
  const d = layer(l.type);
  const card = h('article', { className: 'layer' + (l.on ? '' : ' off') + (collapsed.has(l) ? ' collapsed' : '') });
  const toggle = h('button', { type: 'button', className: 'btn icon ghost', title: l.on ? 'Masquer la couche' : 'Afficher la couche', ariaLabel: l.on ? 'Masquer la couche' : 'Afficher la couche' }, icon(l.on ? 'ph-eye' : 'ph-eye-slash'));
  toggle.addEventListener('click', () => { l.on = !l.on; renderTab(); requestRender(); commit(); });
  const up = h('button', { type: 'button', className: 'btn icon ghost', title: 'Monter', ariaLabel: 'Monter la couche', disabled: i === 0 }, icon('ph-caret-up'));
  up.addEventListener('click', () => { P.layers.splice(i - 1, 0, P.layers.splice(i, 1)[0]); renderTab(); commit(); });
  const del = h('button', { type: 'button', className: 'btn icon ghost', title: 'Supprimer', ariaLabel: 'Supprimer la couche' }, icon('ph-trash'));
  del.addEventListener('click', () => { P.layers.splice(i, 1); renderTab(); requestRender(); commit(); });
  const name = h('button', { type: 'button', className: 'layer-name', title: 'Replier ou déplier' }, icon(T.icon), T.label, icon('ph-caret-down caret'));
  name.setAttribute('aria-expanded', String(!collapsed.has(l)));
  name.addEventListener('click', () => {
    if (collapsed.has(l)) collapsed.delete(l); else collapsed.add(l);
    card.classList.toggle('collapsed', collapsed.has(l));
    name.setAttribute('aria-expanded', String(!collapsed.has(l)));
  });
  card.append(h('header', { className: 'layer-head' }, name, up, toggle, del));

  const body = h('div', { className: 'layer-body' });
  const sizeSpec = { ...LCTL.size, label: T.kind === 'halo' ? 'Rayon' : 'Longueur' };
  body.append(
    slider(l, 'intensity', d.intensity, LCTL.intensity),
    slider(l, 'threshold', d.threshold, LCTL.threshold),
    slider(l, 'knee', d.knee, LCTL.knee),
    slider(l, 'size', d.size, sizeSpec),
  );
  if (T.kind === 'streak') body.append(slider(l, 'angle', d.angle, LCTL.angle));
  if (l.type === 'etoile') {
    body.append(h('div', { className: 'row' }, 'Branches',
      chips([[4, '4'], [6, '6'], [8, '8'], [12, '12']], l.branches, (v) => { l.branches = v; requestRender(); commit(); }, 'Nombre de branches')));
  }
  const color = h('input', { type: 'color', value: l.tint, ariaLabel: 'Teinte de la couche' });
  color.addEventListener('input', () => { l.tint = color.value; requestRender(); });
  color.addEventListener('change', commit);
  body.append(h('label', { className: 'row' }, 'Teinte', color));
  const seg = h('div', { className: 'seg', role: 'group', ariaLabel: 'Mélange' });
  for (const [v, t] of [['add', 'Ajout'], ['screen', 'Écran']]) {
    const b = h('button', { type: 'button', textContent: t });
    b.setAttribute('aria-pressed', String(l.blend === v));
    b.addEventListener('click', () => { l.blend = v; for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b)); requestRender(); commit(); });
    seg.append(b);
  }
  body.append(h('div', { className: 'row' }, 'Mélange', seg));
  card.append(body);
  return card;
}

function markLooks() {
  if (!looksEl) return;
  const cur = JSON.stringify(P.layers);
  for (const b of looksEl.children) {
    const L = LOOKS.find((x) => x.id === b.dataset.look);
    b.setAttribute('aria-pressed', String(JSON.stringify(L.layers()) === cur));
  }
}

// Miniatures : chaque préréglage rendu sur la photo en cours, l'un après l'autre.
let thumbJob = 0;
async function makeThumbs() {
  const job = ++thumbJob;
  thumbs.clear();
  for (const img of document.querySelectorAll('.look img')) img.removeAttribute('src');
  const [W, H] = (() => { const s = Math.max(240 / src.w, 160 / src.h); return [Math.round(src.w * s), Math.round(src.h * s)]; })();
  const c = h('canvas', { width: W, height: H });
  for (const L of LOOKS) {
    const data = await engine.snapshot(resolve({ ...P, layers: L.layers() }), W, H);
    if (job !== thumbJob) return;
    c.getContext('2d').putImageData(data, 0, 0);
    const url = c.toDataURL('image/jpeg', 0.85);
    thumbs.set(L.id, url);
    const img = document.querySelector(`.look[data-look="${L.id}"] img`);
    if (img) img.src = url;
  }
  requestRender();
}

/* ---------- Infos ---------- */

function renderInfo(pane) {
  const m = src?.meta || {};
  const rows = [
    ['Fichier', src?.name],
    ['Format', m.format],
    ['Dimensions', src && `${src.w} × ${src.h} · ${(src.w * src.h / 1e6).toFixed(1)} Mpx`],
    ['Appareil', m.camera],
    ['Objectif', m.lens],
    ['ISO', m.iso],
    ['Vitesse', m.shutter && shutter(m.shutter)],
    ['Ouverture', m.aperture && 'f/' + (+m.aperture).toFixed(1).replace(/\.0$/, '')],
    ['Focale', m.focal && Math.round(m.focal) + ' mm'],
    ['Date', m.date && m.date.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })],
    ['Exposition de base', src && !src.sdr && src.baseline ? '+' + src.baseline.toFixed(2) + ' EV' : null],
  ].filter(([, v]) => v);
  const dl = h('dl', { className: 'facts' });
  for (const [k, v] of rows) dl.append(h('dt', { textContent: k }), h('dd', { textContent: v }));
  pane.append(group('Photo', 0, dl));
  const gpu = h('dl', { className: 'facts' }, h('dt', { textContent: 'Carte graphique' }), h('dd', { textContent: engine?.info || 'WebGPU' }),
    h('dt', { textContent: 'Décodage RAW' }), h('dd', { textContent: crossOriginIsolated ? 'Disponible' : 'Indisponible (page non isolée)' }));
  pane.append(group('Moteur', 1, gpu));
  const keys = [['M', 'Afficher le masque du calque'], ['Clic', 'Placer la loupe (onglet Détail)'], ['Flèches', 'Déplacer un point de courbe'], ['O', 'Ouvrir un fichier'], ['Y', 'Avant / après'], ['H', 'Masquer les réglages'], ['⌘ Z', 'Annuler'], ['⇧ ⌘ Z', 'Rétablir'], ['Double-clic', 'Remettre un curseur à zéro']];
  const sc = h('div', { className: 'shortcuts' });
  for (const [k, t] of keys) sc.append(h('kbd', { textContent: k }), h('span', { textContent: t }));
  pane.append(group('Raccourcis', 2, sc));
}

const shutter = (s) => (s >= 0.5 ? (+s).toFixed(1).replace(/\.0$/, '') + ' s' : '1/' + Math.round(1 / s) + ' s');

function syncMeta() {
  const m = src.meta || {};
  $('#meta').textContent = src.name;
  $('#meta').title = `${src.name} · ${src.w} × ${src.h}`;
  $('#shot').replaceChildren(...[
    m.iso && 'ISO ' + m.iso, m.shutter && shutter(m.shutter),
    m.aperture && 'f/' + (+m.aperture).toFixed(1).replace(/\.0$/, ''), m.focal && Math.round(m.focal) + 'mm',
  ].filter(Boolean).map((t) => h('span', { textContent: t })));
  if (!$('#shot').children.length) $('#shot').append(h('span', { textContent: `${src.w} × ${src.h}` }));
  for (const el of document.querySelectorAll('[data-size]')) {
    const max = +el.dataset.size;
    const [w, hh] = max ? fit(src.w, src.h, max) : [src.w, src.h];
    el.textContent = `${w} × ${hh}`;
  }
}

/* ---------- Ouverture ---------- */

const statusEl = $('#status');
const status = (text) => {
  statusEl.hidden = !text;
  frame.classList.toggle('loading', !!text);
  if (text) $('#status-text').textContent = text;
};
const alertBox = (text) => {
  $('#alert').hidden = !text;
  if (text) { $('#alert-text').textContent = text; $('#hint').hidden = true; }
};
$('#alert-close').addEventListener('click', () => alertBox(''));

function setSource(s) {
  engine.setSource(s);
  s.bitmap?.close?.();
  src = { w: s.w, h: s.h, name: s.name, meta: s.meta, sdr: s.sdr, baseline: s.baseline };
  defaults = {
    ...structuredClone(DEFAULTS), tonemap: s.sdr ? 'standard' : 'doux', recovery: s.sdr ? 0.6 : 0,
    denoise: { ...DEFAULTS.denoise, strength: isoStrength(s.meta?.iso) },
  };
  // Nouvelle photo : on repart de zéro pour la lumière, la couleur et le bruit ; on garde le look (courbes, bloom, finition).
  for (const k of [...TABS[0].keys, ...TABS[1].keys, 'tonemap', 'recovery', 'denoise']) P[k] = structuredClone(defaults[k]);
  dnState.key = 'off';
  if (dnState.job) dnState.job.cancelled = true;
  dnState.job = null;
  syncDenoiseStatus();
  loupeAt = { x: 0.5, y: 0.5 };
  resetHistory();
  renderTab();
  syncMeta();
  requestRender();
  makeThumbs();
  lutThumbs.clear();
  if (tab === 'lut') makeLutThumbs();
}

async function openFile(file) {
  if (!file || !engine) return;
  status('Ouverture…');
  try {
    const s = await decodeFile(file, engine.maxDim, status);
    status('Envoi à la carte graphique…');
    await new Promise((r) => setTimeout(r, 0));
    setSource(s);
    $('#hint').hidden = true;
    alertBox('');
  } catch (err) {
    console.error(err);
    const why = {
      isolation: 'le décodage RAW demande une page isolée. Recharge la page ; en local, lance python3 day-03-bloom/serve.py.',
      raw: 'ce RAW n\'a pas pu être décodé.',
      hdr: 'ce fichier HDR n\'est pas lisible.',
      size: 'l\'image est trop grande pour la carte graphique.',
    }[err.message] || 'ce format n\'est pas pris en charge.';
    alertBox(`Impossible d'ouvrir ${file.name} : ${why}`);
  } finally {
    status('');
  }
}

const fileInput = $('#file');
fileInput.accept = ACCEPT;
fileInput.addEventListener('change', () => { openFile(fileInput.files[0]); fileInput.value = ''; });
$('#open').addEventListener('click', () => fileInput.click());

let dragDepth = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop').hidden = true;
  const f = e.dataTransfer.files[0];
  if (f && /\.cube$/i.test(f.name)) importLut(f);
  else openFile(f);
});
addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])][0];
  if (f) openFile(f);
});

/* ---------- Avant / après ---------- */

function setCompare(on) {
  compare = on;
  $('#compare').setAttribute('aria-pressed', String(on));
  $('#compare-top').setAttribute('aria-pressed', String(on));
  $('#split').hidden = !on;
  frame.classList.toggle('split', on);
  requestRender();
}
$('#compare').addEventListener('click', () => setCompare(!compare));
$('#compare-top').addEventListener('click', () => setCompare(!compare));
frame.addEventListener('pointerdown', (e) => {
  if (picking && src) { pickColor(e); return; }
  if (!compare && tab === 'detail' && src) {
    const r = view.getBoundingClientRect();
    loupeAt = { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
    placeMark();
    renderLoupe();
    return;
  }
  if (!compare) return;
  frame.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const r = view.getBoundingClientRect();
    split = clamp((ev.clientX - r.left) / r.width, 0, 1);
    requestRender();
  };
  move(e);
  frame.addEventListener('pointermove', move);
  frame.addEventListener('pointerup', () => frame.removeEventListener('pointermove', move), { once: true });
});

/* ---------- Export ---------- */

const exportBtn = $('#export'), exportMenu = $('#export-menu');
const closeMenu = () => { exportMenu.hidden = true; exportBtn.setAttribute('aria-expanded', 'false'); };
exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (exportBtn.classList.contains('busy')) return;
  exportMenu.hidden = !exportMenu.hidden;
  exportBtn.setAttribute('aria-expanded', String(!exportMenu.hidden));
});
addEventListener('click', (e) => { if (!exportMenu.hidden && !exportMenu.contains(e.target)) closeMenu(); });
for (const b of exportMenu.querySelectorAll('button')) {
  b.addEventListener('click', () => { closeMenu(); doExport(b.dataset.type, +b.dataset.max); });
}

async function doExport(type, max) {
  if (!src) return;
  const [W, H] = max ? fit(src.w, src.h, max) : [src.w, src.h];
  const label = $('#export-label');
  exportBtn.classList.add('busy');
  try {
    if (dnState.job) {
      label.textContent = 'Débruitage…';
      await dnState.job.done;
    }
    const canvas = await engine.export(resolve(), W, H, (p) => { label.textContent = Math.round(p * 100) + ' %'; });
    label.textContent = 'Encodage…';
    const blob = await new Promise((r) => canvas.toBlob(r, type, 0.92));
    if (!blob) throw new Error('encode');
    const a = h('a', { href: URL.createObjectURL(blob), download: src.name.replace(/\.[^.]+$/, '') + '-bloom.' + (type === 'image/png' ? 'png' : 'jpg') });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Exporté en ${W} × ${H}`);
    requestRender();
  } catch (err) {
    console.error(err);
    alertBox('L\'export a échoué. La carte graphique manque peut-être de mémoire : essaie le JPEG pour le web.');
  } finally {
    exportBtn.classList.remove('busy');
    label.textContent = 'Exporter';
  }
}

/* ---------- Divers ---------- */

let toastTimer = 0;
function toast(text, err = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('err', err);
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), err ? 4200 : 2200);
}

const togglePanel = () => {
  const hidden = document.body.classList.toggle('panel-hidden');
  $('#toggle-panel').setAttribute('aria-pressed', String(!hidden));
  requestRender();
};
$('#toggle-panel').addEventListener('click', togglePanel);
// Maintenir l'œil : l'original sur toute l'image.
const setHold = (v) => () => {
  if (holdBefore === v) return;
  holdBefore = v;
  for (const b of document.querySelectorAll('#hold, #hold-top')) b.setAttribute('aria-pressed', String(v));
  requestRender();
};
for (const holdBtn of document.querySelectorAll('#hold, #hold-top')) {
  holdBtn.addEventListener('pointerdown', setHold(true));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) holdBtn.addEventListener(ev, setHold(false));
  holdBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setHold(true)(); } });
  holdBtn.addEventListener('keyup', setHold(false));
}

// Menu « … »
const moreBtn = $('#more'), moreMenu = $('#more-menu');
moreBtn.addEventListener('click', (e) => { e.stopPropagation(); moreMenu.hidden = !moreMenu.hidden; moreBtn.setAttribute('aria-expanded', String(!moreMenu.hidden)); });
addEventListener('click', (e) => { if (!moreMenu.hidden && !moreMenu.contains(e.target)) { moreMenu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); } });
for (const b of moreMenu.querySelectorAll('button')) {
  b.addEventListener('click', () => {
    moreMenu.hidden = true;
    if (b.dataset.act === 'open') fileInput.click();
    else if (b.dataset.act === 'panel') togglePanel();
    else if (b.dataset.act === 'theme') setTheme(theme === 'lum' ? 'dark' : 'lum');
    else { if (document.body.classList.contains('panel-hidden')) togglePanel(); tab = 'info'; panelView = 'edit'; renderTab(); }
  });
}
$('#undo').addEventListener('click', () => go(-1));
$('#redo').addEventListener('click', () => go(1));

addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); go(e.shiftKey ? 1 : -1); return; }
  if (mod && k === 'y') { e.preventDefault(); go(1); return; }
  if (mod || e.altKey) return;
  if (k === 'o') fileInput.click();
  else if (k === 'y' || k === '\\') setCompare(!compare);
  else if (k === 'h') togglePanel();
  else if (k === 'm' && tab === 'locals') { showMask = !showMask; renderTab(); requestRender(); }
  else if (k === 'escape') closeMenu();
});

/* ---------- Démarrage ---------- */

async function start() {
  engine = new Engine();
  try {
    await engine.init(view);
  } catch (err) {
    console.error(err);
    frame.replaceWith(h('div', { className: 'fatal' }, icon('ph-graphics-card'),
      h('b', { textContent: 'WebGPU n\'est pas disponible' }),
      'Ce navigateur ou cette machine ne donne pas accès à WebGPU. Chrome, Edge, Safari 26 et Firefox récents le proposent.'));
    $('#hint').hidden = true;
    return;
  }
  engine.onHisto = drawHisto;
  denoiser = new Denoiser(engine);
  userLuts = (await loadUserLuts()).map((l) => ({ ...l, data: l.data instanceof Float32Array ? l.data : new Float32Array(l.data) }));
  engine.lost.then((info) => { if (info.reason !== 'destroyed') toast('La carte graphique a été réinitialisée, recharge la page.', true); });
  await document.fonts?.load('600 160px Geist').catch(() => {});
  P.layers = LOOKS.find((l) => l.id === 'neon').layers();
  setSource(makeDemo());
  setTimeout(() => { $('#hint').hidden = true; }, 6000);
}
document.body.classList.add(theme === 'lum' ? 'theme-lum' : 'theme-dark');
$('#theme-label').textContent = theme === 'lum' ? 'Interface chambre noire' : 'Interface épurée';
start();
