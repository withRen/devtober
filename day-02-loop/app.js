/* =========================================================
   LOOP, jour 02 du Devtober : un générateur de fonds d'écran
   Des milliers de particules qui tournent en boucle, en points,
   en ASCII ou en vecteurs. Export PNG à toute résolution, et SVG.
   ========================================================= */

import { createNodeEditor, defaultGraph } from "./nodes.js";
import { createTimeline } from "./timeline.js";
import { createGpu } from "./gpu.js";

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;

/* ---------- Réglages ---------- */
const DEFAULTS = {
  shape: "galaxie", arms: 2, twist: 4.8, petals: 5, lissA: 3, lissB: 2, starN: 5, starDepth: 0.45,
  rings: 6, inner: 0.2, ringTwist: 0.35, alternate: false,
  count: 90000, filaments: 60, width: 0.3, dispersion: 0.22, dust: 0.08,
  flow: 0.025, rot: 0.03, turb: 0.12, turbScale: 3, evolve: 0.12, trail: 0.7,
  mode: "points", size: 1, exposure: 0.4, charSize: 10, charset: " .:-=+*#%@", lines: 180, lineWidth: 0.8, lineAlpha: 0.22,
  halo: 0.45, haloSize: 1.5,
  palette: "galaxie", bg: "#050505", c1: "#7a7a7a", c2: "#ffffff",
  zoom: 1, cx: 0, cy: 0, angle: 0,
  tilt: 0.45, orbits: 0, chroma: 0, grain: 0,
  glyphSize: 20, glyphs: "0123456789", flicker: 0.25,
  bgFit: "cover", bgVeil: 0.35, bgBlur: 0,
  seed: 7, format: "ecran", freehand: null, preset: "galaxie", graph: null,
  duration: 10, keys: null
};
const SECTION_TITLES = ["Forme", "Boucles", "Mouvement", "Rendu", "Effets", "Couleurs", "Cadrage"];

// Graphe de nœuds d'un préréglage (les modulateurs sont placés sous le pipeline)
const presetGraph = (nodes, links) => ({ ...defaultGraph(SECTION_TITLES), nodes, links, next: nodes.length + 1 });

// Préréglages : chacun part des réglages par défaut et en change une partie
const PRESETS = {
  galaxie: { name: "Galaxie" },
  orbite: {
    name: "Orbite", shape: "sphere", count: 150000, filaments: 80, dispersion: 0.6, width: 0.4, dust: 0.01,
    flow: 0.01, rot: 0.035, tilt: 0.55, turb: 0.13, turbScale: 2.2, evolve: 0.25, trail: 0.45,
    exposure: 1.1, halo: 0.75, haloSize: 1.2, chroma: 0.7, grain: 0.35, orbits: 3, palette: "galaxie"
  },
  chiffres: {
    name: "Sphère de chiffres", shape: "sphere", mode: "glyphes", count: 1100, filaments: 18, dispersion: 0.015, width: 0, dust: 0,
    flow: 0.012, rot: 0.04, tilt: 0.3, turb: 0, glyphSize: 20, glyphs: "0123456789", flicker: 0.2,
    halo: 0.2, haloSize: 0.8, palette: "galaxie"
  },
  fleur: {
    name: "Fleur néon", shape: "fleur", petals: 7, mode: "vecteurs", rings: 9, inner: 0.15, ringTwist: 0.2,
    lines: 320, lineWidth: 0.7, lineAlpha: 0.2, turb: 0.06, palette: "braise", halo: 0.8
  },
  code: {
    name: "Code", shape: "lissajous", lissA: 3, lissB: 4, mode: "ascii", charSize: 11, charset: " ;{}[]<>/=",
    rings: 5, inner: 0.35, width: 0.12, filaments: 30, palette: "aurore", halo: 0.4, trail: 0.85, exposure: 0.8
  },
  infini: {
    name: "Infini", shape: "infini", rings: 10, inner: 0.25, ringTwist: 0.12, alternate: true, filaments: 12,
    width: 0.06, dispersion: 0.15, turb: 0.04, palette: "glacier", halo: 0.7, chroma: 0.25, exposure: 0.7
  },
  atome: {
    name: "Atome", shape: "cercle", rings: 3, inner: 0.85, ringTwist: 1.05, count: 60000, filaments: 6, width: 0.02,
    dispersion: 0.05, turb: 0.02, orbits: 4, tilt: 0.9, palette: "sang", halo: 0.9, chroma: 0.35, exposure: 0.6, trail: 0.8
  },
  respiration: {
    name: "Respiration", count: 100000, halo: 0.7, chroma: 0.15,
    graph: presetGraph([
      { id: "n1", type: "osc", x: 900, y: 400, p: { onde: "sinus", frequence: 0.12, amplitude: 0.45, centre: 0.75, phase: 0 } },
      { id: "n2", type: "osc", x: 1180, y: 400, p: { onde: "sinus", frequence: 0.12, amplitude: 0.1, centre: 1, phase: 0.25 } },
      { id: "n3", type: "bruit", x: 500, y: 400, p: { vitesse: 0.15, amplitude: 0.12, centre: 0.14, graine: 4 } }
    ], [
      { fn: "n1", fo: "valeur", tn: "sec:Effets", ti: "halo" },
      { fn: "n2", fo: "valeur", tn: "sec:Cadrage", ti: "zoom" },
      { fn: "n3", fo: "valeur", tn: "sec:Mouvement", ti: "turb" }
    ])
  },
  interactif: {
    name: "Interactif", shape: "sphere", count: 110000, filaments: 80, dispersion: 0.6, width: 0.4, dust: 0.01,
    flow: 0.01, rot: 0.02, tilt: 0.4, turb: 0.13, turbScale: 2.2, evolve: 0.25, trail: 0.5,
    exposure: 1, halo: 0.7, haloSize: 1.2, chroma: 0.4, grain: 0.25, orbits: 2, palette: "glacier",
    graph: presetGraph([
      { id: "n1", type: "souris", x: 0, y: 400, p: { lissage: 0.9 } },
      { id: "n2", type: "plage", x: 260, y: 400, p: { valeur: 0, deMin: -1, deMax: 1, versMin: 0, versMax: 0.45, borner: "oui" } },
      { id: "n3", type: "math", x: 260, y: 680, p: { op: "multiplication", a: 0, b: 1.2 } }
    ], [
      { fn: "n1", fo: "x", tn: "n2", ti: "valeur" },
      { fn: "n2", fo: "valeur", tn: "sec:Mouvement", ti: "turb" },
      { fn: "n1", fo: "y", tn: "n3", ti: "a" },
      { fn: "n3", fo: "valeur", tn: "sec:Forme", ti: "tilt" }
    ])
  },
  papier: {
    name: "Papier", shape: "etoile", starN: 6, starDepth: 0.35, rings: 12, inner: 0.1, ringTwist: 0.08, mode: "vecteurs",
    lines: 260, lineAlpha: 0.35, lineWidth: 0.6, palette: "papier", halo: 0.25, turb: 0.03
  }
};

function presetSettings(key) {
  const p = { ...DEFAULTS, ...JSON.parse(JSON.stringify(PRESETS[key])), preset: key };
  delete p.name;
  if (!p.graph) p.graph = defaultGraph(SECTION_TITLES);
  const [bg, c1, c2] = PALETTES[p.palette] || PALETTES.galaxie;
  return { ...p, bg, c1, c2 };
}

const PALETTES = {
  galaxie: ["#050505", "#7a7a7a", "#ffffff"],
  braise: ["#0a0503", "#c2410c", "#ffd9b0"],
  glacier: ["#02060b", "#2a7fb8", "#e8f7ff"],
  aurore: ["#020806", "#1f9d6b", "#dcffec"],
  sang: ["#070000", "#d4111a", "#ffe1e1"],
  papier: ["#ececec", "#6b6b6b", "#111111"],
  toyota: ["#f4f4f4", "#eb0a1e", "#151515"]
};

const CHARSETS = { classique: " .:-=+*#%@", blocs: " ░▒▓█", binaire: " 01", points: " ·•●", code: " ;{}[]<>/=" };

const FORMATS = {
  ecran: ["Mon écran", 0, 0],
  "4k": ["4K", 3840, 2160],
  qhd: ["1440p", 2560, 1440],
  fhd: ["1080p", 1920, 1080],
  uw: ["Ultra large", 3440, 1440],
  iphone: ["iPhone", 1179, 2556],
  android: ["Android", 1080, 2400],
  carre: ["Carré", 2048, 2048]
};

let S = loadSettings();

function loadSettings() {
  try {
    if (location.hash.length > 1) return { ...DEFAULTS, ...JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1))))) };
  } catch (e) {}
  try {
    const saved = JSON.parse(localStorage.getItem("loop-wallpaper"));
    if (saved) return { ...DEFAULTS, ...saved };
  } catch (e) {}
  return { ...DEFAULTS };
}

function saveSettings() {
  try { localStorage.setItem("loop-wallpaper", JSON.stringify(S)); } catch (e) {}
}

function formatSize(key) {
  const [, w, h] = FORMATS[key];
  if (w) return [w, h];
  const dpr = devicePixelRatio || 1;
  return [Math.round(screen.width * dpr), Math.round(screen.height * dpr)];
}

/* ---------- Hasard reproductible et bruit ---------- */
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  let u = 0;
  while (!u) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r());
}

// Bruit de valeur sur une grille 256 × 256 qui se répète : très rapide à échantillonner
const NS = 256;
const noiseT = new Float32Array(NS * NS);
{ const r = mulberry32(1234); for (let i = 0; i < noiseT.length; i++) noiseT[i] = r() * 2 - 1; }
function vnoise(x, y) {
  const xf = Math.floor(x), yf = Math.floor(y);
  const fx = x - xf, fy = y - yf;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const i0 = xf & 255, i1 = (xf + 1) & 255, j0 = (yf & 255) * NS, j1 = ((yf + 1) & 255) * NS;
  const a = noiseT[j0 + i0], b = noiseT[j0 + i1], c = noiseT[j1 + i0], d = noiseT[j1 + i1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x, y) => vnoise(x, y) + 0.5 * vnoise(x * 2.03 + 17.1, y * 2.03 + 31.7);

/* ---------- Formes de boucle ---------- */
// Chaque forme est échantillonnée puis rééchantillonnée à longueur d'arc constante :
// les particules se répartissent régulièrement, quelle que soit la forme.
const CURVE_N = 1024;
const curve = new Float32Array(CURVE_N * 2), normals = new Float32Array(CURVE_N * 2);

function rawShape(t) {
  const a = t * TAU;
  switch (S.shape) {
    case "infini": { const s = Math.sin(a), c = Math.cos(a), d = 1 + s * s; return [c / d, s * c / d]; }
    case "fleur": { const r = 0.55 + 0.45 * Math.cos(S.petals * a); return [r * Math.cos(a), r * Math.sin(a)]; }
    case "lissajous": return [Math.sin(S.lissA * a + Math.PI / 2), Math.sin(S.lissB * a)];
    case "coeur": {
      const x = 16 * Math.sin(a) ** 3, y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
      return [x, -y];
    }
    case "etoile": {
      const r = 1 - S.starDepth * (0.5 - 0.5 * Math.cos(S.starN * a));
      return [r * Math.cos(a - Math.PI / 2), r * Math.sin(a - Math.PI / 2)];
    }
    case "libre": {
      const pts = S.freehand;
      if (!pts || pts.length < 6) return [Math.cos(a), Math.sin(a)];
      const n = pts.length / 2, f = t * n, i = Math.floor(f) % n, j = (i + 1) % n, k = f - Math.floor(f);
      return [pts[i * 2] + (pts[j * 2] - pts[i * 2]) * k, pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * k];
    }
    default: return [Math.cos(a), Math.sin(a)];
  }
}

function buildCurve() {
  const RAW = 4096;
  const xs = new Float64Array(RAW + 1), ys = new Float64Array(RAW + 1), len = new Float64Array(RAW + 1);
  for (let i = 0; i <= RAW; i++) { const [x, y] = rawShape((i % RAW) / RAW); xs[i] = x; ys[i] = y; }
  for (let i = 1; i <= RAW; i++) len[i] = len[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  const total = len[RAW] || 1;
  let j = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < CURVE_N; i++) {
    const target = i / CURVE_N * total;
    while (j < RAW - 1 && len[j + 1] < target) j++;
    const k = (target - len[j]) / ((len[j + 1] - len[j]) || 1);
    const x = xs[j] + (xs[j + 1] - xs[j]) * k, y = ys[j] + (ys[j + 1] - ys[j]) * k;
    curve[i * 2] = x; curve[i * 2 + 1] = y;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // Centrée, et mise à l'échelle pour tenir dans un rayon de 0,9
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, sc = 0.9 / (Math.max(maxX - minX, maxY - minY) / 2 || 1);
  for (let i = 0; i < CURVE_N; i++) { curve[i * 2] = (curve[i * 2] - cx) * sc; curve[i * 2 + 1] = (curve[i * 2 + 1] - cy) * sc; }
  for (let i = 0; i < CURVE_N; i++) {
    const a = ((i - 1 + CURVE_N) % CURVE_N) * 2, b = ((i + 1) % CURVE_N) * 2;
    const tx = curve[b] - curve[a], ty = curve[b + 1] - curve[a + 1], l = Math.hypot(tx, ty) || 1;
    normals[i * 2] = -ty / l; normals[i * 2 + 1] = tx / l;
  }
  curveVersion++;
}
let curveVersion = 0, lutVersion = 0;

/* ---------- Particules ---------- */
const DUST = 65535, ORBIT = 60000;
let orbitTilt = [];
let P = { n: 0, k: new Uint16Array(0), u: new Float32Array(0), off: new Float32Array(0) };
let filamentOffsets = new Float32Array(0);

function buildParticles() {
  const r = mulberry32(S.seed * 7919 + 13);
  const main = S.count;
  const perOrbit = 7000;
  const n = main + S.orbits * perOrbit;
  const k = new Uint16Array(n), u = new Float32Array(n), off = new Float32Array(n);
  const sphere = S.shape === "sphere";
  const F = Math.max(1, S.filaments);
  filamentOffsets = new Float32Array(F);
  for (let j = 0; j < F; j++) filamentOffsets[j] = gauss(r) * 0.5;
  const K = S.shape === "galaxie" ? S.arms : S.rings;
  for (let i = 0; i < main; i++) {
    if (r() < S.dust) {
      // Poussière d'étoiles : position fixe dans tout le cadre
      k[i] = DUST; u[i] = r() * 2 - 1; off[i] = r() * 2 - 1;
      continue;
    }
    if (sphere) {
      // Sphère : longitude libre, latitude regroupée en bandes (les « filaments »)
      k[i] = Math.floor(r() * 1000);
      u[i] = r();
      const band = F > 1 ? (Math.floor(r() * F) + 0.5) / F * 2 - 1 : 0;
      // On rebondit sur les pôles au lieu de borner : sinon les particules s'y empilent
      let o = band + gauss(r) * S.dispersion * 0.5;
      for (let g = 0; g < 4 && Math.abs(o) > 1; g++) o = o > 1 ? 2 - o : -2 - o;
      off[i] = Math.max(-0.999, Math.min(0.999, o));
      continue;
    }
    k[i] = Math.floor(r() * K);
    u[i] = S.shape === "galaxie" ? Math.pow(r(), 1.6) : r();
    off[i] = filamentOffsets[Math.floor(r() * F)] + gauss(r) * S.dispersion * 0.5;
  }
  // Anneaux en orbite, chacun incliné différemment
  const ro = mulberry32(S.seed * 101 + 3);
  orbitTilt = Array.from({ length: S.orbits }, () => [(ro() - 0.5) * 2.4, (ro() - 0.5) * 2.4]);
  for (let i = main; i < n; i++) {
    k[i] = ORBIT + Math.floor((i - main) / perOrbit);
    u[i] = r();
    off[i] = gauss(r);
  }
  // Cosinus et sinus de l'angle propre de chaque particule, calculés une fois pour toutes
  const cu = new Float32Array(n), su = new Float32Array(n), rr = new Float32Array(n);
  for (let i = 0; i < n; i++) { cu[i] = Math.cos(u[i] * TAU); su[i] = Math.sin(u[i] * TAU); rr[i] = Math.sqrt(Math.max(0, 1 - off[i] * off[i])); }
  P = { n, main, k, u, off, cu, su, rr };
}

// Position d'une particule au temps t, en coordonnées normalisées (rayon ~1)
let PX = 0, PY = 0, PZ = 0, PW = 1;   // position projetée, profondeur, poids lumineux
let NOFLOW = false;   // les lignes vectorielles ne glissent pas le long de la boucle
const ringCos = new Float32Array(64), ringSin = new Float32Array(64);

// Rotations communes à toutes les particules pour cette image
const FR = { c0: 1, s0: 0, cs: 1, ss: 0, ct: 1, st: 0, oc: 1, os: 0, orb: [] };
function prepareFrame(t) {
  prepareRings(t);
  const p0 = t * S.flow * TAU, sp = t * S.rot * TAU, po = t * S.flow * 2 * TAU;
  FR.c0 = Math.cos(p0); FR.s0 = Math.sin(p0);
  FR.cs = Math.cos(sp); FR.ss = Math.sin(sp);
  FR.ct = Math.cos(S.tilt); FR.st = Math.sin(S.tilt);
  FR.oc = Math.cos(po); FR.os = Math.sin(po);
  FR.orb = orbitTilt.map(([tx, tz]) => { const rx = tx + t * S.rot * 0.6; return [Math.cos(rx), Math.sin(rx), Math.cos(tz), Math.sin(tz)]; });
}

function prepareRings(t) {
  for (let k = 0; k < S.rings; k++) {
    const a = k * S.ringTwist + t * S.rot * TAU;
    ringCos[k] = Math.cos(a); ringSin[k] = Math.sin(a);
  }
}

// Perspective simple : la caméra est à 3 unités, ce qui est derrière est plus petit et plus sombre
function project(x, y, z) {
  const s = 3 / (3 - z);
  PX = x * s; PY = y * s; PZ = z;
  PW = 0.2 + 0.8 * Math.max(0, Math.min(1, (z / 0.7 + 1) / 2));
}

function posAt(k, u, off, t, i = -1) {
  PW = 1; PZ = 0;
  if (k === DUST) {
    const a = t * S.rot * TAU * 0.25, c = Math.cos(a), s = Math.sin(a);
    const x = u * 1.8, y = off * 1.8;
    PX = x * c - y * s; PY = x * s + y * c;
    return;
  }
  if (k >= ORBIT) {
    const j = k - ORBIT;
    let ca, sa;
    if (i >= 0) { const cu = P.cu[i], su = P.su[i]; ca = cu * FR.oc - su * FR.os; sa = su * FR.oc + cu * FR.os; }
    else { const a = (u + t * S.flow * 2) * TAU; ca = Math.cos(a); sa = Math.sin(a); }
    const R = 0.84 + j * 0.1;
    const x = ca * R, y = off * 0.005, z = sa * R;
    const o = FR.orb[j] || [1, 0, 1, 0];
    const y1 = y * o[0] - z * o[1], z1 = y * o[1] + z * o[0];
    const x2 = x * o[2] - y1 * o[3], y2 = x * o[3] + y1 * o[2];
    project(x2 * 0.85, y2 * 0.85, z1 * 0.85);
    return;
  }
  if (S.shape === "sphere") {
    // lon0 = angle propre + glissement, lon = lon0 + rotation : obtenus par rotation des cos/sin précalculés
    let c0, s0, rr;
    if (i >= 0) { const cu = P.cu[i], su = P.su[i]; c0 = cu * FR.c0 - su * FR.s0; s0 = su * FR.c0 + cu * FR.s0; rr = P.rr[i]; }
    else { const lon0 = (u + t * S.flow) * TAU; c0 = Math.cos(lon0); s0 = Math.sin(lon0); rr = Math.sqrt(Math.max(0, 1 - off * off)); }
    const cl = c0 * FR.cs - s0 * FR.ss, sl = s0 * FR.cs + c0 * FR.ss;
    const cy = off;
    let R = 0.62 * (1 + S.width * (k / 500 - 1));
    if (S.turb > 0) {
      // Bosses à la surface : le bruit est lié à la sphère, il tourne avec elle
      const f = S.turbScale, e = t * S.evolve;
      R *= 1 + S.turb * 1.6 * fbm(rr * c0 * f + e + 3.1, (cy + rr * s0 * 0.7) * f - e * 0.6);
    }
    const x = rr * cl * R, y = cy * R, z = rr * sl * R;
    project(x, y * FR.ct - z * FR.st, y * FR.st + z * FR.ct);
    return;
  }
  if (S.shape === "galaxie") {
    let uu = NOFLOW ? u : u + t * S.flow; uu -= Math.floor(uu);
    const r = 0.025 + uu * 0.975;
    const th = k / S.arms * TAU + S.twist * Math.log(1 + r * 8) + t * S.rot * TAU;
    const w = off * S.width * (0.35 + r);
    const c = Math.cos(th), s = Math.sin(th);
    PX = r * c - w * s; PY = r * s + w * c;
  } else {
    const dir = S.alternate && (k & 1) ? -1 : 1;
    let uu = u + t * S.flow * dir; uu -= Math.floor(uu);
    const f = uu * CURVE_N, i0 = f | 0, i1 = (i0 + 1) % CURVE_N, fr = f - i0;
    const bx = curve[i0 * 2] + (curve[i1 * 2] - curve[i0 * 2]) * fr;
    const by = curve[i0 * 2 + 1] + (curve[i1 * 2 + 1] - curve[i0 * 2 + 1]) * fr;
    const sk = S.rings > 1 ? S.inner + (1 - S.inner) * k / (S.rings - 1) : 1;
    const w = off * S.width;
    const x = (bx + normals[i0 * 2] * w) * sk, y = (by + normals[i0 * 2 + 1] * w) * sk;
    PX = x * ringCos[k] - y * ringSin[k]; PY = x * ringSin[k] + y * ringCos[k];
  }
  if (S.turb > 0) {
    const f = S.turbScale, e = t * S.evolve;
    const nx = fbm(PX * f + e, PY * f), ny = fbm(PX * f + 41.3, PY * f - e);
    PX += S.turb * nx; PY += S.turb * ny;
  }
}

/* ---------- Couleurs ---------- */
const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const isLight = h => { const [r, g, b] = hex(h); return 0.299 * r + 0.587 * g + 0.114 * b > 140; };
const LUT_N = 1024;
let lut = new Uint32Array(LUT_N), lutRGB = [];
let DMAX = 4;

function buildLut() {
  const bg = hex(layerBg()), c1 = hex(S.c1), c2 = hex(S.c2);
  DMAX = 5 / S.exposure;
  lutRGB = [];
  for (let i = 0; i < LUT_N; i++) {
    const d = i / (LUT_N - 1) * DMAX;
    const v = 1 - Math.exp(-d * S.exposure);
    let a, b, k;
    if (v < 0.55) { a = bg; b = c1; k = v / 0.55; } else { a = c1; b = c2; k = (v - 0.55) / 0.45; }
    const col = [0, 1, 2].map(j => Math.round(a[j] + (b[j] - a[j]) * k));
    lutRGB.push(col);
    lut[i] = (255 << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
  }
  lutVersion++;
}

/* ---------- Rendu ---------- */
const stage = $("stage");
const canvas = $("view");
const ctx = canvas.getContext("2d");
let W = 0, H = 0, buf = new Float32Array(0), img = null, img32 = null;
let t = 0, paused = false;

function transform(w, h) {
  const unit = Math.min(w, h) / 2 * S.zoom;
  const a = S.angle * Math.PI / 180;
  return { unit, ox: w / 2 + S.cx * w / 2, oy: h / 2 + S.cy * h / 2, ca: Math.cos(a), sa: Math.sin(a) };
}

// Ajoute toutes les particules au tampon de densité (dépôt bilinéaire : pas de crénelage)
function splat(b, w, h, time, weight) {
  const { unit, ox, oy, ca, sa } = transform(w, h);
  prepareFrame(time);
  const n = P.n, K = P.k, U = P.u, O = P.off;
  const size = S.size | 0;
  const wgt = weight / (size * size);
  for (let i = 0; i < n; i++) {
    posAt(K[i], U[i], O[i], time, i);
    const ww = wgt * PW;
    const X0 = ox + (PX * ca - PY * sa) * unit, Y0 = oy + (PX * sa + PY * ca) * unit;
    for (let sy = 0; sy < size; sy++) {
      for (let sx = 0; sx < size; sx++) {
        const X = X0 + sx - (size - 1) / 2, Y = Y0 + sy - (size - 1) / 2;
        const x0 = Math.floor(X), y0 = Math.floor(Y);
        if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
        const fx = X - x0, fy = Y - y0, idx = y0 * w + x0;
        b[idx] += ww * (1 - fx) * (1 - fy);
        b[idx + 1] += ww * fx * (1 - fy);
        b[idx + w] += ww * (1 - fx) * fy;
        b[idx + w + 1] += ww * fx * fy;
      }
    }
  }
}

function particleWeight(w, h) {
  return w * h / Math.max(1, P.n) * 0.16;
}

function toneMap(b, out32) {
  const k = (LUT_N - 1) / DMAX;
  for (let i = 0; i < b.length; i++) {
    let j = (b[i] * k) | 0;
    if (j > LUT_N - 1) j = LUT_N - 1;
    out32[i] = lut[j];
  }
}

// ASCII : un caractère par cellule, choisi selon la densité moyenne
let atlas = null, atlasKey = "";
function buildAtlas(cell) {
  const key = `${cell}|${S.charset}|${layerBg()}|${S.c1}|${S.c2}|${S.exposure}`;
  if (key === atlasKey) return;
  atlasKey = key;
  const chars = [...S.charset];
  const LEVELS = 24;
  atlas = document.createElement("canvas");
  atlas.width = cell * chars.length; atlas.height = cell * LEVELS;
  const g = atlas.getContext("2d");
  g.font = `500 ${cell * 0.95}px "Geist Mono", ui-monospace, monospace`;
  g.textAlign = "center"; g.textBaseline = "middle";
  for (let l = 0; l < LEVELS; l++) {
    const [r, gg, bb] = lutRGB[Math.round(LUT_N * (0.25 + 0.75 * l / (LEVELS - 1)) - 1)] || [255, 255, 255];
    g.fillStyle = `rgb(${r},${gg},${bb})`;
    chars.forEach((ch, i) => g.fillText(ch, i * cell + cell / 2, l * cell + cell / 2 + 1));
  }
  atlas.levels = LEVELS;
  atlas.chars = chars.length;
}

function drawAscii(g, b, w, h, cell) {
  buildAtlas(cell);
  g.fillStyle = layerBg();
  g.fillRect(0, 0, w, h);
  const cols = Math.floor(w / cell), rows = Math.floor(h / cell);
  const k = 1 / (cell * cell);
  const nc = atlas.chars, nl = atlas.levels;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      let sum = 0;
      const y0 = ry * cell, x0 = rx * cell;
      for (let y = y0; y < y0 + cell; y += 2) { const row = y * w; for (let x = x0; x < x0 + cell; x += 2) sum += b[row + x]; }
      const d = sum * k * 4;
      const v = 1 - Math.exp(-d * S.exposure * 1.6);
      const ci = Math.min(nc - 1, Math.floor(v * nc));
      if (ci <= 0) continue;
      const li = Math.min(nl - 1, Math.floor(v * nl));
      g.drawImage(atlas, ci * cell, li * cell, cell, cell, x0, y0, cell, cell);
    }
  }
}

// Vecteurs : des lignes qui suivent les boucles
function strands(time) {
  const r = mulberry32(S.seed * 31 + 5);
  const L = S.lines, out = [];
  const galaxy = S.shape === "galaxie", sphere = S.shape === "sphere";
  prepareFrame(time);
  const K = galaxy ? S.arms : S.rings;
  const M = galaxy ? 140 : 200;
  const F = Math.max(1, S.filaments);
  for (let i = 0; i < L; i++) {
    const k = sphere ? Math.floor(r() * 1000) : i % K;
    const off = sphere
      ? Math.max(-0.999, Math.min(0.999, ((i % F) + 0.5) / F * 2 - 1 + gauss(r) * S.dispersion * 0.2))
      : filamentOffsets[Math.floor(r() * filamentOffsets.length)] + gauss(r) * S.dispersion * 0.35;
    const start = r();
    const pts = new Float32Array((M + 1) * 2);
    NOFLOW = galaxy;
    for (let m = 0; m <= M; m++) {
      // Galaxie : du centre vers l'extérieur (on s'arrête juste avant 1 pour ne pas reboucler)
      posAt(k, galaxy ? m / M * 0.999 : start + m / M, off, time);
      pts[m * 2] = PX; pts[m * 2 + 1] = PY;
    }
    NOFLOW = false;
    out.push({ pts, closed: !galaxy });
  }
  return out;
}

function orbitPaths(time) {
  prepareFrame(time);
  const out = [];
  for (let j = 0; j < S.orbits; j++) {
    const M = 200, pts = new Float32Array((M + 1) * 2);
    for (let m = 0; m <= M; m++) { posAt(ORBIT + j, m / M, 0, time); pts[m * 2] = PX; pts[m * 2 + 1] = PY; }
    out.push({ pts, closed: true });
  }
  return out;
}

function strokePaths(g, list, w, h, color, alpha, lw) {
  const { unit, ox, oy, ca, sa } = transform(w, h);
  g.strokeStyle = color; g.globalAlpha = alpha; g.lineWidth = lw; g.lineJoin = "round";
  for (const s of list) {
    g.beginPath();
    const p = s.pts;
    for (let m = 0; m < p.length / 2; m++) {
      const X = ox + (p[m * 2] * ca - p[m * 2 + 1] * sa) * unit, Y = oy + (p[m * 2] * sa + p[m * 2 + 1] * ca) * unit;
      m ? g.lineTo(X, Y) : g.moveTo(X, Y);
    }
    if (s.closed) g.closePath();
    g.stroke();
  }
  g.globalAlpha = 1;
}

// Glyphes : chaque particule est un caractère, plus petit et plus sombre quand il est loin
let glyphAtlas = null, glyphKey = "";
const GCELL = 96;
function buildGlyphAtlas() {
  const key = S.glyphs + S.c2;
  if (key === glyphKey) return;
  glyphKey = key;
  const chars = [...S.glyphs];
  glyphAtlas = document.createElement("canvas");
  glyphAtlas.width = GCELL * chars.length; glyphAtlas.height = GCELL;
  const g = glyphAtlas.getContext("2d");
  g.font = `500 ${GCELL * 0.8}px "Geist Mono", ui-monospace, monospace`;
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = S.c2;
  chars.forEach((ch, i) => g.fillText(ch, i * GCELL + GCELL / 2, GCELL / 2 + 3));
  glyphAtlas.n = chars.length;
}

const gx = new Float32Array(8000), gy = new Float32Array(8000), gz = new Float32Array(8000), gw = new Float32Array(8000);
const gOrder = new Uint16Array(8000);
function glyphList(time, w, h) {
  const { unit, ox, oy, ca, sa } = transform(w, h);
  prepareFrame(time);
  const n = Math.min(P.main, 8000);
  for (let i = 0; i < n; i++) {
    posAt(P.k[i], P.u[i], P.off[i], time, i);
    gx[i] = ox + (PX * ca - PY * sa) * unit; gy[i] = oy + (PX * sa + PY * ca) * unit; gz[i] = PZ; gw[i] = PW;
    gOrder[i] = i;
  }
  // Du plus loin au plus proche
  const order = Array.from(gOrder.subarray(0, n)).sort((a, b) => gz[a] - gz[b]);
  return order;
}

function drawGlyphs(g, w, h, time) {
  g.fillStyle = layerBg();
  g.fillRect(0, 0, w, h);
  if (S.orbits) strokePaths(g, orbitPaths(time), w, h, S.c1, 0.7, Math.max(1, Math.min(w, h) / 900));
  buildGlyphAtlas();
  const base = S.glyphSize * Math.min(w, h) / 1000;
  const nc = glyphAtlas.n;
  for (const i of glyphList(time, w, h)) {
    const depth = (gz[i] / 0.7 + 1) / 2;
    const size = base * (0.4 + 0.8 * Math.max(0, Math.min(1, depth)));
    const ci = (i * 7 + Math.floor(time * S.flicker * 6 + i * 0.37 * (S.flicker > 0 ? 1 : 0))) % nc;
    g.globalAlpha = Math.min(1, gw[i]);
    g.drawImage(glyphAtlas, ci * GCELL, 0, GCELL, GCELL, gx[i] - size / 2, gy[i] - size / 2, size, size);
  }
  g.globalAlpha = 1;
}

// Aberration chromatique : on sépare l'image en trois calques rouge, vert et bleu,
// le rouge légèrement agrandi et le bleu légèrement réduit, puis on les additionne.
// Tout se fait par composition de canvas, donc sur la carte graphique.
const fx = { src: document.createElement("canvas"), r: document.createElement("canvas"), g: document.createElement("canvas"), b: document.createElement("canvas") };
const grainTile = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d"), im = g.createImageData(256, 256);
  const r = mulberry32(99);
  for (let i = 0; i < im.data.length; i += 4) { const v = r() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0);
  return c;
})();

function postFx(g, w, h) {
  if (S.chroma > 0) {
    for (const c of Object.values(fx)) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    fx.src.getContext("2d").drawImage(g.canvas, 0, 0);
    const k = S.chroma * 0.012;
    const layer = (c, scale, color) => {
      const x = c.getContext("2d");
      // L'image non décalée d'abord, pour que les bords du calque réduit ne restent pas vides
      x.globalCompositeOperation = "copy";
      x.drawImage(fx.src, 0, 0);
      x.globalCompositeOperation = "source-over";
      const sw = w * scale, sh = h * scale;
      x.drawImage(fx.src, (w - sw) / 2, (h - sh) / 2, sw, sh);
      x.globalCompositeOperation = "multiply";
      x.fillStyle = color;
      x.fillRect(0, 0, w, h);
    };
    layer(fx.r, 1 + k, "#ff0000");
    layer(fx.g, 1, "#00ff00");
    layer(fx.b, 1 - k, "#0000ff");
    g.save();
    g.globalCompositeOperation = "copy";
    g.drawImage(fx.r, 0, 0);
    g.globalCompositeOperation = "lighter";
    g.drawImage(fx.g, 0, 0);
    g.drawImage(fx.b, 0, 0);
    g.restore();
  }
  if (S.grain > 0) {
    g.save();
    g.globalCompositeOperation = "overlay";
    g.globalAlpha = Math.min(1, S.grain * 0.6);
    const pat = g.createPattern(grainTile, "repeat");
    const ox = Math.floor(Math.random() * 256), oy = Math.floor(Math.random() * 256);
    g.translate(-ox, -oy);
    g.fillStyle = pat;
    g.fillRect(0, 0, w + 256, h + 256);
    g.restore();
  }
}

function drawVectors(g, w, h, time) {
  g.fillStyle = layerBg();
  g.fillRect(0, 0, w, h);
  const { unit, ox, oy, ca, sa } = transform(w, h);
  const light = isLight(S.bg);
  g.globalCompositeOperation = light ? "multiply" : "lighter";
  const [r, gg, b] = hex(S.c2), [r1, g1, b1] = hex(S.c1);
  const lw = S.lineWidth * Math.min(w, h) / 1000;
  g.lineWidth = lw;
  g.lineJoin = "round";
  for (const [i, s] of strands(time).entries()) {
    const mix = (i % 3) / 2;
    g.strokeStyle = `rgba(${Math.round(r1 + (r - r1) * mix)},${Math.round(g1 + (gg - g1) * mix)},${Math.round(b1 + (b - b1) * mix)},${S.lineAlpha})`;
    g.beginPath();
    const p = s.pts;
    for (let m = 0; m < p.length / 2; m++) {
      const X = ox + (p[m * 2] * ca - p[m * 2 + 1] * sa) * unit, Y = oy + (p[m * 2] * sa + p[m * 2 + 1] * ca) * unit;
      m ? g.lineTo(X, Y) : g.moveTo(X, Y);
    }
    if (s.closed) g.closePath();
    g.stroke();
  }
  if (S.orbits) strokePaths(g, orbitPaths(time), w, h, S.c2, Math.min(1, S.lineAlpha * 2.5), lw * 1.4);
  g.globalCompositeOperation = "source-over";
}

// Halo : l'image réduite (donc floutée) puis ajoutée par-dessus
const haloA = document.createElement("canvas"), haloB = document.createElement("canvas");
const canFilter = (() => { const c = document.createElement("canvas").getContext("2d"); c.filter = "blur(2px)"; return c.filter === "blur(2px)"; })();

function applyHalo(g, src, w, h) {
  if (S.halo <= 0) return;
  const d1 = 3 + S.haloSize * 2, d2 = d1 * 3.5;
  haloA.width = Math.max(1, Math.round(w / d1)); haloA.height = Math.max(1, Math.round(h / d1));
  haloB.width = Math.max(1, Math.round(w / d2)); haloB.height = Math.max(1, Math.round(h / d2));
  const a = haloA.getContext("2d"), b = haloB.getContext("2d");
  a.imageSmoothingQuality = "high"; b.imageSmoothingQuality = "high";
  if (canFilter) a.filter = "blur(2px)";
  a.drawImage(src, 0, 0, haloA.width, haloA.height);
  if (canFilter) b.filter = "blur(2px)";
  b.drawImage(haloA, 0, 0, haloB.width, haloB.height);
  const light = isLight(S.bg);
  g.save();
  g.globalCompositeOperation = light ? "multiply" : "lighter";
  g.imageSmoothingQuality = "high";
  g.globalAlpha = Math.min(1, S.halo);
  g.drawImage(haloA, 0, 0, w, h);
  g.globalAlpha = Math.min(1, S.halo * 0.85);
  g.drawImage(haloB, 0, 0, w, h);
  if (S.halo > 1) { g.globalAlpha = S.halo - 1; g.drawImage(haloB, 0, 0, w, h); }
  g.restore();
}

/* ---------- Image de fond ---------- */
// L'image n'est pas dans les réglages (trop lourde pour le lien de partage) : elle est
// gardée dans IndexedDB. Les particules sont rendues sur un fond noir (ou blanc si la
// palette est claire), puis posées sur l'image en mode « écran » (ou « produit »).
// La couleur de fond sert alors de voile sur l'image.
const BG = { img: null, blob: null, name: "", w: 0, h: 0, url: "", off: false, loading: false, error: "" };
const hasImage = () => !!BG.img && !BG.off;
const layerBg = () => hasImage() ? (isLight(S.bg) ? "#ffffff" : "#000000") : S.bg;

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("loop-wallpaper", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("files", mode);
      const req = fn(tx.objectStore("files"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

async function setBackground(blob, name, persist = true) {
  BG.loading = true; BG.error = "";
  syncPanel();
  let bmp;
  try { bmp = await createImageBitmap(blob); }
  catch (e) {
    BG.loading = false;
    BG.error = `« ${name || "Ce fichier"} » ne peut pas être lu. Essaie un PNG, un JPEG ou un WebP.`;
    syncPanel();
    return;
  }
  // Au-delà de 4 096 pixels, on réduit : c'est assez pour un export 4K et ça reste léger
  const MAX = 4096, k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  if (k < 1) {
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.92));
    bmp = await createImageBitmap(blob);
  }
  if (BG.url) URL.revokeObjectURL(BG.url);
  Object.assign(BG, { img: bmp, blob, name: name || "Image", w: bmp.width, h: bmp.height, url: URL.createObjectURL(blob), loading: false });
  bgKey = "";
  if (persist) {
    try { await idb("readwrite", st => st.put({ blob, name: BG.name }, "background")); }
    catch (e) { toast("Image appliquée, mais elle ne sera pas gardée après rechargement"); }
  }
  changed({ lut: true });
  if (persist) toast("Image de fond appliquée");
}

async function clearBackground() {
  if (BG.img) BG.img.close();
  if (BG.url) URL.revokeObjectURL(BG.url);
  Object.assign(BG, { img: null, blob: null, name: "", w: 0, h: 0, url: "", error: "" });
  bgKey = "";
  try { await idb("readwrite", st => st.delete("background")); } catch (e) {}
  changed({ lut: true });
  toast("Image de fond retirée");
}

async function restoreBackground() {
  try {
    const saved = await idb("readonly", st => st.get("background"));
    if (saved && saved.blob) await setBackground(saved.blob, saved.name, false);
  } catch (e) {}
}

// Place l'image dans un cadre w × h : « remplir » rogne, « adapter » laisse des bandes
function bgRect(w, h) {
  const k = (S.bgFit === "contain" ? Math.min : Math.max)(w / BG.w, h / BG.h);
  const dw = BG.w * k, dh = BG.h * k;
  return [(w - dw) / 2, (h - dh) / 2, dw, dh];
}

function paintBackground(g, w, h) {
  g.fillStyle = S.bg;
  g.fillRect(0, 0, w, h);
  let [x, y, dw, dh] = bgRect(w, h);
  const blur = S.bgBlur * Math.min(w, h) / 1000 * 40;
  if (blur > 0.3 && canFilter) {
    // On agrandit un peu l'image floutée pour que ses bords ne s'estompent pas dans le fond
    if (S.bgFit !== "contain") { x -= blur * 2; y -= blur * 2; dw += blur * 4; dh += blur * 4; }
    g.filter = `blur(${blur.toFixed(1)}px)`;
  }
  g.imageSmoothingQuality = "high";
  g.drawImage(BG.img, x, y, dw, dh);
  g.filter = "none";
  if (S.bgVeil > 0) {
    g.globalAlpha = S.bgVeil;
    g.fillStyle = S.bg;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }
}

// Le fond de l'aperçu est mis en cache : il ne change qu'avec ses réglages
const bgCache = document.createElement("canvas"), bgTmp = document.createElement("canvas");
let bgKey = "";
function composeBackground(g, w, h, cached) {
  if (!hasImage()) return;
  let back = bgCache;
  if (cached) {
    const key = `${w}x${h}|${S.bgFit}|${S.bgVeil}|${S.bgBlur}|${S.bg}`;
    if (key !== bgKey) { bgCache.width = w; bgCache.height = h; paintBackground(bgCache.getContext("2d"), w, h); bgKey = key; }
  } else {
    back = document.createElement("canvas");
    back.width = w; back.height = h;
    paintBackground(back.getContext("2d"), w, h);
  }
  const tmp = cached ? bgTmp : document.createElement("canvas");
  if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h; }
  tmp.getContext("2d").drawImage(g.canvas, 0, 0);
  g.save();
  g.globalCompositeOperation = "copy";
  g.drawImage(back, 0, 0);
  g.globalCompositeOperation = isLight(S.bg) ? "multiply" : "screen";
  g.drawImage(tmp, 0, 0);
  g.restore();
}

const blobToDataURL = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });

/* ---------- Carte graphique ---------- */
// Le mode Particules passe par WebGL2 quand c'est possible (profil haute performance,
// donc la carte dédiée si la machine en a une). Sinon, rendu par le processeur.
let gpu = null, gpuError = "";
function startGpu() {
  if (gpu) return gpu;
  try { gpu = createGpu(); gpuError = gpu ? "" : "WebGL2 ou les textures flottantes ne sont pas disponibles"; }
  catch (e) { gpu = null; gpuError = e.message; }
  if (gpu) gpu.canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); gpu = null; gpuError = "Contexte WebGL perdu"; toast("Carte graphique indisponible, rendu par le processeur"); });
  return gpu;
}
const useGpu = () => !!gpu && prefs.gpu && !gpu.lost();
const gpuSrc = () => ({ S, P, curve, normals, curveVersion, noise: noiseT, lut, lutVersion, DMAX, orbitTilt, transform });

// Nombre d'images passées et poids de départ pour un tampon complet (traînées comprises)
function primeParams(w, h) {
  const samples = S.trail > 0 ? Math.round(6 + S.trail * 40) : 1;
  const norm = 1 - Math.pow(S.trail, samples);
  return { samples, base: particleWeight(w, h) * (1 - S.trail) / Math.max(norm, 1e-6) };
}

/* ---------- Image par image ---------- */
function resize() {
  const [fw, fh] = formatSize(S.format);
  const rect = stage.getBoundingClientRect();
  // Marge du bas plus grande : la barre flottante ne doit pas couvrir l'aperçu
  const pad = 24, padBottom = 72;
  const scale = Math.min((rect.width - pad * 2) / fw, (rect.height - pad - padBottom) / fh);
  const cssW = Math.max(50, Math.floor(fw * scale)), cssH = Math.max(50, Math.floor(fh * scale));
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  // Aperçu limité à ~2,2 millions de pixels pour rester fluide
  let dpr = Math.min(devicePixelRatio || 1, 1.5);
  const maxPx = 2.2e6;
  if (cssW * cssH * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (cssW * cssH));
  W = Math.round(cssW * dpr); H = Math.round(cssH * dpr);
  canvas.width = W; canvas.height = H;
  buf = new Float32Array(W * H);
  img = ctx.createImageData(W, H);
  img32 = new Uint32Array(img.data.buffer);
  $("draw").width = W; $("draw").height = H;
  $("draw").style.width = cssW + "px"; $("draw").style.height = cssH + "px";
  $("frame-size").textContent = `${fw} × ${fh}`;
}

// Les nœuds remplacent temporairement certains réglages le temps d'une image
const CURVE_KEYS = ["petals", "lissA", "lissB", "starN", "starDepth"];
let editor = null, timeline = null;
const lastApplied = {};
let inOverrides = false;
function controlOf(key) {
  for (const sec of CONTROLS) for (const c of sec.items) if (c.key === key) return c;
  return null;
}
function withOverrides(time, fn) {
  // Déjà dans un rendu remplacé (export, tampon en pause) : on ne remplace pas deux fois
  if (inOverrides) { fn(); return null; }
  const kf = timeline ? timeline.evaluate(time) : null;
  const nd = editor ? editor.evaluate(time) : null;
  const ov = kf || nd ? { ...kf, ...nd } : null;
  if (!ov || !Object.keys(ov).length) { fn(); return ov; }
  const saved = {};
  let curveDirty = false, lutDirty = false;
  for (const [key, raw] of Object.entries(ov)) {
    const c = controlOf(key);
    if (!c || c.rebuild) continue;
    let v = raw;
    if (c.type === "color") { if (typeof v !== "string") continue; }
    else {
      v = Math.max(c.min, Math.min(c.max, +raw));
      if (c.step >= 1) v = Math.round(v);
    }
    saved[key] = S[key];
    S[key] = v;
    if (lastApplied[key] !== v) {
      if (CURVE_KEYS.includes(key)) curveDirty = true;
      if (c.lut) lutDirty = true;
      lastApplied[key] = v;
    }
  }
  if (curveDirty) buildCurve();
  if (lutDirty) { buildLut(); atlasKey = ""; glyphKey = ""; }
  inOverrides = true;
  try { fn(); } finally { Object.assign(S, saved); inOverrides = false; }
  return ov;
}

let last = performance.now(), msAvg = 16;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) t += dt;
  const t0 = performance.now();
  const ov = withOverrides(t, () => renderFrame());
  if (editor) editor.tick(ov);
  if (timeline && !$("timeline").hidden) timeline.tick();
  if (frameCount % 6 === 0) syncAnimated(ov);

  msAvg = msAvg * 0.9 + (performance.now() - t0) * 0.1;
  if (frameCount++ % 15 === 0) $("perf").textContent = `${msAvg.toFixed(1)} ms`;
  requestAnimationFrame(frame);
}

function renderFrame() {
  if (S.mode === "vecteurs") {
    drawVectors(ctx, W, H, t);
  } else if (S.mode === "glyphes") {
    drawGlyphs(ctx, W, H, t);
  } else if (S.mode === "points" && useGpu()) {
    // Sur la carte graphique : estompage, dépôt et couleurs, puis copie dans l'aperçu
    ctx.drawImage(gpu.frame(gpuSrc(), W, H, t, particleWeight(W, H) * (1 - S.trail), S.trail, !paused), 0, 0);
  } else {
    // Traînées : le tampon s'estompe au lieu d'être effacé
    if (!paused) {
      const keep = S.trail;
      for (let i = 0; i < buf.length; i++) buf[i] *= keep;
      splat(buf, W, H, t, particleWeight(W, H) * (1 - S.trail));
    }
    if (S.mode === "ascii") drawAscii(ctx, buf, W, H, Math.max(4, Math.round(S.charSize * W / canvas.clientWidth)));
    else { toneMap(buf, img32); ctx.putImageData(img, 0, 0); }
  }
  applyHalo(ctx, canvas, W, H);
  composeBackground(ctx, W, H, true);
  postFx(ctx, W, H);
}
let frameCount = 0;

// Remplit le tampon d'un coup (après un changement de réglage, ou en pause)
function primeBuffer(b, w, h, time) {
  withOverrides(time, () => primeRaw(b, w, h, time));
}
function primeRaw(b, w, h, time) {
  // Même résultat que l'aperçu en direct : chaque image passée pèse trail^i
  const { samples, base } = primeParams(w, h);
  if (b === buf && S.mode === "points" && useGpu()) { gpu.prime(gpuSrc(), w, h, time, samples, base, S.trail); return; }
  b.fill(0);
  for (let i = 0; i < samples; i++) splat(b, w, h, time - i / 60, base * Math.pow(S.trail, i));
}

/* ---------- Export ---------- */
async function exportPNG() {
  const [w, h] = formatSize(S.format);
  toggleExportMenu(false);
  const btn = $("export");
  btn.disabled = true;
  btn.classList.add("busy");
  btn.querySelector("span").textContent = "Rendu en cours";
  await new Promise(r => setTimeout(r, 30));
  try {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    let blobDone;
    withOverrides(t, () => { blobDone = renderStill(c, g, w, h); });
    const blob = await blobDone;
    download(blob, `loop-${S.shape}-${w}x${h}.png`);
    toast(`PNG ${w} × ${h} exporté`);
  } catch (err) {
    toast("L'export a échoué : résolution trop grande pour ce navigateur ?");
  } finally {
    if (gpuResized) { gpuResized = false; primeBuffer(buf, W, H, t); }
    btn.disabled = false;
    btn.classList.remove("busy");
    btn.querySelector("span").textContent = "Exporter";
  }
}

let gpuResized = false;
function renderStill(c, g, w, h) {
  {
    // Les caractères et les traits gardent la même taille relative que dans l'aperçu
    const ratio = w / canvas.clientWidth;
    if (S.mode === "vecteurs") {
      drawVectors(g, w, h, t);
    } else if (S.mode === "glyphes") {
      drawGlyphs(g, w, h, t);
    } else if (S.mode === "points" && useGpu() && Math.max(w, h) <= gpu.maxSize) {
      const { samples, base } = primeParams(w, h);
      g.drawImage(gpu.prime(gpuSrc(), w, h, t, samples, base, S.trail), 0, 0);
      gpuResized = true;
    } else {
      const b = new Float32Array(w * h);
      primeBuffer(b, w, h, t);
      if (S.mode === "ascii") {
        lutRGB.length || buildLut();
        atlasKey = "";
        drawAscii(g, b, w, h, Math.max(4, Math.round(S.charSize * ratio)));
        atlasKey = "";
      } else {
        const im = g.createImageData(w, h);
        toneMap(b, new Uint32Array(im.data.buffer));
        g.putImageData(im, 0, 0);
      }
    }
    applyHalo(g, c, w, h);
    composeBackground(g, w, h, false);
    postFx(g, w, h);
    return new Promise(r => c.toBlob(r, "image/png"));
  }
}

async function exportSVG() {
  toggleExportMenu(false);
  const bgData = hasImage() ? await blobToDataURL(BG.blob) : "";
  withOverrides(t, () => exportSVGNow(bgData));
}
function exportSVGNow(bgData) {
  const [w, h] = formatSize(S.format);
  const { unit, ox, oy, ca, sa } = transform(w, h);
  const [r, gg, b] = hex(S.c2), [r1, g1, b1] = hex(S.c1);
  const lw = (S.lineWidth * Math.min(w, h) / 1000).toFixed(2);
  const list = S.mode === "glyphes" ? [] : strands(t);
  const paths = list.map((s, i) => {
    const mix = (i % 3) / 2;
    const col = `rgb(${Math.round(r1 + (r - r1) * mix)},${Math.round(g1 + (gg - g1) * mix)},${Math.round(b1 + (b - b1) * mix)})`;
    let d = "";
    const p = s.pts;
    for (let m = 0; m < p.length / 2; m++) {
      const X = ox + (p[m * 2] * ca - p[m * 2 + 1] * sa) * unit, Y = oy + (p[m * 2] * sa + p[m * 2 + 1] * ca) * unit;
      d += (m ? "L" : "M") + X.toFixed(1) + " " + Y.toFixed(1);
    }
    return `<path d="${d}${s.closed ? "Z" : ""}" stroke="${col}"/>`;
  }).join("\n    ");
  const blend = isLight(S.bg) ? "multiply" : "screen";
  const toD = s => { let d = ""; const p = s.pts; for (let m = 0; m < p.length / 2; m++) { const X = ox + (p[m * 2] * ca - p[m * 2 + 1] * sa) * unit, Y = oy + (p[m * 2] * sa + p[m * 2 + 1] * ca) * unit; d += (m ? "L" : "M") + X.toFixed(1) + " " + Y.toFixed(1); } return d + "Z"; };
  const orbits = S.orbits ? `<g fill="none" stroke="${S.c2}" stroke-width="${(lw * 1.4).toFixed(2)}" stroke-opacity="0.7">${orbitPaths(t).map(s => `<path d="${toD(s)}"/>`).join("")}</g>` : "";
  let glyphs = "";
  if (S.mode === "glyphes") {
    const chars = [...S.glyphs], base = S.glyphSize * Math.min(w, h) / 1000;
    glyphs = `<g font-family="Geist Mono, ui-monospace, monospace" font-weight="500" text-anchor="middle" dominant-baseline="central" fill="${S.c2}">` +
      glyphList(t, w, h).map(i => {
        const depth = Math.max(0, Math.min(1, (gz[i] / 0.7 + 1) / 2));
        const size = base * (0.4 + 0.8 * depth) * 0.8;
        const ch = chars[(i * 7 + Math.floor(t * S.flicker * 6 + i * 0.37 * (S.flicker > 0 ? 1 : 0))) % chars.length].replace(/[<&>]/g, c => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;" }[c]));
        return `<text x="${gx[i].toFixed(1)}" y="${gy[i].toFixed(1)}" font-size="${size.toFixed(1)}" fill-opacity="${Math.min(1, gw[i]).toFixed(2)}">${ch}</text>`;
      }).join("") + "</g>";
  }
  const blur = (Math.min(w, h) / 1000 * (4 + S.haloSize * 6)).toFixed(1);
  let backdrop = "";
  if (bgData) {
    const [x, y, dw, dh] = bgRect(w, h);
    const bb = S.bgBlur * Math.min(w, h) / 1000 * 40;
    backdrop = `<svg x="0" y="0" width="${w}" height="${h}"><image href="${bgData}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${dw.toFixed(1)}" height="${dh.toFixed(1)}" preserveAspectRatio="none"${bb > 0.3 ? ` filter="url(#bgblur)"` : ""}/></svg>
  ${S.bgVeil > 0 ? `<rect width="100%" height="100%" fill="${S.bg}" fill-opacity="${S.bgVeil}"/>` : ""}`;
    if (bb > 0.3) backdrop = backdrop.replace("<svg x", `<defs><filter id="bgblur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${bb.toFixed(1)}"/></filter></defs>\n  <svg x`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><filter id="halo" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>
  <rect width="100%" height="100%" fill="${S.bg}"/>
  ${backdrop}
  ${S.halo > 0 ? `<g fill="none" stroke-width="${(lw * 3).toFixed(2)}" stroke-opacity="${Math.min(1, S.lineAlpha * S.halo)}" filter="url(#halo)" style="mix-blend-mode:${blend}">\n    ${paths}\n  </g>` : ""}
  <g fill="none" stroke-width="${lw}" stroke-opacity="${S.lineAlpha}" stroke-linejoin="round" style="mix-blend-mode:${blend}">
    ${paths}
  </g>
  ${orbits}
  ${glyphs}
</svg>`;
  download(new Blob([svg], { type: "image/svg+xml" }), `loop-${S.shape}-${w}x${h}.svg`);
  toast(`SVG ${w} × ${h} exporté`);
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

let toastT = 0;
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => $("toast").classList.remove("on"), 2600);
}

/* ---------- Panneau de réglages ---------- */
const is = (...shapes) => () => shapes.includes(S.shape);
const not = (...shapes) => () => !shapes.includes(S.shape);
const mode = m => () => S.mode === m;

const CONTROLS = [
  { title: "Préréglages", items: [{ key: "preset", type: "presets" }] },
  { title: "Forme", items: [
    { key: "shape", type: "chips", options: [["galaxie", "Galaxie"], ["sphere", "Sphère"], ["cercle", "Cercle"], ["infini", "Infini"], ["fleur", "Fleur"], ["lissajous", "Lissajous"], ["coeur", "Cœur"], ["etoile", "Étoile"], ["libre", "Dessin libre"]] },
    { type: "button", id: "draw-btn", label: "Dessiner une forme", icon: "ph-pencil-simple-line", action: () => startDrawing() },
    { key: "arms", label: "Bras", min: 1, max: 8, step: 1, show: is("galaxie") },
    { key: "twist", label: "Enroulement", min: 0, max: 6, step: 0.05, show: is("galaxie") },
    { key: "petals", label: "Pétales", min: 2, max: 12, step: 1, show: is("fleur") },
    { key: "lissA", label: "Fréquence X", min: 1, max: 7, step: 1, show: is("lissajous") },
    { key: "lissB", label: "Fréquence Y", min: 1, max: 7, step: 1, show: is("lissajous") },
    { key: "starN", label: "Branches", min: 3, max: 12, step: 1, show: is("etoile") },
    { key: "starDepth", label: "Creux", min: 0, max: 0.85, step: 0.01, show: is("etoile") },
    { key: "tilt", label: "Inclinaison", min: -1.5, max: 1.5, step: 0.01, show: () => S.shape === "sphere" }
  ] },
  { title: "Boucles", items: [
    { key: "rings", label: "Boucles imbriquées", min: 1, max: 16, step: 1, show: not("galaxie") },
    { key: "inner", label: "Taille de la plus petite", min: 0.05, max: 1, step: 0.01, show: not("galaxie") },
    { key: "ringTwist", label: "Décalage entre boucles", min: 0, max: 1.6, step: 0.01, show: not("galaxie") },
    { key: "alternate", label: "Sens alternés", type: "toggle", show: not("galaxie") },
    { key: "count", label: "Particules", min: 200, max: 200000, step: 100, fmt: v => v >= 10000 ? `${Math.round(v / 1000)} k` : String(v), rebuild: true },
    { key: "filaments", label: "Filaments", min: 1, max: 80, step: 1, rebuild: true },
    { key: "width", label: "Épaisseur", min: 0, max: 1, step: 0.005 },
    { key: "dispersion", label: "Dispersion", min: 0, max: 1, step: 0.01, rebuild: true },
    { key: "dust", label: "Poussière d'étoiles", min: 0, max: 0.4, step: 0.01, rebuild: true },
    { key: "orbits", label: "Anneaux en orbite", min: 0, max: 5, step: 1, rebuild: true }
  ] },
  { title: "Mouvement", items: [
    { key: "flow", label: "Vitesse le long de la boucle", min: -0.2, max: 0.2, step: 0.001 },
    { key: "rot", label: "Rotation", min: -0.2, max: 0.2, step: 0.001 },
    { key: "turb", label: "Turbulence", min: 0, max: 0.5, step: 0.005 },
    { key: "turbScale", label: "Échelle de la turbulence", min: 0.3, max: 8, step: 0.05 },
    { key: "evolve", label: "Évolution", min: 0, max: 1, step: 0.01 },
    { key: "trail", label: "Traînées", min: 0, max: 0.97, step: 0.01 }
  ] },
  { title: "Rendu", items: [
    { key: "mode", type: "chips", options: [["points", "Particules"], ["ascii", "ASCII"], ["vecteurs", "Vecteurs"], ["glyphes", "Glyphes"]] },
    { key: "size", label: "Taille des points", min: 1, max: 3, step: 1, show: mode("points") },
    { key: "exposure", label: "Luminosité", min: 0.2, max: 4, step: 0.05, lut: true },
    { key: "charSize", label: "Taille des caractères", min: 6, max: 28, step: 1, show: mode("ascii") },
    { key: "charset", type: "chips", options: Object.entries(CHARSETS).map(([k, v]) => [v, k[0].toUpperCase() + k.slice(1)]), show: mode("ascii") },
    { key: "lines", label: "Lignes", min: 10, max: 800, step: 10, show: mode("vecteurs") },
    { key: "lineWidth", label: "Épaisseur du trait", min: 0.2, max: 4, step: 0.05, show: mode("vecteurs") },
    { key: "lineAlpha", label: "Opacité du trait", min: 0.02, max: 1, step: 0.01, show: mode("vecteurs") },
    { key: "glyphs", type: "chips", options: [["0123456789", "Chiffres"], ["01", "Binaire"], ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Lettres"], ["+×÷=<>*#", "Symboles"], ["アイウエオカキクケコサシスセソ", "Katakana"]], show: mode("glyphes") },
    { key: "glyphSize", label: "Taille des glyphes", min: 4, max: 80, step: 1, show: mode("glyphes") },
    { key: "flicker", label: "Scintillement", min: 0, max: 2, step: 0.01, show: mode("glyphes") }
  ] },
  { title: "Effets", items: [
    { key: "halo", label: "Halo", min: 0, max: 1.6, step: 0.01 },
    { key: "haloSize", label: "Taille du halo", min: 0.3, max: 5, step: 0.05 },
    { key: "chroma", label: "Aberration chromatique", min: 0, max: 1.5, step: 0.01 },
    { key: "grain", label: "Grain", min: 0, max: 1, step: 0.01 }
  ] },
  { title: "Couleurs", items: [
    { key: "palette", type: "swatches" },
    { key: "bg", label: "Fond", type: "color", lut: true },
    { key: "c1", label: "Couleur moyenne", type: "color", lut: true },
    { key: "c2", label: "Couleur vive", type: "color", lut: true }
  ] },
  { title: "Image de fond", items: [
    { type: "bgimage", id: "bg-image" },
    { key: "bgFit", type: "chips", options: [["cover", "Remplir"], ["contain", "Adapter"]], show: hasImage },
    { key: "bgVeil", label: "Voile de la couleur de fond", min: 0, max: 1, step: 0.01, show: hasImage },
    { key: "bgBlur", label: "Flou", min: 0, max: 1, step: 0.01, show: hasImage }
  ] },
  { title: "Cadrage", items: [
    { key: "zoom", label: "Zoom", min: 0.2, max: 4, step: 0.01 },
    { key: "cx", label: "Position X", min: -1, max: 1, step: 0.005 },
    { key: "cy", label: "Position Y", min: -1, max: 1, step: 0.005 },
    { key: "angle", label: "Angle", min: 0, max: 360, step: 1, fmt: v => `${v}°` }
  ] }
];

const fmtNum = v => Math.abs(v) >= 100 ? String(Math.round(v)) : (+v.toFixed(3)).toString();

// Les sections sont regroupées en onglets ; le rail à droite du panneau passe de l'un à l'autre
const TABS = [
  { id: "styles", label: "Styles", icon: "ph-squares-four", sections: ["Préréglages"], extra: "keys" },
  { id: "forme", label: "Forme", icon: "ph-shapes", sections: ["Forme", "Boucles"] },
  { id: "mouvement", label: "Mouvement", icon: "ph-wind", sections: ["Mouvement"] },
  { id: "rendu", label: "Rendu", icon: "ph-paint-brush", sections: ["Rendu", "Effets"] },
  { id: "couleurs", label: "Couleurs", icon: "ph-palette", sections: ["Couleurs", "Image de fond"] },
  { id: "cadrage", label: "Cadrage", icon: "ph-crop", sections: ["Cadrage"] }
];
let tab = "styles";
try { tab = localStorage.getItem("loop-tab") || tab; } catch (e) {}
if (!TABS.some(x => x.id === tab)) tab = "styles";


// Losange à côté d'un réglage animable : pose ou retire une image clé à l'instant courant
const kfButton = c => `<button type="button" class="kf" data-kf="${c.key}" aria-label="Image clé pour ${c.label}" title="Image clé à l'instant courant"><i class="ph ph-diamond"></i></button>`;
$("controls").addEventListener("click", e => {
  const b = e.target.closest(".kf");
  if (!b) return;
  e.preventDefault();
  const key = b.dataset.kf;
  const wasAnimated = timeline.isAnimated(key);
  timeline.toggleKey(key, currentValue(key));
  if (!wasAnimated && timeline.isAnimated(key)) {
    toggleTimeline(true);
    toast(`${controlOf(key).label} est animé : déplace la tête de lecture et change la valeur pour poser d'autres clés`);
  }
  syncAnimated();
});

// Valeur affichée d'un réglage : animée si une piste ou un nœud le pilote
let lastOv = null;
function currentValue(key) {
  if (lastOv && key in lastOv) {
    const c = controlOf(key);
    if (c.type === "color") return lastOv[key];
    let v = Math.max(c.min, Math.min(c.max, +lastOv[key]));
    return c.step >= 1 ? Math.round(v) : v;
  }
  return S[key];
}

// Les réglages animés suivent la lecture (environ 10 fois par seconde)
function syncAnimated(ov = lastOv) {
  lastOv = ov;
  if (!timeline) return;
  for (const b of document.querySelectorAll("#controls .kf")) {
    const key = b.dataset.kf, anim = timeline.isAnimated(key), on = anim && timeline.hasKeyAt(key);
    b.classList.toggle("anim", anim);
    b.querySelector("i").className = on ? "ph-fill ph-diamond" : "ph ph-diamond";
  }
  if (!ov) return;
  for (const key of Object.keys(ov)) {
    const row = document.querySelector(`.ctl[data-key="${key}"]`);
    if (!row || row.hidden) continue;
    const c = controlOf(key), input = row.querySelector("input");
    if (!input || document.activeElement === input) continue;
    const v = currentValue(key);
    if (c.type === "color") { input.value = v; continue; }
    input.value = v;
    row.querySelector("output").textContent = c.fmt ? c.fmt(v) : fmtNum(v);
    input.style.setProperty("--p", `${(v - c.min) / (c.max - c.min) * 100}%`);
  }
}

function controlRow(c) {
  const row = document.createElement("div");
  row.className = "ctl";
  row.dataset.key = c.key || c.id;
  if (c.type === "presets") {
    row.innerHTML = `<div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" class="preset" data-v="${k}"><span class="thumb"><img alt="" data-thumb="${k}"></span><span>${p.name}</span></button>`).join("")}</div>`;
    row.addEventListener("click", e => {
      const b = e.target.closest(".preset"); if (!b) return;
      S = { ...presetSettings(b.dataset.v), format: S.format, freehand: S.freehand, bgFit: S.bgFit, bgVeil: S.bgVeil, bgBlur: S.bgBlur };
      changed({ curve: true, rebuild: true, lut: true });
      toast(PRESETS[b.dataset.v].name);
    });
  } else if (c.type === "chips") {
    row.innerHTML = `<div class="chips">${c.options.map(([v, l]) => `<button type="button" class="chip" data-v="${v.replace(/"/g, "&quot;")}">${l}</button>`).join("")}</div>`;
    row.addEventListener("click", e => {
      const b = e.target.closest(".chip"); if (!b) return;
      set(c.key, b.dataset.v, { rebuild: c.key !== "bgFit", curve: c.key === "shape", lut: c.key === "charset" || c.key === "glyphs" });
    });
  } else if (c.type === "swatches") {
    row.innerHTML = `<div class="swatches">${Object.entries(PALETTES).map(([k, p]) => `<button type="button" class="sw" data-v="${k}" title="${k}" aria-label="Palette ${k}" style="--a:${p[0]};--b:${p[1]};--c:${p[2]}"></button>`).join("")}</div>`;
    row.addEventListener("click", e => {
      const b = e.target.closest(".sw"); if (!b) return;
      const [bg, c1, c2] = PALETTES[b.dataset.v];
      Object.assign(S, { palette: b.dataset.v, bg, c1, c2, preset: "" });
      changed({ lut: true });
    });
  } else if (c.type === "color") {
    row.innerHTML = `<label class="color"><span class="lbl">${kfButton(c)}<span>${c.label}</span></span><input type="color" value="${S[c.key]}"></label>`;
    row.querySelector("input").addEventListener("input", e => { S.palette = ""; set(c.key, e.target.value, { lut: true }); });
  } else if (c.type === "toggle") {
    row.innerHTML = `<label class="toggle"><span>${c.label}</span><input type="checkbox"><i></i></label>`;
    row.querySelector("input").addEventListener("change", e => set(c.key, e.target.checked, {}));
  } else if (c.type === "button") {
    row.innerHTML = `<button type="button" class="btn wide" id="${c.id}"><i class="ph ${c.icon}"></i>${c.label}</button>`;
    row.querySelector("button").addEventListener("click", c.action);
  } else if (c.type === "bgimage") {
    // Rempli par syncPanel selon qu'une image est chargée ou non
    row.addEventListener("click", e => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "pick") $("bg-file").click();
      else if (act.dataset.act === "clear") clearBackground();
    });
  } else {
    row.innerHTML = `<div class="ctl-head"><span class="lbl">${c.rebuild ? "" : kfButton(c)}<label for="r-${c.key}">${c.label}</label></span><output></output></div><input id="r-${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step}">`;
    const input = row.querySelector("input");
    input.addEventListener("input", () => set(c.key, +input.value, { rebuild: c.rebuild, curve: CURVE_KEYS.includes(c.key), lut: c.lut }));
  }
  return row;
}

function buildPanel() {
  const panel = $("controls"), rail = $("tabs");
  panel.innerHTML = "";
  rail.querySelectorAll(".tab[role=tab]").forEach(b => b.remove());
  const foot = rail.querySelector(".rail-foot");
  for (const tb of TABS) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "tab"; btn.setAttribute("role", "tab");
    btn.id = `tab-${tb.id}`; btn.dataset.tab = tb.id;
    btn.setAttribute("aria-controls", `pane-${tb.id}`);
    btn.innerHTML = `<i class="ph ${tb.icon}"></i>${tb.label}`;
    btn.addEventListener("click", () => showTab(tb.id));
    rail.insertBefore(btn, foot);

    const pane = document.createElement("div");
    pane.className = "tabpane"; pane.id = `pane-${tb.id}`; pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", `tab-${tb.id}`);
    const secs = CONTROLS.filter(sec => tb.sections.includes(sec.title));
    const titled = secs.length + (tb.extra ? 1 : 0) > 1;
    for (const [i, sec] of secs.entries()) {
      const g = document.createElement("section");
      g.className = "group";
      g.style.setProperty("--i", i);
      if (titled) g.innerHTML = `<h3>${sec.title}</h3>`;
      for (const c of sec.items) g.appendChild(controlRow(c));
      pane.appendChild(g);
    }
    if (tb.extra === "keys") {
      const g = document.createElement("section");
      g.className = "group";
      g.style.setProperty("--i", secs.length);
      g.innerHTML = `<h3>Raccourcis</h3><div class="shortcuts"></div><button type="button" class="btn wide" data-open-settings><i class="ph ph-keyboard"></i>Modifier les raccourcis</button>`;
      g.querySelector("[data-open-settings]").addEventListener("click", () => openSettings());
      pane.appendChild(g);
    }
    panel.appendChild(pane);
  }
  showTab(tab, true);
  syncPanel();
}

function showTab(id, quiet) {
  tab = id;
  try { localStorage.setItem("loop-tab", id); } catch (e) {}
  const tb = TABS.find(x => x.id === id);
  $("tab-title").textContent = tb.label;
  for (const x of TABS) {
    $(`tab-${x.id}`).setAttribute("aria-selected", x.id === id);
    $(`tab-${x.id}`).tabIndex = x.id === id ? 0 : -1;
    $(`pane-${x.id}`).hidden = x.id !== id;
  }
  // Relance la cascade d'apparition des groupes
  for (const g of $(`pane-${id}`).querySelectorAll(".group")) { g.style.animation = "none"; void g.offsetWidth; g.style.animation = ""; }
  if (!quiet) $("controls").scrollTop = 0;
}

// Flèches haut et bas dans le rail, comme une vraie liste d'onglets
$("tabs").addEventListener("keydown", e => {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key) || !e.target.dataset.tab) return;
  e.preventDefault();
  const i = TABS.findIndex(x => x.id === tab), d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
  const next = TABS[(i + d + TABS.length) % TABS.length].id;
  showTab(next);
  $(`tab-${next}`).focus();
});

function syncPanel() {
  for (const sec of CONTROLS) for (const c of sec.items) {
    const row = document.querySelector(`.ctl[data-key="${c.key || c.id}"]`);
    if (!row) continue;
    row.hidden = c.show ? !c.show() : false;
    if (c.type === "presets") row.querySelectorAll(".preset").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === S.preset));
    else if (c.type === "chips") row.querySelectorAll(".chip").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === String(S[c.key])));
    else if (c.type === "swatches") row.querySelectorAll(".sw").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === S.palette));
    else if (c.type === "color") row.querySelector("input").value = S[c.key];
    else if (c.type === "toggle") row.querySelector("input").checked = !!S[c.key];
    else if (c.type === "bgimage") {
      const key = BG.loading ? "loading" : (BG.img ? BG.url : "none") + BG.error;
      if (row.dataset.state === key) continue;
      row.dataset.state = key;
      row.innerHTML = BG.loading
        ? `<div class="pick loading" aria-busy="true"><i class="ph ph-image-square"></i><span>Chargement de l'image</span><small>Réduction à 4 096 pixels si besoin</small></div>`
        : BG.img
        ? `<div class="bgfile"><img src="${BG.url}" alt=""><div><b></b><small>${BG.w} × ${BG.h}</small></div><span class="btns"><button type="button" class="btn icon ghost" data-act="pick" title="Remplacer l'image" aria-label="Remplacer l'image"><i class="ph ph-arrows-clockwise"></i></button><button type="button" class="btn icon ghost" data-act="clear" title="Retirer l'image" aria-label="Retirer l'image"><i class="ph ph-trash"></i></button></span></div>`
        : `<button type="button" class="pick" data-act="pick"><i class="ph ph-image-square"></i><span>Choisir une image</span><small>ou glisse-la sur l'aperçu, ou colle-la</small></button>`;
      if (BG.error) {
        row.insertAdjacentHTML("beforeend", `<p class="field-error" role="alert"><i class="ph ph-warning-circle"></i><span></span></p>`);
        row.querySelector(".field-error span").textContent = BG.error;
      }
      if (BG.img && !BG.loading) row.querySelector("b").textContent = BG.name;
    }
    else if (c.type !== "button") {
      const input = row.querySelector("input");
      input.value = S[c.key];
      row.querySelector("output").textContent = c.fmt ? c.fmt(S[c.key]) : fmtNum(S[c.key]);
      const p = (S[c.key] - c.min) / (c.max - c.min) * 100;
      input.style.setProperty("--p", `${p}%`);
    }
  }
  $("format").value = S.format;
  $("png-size").textContent = `${formatSize(S.format).join(" × ")}, ${FORMATS[S.format][0].toLowerCase()}`;
  $("pause").querySelector("i").className = paused ? "ph-fill ph-play" : "ph-fill ph-pause";
  $("pause").setAttribute("aria-label", paused ? "Lecture" : "Pause");
  $("pause").title = (paused ? "Lecture" : "Pause") + hintOf("pause");
  $("live").classList.toggle("off", paused);
}

let rebuildT = 0;
function set(key, value, opts) {
  S[key] = value;
  S.preset = "";
  if (timeline && timeline.isAnimated(key)) { timeline.setKey(key, timeline.now(), value); timeline.render(); }
  changed(opts);
}

function changed({ rebuild, curve: rc, lut: rl } = {}) {
  if (rc) buildCurve();
  if (rl) { buildLut(); atlasKey = ""; glyphKey = ""; }
  if (rebuild || rc) {
    // Reconstruction différée pour garder le curseur fluide
    clearTimeout(rebuildT);
    rebuildT = setTimeout(() => { buildParticles(); if (paused) primeBuffer(buf, W, H, t); }, 60);
  }
  if (paused) setTimeout(() => primeBuffer(buf, W, H, t), 70);
  syncPanel();
  saveSettings();
  if ((rebuild || rc || rl) && editor) editor.refresh();
}

/* ---------- Dessin libre ---------- */
const drawCanvas = $("draw");
let drawing = null;

function startDrawing() {
  stage.classList.add("drawing");
  $("draw-hint").hidden = false;
  drawing = [];
  const g = drawCanvas.getContext("2d");
  g.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
}

function stopDrawing(cancel) {
  stage.classList.remove("drawing");
  $("draw-hint").hidden = true;
  drawCanvas.getContext("2d").clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  if (!cancel && drawing && drawing.length > 12) {
    // Lissage, puis rééchantillonnage à 96 points
    const pts = drawing;
    const sm = pts.map((p, i) => {
      let x = 0, y = 0, n = 0;
      for (let k = -3; k <= 3; k++) { const q = pts[(i + k + pts.length) % pts.length]; x += q[0]; y += q[1]; n++; }
      return [x / n, y / n];
    });
    const lens = [0];
    for (let i = 1; i <= sm.length; i++) { const a = sm[i - 1], b = sm[i % sm.length]; lens.push(lens[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = lens[lens.length - 1], N = 96, out = [];
    let j = 0;
    for (let i = 0; i < N; i++) {
      const target = i / N * total;
      while (j < sm.length - 1 && lens[j + 1] < target) j++;
      const a = sm[j], b = sm[(j + 1) % sm.length], k = (target - lens[j]) / ((lens[j + 1] - lens[j]) || 1);
      out.push(+(a[0] + (b[0] - a[0]) * k).toFixed(3), +(a[1] + (b[1] - a[1]) * k).toFixed(3));
    }
    S.freehand = out;
    S.shape = "libre";
    changed({ curve: true, rebuild: true });
    toast("Forme enregistrée");
  } else if (!cancel) {
    toast("Trace trop courte : dessine une boucle plus grande, d'un seul trait");
  }
  drawing = null;
}

function drawPos(e) {
  const r = drawCanvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
  // En coordonnées de la forme (cadrage inclus), pour que la forme apparaisse là où on l'a tracée
  const { unit, ox, oy, ca, sa } = transform(W, H);
  const dx = (x - ox) / unit, dy = (y - oy) / unit;
  return { px: x, py: y, n: [dx * ca + dy * sa, -dx * sa + dy * ca] };
}

drawCanvas.addEventListener("pointerdown", e => {
  if (!drawing) return;
  drawCanvas.setPointerCapture(e.pointerId);
  drawing.length = 0;
  drawing.active = true;
  const p = drawPos(e);
  drawing.push(p.n);
  const g = drawCanvas.getContext("2d");
  g.clearRect(0, 0, W, H);
  g.strokeStyle = S.c2; g.lineWidth = Math.max(2, W / 400); g.lineCap = g.lineJoin = "round";
  g.beginPath(); g.moveTo(p.px, p.py);
});
drawCanvas.addEventListener("pointermove", e => {
  if (!drawing || !drawing.active) return;
  const p = drawPos(e);
  const lastP = drawing[drawing.length - 1];
  if (Math.hypot(p.n[0] - lastP[0], p.n[1] - lastP[1]) < 0.004) return;
  drawing.push(p.n);
  const g = drawCanvas.getContext("2d");
  g.lineTo(p.px, p.py); g.stroke();
});
drawCanvas.addEventListener("pointerup", () => { if (drawing && drawing.active) stopDrawing(false); });

/* ---------- Aléatoire ---------- */
function randomize() {
  const r = Math.random;
  const pick = a => a[Math.floor(r() * a.length)];
  const shapes = ["galaxie", "galaxie", "sphere", "cercle", "infini", "fleur", "lissajous", "coeur", "etoile"];
  const pal = pick(Object.keys(PALETTES));
  const [bg, c1, c2] = PALETTES[pal];
  Object.assign(S, {
    shape: pick(shapes), arms: 1 + Math.floor(r() * 5), twist: 1 + r() * 4,
    petals: 3 + Math.floor(r() * 7), lissA: 1 + Math.floor(r() * 5), lissB: 1 + Math.floor(r() * 5), starN: 4 + Math.floor(r() * 7), starDepth: 0.2 + r() * 0.5,
    rings: 2 + Math.floor(r() * 10), inner: 0.1 + r() * 0.5, ringTwist: r() * 1.2, alternate: r() < 0.4,
    filaments: 4 + Math.floor(r() * 50), width: 0.02 + r() * 0.18, dispersion: 0.05 + r() * 0.6, dust: r() * 0.15,
    flow: (r() - 0.3) * 0.08, rot: (r() - 0.5) * 0.08, turb: r() * 0.18, turbScale: 0.8 + r() * 4, evolve: r() * 0.4, trail: 0.6 + r() * 0.35,
    halo: 0.2 + r() * 0.9, haloSize: 0.5 + r() * 3, palette: pal, bg, c1, c2, seed: Math.floor(r() * 1e6), angle: 0, cx: 0, cy: 0, zoom: 1,
    orbits: r() < 0.3 ? 1 + Math.floor(r() * 3) : 0, tilt: (r() - 0.5) * 1.6, chroma: r() < 0.3 ? r() * 0.7 : 0, grain: r() < 0.3 ? r() * 0.4 : 0, preset: ""
  });
  if (S.mode === "glyphes") S.count = 800 + Math.floor(r() * 1500);
  if (S.shape === "lissajous" && S.lissA === S.lissB) S.lissB = S.lissA + 1;
  changed({ curve: true, rebuild: true, lut: true });
  toast("Nouvelle combinaison");
}

/* ---------- Barre d'outils et clavier ---------- */
$("format").innerHTML = Object.entries(FORMATS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("");
$("format").addEventListener("change", e => {
  S.format = e.target.value;
  resize();
  primeBuffer(buf, W, H, t);
  changed({});
});

// Menu d'export
function toggleExportMenu(open) {
  const menu = $("export-menu");
  open = open ?? menu.hidden;
  menu.hidden = !open;
  $("export").setAttribute("aria-expanded", open);
  if (open) menu.querySelector("button").focus();
}
$("export").addEventListener("click", () => toggleExportMenu());
addEventListener("pointerdown", e => { if (!e.target.closest?.(".menu-wrap")) toggleExportMenu(false); });
$("export-menu").addEventListener("keydown", e => {
  const items = [...$("export-menu").querySelectorAll("button")], i = items.indexOf(document.activeElement);
  if (e.key === "Escape") { toggleExportMenu(false); $("export").focus(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
});

// Image de fond : sélecteur de fichier, glisser-déposer sur l'aperçu, coller
$("bg-file").addEventListener("change", e => {
  const f = e.target.files[0];
  if (f) setBackground(f, f.name);
  e.target.value = "";
});
let dragDepth = 0;
const isFileDrag = e => [...(e.dataTransfer?.types || [])].includes("Files");
stage.addEventListener("dragenter", e => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; $("drop").hidden = false; });
stage.addEventListener("dragover", e => { if (isFileDrag(e)) e.preventDefault(); });
stage.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop").hidden = true; } });
stage.addEventListener("drop", e => {
  e.preventDefault();
  dragDepth = 0; $("drop").hidden = true;
  const f = [...e.dataTransfer.files].find(x => x.type.startsWith("image/"));
  if (f) { setBackground(f, f.name); showTab("couleurs"); }
  else { BG.error = "Ce fichier n'est pas une image. Dépose un PNG, un JPEG ou un WebP."; syncPanel(); showTab("couleurs"); }
});
addEventListener("paste", e => {
  if (e.target.closest("input, textarea")) return;
  const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith("image/"));
  if (f) { e.preventDefault(); setBackground(f, f.name && f.name !== "image.png" ? f.name : "Image collée"); showTab("couleurs"); }
});
$("random").addEventListener("click", randomize);
$("pause").addEventListener("click", togglePause);
$("export-png").addEventListener("click", exportPNG);
$("export-svg").addEventListener("click", exportSVG);
$("share").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}#${btoa(unescape(encodeURIComponent(JSON.stringify(S))))}`;
  try { await navigator.clipboard.writeText(url); toast("Lien copié : il contient tous les réglages"); }
  catch (e) { history.replaceState(null, "", url); toast("Lien mis dans la barre d'adresse"); }
});
$("reset").addEventListener("click", () => {
  S = { ...DEFAULTS, format: S.format };
  changed({ curve: true, rebuild: true, lut: true });
  toast("Réglages par défaut");
});
$("toggle-panel").addEventListener("click", () => togglePanel());
$("show-panel").addEventListener("click", () => togglePanel());

function toggleNodes(force) {
  const el = $("nodes");
  const open = force ?? el.hidden;
  el.hidden = !open;
  $("toggle-nodes").setAttribute("aria-pressed", open);
  if (open) { editor.render(); if (!S.graph || !S.graph.fitted) { requestAnimationFrame(() => { editor.fit(); S.graph.fitted = true; }); } }
  requestAnimationFrame(() => { resize(); primeBuffer(buf, W, H, t); });
}
$("toggle-nodes").addEventListener("click", () => toggleNodes());

// Redimensionner le tiroir des nœuds
$("nodes").addEventListener("pointerdown", e => {
  if (!e.target.classList.contains("ne-resize")) return;
  const wrap = document.querySelector(".stage-wrap");
  const y0 = e.clientY, h0 = $("nodes").offsetHeight;
  e.target.setPointerCapture(e.pointerId);
  const move = ev => wrap.style.setProperty("--ne-h", Math.max(180, Math.min(wrap.offsetHeight - 160, h0 - (ev.clientY - y0))) + "px");
  const up = () => { e.target.removeEventListener("pointermove", move); e.target.removeEventListener("pointerup", up); resize(); primeBuffer(buf, W, H, t); };
  e.target.addEventListener("pointermove", move);
  e.target.addEventListener("pointerup", up);
});

// Position de la souris sur l'aperçu, pour le nœud Souris (de -1 à 1)
let mouse = [0, 0];
canvas.addEventListener("pointermove", e => {
  const r = canvas.getBoundingClientRect();
  mouse = [(e.clientX - r.left) / r.width * 2 - 1, (e.clientY - r.top) / r.height * 2 - 1];
});

function togglePause() {
  paused = !paused;
  if (paused) primeBuffer(buf, W, H, t);
  syncPanel();
}
function togglePanel() {
  document.body.classList.toggle("panel-hidden");
  requestAnimationFrame(() => { resize(); primeBuffer(buf, W, H, t); });
}

/* ---------- Raccourcis configurables ---------- */
const ACTIONS = [
  { id: "pause", label: "Lecture et pause", def: "Space", run: () => togglePause() },
  { id: "random", label: "Combinaison aléatoire", def: "r", run: () => randomize() },
  { id: "timeline", label: "Afficher la timeline", def: "t", run: () => toggleTimeline() },
  { id: "nodes", label: "Éditeur de nœuds", def: "n", run: () => toggleNodes() },
  { id: "panel", label: "Masquer les réglages", def: "h", run: () => togglePanel() },
  { id: "start", label: "Revenir au début de la timeline", def: "Home", run: () => timeline.seek(0) },
  { id: "prevKey", label: "Image clé précédente", def: "j", run: () => timeline.jump(-1) },
  { id: "nextKey", label: "Image clé suivante", def: "l", run: () => timeline.jump(1) },
  { id: "deleteKey", label: "Supprimer l'image clé sélectionnée", def: "Delete", run: () => timeline.deleteSelected() },
  { id: "exportPng", label: "Exporter en PNG", def: "e", run: () => exportPNG() },
  { id: "settings", label: "Ouvrir les paramètres", def: ",", run: () => openSettings() }
];
const PREFS_KEY = "loop-prefs";
let prefs = { binds: {}, snap: true, timeline: true, gpu: true };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; } catch (e) {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} };
const bindOf = id => id in prefs.binds ? prefs.binds[id] : ACTIONS.find(a => a.id === id).def;

// « Maj+K », « Ctrl+Alt+Home »… La touche suit la disposition du clavier (AZERTY compris)
function comboOf(e) {
  let k = e.key;
  if (k === " ") k = "Space";
  else if (k.length === 1) k = k.toLowerCase();
  if (["Shift", "Control", "Alt", "Meta"].includes(k)) return null;
  const mods = (e.ctrlKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.metaKey ? "Cmd+" : "");
  const shift = e.shiftKey && (k.length > 1 || /^[a-z]$/.test(k)) ? "Shift+" : "";
  return mods + shift + k;
}
const KEY_NAMES = { Space: "Espace", Home: "Début", End: "Fin", Delete: "Suppr", Backspace: "Retour arrière", Enter: "Entrée", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", PageUp: "Page préc.", PageDown: "Page suiv.", Shift: "Maj", Ctrl: "Ctrl", Alt: "Alt", Cmd: "⌘" };
function keyLabel(combo) {
  if (!combo) return "Aucun";
  return combo.split("+").map((p, i, a) => i < a.length - 1 ? (p === "Shift" ? "Maj" : KEY_NAMES[p] || p) : KEY_NAMES[p] || (p.length === 1 ? p.toUpperCase() : p)).join(" ");
}
const hintOf = id => { const b = bindOf(id); return b ? ` (${keyLabel(b)})` : ""; };

function refreshHints() {
  $("random").title = "Combinaison aléatoire" + hintOf("random");
  $("toggle-nodes").title = "Éditeur de nœuds" + hintOf("nodes");
  $("toggle-timeline").title = "Timeline et images clés" + hintOf("timeline");
  $("open-settings").title = "Paramètres" + hintOf("settings");
  $("toggle-panel").title = "Masquer les réglages" + hintOf("panel");
  $("show-panel").title = "Afficher les réglages" + hintOf("panel");
  $("pause").title = (paused ? "Lecture" : "Pause") + hintOf("pause");
  const list = document.querySelector(".shortcuts");
  if (list) list.innerHTML = ACTIONS.filter(a => bindOf(a.id)).slice(0, 7).map(a => `<kbd>${keyLabel(bindOf(a.id))}</kbd><span>${a.label}</span>`).join("") +
    `<kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ V" : "Ctrl V"}</kbd><span>Coller une image de fond</span>`;
}

let capturing = null;   // action en attente d'une nouvelle touche
addEventListener("keydown", e => {
  if (capturing) return;
  if (e.target.closest("input, select, textarea") && e.target.type !== "range" && e.target.type !== "checkbox") return;
  if (e.code === "Escape" && drawing) { stopDrawing(true); return; }
  if (e.target.closest(".menu") || $("settings").open) return;
  const combo = comboOf(e);
  if (!combo) return;
  // Retour arrière supprime aussi la clé sélectionnée, comme Suppr
  if (combo === "Backspace" && timeline.selected && bindOf("deleteKey") === "Delete") { e.preventDefault(); e.stopImmediatePropagation(); timeline.deleteSelected(); return; }
  const act = ACTIONS.find(a => bindOf(a.id) === combo);
  if (!act) return;
  if (act.id === "deleteKey" && !timeline.selected) return;   // laisse la touche aux nœuds
  e.preventDefault();
  e.stopImmediatePropagation();
  act.run();
});

/* ---------- Paramètres ---------- */
function renderBinds() {
  $("binds").innerHTML = ACTIONS.map(a => {
    const b = bindOf(a.id), wait = capturing === a.id;
    return `<div class="bind"><span>${a.label}</span><button type="button" class="keycap${b ? "" : " empty"}${wait ? " waiting" : ""}" data-bind="${a.id}" aria-label="Raccourci pour ${a.label} : ${keyLabel(b)}">${wait ? "Appuie sur une touche" : keyLabel(b)}</button></div>`;
  }).join("");
  $("pref-snap").checked = prefs.snap;
  $("pref-tl").checked = prefs.timeline;
  $("pref-gpu").checked = prefs.gpu;
  $("gpu-info").textContent = gpu ? `Carte utilisée : ${gpu.renderer}${gpu.float32 ? "" : " (tampon en demi-précision)"}` : `Rendu par le processeur : ${gpuError || "accélération coupée"}`;
}
function openSettings() {
  capturing = null;
  renderBinds();
  $("settings").showModal();
}
$("open-settings").addEventListener("click", openSettings);
$("settings-close").addEventListener("click", () => $("settings").close());
$("settings-done").addEventListener("click", () => $("settings").close());
$("settings").addEventListener("close", () => { capturing = null; });
$("settings").addEventListener("click", e => { if (e.target === $("settings")) $("settings").close(); });
$("binds").addEventListener("click", e => {
  const b = e.target.closest("[data-bind]");
  if (!b) return;
  capturing = capturing === b.dataset.bind ? null : b.dataset.bind;
  renderBinds();
  if (capturing) $("binds").querySelector(`[data-bind="${capturing}"]`).focus();
});
// Capture de la nouvelle touche (avant tout le reste, et sans fermer la fenêtre sur Échap)
addEventListener("keydown", e => {
  if (!capturing) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === "Escape") { capturing = null; renderBinds(); return; }
  if (e.key === "Tab") return;
  const id = capturing;
  if (e.key === "Backspace" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    prefs.binds[id] = "";
  } else {
    const combo = comboOf(e);
    if (!combo) return;
    const other = ACTIONS.find(a => a.id !== id && bindOf(a.id) === combo);
    if (other) { prefs.binds[other.id] = ""; toast(`« ${other.label} » n'a plus de raccourci`); }
    prefs.binds[id] = combo;
  }
  capturing = null;
  savePrefs();
  renderBinds();
  refreshHints();
  $("binds").querySelector(`[data-bind="${id}"]`).focus();
}, true);
$("binds-reset").addEventListener("click", () => {
  prefs.binds = {};
  savePrefs(); renderBinds(); refreshHints();
  toast("Raccourcis par défaut");
});
$("pref-snap").addEventListener("change", e => { prefs.snap = e.target.checked; savePrefs(); });
$("pref-tl").addEventListener("change", e => { prefs.timeline = e.target.checked; savePrefs(); });
$("pref-gpu").addEventListener("change", e => {
  prefs.gpu = e.target.checked;
  savePrefs();
  if (prefs.gpu) startGpu();
  primeBuffer(buf, W, H, t);
  renderBinds();
});

/* ---------- Timeline ---------- */
function toggleTimeline(force) {
  const el = $("timeline");
  const open = force ?? el.hidden;
  if (open === !el.hidden) return;
  el.hidden = !open;
  $("toggle-timeline").setAttribute("aria-pressed", open);
  if (open) timeline.render();
  requestAnimationFrame(() => { resize(); primeBuffer(buf, W, H, t); });
}
$("toggle-timeline").addEventListener("click", () => toggleTimeline());

let resizeT = 0;
addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { resize(); primeBuffer(buf, W, H, t); }, 120); });

function renderThumbs() {
  BG.off = true;
  const keep = { S, P, filamentOffsets, orbitTilt, curve: curve.slice(), normals: normals.slice(), lut: lut.slice(), lutRGB, DMAX };
  const size = 120;
  for (const key of Object.keys(PRESETS)) {
    S = { ...presetSettings(key), format: "carre" };
    if (S.mode !== "glyphes") S.count = Math.max(4000, Math.round(S.count * 0.25));
    buildCurve(); buildLut(); buildParticles(); atlasKey = ""; glyphKey = "";
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    if (S.mode === "vecteurs") drawVectors(g, size, size, 2);
    else if (S.mode === "glyphes") { S.glyphSize *= 1.6; drawGlyphs(g, size, size, 2); }
    else {
      const b = new Float32Array(size * size);
      primeBuffer(b, size, size, 2);
      if (S.mode === "ascii") drawAscii(g, b, size, size, 6);
      else { const im = g.createImageData(size, size); toneMap(b, new Uint32Array(im.data.buffer)); g.putImageData(im, 0, 0); }
    }
    applyHalo(g, c, size, size);
    postFx(g, size, size);
    const img = document.querySelector(`img[data-thumb="${key}"]`);
    if (img) img.src = c.toDataURL();
  }
  ({ S, P, filamentOffsets, orbitTilt, lutRGB, DMAX } = keep);
  curve.set(keep.curve); normals.set(keep.normals); lut.set(keep.lut);
  atlasKey = ""; glyphKey = "";
  curveVersion++; lutVersion++;
  BG.off = false;
}

/* ---------- Démarrage ---------- */
buildCurve();
buildLut();
buildParticles();
buildPanel();
editor = createNodeEditor({
  root: $("nodes"),
  S: () => S,
  sections: () => CONTROLS.filter(c => SECTION_TITLES.includes(c.title)),
  control: key => controlOf(key),
  set: (key, v, c) => set(key, v, { rebuild: c && c.rebuild, curve: CURVE_KEYS.includes(key) || key === "shape", lut: !!(c && c.lut) || key === "charset" || key === "glyphs" }),
  save: saveSettings,
  graphChanged: () => { for (const k in lastApplied) delete lastApplied[k]; S.preset = ""; changed({ curve: true, lut: true }); },
  toast,
  noise: (x, y) => fbm(x, y) * 0.75,
  mouse: () => mouse,
  canvas: () => canvas,
  formatLabel: () => `${FORMATS[S.format][0]}, ${formatSize(S.format).join(" × ")}`
});
if (prefs.gpu) startGpu();
timeline = createTimeline({
  root: $("timeline"),
  S: () => S,
  time: () => t,
  setTime: v => { t = v; },
  afterSeek: () => { if (paused) primeBuffer(buf, W, H, t); syncAnimated(); },
  changed: () => { for (const k in lastApplied) delete lastApplied[k]; S.preset = ""; saveSettings(); if (paused) primeBuffer(buf, W, H, t); syncAnimated(); syncPanel(); },
  control: key => controlOf(key),
  label: key => controlOf(key)?.label || key,
  order: () => CONTROLS.flatMap(sec => sec.items.map(c => c.key)).filter(Boolean),
  snap: () => prefs.snap,
  // Hauteur dispo pour la timeline : la colonne moins 180 px d'aperçu et le tiroir des nœuds
  maxHeight: () => document.querySelector(".stage-wrap").offsetHeight - 180 - ($("nodes").hidden ? 0 : $("nodes").offsetHeight),
  // Pendant le glissé, on ne fait que recadrer l'aperçu ; le tampon est recalculé au relâchement
  resized: done => { resize(); if (done || paused) primeBuffer(buf, W, H, t); },
  toast
});
refreshHints();
if (prefs.timeline || (S.keys && Object.keys(S.keys).length)) toggleTimeline(true);
resize();
primeBuffer(buf, W, H, t);
requestAnimationFrame(frame);
setTimeout(renderThumbs, 400);
restoreBackground();

// Préférence système « réduire les animations » : on démarre en pause
if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  paused = true;
  primeBuffer(buf, W, H, t);
  syncPanel();
  toast("Animation en pause (préférence système), Espace pour lancer");
}

// Pour les tests automatisés
window.__wall = { get editor() { return editor; }, toggleNodes, get S() { return S; }, set, changed, exportSVG, exportPNG, randomize, primeBuffer, get W() { return W; }, get H() { return H; }, get ms() { return msAvg; }, startDrawing, stopDrawing, get t() { return t; }, setBackground, clearBackground, showTab, get timeline() { return timeline; }, toggleTimeline, get paused() { return paused; }, togglePause, get gpu() { return useGpu() ? gpu : null; },
  // Mesure : n images rendues d'affilée, en attendant la fin du travail de la carte graphique
  bench(n = 30) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { t += 1 / 60; withOverrides(t, () => renderFrame()); }
    ctx.getImageData(0, 0, 1, 1);
    return (performance.now() - t0) / n;
  } };
