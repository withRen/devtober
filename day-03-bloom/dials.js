/* =========================================================
   Commandes rotatives, en SVG.
   - knob : une molette crantée, avec un repère ambré ; on la tourne
     en glissant vers le haut ou vers la droite.
   - arcDial : une échelle graduée en arc qui défile sous une aiguille
     fixe, avec l'histogramme courbé en dessous.
   Les deux : double-clic pour revenir à la valeur par défaut, flèches
   au clavier (Maj : plus vite), molette de la souris.
   ========================================================= */

const NS = 'http://www.w3.org/2000/svg';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// Comportement commun : glisser, clavier, molette, double-clic, attributs ARIA.
function control(el, { obj, key, def, spec, onLive, onCommit, pxPerRange, axis }) {
  const set = (v, live = true) => {
    const s = spec.step || 0.01;
    obj[key] = clamp(Math.round(v / s) * s, spec.min, spec.max);
    el.setAttribute('aria-valuenow', obj[key]);
    el.setAttribute('aria-valuetext', spec.fmt(obj[key]));
    if (live) onLive();
  };
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', spec.label);
  el.setAttribute('aria-valuemin', spec.min);
  el.setAttribute('aria-valuemax', spec.max);
  set(obj[key], false);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('turning');
    let x = e.clientX, y = e.clientY;
    const move = (ev) => {
      const d = axis(ev.clientX - x, ev.clientY - y) * (ev.shiftKey ? 0.2 : 1);
      x = ev.clientX; y = ev.clientY;
      set(obj[key] + (d * (spec.max - spec.min)) / pxPerRange());
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.classList.remove('turning');
      onCommit();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
  });
  el.addEventListener('dblclick', () => { set(def); onCommit(); });
  let wheelTimer = 0;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    set(obj[key] - (Math.sign(e.deltaY) * (spec.max - spec.min)) / 200);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(onCommit, 300);
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const st = (spec.max - spec.min) / (e.shiftKey ? 20 : 100);
    const m = { ArrowUp: st, ArrowRight: st, ArrowDown: -st, ArrowLeft: -st }[e.key];
    if (e.key === 'Home') set(spec.min);
    else if (e.key === 'End') set(spec.max);
    else if (m) set(obj[key] + m);
    else return;
    e.preventDefault();
    e.stopPropagation();
    onCommit();
  });
}

/* ---------- Molette ---------- */

export function knob({ obj, key, def, spec, onLive, onCommit }) {
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  const s = svg('svg', { viewBox: '0 0 200 200', class: 'knob-svg' });
  const A0 = -135, A1 = 135;
  const ang = (v) => A0 + ((v - spec.min) / (spec.max - spec.min)) * (A1 - A0);
  const pol = (a, r) => [100 + r * Math.sin((a * Math.PI) / 180), 100 - r * Math.cos((a * Math.PI) / 180)];

  // Graduations autour, un trait plus long au défaut et aux extrémités.
  const ticks = svg('g', { class: 'knob-ticks' });
  for (let i = 0; i <= 54; i++) {
    const a = A0 + (i / 54) * (A1 - A0);
    const major = i === 0 || i === 54;
    const [x1, y1] = pol(a, 93), [x2, y2] = pol(a, major ? 84 : 88);
    ticks.append(svg('line', { x1, y1, x2, y2 }));
  }
  const [dx1, dy1] = pol(ang(def), 96), [dx2, dy2] = pol(ang(def), 82);
  ticks.append(svg('line', { x1: dx1, y1: dy1, x2: dx2, y2: dy2, class: 'knob-def' }));
  const defs = svg('defs');
  const grad = svg('radialGradient', { id: 'kg-' + key, cx: '40%', cy: '30%', r: '75%' });
  grad.append(svg('stop', { offset: '0', 'stop-color': '#4a4a4f' }), svg('stop', { offset: '1', 'stop-color': '#2b2b2e' }));
  defs.append(grad);
  // Le bouton : un bord cranté, puis le disque.
  const body = svg('g');
  body.append(
    svg('circle', { cx: 100, cy: 100, r: 76, class: 'knob-knurl' }),
    svg('circle', { cx: 100, cy: 100, r: 72, fill: `url(#kg-${key})`, class: 'knob-cap' }),
  );
  const mark = svg('g', { class: 'knob-mark' });
  mark.append(svg('rect', { x: 94, y: 36, width: 12, height: 36, rx: 6 }));
  s.append(defs, ticks, body, mark);

  const out = document.createElement('div');
  out.className = 'knob-out';
  const label = document.createElement('span');
  label.textContent = spec.label;
  const val = document.createElement('output');
  out.append(label, val);
  wrap.append(s, out);

  const paint = () => {
    mark.setAttribute('transform', `rotate(${ang(obj[key])} 100 100)`);
    val.value = spec.fmt(obj[key]);
    wrap.classList.toggle('changed', Math.abs(obj[key] - def) > 1e-9);
  };
  control(s, {
    obj, key, def, spec,
    onLive: () => { paint(); onLive(); },
    onCommit, pxPerRange: () => 260,
    axis: (dx, dy) => dx - dy,
  });
  paint();
  return wrap;
}

/* ---------- Cadran en arc ---------- */

export function arcDial({ obj, key, def, spec, onLive, onCommit, bins, perUnit = 7, minor = 0.25, major = 1 }) {
  const wrap = document.createElement('div');
  wrap.className = 'arc';
  const W = 400, H = 230, R = 420, CX = 200, CY = 40 + R;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'arc-svg' });
  const head = document.createElement('div');
  head.className = 'arc-head';
  const label = document.createElement('span');
  label.textContent = spec.label;
  const val = document.createElement('output');
  head.append(label, val);
  wrap.append(head, s);

  const pol = (deg, r) => [CX + r * Math.sin((deg * Math.PI) / 180), CY - r * Math.cos((deg * Math.PI) / 180)];
  const arcPath = (r, a0, a1) => {
    const [x0, y0] = pol(a0, r), [x1, y1] = pol(a1, r);
    return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`;
  };
  const SPAN = 27;   // demi-ouverture visible, en degrés (l'arc touche les bords)

  function draw() {
    const v = obj[key];
    s.replaceChildren();
    // Disque intérieur sombre et bande de la graduation.
    s.append(svg('path', { d: `${arcPath(R - 50, -SPAN - 6, SPAN + 6)} L${W},${H} L0,${H} Z`, class: 'arc-disc' }));
    s.append(svg('path', { d: arcPath(R + 8, -SPAN - 6, SPAN + 6), class: 'arc-rim' }));
    // Graduations : elles défilent sous l'aiguille.
    const g = svg('g', { class: 'arc-ticks' });
    for (let t = Math.ceil(spec.min / minor) * minor; t <= spec.max + 1e-9; t += minor) {
      const deg = (t - v) * perUnit;
      if (Math.abs(deg) > SPAN + 6) continue;
      const big = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      const [x1, y1] = pol(deg, R - 4), [x2, y2] = pol(deg, R - (big ? 40 : 24));
      const fade = 1 - Math.max(0, Math.abs(deg) - SPAN + 8) / 12;
      g.append(svg('line', { x1, y1, x2, y2, class: big ? 'major' : '', opacity: clamp(fade, 0, 1).toFixed(2) }));
    }
    s.append(g);
    // Repère du défaut (le point gris), qui défile avec l'échelle.
    const dd = (def - v) * perUnit;
    if (Math.abs(dd) <= SPAN + 4) {
      const [px, py] = pol(dd, R + 26);
      s.append(svg('circle', { cx: px, cy: py, r: 4.5, class: 'arc-zero' }));
    }
    // Histogramme courbé, sous l'échelle.
    const b = bins?.();
    if (b) {
      let max = 1;
      for (let c = 0; c < 3; c++) for (let i = 2; i < 254; i++) max = Math.max(max, b[c * 256 + i]);
      const cls = ['arc-h r', 'arc-h g', 'arc-h b'];
      for (let c = 0; c < 3; c++) {
        let d = '';
        for (let i = 0; i < 256; i += 2) {
          const deg = -SPAN + (i / 255) * SPAN * 2;
          const hgt = Math.min(1, Math.sqrt(b[c * 256 + i] / max));
          const [x, y] = pol(deg, R - 160 + hgt * 96);
          d += (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
        }
        s.append(svg('path', { d, class: cls[c] }));
      }
    }
    // Aiguille fixe, en haut au centre.
    s.append(svg('line', { x1: CX, y1: CY - R + 52, x2: CX, y2: CY - R - 12, class: 'arc-needle' }));
    s.append(svg('circle', { cx: CX, cy: CY - R - 12, r: 8, class: 'arc-knob' }));
    val.value = spec.fmt(v);
    wrap.classList.toggle('changed', Math.abs(v - def) > 1e-9);
  }

  // Glisser d'autant de pixels qu'en parcourent les graduations : l'échelle suit le doigt.
  control(s, {
    obj, key, def, spec,
    onLive: () => { draw(); onLive(); },
    onCommit,
    pxPerRange: () => {
      const scale = s.getBoundingClientRect().width / W || 1;
      return ((spec.max - spec.min) * perUnit * Math.PI * R * scale) / 180;
    },
    axis: (dx) => -dx,
  });
  draw();
  return { el: wrap, draw };
}
