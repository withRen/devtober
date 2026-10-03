/* =========================================================
   Débruitage par réseau de neurones : FFDNet (Zhang et al., 2018),
   poids couleur de KAIR, exécuté en compute shaders WebGPU.

   Le réseau travaille en sRGB [0, 1], en demi-résolution :
   chaque bloc 2 × 2 devient 12 canaux (PixelUnShuffle), plus un
   canal qui donne le niveau de bruit. Puis 12 convolutions 3 × 3
   (13 → 96, 10 × 96 → 96, 96 → 12) avec ReLU, et PixelShuffle.

   Les activations vivent dans des tampons de vec4f (4 canaux par
   case) ; chaque thread calcule un pixel et 16 canaux de sortie,
   avec des produits matrice 4 × 4 par vecteur. On traite l'image
   par tuiles de 640 px, avec une marge de 24 px (12 couches, une
   demi-résolution) pour qu'aucune jointure ne se voie.
   ========================================================= */

const GU = GPUBufferUsage;
const TILE = 640;          // cœur d'une tuile, en pixels pleine résolution
const M = 24;              // marge pleine résolution (12 couches × 2)
const SMAX = TILE / 2 + M; // côté maximal d'une tuile en demi-résolution
const C4 = 24;             // 96 canaux = 24 groupes de 4

const COMMON = /* wgsl */ `
fn s2l(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
fn l2s(c0: vec3f) -> vec3f {
  let c = max(c0, vec3f(0.0));
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}
`;

// Image linéaire → entrée du réseau (12 canaux sRGB + niveau de bruit).
const PACK = COMMON + /* wgsl */ `
struct U { p: vec4f };   // gain, sigma, S
@group(0) @binding(0) var lin: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outb: array<vec4f>;
@group(0) @binding(2) var<uniform> u: U;
fn enc(c: vec3f) -> vec3f { return l2s(clamp(c * u.p.x, vec3f(0.0), vec3f(1.0))); }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  let S = u32(u.p.z);
  if (g.x >= S || g.y >= S) { return; }
  let b = vec2i(g.xy) * 2;
  let a = enc(textureLoad(lin, b, 0).rgb);
  let c = enc(textureLoad(lin, b + vec2i(1, 0), 0).rgb);
  let d = enc(textureLoad(lin, b + vec2i(0, 1), 0).rgb);
  let e = enc(textureLoad(lin, b + vec2i(1, 1), 0).rgb);
  // Ordre de PixelUnShuffle : canal × 4 + dy × 2 + dx.
  let n = S * S;
  let i = g.y * S + g.x;
  outb[i] = vec4f(a.r, c.r, d.r, e.r);
  outb[n + i] = vec4f(a.g, c.g, d.g, e.g);
  outb[2u * n + i] = vec4f(a.b, c.b, d.b, e.b);
  outb[3u * n + i] = vec4f(u.p.y, 0.0, 0.0, 0.0);
}
`;

// Convolution 3 × 3, zéros au bord, ReLU en option.
const CONV = /* wgsl */ `
struct U { p: vec4f, q: vec4f };   // ic4, oc4, S, relu ; décalage des poids, du biais
@group(0) @binding(0) var<storage, read> inb: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outb: array<vec4f>;
@group(0) @binding(2) var<storage, read> w: array<vec4f>;
@group(0) @binding(3) var<uniform> u: U;
@compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) g: vec3u) {
  let S = u32(u.p.z);
  if (g.x >= S || g.y >= S) { return; }
  let ic4 = u32(u.p.x);
  let oc4 = u32(u.p.y);
  let o0 = g.z * 4u;
  let ng = min(4u, oc4 - o0);
  let wOff = u32(u.q.x);
  let bOff = u32(u.q.y);
  let n = S * S;
  var acc: array<vec4f, 4>;
  for (var j = 0u; j < ng; j++) { acc[j] = w[bOff + o0 + j]; }
  for (var ic = 0u; ic < ic4; ic++) {
    for (var ky = 0u; ky < 3u; ky++) {
      let yy = i32(g.y) + i32(ky) - 1;
      if (yy < 0 || yy >= i32(S)) { continue; }
      for (var kx = 0u; kx < 3u; kx++) {
        let xx = i32(g.x) + i32(kx) - 1;
        if (xx < 0 || xx >= i32(S)) { continue; }
        let v = inb[ic * n + u32(yy) * S + u32(xx)];
        let tap = ky * 3u + kx;
        for (var j = 0u; j < ng; j++) {
          let b = wOff + (((o0 + j) * ic4 + ic) * 9u + tap) * 4u;
          acc[j] += mat4x4f(w[b], w[b + 1u], w[b + 2u], w[b + 3u]) * v;
        }
      }
    }
  }
  for (var j = 0u; j < ng; j++) {
    var r = acc[j];
    if (u.p.w > 0.5) { r = max(r, vec4f(0.0)); }
    outb[(o0 + j) * n + g.y * S + g.x] = r;
  }
}
`;

// Sortie du réseau → image linéaire. La luminance et la couleur
// se dosent séparément ; ce qui dépasse le blanc (hautes lumières HDR) garde l'original.
const UNPACK = COMMON + /* wgsl */ `
struct U { p: vec4f, q: vec4f, r: vec4f };   // gain, luminance, couleur, S ; ox, oy ; cw, ch, W, H
@group(0) @binding(0) var lin: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> inb: array<vec4f>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> u: U;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (f32(g.x) >= u.r.x || f32(g.y) >= u.r.y) { return; }
  let gp = vec2u(u.q.xy) + g.xy;
  if (f32(gp.x) >= u.r.z || f32(gp.y) >= u.r.w) { return; }
  let S = u32(u.p.w);
  let lp = g.xy + vec2u(${M}u);
  let o = textureLoad(lin, vec2i(lp), 0).rgb;
  let hp = lp / 2u;
  let k = (lp.y % 2u) * 2u + (lp.x % 2u);
  let n = S * S;
  let i = hp.y * S + hp.x;
  let den = vec3f(inb[i][k], inb[n + i][k], inb[2u * n + i][k]);
  let os = l2s(clamp(o * u.p.x, vec3f(0.0), vec3f(1.0)));
  let d = den - os;
  let dy = dot(d, vec3f(0.2126, 0.7152, 0.0722));
  let s = os + dy * u.p.y + (d - dy) * u.p.z;
  var c = s2l(clamp(s, vec3f(0.0), vec3f(1.0))) / u.p.x;
  c = mix(c, o, smoothstep(1.0, 1.1, max(o.r, max(o.g, o.b)) * u.p.x));
  textureStore(dst, vec2i(gp), vec4f(c, 1.0));
}
`;

export class Denoiser {
  constructor(engine) {
    this.e = engine;
    this.ready = null;
  }

  load() {
    this.ready ??= this.#load();
    return this.ready;
  }

  async #load() {
    const d = this.e.device;
    const res = await fetch(new URL('./models/ffdnet-color.bin', import.meta.url));
    if (!res.ok) throw new Error('model');
    const half = new Uint16Array(await res.arrayBuffer());
    const f = halfToFloat(half);
    // Couches : [groupes d'entrée, groupes de sortie] ; poids puis biais, en vec4.
    const dims = [[4, 24], ...Array(10).fill([24, 24]), [24, 3]];
    let off = 0;
    this.layers = dims.map(([ic4, oc4], i) => {
      const wOff = off;
      off += oc4 * ic4 * 9 * 4;
      const bOff = off;
      off += oc4;
      return { ic4, oc4, wOff, bOff, relu: i < dims.length - 1 };
    });
    if (off * 4 !== f.length) throw new Error('model');
    this.w = d.createBuffer({ size: f.byteLength, usage: GU.STORAGE | GU.COPY_DST });
    d.queue.writeBuffer(this.w, 0, f);
    const size = SMAX * SMAX * C4 * 16;
    this.a = d.createBuffer({ size, usage: GU.STORAGE });
    this.b = d.createBuffer({ size, usage: GU.STORAGE });
    const cp = (code) => d.createComputePipeline({ layout: 'auto', compute: { module: d.createShaderModule({ code }), entryPoint: 'main' } });
    this.p = { pack: cp(PACK), conv: cp(CONV), unpack: cp(UNPACK) };
  }

  dispatch(enc, pipe, res, x, y, z = 1) {
    const bg = this.e.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: res.map((resource, binding) => ({ binding, resource })) });
    const p = enc.beginComputePass();
    p.setPipeline(pipe);
    p.setBindGroup(0, bg);
    p.dispatchWorkgroups(x, y, z);
    p.end();
  }

  // Une tuile : cœur (x0, y0, cw, ch) de la source, écrit dans dst à (ox, oy).
  tile(enc, x0, y0, cw, ch, dst, ox, oy, prm) {
    const e = this.e;
    const S = Math.ceil(Math.max(cw, ch) / 2) + M;
    const lin = e.tex('dnlin', SMAX * 2, SMAX * 2);
    e.draw(enc, e.srcPipe, lin.createView(), [e.src.createView(), e.u(x0 - M, y0 - M, SMAX * 2, SMAX * 2, SMAX * 2, SMAX * 2, 0, 0, ...e.srcMode)]);
    const g = Math.ceil(S / 8);
    this.dispatch(enc, this.p.pack, [lin.createView(), { buffer: this.a }, e.u(prm.gain, prm.sigma, S)], g, g);
    let from = this.a, to = this.b;
    for (const L of this.layers) {
      this.dispatch(enc, this.p.conv, [{ buffer: from }, { buffer: to }, { buffer: this.w }, e.u(L.ic4, L.oc4, S, L.relu ? 1 : 0, L.wOff, L.bOff)], g, g, Math.ceil(L.oc4 / 4));
      [from, to] = [to, from];
    }
    this.dispatch(enc, this.p.unpack, [lin.createView(), { buffer: from }, dst.createView(), e.u(prm.gain, prm.luma, prm.chroma, S, ox, oy, 0, 0, cw, ch, dst.width, dst.height)], Math.ceil(cw / 8), Math.ceil(ch / 8));
  }

  // Toute l'image, tuile par tuile ; rend une texture linéaire pleine résolution, ou null si annulé.
  async full(prm, onProgress, job) {
    await this.load();
    const e = this.e, d = e.device;
    const W = e.sw, H = e.sh;
    const dn = d.createTexture({ size: [W, H], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const nx = Math.ceil(W / TILE), ny = Math.ceil(H / TILE);
    let k = 0;
    for (let ty = 0; ty < ny; ty++) {
      for (let tx = 0; tx < nx; tx++) {
        if (job.cancelled) { dn.destroy(); return null; }
        const x0 = tx * TILE, y0 = ty * TILE;
        const enc = d.createCommandEncoder();
        this.tile(enc, x0, y0, Math.min(TILE, W - x0), Math.min(TILE, H - y0), dn, x0, y0, prm);
        e.submit(enc);
        // On attend chaque tuile : la progression est exacte et la carte graphique reste disponible pour l'aperçu.
        await d.queue.onSubmittedWorkDone();
        onProgress?.(++k / (nx * ny));
      }
    }
    if (job.cancelled) { dn.destroy(); return null; }
    return dn;
  }
}

export function halfToFloat(h) {
  if (typeof Float16Array === 'function') return new Float32Array(new Float16Array(h.buffer, h.byteOffset, h.length));
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const x = h[i], s = x & 0x8000 ? -1 : 1, e = (x >> 10) & 31, m = x & 1023;
    out[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
}
