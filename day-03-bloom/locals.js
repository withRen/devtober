/* =========================================================
   Calques de réglages locaux.
   Un calque = des réglages + un masque. Le masque est une forme
   (radiale ou dégradé) multipliée par une plage (luminance ou
   couleur), comme une fenêtre et un qualificateur dans DaVinci.
   Tout est calculé pixel par pixel dans le shader de finition.
   ========================================================= */

export const MAX_LAYERS = 8;

export const ADJ = {
  exposure: { label: 'Exposition', min: -3, max: 3, step: 0.01, fmt: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + ' EV' },
  contrast: { label: 'Contraste', min: -1, max: 1, step: 0.01 },
  highlights: { label: 'Hautes lumières', min: -1, max: 1, step: 0.01 },
  shadows: { label: 'Ombres', min: -1, max: 1, step: 0.01 },
  temp: { label: 'Température', min: -1, max: 1, step: 0.01, cls: 'temp' },
  tint: { label: 'Teinte', min: -1, max: 1, step: 0.01, cls: 'tint' },
  saturation: { label: 'Saturation', min: -1, max: 1, step: 0.01 },
  vibrance: { label: 'Vibrance', min: -1, max: 1, step: 0.01 },
  bloom: { label: 'Bloom', min: -1, max: 3, step: 0.01 },
};

const ZERO = Object.fromEntries(Object.keys(ADJ).map((k) => [k, 0]));

export function newLayer(kind = 'empty', n = 1) {
  const L = {
    id: Math.random().toString(36).slice(2, 9),
    name: 'Calque ' + n, on: true, opacity: 1, invert: false,
    geo: 'none', range: 'none',
    radial: { cx: 0.5, cy: 0.5, rx: 0.32, ry: 0.24, angle: 0, feather: 0.6 },
    linear: { cx: 0.5, cy: 0.38, angle: 90, width: 0.18 },
    luma: { lo: 0, hi: 0.35, soft: 0.1 },
    color: { hue: 0.92, width: 0.06, sat: 0.2, soft: 0.05 },
    adj: { ...ZERO },
  };
  const P = {
    sky: { name: 'Ciel', geo: 'linear', adj: { ...ZERO, exposure: -0.6, highlights: -0.3, saturation: 0.15 } },
    radial: { name: 'Sujet', geo: 'radial', adj: { ...ZERO, exposure: 0.35, contrast: 0.15 } },
    shadows: { name: 'Ombres', range: 'luma', luma: { lo: 0, hi: 0.3, soft: 0.1 }, adj: { ...ZERO, shadows: 0.4, temp: -0.15 } },
    highs: { name: 'Hautes lumières', range: 'luma', luma: { lo: 0.7, hi: 1.05, soft: 0.1 }, adj: { ...ZERO, highlights: -0.35, temp: 0.12 } },
    neon: { name: 'Néons', range: 'color', adj: { ...ZERO, bloom: 1.2, saturation: 0.2 } },
  }[kind];
  return P ? { ...L, ...P, adj: { ...P.adj } } : L;
}

export const KINDS = [
  ['empty', 'Vide', 'ph-plus'],
  ['sky', 'Ciel (dégradé)', 'ph-gradient'],
  ['radial', 'Sujet (radial)', 'ph-circle-dashed'],
  ['shadows', 'Ombres', 'ph-moon'],
  ['highs', 'Hautes lumières', 'ph-sun-horizon'],
  ['neon', 'Couleur (néons)', 'ph-eyedropper'],
];

/* Tampon d'uniformes : 4 flottants d'en-tête, puis 32 par calque (8 vec4f). */
export function packLayers(layers, showIndex, wb) {
  const live = layers.filter((l) => l.on && l.opacity > 0).slice(0, MAX_LAYERS);
  const f = new Float32Array(4 + MAX_LAYERS * 32);
  f[0] = live.length;
  f[1] = showIndex == null ? -1 : live.indexOf(layers[showIndex]);
  live.forEach((L, i) => {
    const o = 4 + i * 32, a = L.adj;
    const geo = { none: 0, radial: 1, linear: 2 }[L.geo];
    const range = { none: 0, luma: 1, color: 2 }[L.range];
    f.set([geo, range, L.invert ? 1 : 0, L.opacity], o);
    if (L.geo === 'radial') f.set([L.radial.cx, L.radial.cy, L.radial.rx, L.radial.ry], o + 4);
    else f.set([L.linear.cx, L.linear.cy, L.linear.angle, L.linear.width], o + 4);
    const rg = L.range === 'color' ? [L.color.hue, L.color.width, L.color.soft] : [L.luma.lo, L.luma.hi, L.luma.soft];
    f.set([L.radial.feather, ...rg], o + 8);
    f.set([L.color.sat, 0, L.radial.angle, 0], o + 12);
    f.set([a.exposure, a.contrast, a.highlights, a.shadows], o + 16);
    f.set([...wb(a.temp, a.tint), a.saturation], o + 20);
    f.set([a.vibrance, a.bloom, 0, 0], o + 24);
  });
  return f;
}

/* ---------- Poignées sur la photo ----------
   Les rayons et la largeur sont en hauteurs d'image : en pixels, c'est
   la même échelle sur les deux axes, quelle que soit la proportion. */

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

export function handles(svgRoot, L, onLive, onCommit) {
  svgRoot.replaceChildren();
  // Sur un élément SVG, « hidden » n'est pas une propriété : on passe par l'attribut.
  if (!L || L.geo === 'none') { svgRoot.setAttribute('hidden', ''); return; }
  svgRoot.removeAttribute('hidden');
  const W = svgRoot.clientWidth, H = svgRoot.clientHeight;
  svgRoot.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const toPx = (x, y) => [x * W, y * H];

  // Le pointeur est capturé par le SVG lui-même : les poignées sont redessinées pendant le glissé.
  const drag = (node, move) => {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      svgRoot.setPointerCapture(e.pointerId);
      svgRoot.classList.add('dragging');
      const r = svgRoot.getBoundingClientRect();
      const mv = (ev) => { move((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height); onLive(); draw(); };
      svgRoot.addEventListener('pointermove', mv);
      svgRoot.addEventListener('pointerup', () => { svgRoot.removeEventListener('pointermove', mv); svgRoot.classList.remove('dragging'); onCommit(); }, { once: true });
    });
  };
  const dot = (x, y, cls, label) => {
    const c = el('circle', { cx: x, cy: y, r: cls === 'center' ? 8 : 6.5, class: 'h-dot ' + cls });
    c.setAttribute('aria-label', label);
    return c;
  };

  function draw() {
    svgRoot.replaceChildren();
    if (L.geo === 'radial') {
      const R = L.radial, [cx, cy] = toPx(R.cx, R.cy);
      const a = (R.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const g = el('g', { transform: `rotate(${R.angle} ${cx} ${cy})` });
      g.append(
        el('ellipse', { cx, cy, rx: R.rx * H, ry: R.ry * H, class: 'h-line' }),
        el('ellipse', { cx, cy, rx: R.rx * H * (1 - R.feather), ry: R.ry * H * (1 - R.feather), class: 'h-line dash' }),
      );
      svgRoot.append(g);
      const center = dot(cx, cy, 'center', 'Centre');
      const hx = dot(cx + ca * R.rx * H, cy + sa * R.rx * H, 'edge', 'Rayon horizontal');
      const hy = dot(cx - sa * R.ry * H, cy + ca * R.ry * H, 'edge', 'Rayon vertical');
      const rot = dot(cx + ca * R.rx * H * 1.18, cy + sa * R.rx * H * 1.18, 'rot', 'Rotation');
      drag(center, (x, y) => { R.cx = x; R.cy = y; });
      drag(hx, (x, y) => { R.rx = Math.max(0.02, Math.abs(((x - R.cx) * W) * ca + ((y - R.cy) * H) * sa) / H); });
      drag(hy, (x, y) => { R.ry = Math.max(0.02, Math.abs(-((x - R.cx) * W) * sa + ((y - R.cy) * H) * ca) / H); });
      drag(rot, (x, y) => { R.angle = Math.round((Math.atan2((y - R.cy) * H, (x - R.cx) * W) * 180) / Math.PI); });
      svgRoot.append(rot, hx, hy, center);
    } else {
      const G = L.linear, [cx, cy] = toPx(G.cx, G.cy);
      const a = (G.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
      const len = Math.hypot(W, H);
      const line = (off, cls) => {
        const ox = cx + dx * off, oy = cy + dy * off;
        return el('line', { x1: ox - dy * len, y1: oy + dx * len, x2: ox + dy * len, y2: oy - dx * len, class: cls });
      };
      svgRoot.append(line(-G.width * H, 'h-line dash'), line(0, 'h-line'), line(G.width * H, 'h-line dash'));
      const center = dot(cx, cy, 'center', 'Centre');
      const wd = dot(cx + dx * G.width * H, cy + dy * G.width * H, 'edge', 'Largeur de la transition');
      const rot = dot(cx - dy * 70, cy + dx * 70, 'rot', 'Rotation');
      drag(center, (x, y) => { G.cx = x; G.cy = y; });
      drag(wd, (x, y) => { G.width = Math.max(0.005, Math.abs(((x - G.cx) * W) * dx + ((y - G.cy) * H) * dy) / H); });
      drag(rot, (x, y) => { G.angle = Math.round((Math.atan2((y - G.cy) * H, (x - G.cx) * W) * 180) / Math.PI - 90); });
      svgRoot.append(rot, wd, center);
    }
  }
  draw();
}
