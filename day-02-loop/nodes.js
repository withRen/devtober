/* =========================================================
   Éditeur de nœuds, façon Blender / DaVinci Fusion.
   Les nœuds du pipeline exposent les paramètres du générateur ;
   les nœuds de modulation (oscillateur, bruit, souris...) se
   branchent sur ces paramètres pour les animer.
   ========================================================= */

const TAU = Math.PI * 2;
const frac = x => x - Math.floor(x);

const WAVES = {
  sinus: x => Math.sin(x * TAU),
  triangle: x => 1 - 4 * Math.abs(frac(x) - 0.5),
  carre: x => (frac(x) < 0.5 ? 1 : -1),
  dents: x => 2 * frac(x) - 1
};

const OPS = {
  addition: (a, b) => a + b,
  soustraction: (a, b) => a - b,
  multiplication: (a, b) => a * b,
  division: (a, b) => (Math.abs(b) < 1e-9 ? 0 : a / b),
  minimum: Math.min,
  maximum: Math.max,
  puissance: (a, b) => Math.sign(a) * Math.pow(Math.abs(a), b)
};

// Types de nœuds de modulation. Chaque entrée peut être réglée à la main ou branchée.
export const NODE_TYPES = {
  temps: {
    name: "Temps", cat: "entree", icon: "ph-clock",
    inputs: { vitesse: { label: "Vitesse", v: 1, min: -10, max: 10, step: 0.01 } },
    outputs: { valeur: "Secondes" },
    eval: (i, p, t) => ({ valeur: t * i.vitesse })
  },
  osc: {
    name: "Oscillateur", cat: "entree", icon: "ph-wave-sine",
    choices: { onde: { label: "Onde", v: "sinus", options: [["sinus", "Sinus"], ["triangle", "Triangle"], ["carre", "Carré"], ["dents", "Dents de scie"]] } },
    inputs: {
      frequence: { label: "Fréquence", v: 0.2, min: 0, max: 10, step: 0.005 },
      amplitude: { label: "Amplitude", v: 1, min: -10, max: 10, step: 0.01 },
      centre: { label: "Centre", v: 0, min: -10, max: 10, step: 0.01 },
      phase: { label: "Phase", v: 0, min: 0, max: 1, step: 0.01 }
    },
    outputs: { valeur: "Valeur" },
    eval: (i, p, t) => ({ valeur: i.centre + i.amplitude * WAVES[p.onde](t * i.frequence + i.phase) })
  },
  bruit: {
    name: "Bruit", cat: "entree", icon: "ph-waveform",
    inputs: {
      vitesse: { label: "Vitesse", v: 0.3, min: 0, max: 10, step: 0.005 },
      amplitude: { label: "Amplitude", v: 1, min: -10, max: 10, step: 0.01 },
      centre: { label: "Centre", v: 0, min: -10, max: 10, step: 0.01 },
      graine: { label: "Graine", v: 1, min: 0, max: 100, step: 1 }
    },
    outputs: { valeur: "Valeur" },
    eval: (i, p, t, n, api) => ({ valeur: i.centre + i.amplitude * api.noise(t * i.vitesse, i.graine * 7.13) })
  },
  souris: {
    name: "Souris", cat: "entree", icon: "ph-cursor",
    inputs: { lissage: { label: "Lissage", v: 0.85, min: 0, max: 0.99, step: 0.01 } },
    outputs: { x: "X", y: "Y" },
    eval: (i, p, t, n, api) => {
      const m = api.mouse();
      n.sx = n.sx ?? 0; n.sy = n.sy ?? 0;
      n.sx += (m[0] - n.sx) * (1 - i.lissage);
      n.sy += (m[1] - n.sy) * (1 - i.lissage);
      return { x: n.sx, y: n.sy };
    }
  },
  valeur: {
    name: "Valeur", cat: "entree", icon: "ph-hash",
    inputs: { valeur: { label: "Valeur", v: 0.5, min: -10, max: 10, step: 0.01 } },
    outputs: { valeur: "Valeur" },
    eval: i => ({ valeur: i.valeur })
  },
  math: {
    name: "Math", cat: "outil", icon: "ph-function",
    choices: { op: { label: "Opération", v: "multiplication", options: Object.keys(OPS).map(k => [k, k[0].toUpperCase() + k.slice(1)]) } },
    inputs: {
      a: { label: "A", v: 0, min: -10, max: 10, step: 0.01 },
      b: { label: "B", v: 1, min: -10, max: 10, step: 0.01 }
    },
    outputs: { valeur: "Résultat" },
    eval: (i, p) => ({ valeur: OPS[p.op](i.a, i.b) })
  },
  plage: {
    name: "Plage", cat: "outil", icon: "ph-arrows-out-line-horizontal",
    inputs: {
      valeur: { label: "Valeur", v: 0, min: -10, max: 10, step: 0.01 },
      deMin: { label: "De min", v: -1, min: -10, max: 10, step: 0.01 },
      deMax: { label: "De max", v: 1, min: -10, max: 10, step: 0.01 },
      versMin: { label: "Vers min", v: 0, min: -10, max: 10, step: 0.01 },
      versMax: { label: "Vers max", v: 1, min: -10, max: 10, step: 0.01 }
    },
    choices: { borner: { label: "Borner", v: "oui", options: [["oui", "Oui"], ["non", "Non"]] } },
    outputs: { valeur: "Valeur" },
    eval: (i, p) => {
      let k = (i.valeur - i.deMin) / ((i.deMax - i.deMin) || 1e-9);
      if (p.borner === "oui") k = Math.max(0, Math.min(1, k));
      return { valeur: i.versMin + k * (i.versMax - i.versMin) };
    }
  }
};

const ICONS = { "Forme": "ph-shapes", "Boucles": "ph-circles-three", "Mouvement": "ph-wind", "Rendu": "ph-paint-brush", "Effets": "ph-sparkle", "Couleurs": "ph-palette", "Cadrage": "ph-crop" };

const fmt = v => {
  if (!isFinite(v)) return "0";
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(3).replace(/\.?0+$/, "") || "0";
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function defaultGraph(sections) {
  const pos = {};
  sections.forEach((t, i) => { pos[t] = { x: i * 250, y: (i % 2) * 40 }; });
  pos.Sortie = { x: sections.length * 250, y: 20 };
  return { view: { x: 30, y: 30, z: 0.72 }, pos, nodes: [], links: [], next: 1 };
}

export function createNodeEditor(api) {
  const root = api.root;
  const sections = api.sections();     // [{ title, items }]
  const titles = sections.map(s => s.title);

  root.innerHTML = `
    <div class="ne-resize" title="Glisser pour redimensionner"></div>
    <div class="ne-bar">
      <span class="ne-title"><i class="ph ph-tree-structure"></i>Nœuds</span>
      <button class="btn" type="button" data-act="add"><i class="ph ph-plus"></i>Ajouter</button>
      <button class="btn" type="button" data-act="fit"><i class="ph ph-corners-out"></i>Recadrer</button>
      <button class="btn" type="button" data-act="clear"><i class="ph ph-broom"></i>Vider</button>
      <span class="ne-hint">Glisse d'une sortie vers un paramètre pour l'animer. <kbd>Maj</kbd>+<kbd>A</kbd> ou clic droit pour ajouter, <kbd>Suppr</kbd> pour effacer.</span>
    </div>
    <div class="ne-view">
      <div class="ne-world">
        <svg class="ne-wires" width="1" height="1"><g class="w-flow"></g><g class="w-links"></g><path class="w-temp" d=""/></svg>
        <div class="ne-layer"></div>
      </div>
      <div class="ne-menu" hidden></div>
      <p class="ne-empty">Aucun nœud de modulation. Ajoute un <b>Oscillateur</b> et branche sa sortie sur un paramètre, par exemple <b>Halo</b>.</p>
    </div>`;

  const view = root.querySelector(".ne-view");
  const world = root.querySelector(".ne-world");
  const layer = root.querySelector(".ne-layer");
  const wFlow = root.querySelector(".w-flow"), wLinks = root.querySelector(".w-links"), wTemp = root.querySelector(".w-temp");
  const menu = root.querySelector(".ne-menu");
  let selected = null;
  let lastOut = {};      // dernières valeurs calculées, pour l'affichage

  const G = () => {
    const S = api.S();
    if (!S.graph || !S.graph.pos) S.graph = defaultGraph(titles);
    for (const t of [...titles, "Sortie"]) if (!S.graph.pos[t]) S.graph.pos[t] = { x: 0, y: 0 };
    return S.graph;
  };

  /* ---------- Rendu des nœuds ---------- */
  function applyView() {
    const v = G().view;
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    view.style.backgroundSize = `${22 * v.z}px ${22 * v.z}px`;
    view.style.backgroundPosition = `${v.x}px ${v.y}px`;
  }

  const linkTo = (node, input) => G().links.find(l => l.tn === node && l.ti === input);

  function pipelineNode(sec) {
    const S = api.S();
    const id = "sec:" + sec.title;
    const p = G().pos[sec.title];
    const rows = sec.items.filter(c => c.key && c.type !== "presets" && (!c.show || c.show())).map(c => {
      if (c.type === "chips") {
        const lbl = c.label || { shape: "Forme", mode: "Rendu", charset: "Caractères", glyphs: "Glyphes" }[c.key] || "Choix";
        return `<div class="row"><span class="sock-gap"></span><label class="sel"><span>${esc(lbl)}</span><select data-key="${c.key}">${c.options.map(([v, l]) => `<option value="${esc(v)}"${String(S[c.key]) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label></div>`;
      }
      if (c.type === "swatches") return "";
      if (c.type === "color") return `<div class="row"><span class="sock-gap"></span><label class="col"><span>${esc(c.label)}</span><input type="color" data-key="${c.key}" value="${S[c.key]}"></label></div>`;
      if (c.type === "toggle") return `<div class="row"><span class="sock-gap"></span><label class="tog"><span>${esc(c.label)}</span><input type="checkbox" data-key="${c.key}"${S[c.key] ? " checked" : ""}></label></div>`;
      if (c.type === "button") return "";
      const animatable = !c.rebuild;
      const linked = linkTo(id, c.key);
      return `<div class="row${linked ? " linked" : ""}">
        ${animatable ? `<span class="sock in${linked ? " on" : ""}" data-node="${id}" data-in="${c.key}" title="Brancher une modulation"></span>` : `<i class="ph ph-lock-simple lock" title="Reconstruit les particules : réglable, mais pas animable"></i>`}
        <div class="field" data-node="${id}" data-key="${c.key}"></div></div>`;
    }).join("");
    return `<div class="node pipe" data-id="${id}" style="left:${p.x}px;top:${p.y}px">
      <header><span class="flow fin"></span><i class="ph ${ICONS[sec.title] || "ph-circle"}"></i>${esc(sec.title)}<span class="flow fout"></span></header>
      <div class="rows">${rows}</div></div>`;
  }

  function outputNode() {
    const p = G().pos.Sortie;
    return `<div class="node pipe out" data-id="sec:Sortie" style="left:${p.x}px;top:${p.y}px">
      <header><span class="flow fin"></span><i class="ph ph-monitor"></i>Sortie</header>
      <div class="rows"><canvas class="viewer" width="220" height="140"></canvas><div class="row note">${esc(api.formatLabel())}</div></div></div>`;
  }

  function modNode(n) {
    const def = NODE_TYPES[n.type];
    const outs = Object.entries(def.outputs).map(([k, l]) => `<div class="row out"><span class="lab">${esc(l)}</span><output data-out="${n.id}:${k}">0</output><span class="sock out" data-node="${n.id}" data-out="${k}" title="Glisser vers un paramètre"></span></div>`).join("");
    const choices = Object.entries(def.choices || {}).map(([k, c]) => `<div class="row"><span class="sock-gap"></span><label class="sel"><span>${esc(c.label)}</span><select data-mod="${n.id}" data-key="${k}">${c.options.map(([v, l]) => `<option value="${v}"${n.p[k] === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label></div>`).join("");
    const ins = Object.entries(def.inputs).map(([k]) => {
      const linked = linkTo(n.id, k);
      return `<div class="row${linked ? " linked" : ""}"><span class="sock in${linked ? " on" : ""}" data-node="${n.id}" data-in="${k}"></span><div class="field" data-node="${n.id}" data-key="${k}"></div></div>`;
    }).join("");
    return `<div class="node mod cat-${def.cat}${selected === n.id ? " sel" : ""}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
      <header><i class="ph ${def.icon}"></i>${esc(def.name)}<button type="button" class="nx" data-del="${n.id}" aria-label="Supprimer le nœud"><i class="ph ph-x"></i></button></header>
      <div class="rows">${outs}${choices}${ins}</div></div>`;
  }

  function render() {
    const g = G();
    layer.innerHTML = sections.map(pipelineNode).join("") + outputNode() + g.nodes.map(modNode).join("");
    root.querySelector(".ne-empty").hidden = g.nodes.length > 0;
    // Champs numériques
    layer.querySelectorAll(".field").forEach(el => bindField(el));
    applyView();
    requestAnimationFrame(drawWires);
  }

  /* ---------- Champs numériques façon Blender : glisser pour régler, cliquer pour taper ---------- */
  function fieldSpec(el) {
    const node = el.dataset.node, key = el.dataset.key;
    if (node.startsWith("sec:")) {
      const c = api.control(key);
      return { label: c.label, min: c.min, max: c.max, step: c.step, fmt: c.fmt, get: () => api.S()[key], set: v => api.set(key, v, c) };
    }
    const n = G().nodes.find(x => x.id === node);
    const d = NODE_TYPES[n.type].inputs[key];
    return { label: d.label, min: d.min, max: d.max, step: d.step, get: () => n.p[key], set: v => { n.p[key] = v; api.save(); } };
  }

  function paintField(el, value, driven) {
    const s = el._spec;
    const v = value ?? s.get();
    const k = Math.max(0, Math.min(1, (v - s.min) / ((s.max - s.min) || 1)));
    el.querySelector(".f-fill").style.transform = `scaleX(${k})`;
    el.querySelector(".f-val").textContent = s.fmt ? s.fmt(Math.round(v / s.step) * s.step) : fmt(v);
    el.classList.toggle("driven", !!driven);
  }

  function bindField(el) {
    const s = el._spec = fieldSpec(el);
    el.innerHTML = `<span class="f-fill"></span><span class="f-label">${esc(s.label)}</span><span class="f-val"></span>`;
    paintField(el);
    el.addEventListener("pointerdown", e => {
      if (e.button !== 0 || el.classList.contains("driven")) return;
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = s.get();
      let moved = false;
      const move = ev => {
        const dx = ev.clientX - x0;
        if (Math.abs(dx) > 3) moved = true;
        if (!moved) return;
        const span = s.max - s.min;
        let v = v0 + dx / 220 * span * (ev.shiftKey ? 0.1 : 1);
        v = Math.round(v / s.step) * s.step;
        v = Math.max(s.min, Math.min(s.max, v));
        s.set(+v.toFixed(6));
        paintField(el);
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        if (!moved) typeIn(el);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
  }

  function typeIn(el) {
    const s = el._spec;
    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.value = s.get();
    input.className = "f-input";
    el.appendChild(input);
    input.focus();
    input.select();
    const done = commit => {
      if (commit && input.value !== "") s.set(Math.max(s.min, Math.min(s.max, +input.value)));
      input.remove();
      paintField(el);
    };
    input.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
    input.addEventListener("blur", () => done(true));
  }

  /* ---------- Fils ---------- */
  function worldPos(el) {
    const r = el.getBoundingClientRect(), w = world.getBoundingClientRect(), z = G().view.z;
    return [(r.left + r.width / 2 - w.left) / z, (r.top + r.height / 2 - w.top) / z];
  }
  const curve = ([x1, y1], [x2, y2]) => {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}C${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };
  const sockEl = (node, attr, key) => layer.querySelector(`.sock[data-node="${CSS.escape(node)}"][data-${attr}="${CSS.escape(key)}"]`);

  function drawWires() {
    const g = G();
    // Le flux du pipeline, d'un nœud au suivant (décoratif)
    const chain = [...titles, "Sortie"];
    let flow = "";
    for (let i = 0; i < chain.length - 1; i++) {
      const a = layer.querySelector(`.node[data-id="sec:${CSS.escape(chain[i])}"] .fout`);
      const b = layer.querySelector(`.node[data-id="sec:${CSS.escape(chain[i + 1])}"] .fin`);
      if (a && b) flow += `<path d="${curve(worldPos(a), worldPos(b))}"/>`;
    }
    wFlow.innerHTML = flow;
    wLinks.innerHTML = g.links.map((l, i) => {
      const a = sockEl(l.fn, "out", l.fo), b = sockEl(l.tn, "in", l.ti);
      if (!a || !b) return "";
      const d = curve(worldPos(a), worldPos(b));
      return `<path class="hit" data-link="${i}" d="${d}"/><path class="wire${l.tn.startsWith("sec:") ? " to-pipe" : ""}" d="${d}"/>`;
    }).join("");
  }

  /* ---------- Interactions ---------- */
  let drag = null;

  function toWorld(cx, cy) {
    const w = world.getBoundingClientRect(), z = G().view.z;
    return [(cx - w.left) / z, (cy - w.top) / z];
  }

  function reaches(from, target) {
    // Le nœud « from » dépend-il (en amont) de « target » ? Sert à refuser les boucles.
    const seen = new Set();
    const walk = id => {
      if (id === target) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return G().links.filter(l => l.tn === id).some(l => walk(l.fn));
    };
    return walk(from);
  }

  function connect(fn, fo, tn, ti) {
    const g = G();
    if (fn === tn || reaches(fn, tn)) { api.toast("Connexion refusée : elle créerait une boucle"); return; }
    g.links = g.links.filter(l => !(l.tn === tn && l.ti === ti));
    g.links.push({ fn, fo, tn, ti });
    api.graphChanged();
    render();
  }

  view.addEventListener("pointerdown", e => {
    hideMenu();
    const t = e.target;
    if (t.closest(".field, select, input, .nx")) return;
    const sockOut = t.closest(".sock.out");
    const sockIn = t.closest(".sock.in");
    const header = t.closest(".node header");
    view.setPointerCapture(e.pointerId);

    if (sockOut) {
      drag = { mode: "wire", fn: sockOut.dataset.node, fo: sockOut.dataset.out, from: worldPos(sockOut) };
    } else if (sockIn) {
      // Tirer depuis une entrée branchée : on détache le fil et on le garde en main
      const g = G();
      const l = linkTo(sockIn.dataset.node, sockIn.dataset.in);
      if (l) {
        g.links = g.links.filter(x => x !== l);
        api.graphChanged();
        const a = sockEl(l.fn, "out", l.fo);
        drag = { mode: "wire", fn: l.fn, fo: l.fo, from: a ? worldPos(a) : toWorld(e.clientX, e.clientY) };
        render();
      }
    } else if (header) {
      const node = header.closest(".node");
      const id = node.dataset.id;
      selected = id.startsWith("sec:") ? null : id;
      layer.querySelectorAll(".node.mod").forEach(n => n.classList.toggle("sel", n.dataset.id === selected));
      const g = G();
      const obj = id.startsWith("sec:") ? g.pos[id.slice(4)] : g.nodes.find(n => n.id === id);
      drag = { mode: "node", el: node, obj, x0: e.clientX, y0: e.clientY, ox: obj.x, oy: obj.y };
    } else if (t.closest(".w-links .hit")) {
      const i = +t.closest(".hit").dataset.link;
      G().links.splice(i, 1);
      api.graphChanged();
      render();
    } else if (!t.closest(".node")) {
      selected = null;
      layer.querySelectorAll(".node.sel").forEach(n => n.classList.remove("sel"));
      const v = G().view;
      drag = { mode: "pan", x0: e.clientX, y0: e.clientY, vx: v.x, vy: v.y };
    }
  });

  view.addEventListener("pointermove", e => {
    lastPointer = [e.clientX, e.clientY];
    if (!drag) return;
    if (drag.mode === "pan") {
      const v = G().view;
      v.x = drag.vx + e.clientX - drag.x0;
      v.y = drag.vy + e.clientY - drag.y0;
      applyView();
    } else if (drag.mode === "node") {
      const z = G().view.z;
      drag.obj.x = Math.round(drag.ox + (e.clientX - drag.x0) / z);
      drag.obj.y = Math.round(drag.oy + (e.clientY - drag.y0) / z);
      drag.el.style.left = drag.obj.x + "px";
      drag.el.style.top = drag.obj.y + "px";
      drawWires();
    } else if (drag.mode === "wire") {
      wTemp.setAttribute("d", curve(drag.from, toWorld(e.clientX, e.clientY)));
    }
  });

  view.addEventListener("pointerup", e => {
    if (drag && drag.mode === "wire") {
      wTemp.setAttribute("d", "");
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const sockIn = target && target.closest(".sock.in");
      if (sockIn) connect(drag.fn, drag.fo, sockIn.dataset.node, sockIn.dataset.in);
    }
    if (drag && (drag.mode === "node" || drag.mode === "pan")) api.save();
    drag = null;
  });

  view.addEventListener("wheel", e => {
    e.preventDefault();
    const v = G().view;
    const r = view.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const z = Math.max(0.3, Math.min(1.6, v.z * Math.exp(-e.deltaY * 0.0015)));
    v.x = mx - (mx - v.x) * z / v.z;
    v.y = my - (my - v.y) * z / v.z;
    v.z = z;
    applyView();
  }, { passive: false });

  // Sélecteurs, couleurs et cases dans les nœuds
  layer.addEventListener("change", e => {
    const el = e.target;
    if (el.dataset.mod) {
      const n = G().nodes.find(x => x.id === el.dataset.mod);
      n.p[el.dataset.key] = el.value;
      api.save();
      return;
    }
    const key = el.dataset.key;
    if (!key) return;
    const c = api.control(key);
    const value = el.type === "checkbox" ? el.checked : el.value;
    api.set(key, value, c);
    if (["shape", "mode"].includes(key)) render();
  });
  layer.addEventListener("input", e => {
    if (e.target.type === "color" && e.target.dataset.key) api.set(e.target.dataset.key, e.target.value, api.control(e.target.dataset.key));
  });
  layer.addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) removeNode(del.dataset.del);
  });

  function removeNode(id) {
    const g = G();
    g.nodes = g.nodes.filter(n => n.id !== id);
    g.links = g.links.filter(l => l.fn !== id && l.tn !== id);
    if (selected === id) selected = null;
    api.graphChanged();
    render();
  }

  /* ---------- Menu d'ajout ---------- */
  let lastPointer = [0, 0];
  function showMenu(cx, cy) {
    const r = view.getBoundingClientRect();
    const groups = { entree: "Entrées", outil: "Outils" };
    menu.innerHTML = Object.entries(groups).map(([cat, label]) =>
      `<p>${label}</p>` + Object.entries(NODE_TYPES).filter(([, d]) => d.cat === cat).map(([k, d]) => `<button type="button" data-type="${k}"><i class="ph ${d.icon}"></i>${d.name}</button>`).join("")
    ).join("");
    menu.style.left = Math.min(cx - r.left, r.width - 200) + "px";
    menu.style.top = Math.min(cy - r.top, r.height - 300) + "px";
    menu.hidden = false;
    menu.dataset.wx = toWorld(cx, cy)[0];
    menu.dataset.wy = toWorld(cx, cy)[1];
  }
  function hideMenu() { menu.hidden = true; }
  menu.addEventListener("pointerdown", e => e.stopPropagation());
  menu.addEventListener("click", e => {
    const b = e.target.closest("[data-type]");
    if (!b) return;
    addNode(b.dataset.type, +menu.dataset.wx, +menu.dataset.wy);
    hideMenu();
  });
  view.addEventListener("contextmenu", e => { e.preventDefault(); showMenu(e.clientX, e.clientY); });

  function addNode(type, x, y) {
    const g = G();
    const def = NODE_TYPES[type];
    const p = {};
    for (const [k, d] of Object.entries(def.inputs)) p[k] = d.v;
    for (const [k, c] of Object.entries(def.choices || {})) p[k] = c.v;
    const n = { id: "n" + g.next++, type, x: Math.round(x), y: Math.round(y), p };
    g.nodes.push(n);
    selected = n.id;
    api.save();
    render();
    return n;
  }

  root.querySelector(".ne-bar").addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "add") { const r = b.getBoundingClientRect(); showMenu(r.left, r.bottom + 4); }
    if (b.dataset.act === "fit") fit();
    if (b.dataset.act === "clear") { const g = G(); g.nodes = []; g.links = []; api.graphChanged(); render(); }
  });

  addEventListener("keydown", e => {
    if (root.hidden || e.target.closest("input, select, textarea")) return;
    const over = root.matches(":hover");
    if (over && e.shiftKey && (e.key === "A" || e.key === "a")) { e.preventDefault(); e.stopImmediatePropagation(); showMenu(lastPointer[0], lastPointer[1]); }
    if (selected && (e.key === "Delete" || e.key === "Backspace" || (over && (e.key === "x" || e.key === "X")))) { e.preventDefault(); e.stopImmediatePropagation(); removeNode(selected); }
    if (e.key === "Escape") hideMenu();
  }, true);

  function fit() {
    const nodes = [...layer.querySelectorAll(".node")];
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const x = parseFloat(n.style.left), y = parseFloat(n.style.top);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + n.offsetWidth); maxY = Math.max(maxY, y + n.offsetHeight);
    }
    const r = view.getBoundingClientRect(), pad = 30;
    const z = Math.max(0.3, Math.min(1.2, Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY))));
    G().view = { x: pad - minX * z + (r.width - pad * 2 - (maxX - minX) * z) / 2, y: pad - minY * z, z };
    applyView();
    api.save();
  }

  /* ---------- Évaluation ---------- */
  const api2 = { noise: api.noise, mouse: api.mouse };

  function evaluate(t) {
    const g = G();
    if (!g.links.length) { lastOut = {}; return null; }
    const memo = new Map(), visiting = new Set();
    const nodeById = new Map(g.nodes.map(n => [n.id, n]));
    const outputs = id => {
      if (memo.has(id)) return memo.get(id);
      const n = nodeById.get(id);
      if (!n || visiting.has(id)) return {};
      visiting.add(id);
      const def = NODE_TYPES[n.type];
      const inp = {};
      for (const k of Object.keys(def.inputs)) {
        const l = g.links.find(x => x.tn === id && x.ti === k);
        inp[k] = l ? (outputs(l.fn)[l.fo] ?? 0) : n.p[k];
      }
      const res = def.eval(inp, n.p, t, n, api2);
      visiting.delete(id);
      memo.set(id, res);
      return res;
    };
    // On calcule aussi les nœuds non branchés, pour afficher leur valeur
    for (const n of g.nodes) outputs(n.id);
    const ov = {};
    for (const l of g.links) if (l.tn.startsWith("sec:")) ov[l.ti] = memo.get(l.fn)?.[l.fo] ?? 0;
    lastOut = Object.fromEntries([...memo].map(([id, o]) => [id, o]));
    return ov;
  }

  // Valeurs en direct dans les nœuds, environ 12 fois par seconde
  let tickN = 0;
  function tick(ov) {
    if (root.hidden || tickN++ % 5) return;
    for (const o of layer.querySelectorAll("output[data-out]")) {
      const [id, k] = o.dataset.out.split(":");
      o.textContent = fmt(lastOut[id]?.[k] ?? 0);
    }
    for (const el of layer.querySelectorAll(".field")) {
      const node = el.dataset.node, key = el.dataset.key;
      if (node.startsWith("sec:")) paintField(el, ov && key in ov ? ov[key] : undefined, ov && key in ov);
      else {
        const l = linkTo(node, key);
        if (l) paintField(el, lastOut[l.fn]?.[l.fo] ?? 0, true);
        else if (el.classList.contains("driven")) paintField(el);
      }
    }
    const viewer = layer.querySelector(".viewer");
    if (viewer) {
      const src = api.canvas();
      const g = viewer.getContext("2d");
      const k = Math.min(viewer.width / src.width, viewer.height / src.height);
      g.fillStyle = "#0a0a0b"; g.fillRect(0, 0, viewer.width, viewer.height);
      g.drawImage(src, (viewer.width - src.width * k) / 2, (viewer.height - src.height * k) / 2, src.width * k, src.height * k);
    }
  }

  return { render, evaluate, tick, fit, addNode, connect, refresh: () => { if (!root.hidden) render(); } };
}
