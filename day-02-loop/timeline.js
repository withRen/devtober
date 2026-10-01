/* =========================================================
   Timeline et images clés.
   Chaque réglage animé a sa piste : une liste de clés { t, v, e }
   (temps en secondes, valeur, interpolation vers cette clé).
   La timeline boucle sur sa durée ; ses valeurs remplacent les
   réglages le temps du rendu, comme les nœuds.
   ========================================================= */

const EASES = {
  lineaire: p => p,
  doux: p => p * p * (3 - 2 * p),
  constant: () => 0
};
export const EASE_LABELS = [["lineaire", "Linéaire"], ["doux", "Doux"], ["constant", "Constant"]];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgbHex = c => "#" + c.map(x => Math.round(x).toString(16).padStart(2, "0")).join("");
const mod = (a, b) => ((a % b) + b) % b;

export function createTimeline(api) {
  const root = api.root;
  const S = () => api.S();
  const D = () => S().duration || 10;
  const keysOf = p => (S().keys && S().keys[p]) || [];
  let selected = null;          // { p, i }
  let lastTime = -1;

  root.innerHTML = `
    <div class="tl-resize" title="Glisser pour agrandir, double-clic pour la taille par défaut" aria-hidden="true"></div>
    <div class="tl-bar">
      <span class="tl-title"><i class="ph ph-film-strip"></i><span>Timeline</span></span>
      <button class="btn icon" type="button" data-act="start" aria-label="Revenir au début"><i class="ph ph-skip-back"></i></button>
      <button class="btn icon" type="button" data-act="prev" aria-label="Image clé précédente"><i class="ph ph-caret-left"></i></button>
      <button class="btn icon" type="button" data-act="next" aria-label="Image clé suivante"><i class="ph ph-caret-right"></i></button>
      <span class="tl-time mono"><b>0.00</b> / <span class="tl-dur-out">10.00</span> s</span>
      <label class="tl-dur">Durée<input type="number" min="1" max="120" step="0.5" class="mono" aria-label="Durée de la boucle en secondes"><span>s</span></label>
      <span class="tl-sel" hidden></span>
      <span class="spacer"></span>
      <span class="tl-hint">Double-clic sur une piste pour poser une clé</span>
    </div>
    <div class="tl-body">
      <div class="tl-grid"></div>
      <div class="tl-over"><div class="tl-head"></div></div>
      <p class="tl-empty">Aucune image clé. Clique sur <i class="ph ph-diamond"></i> à côté d'un réglage pour en poser une à l'instant courant.</p>
    </div>`;

  const grid = root.querySelector(".tl-grid");
  const over = root.querySelector(".tl-over"), head = root.querySelector(".tl-head");
  const selBox = root.querySelector(".tl-sel");
  const durInput = root.querySelector(".tl-dur input");

  /* ---------- Hauteur réglable par le bord haut ---------- */
  const body = root.querySelector(".tl-body"), grip = root.querySelector(".tl-resize");
  function setHeight(h) {
    if (h == null) { root.classList.remove("sized"); root.style.removeProperty("--tl-h"); }
    else {
      // L'aperçu garde au moins 180 px
      const max = Math.max(120, (api.maxHeight ? api.maxHeight() : innerHeight * 0.7) - (root.offsetHeight - body.offsetHeight));
      root.classList.add("sized");
      root.style.setProperty("--tl-h", Math.round(Math.max(80, Math.min(max, h))) + "px");
    }
  }
  try { const h = +localStorage.getItem("loop-tl-h"); if (h) setHeight(h); } catch (e) {}
  grip.addEventListener("pointerdown", e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = body.offsetHeight;
    root.classList.add("resizing");
    const move = ev => { setHeight(h0 - (ev.clientY - y0)); api.resized(); };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      root.classList.remove("resizing");
      try { localStorage.setItem("loop-tl-h", body.offsetHeight); } catch (err) {}
      api.resized(true);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
  // Fenêtre plus petite : la hauteur enregistrée est rebornée pour laisser l'aperçu visible
  addEventListener("resize", () => { if (root.classList.contains("sized") && !root.hidden) setHeight(body.offsetHeight); });
  grip.addEventListener("dblclick", () => {
    setHeight(null);
    try { localStorage.removeItem("loop-tl-h"); } catch (e) {}
    api.resized(true);
  });

  /* ---------- Données ---------- */
  function now() { return mod(api.time(), D()); }

  function valueAt(p, time) {
    const ks = keysOf(p);
    if (!ks.length) return undefined;
    if (time <= ks[0].t) return ks[0].v;
    const last = ks[ks.length - 1];
    if (time >= last.t) return last.v;
    let i = 1;
    while (ks[i].t < time) i++;
    const a = ks[i - 1], b = ks[i];
    const k = (EASES[b.e] || EASES.doux)((time - a.t) / ((b.t - a.t) || 1));
    if (typeof a.v === "string") {
      const ca = hexRGB(a.v), cb = hexRGB(b.v);
      return rgbHex(ca.map((x, j) => x + (cb[j] - x) * k));
    }
    return a.v + (b.v - a.v) * k;
  }

  function evaluate(time) {
    const all = S().keys;
    if (!all) return null;
    const tt = mod(time, D()), ov = {};
    for (const p of Object.keys(all)) if (all[p].length) ov[p] = valueAt(p, tt);
    return Object.keys(ov).length ? ov : null;
  }

  const isAnimated = p => keysOf(p).length > 0;
  const EPS = 1 / 120;
  const indexAt = (p, time) => keysOf(p).findIndex(k => Math.abs(k.t - time) < EPS);
  const hasKeyAt = (p, time = now()) => indexAt(p, snap(time)) >= 0;

  function snap(time, free) {
    const d = D();
    let v = Math.max(0, Math.min(d, time));
    if (api.snap() && !free) v = Math.round(v * 10) / 10;
    return +v.toFixed(3);
  }

  function sortKeys(p) {
    const ks = keysOf(p);
    const sel = selected && selected.p === p ? ks[selected.i] : null;
    ks.sort((a, b) => a.t - b.t);
    if (sel) selected.i = ks.indexOf(sel);
  }

  // Pose (ou met à jour) une clé ; renvoie son index
  function setKey(p, time, value) {
    const s = S();
    if (!s.keys) s.keys = {};
    if (!s.keys[p]) s.keys[p] = [];
    const ks = s.keys[p];
    time = snap(time);
    let i = indexAt(p, time);
    if (i >= 0) ks[i].v = value;
    else { ks.push({ t: time, v: value, e: "doux" }); sortKeys(p); i = indexAt(p, time); }
    return i;
  }

  function removeKey(p, i) {
    const s = S(), ks = keysOf(p);
    ks.splice(i, 1);
    if (!ks.length) delete s.keys[p];
    selected = null;
  }

  function removeTrack(p) {
    delete S().keys[p];
    if (selected && selected.p === p) selected = null;
    api.changed();
    render();
  }

  /* ---------- Rendu ---------- */
  const tracks = () => {
    const all = S().keys || {};
    return api.order().filter(p => all[p] && all[p].length);
  };
  const pct = time => `${(time / D()) * 100}%`;

  function ruler() {
    const d = D();
    const step = d <= 6 ? 0.5 : d <= 15 ? 1 : d <= 40 ? 5 : 10;
    let html = "";
    for (let s = 0; s <= d + 1e-6; s += step) {
      const major = Math.abs(s - Math.round(s / (step * 2)) * step * 2) < 1e-6 || step >= 1;
      html += `<span class="tick${major ? "" : " minor"}" style="left:${pct(s)}">${major ? `${+s.toFixed(1)}s` : ""}</span>`;
    }
    return html;
  }

  function dotShape(e) { return e === "constant" ? "sq" : e === "lineaire" ? "di" : "ci"; }

  function render() {
    const list = tracks();
    durInput.value = D();
    root.querySelector(".tl-dur-out").textContent = D().toFixed(2);
    root.querySelector(".tl-empty").hidden = list.length > 0;
    grid.innerHTML = `<div class="tl-corner"></div><div class="tl-ruler" data-scrub><div class="tl-in">${ruler()}</div></div>` +
      list.map(p => {
        const ks = keysOf(p);
        return `<div class="tl-label" title="${esc(api.label(p))}"><span>${esc(api.label(p))}</span><button type="button" class="tl-x" data-rm="${esc(p)}" aria-label="Supprimer l'animation de ${esc(api.label(p))}"><i class="ph ph-x"></i></button></div>
        <div class="tl-lane" data-lane="${esc(p)}"><div class="tl-in">${ks.map((k, i) =>
          `<button type="button" class="kd ${dotShape(k.e)}${selected && selected.p === p && selected.i === i ? " sel" : ""}" data-p="${esc(p)}" data-i="${i}" style="left:${pct(k.t)}" aria-label="Clé ${esc(api.label(p))} à ${k.t.toFixed(2)} s"></button>`).join("")}</div></div>`;
      }).join("");
    renderSel();
    lastTime = -1;
    tick();
  }

  function renderSel() {
    if (!selected || !keysOf(selected.p)[selected.i]) { selected = null; selBox.hidden = true; root.classList.remove("has-sel"); return; }
    const k = keysOf(selected.p)[selected.i];
    const color = typeof k.v === "string";
    const c = api.control(selected.p);
    selBox.hidden = false;
    root.classList.add("has-sel");
    selBox.innerHTML = `<span class="tl-sel-name">${esc(api.label(selected.p))}</span><span class="mono tl-sel-t">${k.t.toFixed(2)} s</span>
      ${color ? `<input type="color" class="tl-val" value="${k.v}" aria-label="Valeur de la clé">`
        : `<input type="number" class="tl-val mono" value="${+(+k.v).toFixed(4)}" step="${c ? c.step : 0.01}" ${c ? `min="${c.min}" max="${c.max}"` : ""} aria-label="Valeur de la clé">`}
      <span class="seg" role="group" aria-label="Interpolation vers cette clé">${EASE_LABELS.map(([v, l]) => `<button type="button" data-ease="${v}" aria-pressed="${k.e === v}">${l}</button>`).join("")}</span>
      <button class="btn icon" type="button" data-act="del" aria-label="Supprimer la clé"><i class="ph ph-trash"></i></button>`;
  }

  // Tête de lecture et compteur, à chaque image
  function tick() {
    const tt = now();
    if (Math.abs(tt - lastTime) < 1e-4) return;
    lastTime = tt;
    head.style.left = pct(tt);
    root.querySelector(".tl-time b").textContent = tt.toFixed(2);
  }

  /* ---------- Interactions ---------- */
  function timeFromX(el, clientX) {
    const r = el.querySelector(".tl-in")?.getBoundingClientRect() || el.getBoundingClientRect();
    return (clientX - r.left) / r.width * D();
  }

  function seek(time) {
    api.setTime(Math.max(0, Math.min(D() - 1e-3, time)));
    lastTime = -1;
    tick();
    api.afterSeek();
  }

  function select(p, i) {
    selected = p == null ? null : { p, i };
    for (const el of grid.querySelectorAll(".kd")) el.classList.toggle("sel", !!selected && el.dataset.p === p && +el.dataset.i === i);
    renderSel();
  }

  grid.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const rm = e.target.closest("[data-rm]");
    if (rm) return;
    const dot = e.target.closest(".kd");
    if (dot) {
      e.preventDefault();
      const p = dot.dataset.p, i = +dot.dataset.i, k = keysOf(p)[i];
      select(p, i);
      const x0 = e.clientX, lane = dot.closest(".tl-lane");
      let moved = false;
      dot.setPointerCapture(e.pointerId);
      const move = ev => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return;
        moved = true;
        k.t = snap(timeFromX(lane, ev.clientX), ev.shiftKey);
        dot.style.left = pct(k.t);
        sortKeys(p);
        selBox.querySelector(".tl-sel-t").textContent = `${k.t.toFixed(2)} s`;
      };
      const up = () => {
        dot.removeEventListener("pointermove", move);
        dot.removeEventListener("pointerup", up);
        // Deux clés au même instant : on garde celle qu'on vient de déplacer
        if (moved) {
          const ks = keysOf(p);
          for (let j = ks.length - 1; j >= 0; j--) if (ks[j] !== k && Math.abs(ks[j].t - k.t) < EPS) ks.splice(j, 1);
          sortKeys(p);
          selected = { p, i: ks.indexOf(k) };
          api.changed();
          render();
        } else seek(k.t);
      };
      dot.addEventListener("pointermove", move);
      dot.addEventListener("pointerup", up);
      return;
    }
    const scrub = e.target.closest("[data-scrub], .tl-lane");
    if (!scrub) return;
    e.preventDefault();
    if (selected) select(null);
    scrub.setPointerCapture(e.pointerId);
    seek(timeFromX(scrub, e.clientX));
    const move = ev => seek(timeFromX(scrub, ev.clientX));
    const up = () => { scrub.removeEventListener("pointermove", move); scrub.removeEventListener("pointerup", up); };
    scrub.addEventListener("pointermove", move);
    scrub.addEventListener("pointerup", up);
  });

  grid.addEventListener("click", e => {
    const rm = e.target.closest("[data-rm]");
    if (rm) removeTrack(rm.dataset.rm);
  });

  // Double-clic sur une piste : une clé à cet instant, avec la valeur du moment
  grid.addEventListener("dblclick", e => {
    const lane = e.target.closest(".tl-lane");
    if (!lane || e.target.closest(".kd")) return;
    const p = lane.dataset.lane, time = snap(timeFromX(lane, e.clientX));
    const i = setKey(p, time, valueAt(p, time));
    selected = { p, i };
    api.changed();
    render();
  });

  root.querySelector(".tl-bar").addEventListener("click", e => {
    const b = e.target.closest("[data-act], [data-ease]");
    if (!b) return;
    if (b.dataset.ease && selected) {
      keysOf(selected.p)[selected.i].e = b.dataset.ease;
      api.changed(); render();
      return;
    }
    const act = b.dataset.act;
    if (act === "start") seek(0);
    else if (act === "prev") jump(-1);
    else if (act === "next") jump(1);
    else if (act === "del") deleteSelected();
  });

  selBox.addEventListener("change", e => {
    if (!e.target.classList.contains("tl-val") || !selected) return;
    const k = keysOf(selected.p)[selected.i];
    if (e.target.type === "color") k.v = e.target.value;
    else {
      const c = api.control(selected.p);
      let v = +e.target.value;
      if (!Number.isFinite(v)) return;
      if (c) v = Math.max(c.min, Math.min(c.max, v));
      k.v = v;
    }
    api.changed();
    render();
  });
  selBox.addEventListener("keydown", e => e.stopPropagation());

  durInput.addEventListener("change", () => {
    const v = Math.max(1, Math.min(120, +durInput.value || 10));
    S().duration = v;
    api.changed();
    render();
  });
  durInput.addEventListener("keydown", e => e.stopPropagation());

  // Clé précédente ou suivante, toutes pistes confondues
  function jump(dir) {
    const tt = now();
    const times = [...new Set(tracks().flatMap(p => keysOf(p).map(k => k.t)))].sort((a, b) => a - b);
    if (!times.length) { api.toast("Aucune image clé"); return; }
    const target = dir > 0 ? times.find(x => x > tt + EPS) ?? times[0] : [...times].reverse().find(x => x < tt - EPS) ?? times[times.length - 1];
    seek(target);
  }

  function deleteSelected() {
    if (!selected) return false;
    removeKey(selected.p, selected.i);
    api.changed();
    render();
    return true;
  }

  // Un clic ailleurs que dans la timeline désélectionne la clé
  addEventListener("pointerdown", e => { if (selected && !root.contains(e.target)) select(null); }, true);

  return {
    render, tick, evaluate, valueAt, isAnimated, hasKeyAt, setKey, now, seek, jump, deleteSelected,
    get selected() { return selected; },
    // Le losange d'un réglage : pose une clé, ou retire celle de l'instant courant
    toggleKey(p, value) {
      const tt = now(), i = indexAt(p, snap(tt));
      if (i >= 0) { removeKey(p, i); }
      else { const j = setKey(p, tt, value); selected = { p, i: j }; }
      api.changed();
      render();
    }
  };
}
