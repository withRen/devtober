/* =========================================================
   LUT 3D : lecture (.cube, HaldCLUT), galerie intégrée,
   écriture d'un .cube, et rangement des LUT importées.
   Une LUT est { id, name, N, data } : data en Float32, RVB,
   rouge le plus rapide, puis vert, puis bleu (l'ordre du .cube).
   ========================================================= */
import { toHalf } from './decode.js';

/* ---------- Lecture ---------- */

export function parseCube(text, name) {
  let N3 = 0, N1 = 0, min = [0, 0, 0], max = [1, 1, 1], title = '';
  const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const [k, ...rest] = line.split(/\s+/);
    if (k === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (k === 'LUT_3D_SIZE') N3 = +rest[0];
    else if (k === 'LUT_1D_SIZE') N1 = +rest[0];
    else if (k === 'DOMAIN_MIN') min = rest.map(Number);
    else if (k === 'DOMAIN_MAX') max = rest.map(Number);
    else if (/^[-+\d.eE]/.test(k)) vals.push(+k, +rest[0], +rest[1]);
  }
  const lutName = title || name.replace(/\.[^.]+$/, '');
  const dom = (v, c) => (v - min[c]) / (max[c] - min[c] || 1);
  if (N3 >= 2 && vals.length >= N3 ** 3 * 3) {
    if (N3 > 128) throw new Error('lut');
    // Un domaine autre que [0, 1] : on rééchantillonne sur [0, 1].
    const data = Float32Array.from(vals.slice(0, N3 ** 3 * 3));
    if (min.some((v) => v !== 0) || max.some((v) => v !== 1)) {
      return { name: lutName, N: 33, data: build((r, g, b) => sample3(data, N3, [dom(r, 0), dom(g, 1), dom(b, 2)]), 33) };
    }
    return { name: lutName, N: N3, data };
  }
  if (N1 >= 2 && vals.length >= N1 * 3) {
    // LUT 1D : une courbe par canal, convertie en 3D.
    const c = (v, k) => { const x = Math.min(1, Math.max(0, dom(v, k))) * (N1 - 1), i = Math.min(N1 - 2, Math.floor(x)), t = x - i; return vals[i * 3 + k] * (1 - t) + vals[(i + 1) * 3 + k] * t; };
    return { name: lutName, N: 33, data: build((r, g, b) => [c(r, 0), c(g, 1), c(b, 2)], 33) };
  }
  throw new Error('lut');
}

// HaldCLUT : une image de L³ × L³ pixels, soit une LUT de L² points par côté.
export async function parseHald(file) {
  const bmp = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const W = bmp.width, L = Math.round(Math.cbrt(W));
  if (bmp.height !== W || L ** 3 !== W || L < 2) { bmp.close(); throw new Error('hald'); }
  const N = L * L;
  const c = new OffscreenCanvas(W, W);
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const px = g.getImageData(0, 0, W, W).data;
  const data = new Float32Array(N ** 3 * 3);
  for (let i = 0; i < N ** 3; i++) { data[i * 3] = px[i * 4] / 255; data[i * 3 + 1] = px[i * 4 + 1] / 255; data[i * 3 + 2] = px[i * 4 + 2] / 255; }
  return { name: file.name.replace(/\.[^.]+$/, ''), N, data };
}

function sample3(d, N, [r, g, b]) {
  const f = (v) => { const x = Math.min(1, Math.max(0, v)) * (N - 1); const i = Math.min(N - 2, Math.floor(x)); return [i, x - i]; };
  const [ri, rt] = f(r), [gi, gt] = f(g), [bi, bt] = f(b);
  const out = [0, 0, 0];
  for (let k = 0; k < 8; k++) {
    const dr = k & 1, dg = (k >> 1) & 1, db = k >> 2;
    const w = (dr ? rt : 1 - rt) * (dg ? gt : 1 - gt) * (db ? bt : 1 - bt);
    const o = (((bi + db) * N + gi + dg) * N + ri + dr) * 3;
    out[0] += d[o] * w; out[1] += d[o + 1] * w; out[2] += d[o + 2] * w;
  }
  return out;
}

export function build(fn, N = 33) {
  const data = new Float32Array(N ** 3 * 3);
  let i = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const o = fn(r / (N - 1), g / (N - 1), b / (N - 1));
    data[i++] = o[0]; data[i++] = o[1]; data[i++] = o[2];
  }
  return data;
}

// Pour la carte graphique : RGBA en demi-flottants.
const halves = new WeakMap();
export function lutHalf(lut) {
  let h = halves.get(lut.data);
  if (!h) {
    const n = lut.N ** 3, f = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { f[i * 4] = lut.data[i * 3]; f[i * 4 + 1] = lut.data[i * 3 + 1]; f[i * 4 + 2] = lut.data[i * 3 + 2]; f[i * 4 + 3] = 1; }
    h = toHalf(f);
    halves.set(lut.data, h);
  }
  return h;
}

export function toCube(title, N, data) {
  const lines = [`# Bloom, jour 03 · Devtober 2026`, `TITLE "${title.replace(/"/g, '')}"`, `LUT_3D_SIZE ${N}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0', ''];
  for (let i = 0; i < N ** 3; i++) lines.push(`${data[i * 3].toFixed(6)} ${data[i * 3 + 1].toFixed(6)} ${data[i * 3 + 2].toFixed(6)}`);
  return lines.join('\n') + '\n';
}

/* ---------- Galerie intégrée ----------
   Des fonctions sur des valeurs d'affichage (sRGB, 0 à 1),
   échantillonnées en 33³. */

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sc = (x, k) => x + k * (x * x * (3 - 2 * x) - x);         // courbe en S
const sat = (c, k) => { const y = lum(...c); return c.map((v) => y + (v - y) * k); };
const cl = (c) => c.map((v) => Math.min(1, Math.max(0, v)));
const tone = (c, sh, hi) => { const y = lum(...c); return c.map((v, i) => v + sh[i] * (1 - y) ** 2 + hi[i] * y * y); };

export const BUILTIN = [
  { id: 'b:teal', name: 'Sarcelle et orange', fn: (r, g, b) => {
    let c = tone([r, g, b], [-0.05, 0.02, 0.07], [0.08, 0.02, -0.07]);
    c = sat(c.map((v) => sc(v, 0.25)), 1.12);
    return cl(c);
  } },
  { id: 'b:warm', name: 'Pellicule chaude', fn: (r, g, b) => {
    let c = [r, g, b].map((v) => 0.035 + sc(v, 0.3) * 0.94);
    c = tone(c, [0.01, 0, -0.02], [0.05, 0.015, -0.05]);
    return cl(sat(c, 1.08));
  } },
  { id: 'b:cool', name: 'Pellicule froide', fn: (r, g, b) => {
    let c = [r, g, b].map((v) => 0.025 + sc(v, 0.18) * 0.95);
    c = tone(c, [-0.03, 0.02, 0.03], [0.02, -0.01, 0.025]);
    return cl(sat(c, 0.88));
  } },
  { id: 'b:fade', name: 'Délavé', fn: (r, g, b) => {
    const c = [r, g, b].map((v) => 0.09 + v * 0.84);
    return cl(sat(tone(c, [0.01, 0, 0.02], [0.02, 0.01, -0.01]), 0.8));
  } },
  { id: 'b:bleach', name: 'Sans blanchiment', fn: (r, g, b) => {
    const c = sat([r, g, b], 0.45).map((v) => sc(v, 0.55));
    return cl(c);
  } },
  { id: 'b:night', name: 'Nuit américaine', fn: (r, g, b) => {
    let c = sat([r, g, b], 0.55).map((v) => 0.62 * v ** 1.25);
    c = [c[0] * 0.78, c[1] * 0.92, c[2] * 1.28];
    return cl(c);
  } },
  { id: 'b:mono', name: 'Noir et blanc', fn: (r, g, b) => {
    const y = sc(Math.min(1, 0.5 * r + 0.42 * g + 0.08 * b), 0.3);
    return [y, y, y];
  } },
  { id: 'b:sepia', name: 'Sépia', fn: (r, g, b) => {
    const y = sc(lum(r, g, b), 0.15);
    return cl([y * 1.07 + 0.02, y * 0.96 + 0.01, y * 0.78]);
  } },
].map((l) => ({ ...l, builtin: true, N: 33, get data() { return (this._d ??= build(this.fn, 33)); } }));

/* ---------- LUT importées : IndexedDB ---------- */

const DB = 'bloom-luts', STORE = 'luts';
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
};
export const loadUserLuts = () => tx('readonly', (s) => s.getAll()).catch(() => []);
export const saveUserLut = (l) => tx('readwrite', (s) => s.put({ id: l.id, name: l.name, N: l.N, data: l.data })).catch(() => {});
export const deleteUserLut = (id) => tx('readwrite', (s) => s.delete(id)).catch(() => {});
