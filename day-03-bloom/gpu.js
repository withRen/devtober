/* =========================================================
   Moteur de rendu WebGPU.

   La source est envoyée une fois sur la carte graphique, en pleine
   résolution (8 bits, 16 bits ou demi-flottants). On en tire une
   « base » linéaire de 4096 px au plus, avec ses mips : c'est elle
   que l'aperçu échantillonne. Le bloom se calcule sur une version
   de 2048 px au plus, la même pour l'aperçu et pour l'export, donc
   il a exactement la même forme quelle que soit la taille de sortie.
   L'export repart de la source pleine résolution, par tuiles de
   2048 px, et lit le bloom en coordonnées relatives.
   ========================================================= */
import * as S from './shaders.js';
import { toHalf } from './decode.js';

const TU = GPUTextureUsage;
const BU = GPUBufferUsage;
const BASE_MAX = 4096;
const BLOOM_MAX = 2048;
const TILE = 2048;
const SLOT = 256;        // un emplacement d'uniformes par passe
const SLOTS = 4096;

export const fit = (w, h, max) => {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
};

export class Engine {
  async init(canvas) {
    if (!navigator.gpu) throw new Error('webgpu');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('webgpu');
    const L = adapter.limits;
    const d = this.device = await adapter.requestDevice({
      requiredLimits: { maxTextureDimension2D: L.maxTextureDimension2D, maxBufferSize: L.maxBufferSize },
    });
    this.info = adapter.info ? `${adapter.info.vendor} ${adapter.info.architecture}`.trim() : '';
    this.maxDim = d.limits.maxTextureDimension2D;
    this.lost = d.lost;

    this.ctx = canvas.getContext('webgpu');
    this.ctx.configure({ device: d, format: 'rgba8unorm', usage: TU.RENDER_ATTACHMENT | TU.COPY_DST, alphaMode: 'opaque' });
    this.samp = d.createSampler({
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    const pipe = (code, format = 'rgba16float', blend) => {
      const module = d.createShaderModule({ code });
      return d.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
      });
    };
    const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
    this.p = {
      ingestF: pipe(S.INGEST_F), ingestU: pipe(S.INGEST_U), mip: pipe(S.MIP),
      develop: pipe(S.DEVELOP), prefilter: pipe(S.PREFILTER), down: pipe(S.DOWN), up: pipe(S.UP),
      streak: pipe(S.STREAK), accum: pipe(S.ACCUM, 'rgba16float', add), finish: pipe(S.FINISH, 'rgba8unorm'),
      histo: d.createComputePipeline({ layout: 'auto', compute: { module: d.createShaderModule({ code: S.HISTO }), entryPoint: 'main' } }),
    };

    this.ubuf = d.createBuffer({ size: SLOT * SLOTS, usage: BU.UNIFORM | BU.COPY_DST });
    this.udata = new Float32Array(SLOT / 4 * SLOTS);
    this.un = 0;
    this.bins = d.createBuffer({ size: 4096, usage: BU.STORAGE | BU.COPY_SRC | BU.COPY_DST });
    this.binsRead = d.createBuffer({ size: 4096, usage: BU.MAP_READ | BU.COPY_DST });
    this.binsBusy = false;
    this.pool = new Map();
    this.bloomKey = null;
    this.src = null;
    this.curve = d.createTexture({ size: [1024, 1], format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
    this.curveKey = null;
    this.lut = d.createTexture({ size: [2, 2, 2], dimension: '3d', format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
    this.lutKey = null;
    this.layerBuf = d.createBuffer({ size: 16 + 8 * 128, usage: BU.UNIFORM | BU.COPY_DST });
  }

  /* ---------- Petits outils ---------- */

  // Réserve un emplacement d'uniformes ; tout part en un seul envoi au moment du submit.
  u(...vals) {
    if (this.un >= SLOTS) throw new Error('uniforms');
    const off = this.un * (SLOT / 4);
    this.udata.fill(0, off, off + SLOT / 4);
    this.udata.set(vals, off);
    return { buffer: this.ubuf, offset: this.un++ * SLOT, size: SLOT };
  }

  submit(enc) {
    if (this.un) this.device.queue.writeBuffer(this.ubuf, 0, this.udata.buffer, 0, this.un * SLOT);
    this.device.queue.submit([enc.finish()]);
    this.un = 0;
  }

  tex(name, w, h, format = 'rgba16float', mips = 1, extra = 0) {
    let t = this.pool.get(name);
    if (t && t.width === w && t.height === h && t.format === format && t.mipLevelCount === mips) return t;
    t?.destroy();
    t = this.device.createTexture({ size: [w, h], format, mipLevelCount: mips, usage: TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT | extra });
    this.pool.set(name, t);
    return t;
  }

  draw(enc, pipeline, view, res, clear = true) {
    const bg = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: res.map((resource, binding) => ({ binding, resource })),
    });
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: clear ? 'clear' : 'load', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
  }

  clear(enc, t) {
    enc.beginRenderPass({ colorAttachments: [{ view: t.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }] }).end();
  }

  /* ---------- Source ---------- */

  // s : { kind: 'bitmap', bitmap } | { kind: 'u16', data, colors } | { kind: 'f16', data }, plus w et h.
  setSource(s) {
    const d = this.device;
    const { w, h } = s;
    if (w > this.maxDim || h > this.maxDim) throw new Error('size');
    this.src?.destroy();
    if (s.kind === 'bitmap') {
      this.src = d.createTexture({ size: [w, h], format: 'rgba8unorm', usage: TU.TEXTURE_BINDING | TU.COPY_DST | TU.RENDER_ATTACHMENT });
      d.queue.copyExternalImageToTexture({ source: s.bitmap }, { texture: this.src }, [w, h]);
      this.srcPipe = this.p.ingestF;
      this.srcMode = [1, 1];
    } else if (s.kind === 'u16') {
      // RGB 16 bits vers RGBA 16 bits, par bandes, pour ne pas doubler la mémoire d'un coup.
      this.src = d.createTexture({ size: [w, h], format: 'rgba16uint', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
      const nc = s.colors || 3;
      const rows = Math.max(1, Math.floor((1 << 22) / w));
      const tmp = new Uint16Array(w * rows * 4);
      for (let y0 = 0; y0 < h; y0 += rows) {
        const n = Math.min(rows, h - y0);
        for (let i = 0, j = y0 * w * nc, e = n * w; i < e; i++, j += nc) {
          const k = i * 4;
          tmp[k] = s.data[j];
          tmp[k + 1] = s.data[j + (nc > 1 ? 1 : 0)];
          tmp[k + 2] = s.data[j + (nc > 2 ? 2 : 0)];
          tmp[k + 3] = 65535;
        }
        d.queue.writeTexture({ texture: this.src, origin: [0, y0] }, tmp, { bytesPerRow: w * 8, rowsPerImage: n }, [w, n]);
      }
      this.srcPipe = this.p.ingestU;
      this.srcMode = [0, 1 / 65535];
    } else {
      this.src = d.createTexture({ size: [w, h], format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
      d.queue.writeTexture({ texture: this.src }, s.data, { bytesPerRow: w * 8, rowsPerImage: h }, [w, h]);
      this.srcPipe = this.p.ingestF;
      this.srcMode = [0, 1];
    }
    this.sw = w;
    this.sh = h;

    this.clearDenoise();
    this.base = this.base0 = this.buildBase('base0', this.src, this.srcPipe, this.srcMode);
    this.bloomKey = null;
  }

  // Base linéaire (4 096 px au plus) avec tous ses mips, depuis une texture source.
  buildBase(name, tex, pipe, mode) {
    const [bw, bh] = fit(this.sw, this.sh, BASE_MAX);
    const mips = Math.floor(Math.log2(Math.max(bw, bh))) + 1;
    const base = this.tex(name, bw, bh, 'rgba16float', mips);
    const enc = this.device.createCommandEncoder();
    this.draw(enc, pipe, base.createView({ baseMipLevel: 0, mipLevelCount: 1 }), [
      tex.createView(), this.u(0, 0, this.sw, this.sh, bw, bh, 0, 0, ...mode),
    ]);
    for (let i = 1; i < mips; i++) {
      this.draw(enc, this.p.mip, base.createView({ baseMipLevel: i, mipLevelCount: 1 }), [
        base.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }), this.samp,
      ]);
    }
    this.submit(enc);
    return base;
  }

  /* ---------- Débruitage ----------
     La version débruitée (pleine résolution, linéaire) remplace la source
     pour l'aperçu et l'export ; l'originale reste pour « Avant » et la loupe. */

  setDenoised(dn) {
    this.dn?.destroy();
    this.dn = dn;
    this.base = this.buildBase('baseDn', dn, this.p.ingestF, [0, 1]);
    this.bloomKey = null;
  }

  clearDenoise() {
    if (!this.dn) return;
    this.dn.destroy();
    this.dn = null;
    this.pool.get('baseDn')?.destroy();
    this.pool.delete('baseDn');
    this.base = this.base0;
    this.bloomKey = null;
  }

  /* ---------- Passes ---------- */

  // La reconstruction des hautes lumières ne nourrit que le bloom : l'image elle-même ne bouge pas.
  devU(r, W, H, lod, recovery = 0) {
    return this.u(r.wb[0], r.wb[1], r.wb[2], r.gain, recovery, lod, 0, 0, 0, 0, 1, 1, W, H, 0, 0);
  }

  // Calcule les couches de bloom dans deux accumulateurs (ajout et écran).
  // Rien n'est refait si seuls les réglages d'affichage ont changé.
  bloom(enc, r) {
    const base = this.base;
    const [Wb, Hb] = fit(this.sw, this.sh, Math.min(BLOOM_MAX, Math.max(base.width, base.height)));
    const Pw = Math.max(1, Math.ceil(Wb / 2));
    const Ph = Math.max(1, Math.ceil(Hb / 2));
    const A = this.tex('accA', Pw, Ph);
    const B = this.tex('accS', Pw, Ph);
    const key = JSON.stringify([r.wb, r.gain, r.recovery, r.layers, Pw, Ph]);
    if (key === this.bloomKey) return;
    this.bloomKey = key;
    this.clear(enc, A);
    this.clear(enc, B);
    if (!r.layers.length) return;

    const bdev = this.tex('bdev', Wb, Hb);
    this.draw(enc, this.p.develop, bdev.createView(), [base.createView(), this.samp, this.devU(r, Wb, Hb, Math.max(0, Math.log2(base.width / Wb)), r.recovery)]);
    const pre = this.tex('pre', Pw, Ph);

    for (const L of r.layers) {
      this.draw(enc, this.p.prefilter, pre.createView(), [bdev.createView(), this.samp, this.u(L.threshold, L.knee, 256, 0, 1 / Wb, 1 / Hb)]);
      const acc = (L.blend === 'screen' ? B : A).createView();

      if (L.kind === 'halo') {
        const lv = [pre];
        let w = Pw, h = Ph;
        for (let i = 1; i < L.levels && Math.min(w, h) > 4; i++) {
          const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2);
          const t = this.tex('d' + i, nw, nh);
          this.draw(enc, this.p.down, t.createView(), [lv[i - 1].createView(), this.samp, this.u(1 / w, 1 / h)]);
          lv.push(t);
          w = nw; h = nh;
        }
        let up = lv[lv.length - 1];
        for (let i = lv.length - 2; i >= 0; i--) {
          const t = this.tex('u' + i, lv[i].width, lv[i].height);
          this.draw(enc, this.p.up, t.createView(), [up.createView(), lv[i].createView(), this.samp, this.u(1 / up.width, 1 / up.height, 0, 0, L.scatter)]);
          up = t;
        }
        this.draw(enc, this.p.accum, acc, [up.createView(), this.samp, this.u(...L.color, 1)], false);
      } else {
        const s0 = this.tex('s0', Pw, Ph), s1 = this.tex('s1', Pw, Ph);
        for (const a of L.dirs) {
          const dx = Math.cos(a), dy = Math.sin(a);
          let from = pre;
          for (let k = 0; k < L.passes; k++) {
            const step = 4 ** k;
            const to = k % 2 ? s1 : s0;
            this.draw(enc, this.p.streak, to.createView(), [from.createView(), this.samp, this.u(dx * step / Pw, dy * step / Ph, 0, 0, L.atten, step)]);
            from = to;
          }
          this.draw(enc, this.p.accum, acc, [from.createView(), this.samp, this.u(...L.color, 1)], false);
        }
      }
    }
  }

  finish(enc, r, dev, out, rect, split, fullW, fullH) {
    const base = this.base0;   // « Avant » montre toujours l'original
    if (r.curves.key !== this.curveKey) {
      this.curveKey = r.curves.key;
      this.device.queue.writeTexture({ texture: this.curve }, r.curves.data, { bytesPerRow: 1024 * 8 }, [1024, 1]);
    }
    if (r.lut && r.lut.key !== this.lutKey) {
      const N = r.lut.N;
      if (this.lut.width !== N) {
        this.lut.destroy();
        this.lut = this.device.createTexture({ size: [N, N, N], dimension: '3d', format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
      }
      this.device.queue.writeTexture({ texture: this.lut }, r.lut.data, { bytesPerRow: N * 8, rowsPerImage: N }, [N, N, N]);
      this.lutKey = r.lut.key;
    }
    // Calques locaux : un tampon à part (trop grand pour un emplacement d'uniformes).
    // Écrit juste avant cet encodeur : une seule finition par envoi, donc pas de mélange.
    this.device.queue.writeBuffer(this.layerBuf, 0, r.locals || new Float32Array([0, -1, 0, 0]));
    const pxPerOut = (fullW ? this.sw / fullW : this.sw / out.width) * base.width / this.sw;
    const gs = 1 + r.grainSize * 2.5;
    this.draw(enc, this.p.finish, out.createView(), [
      dev.createView(), this.pool.get('accA').createView(), this.pool.get('accS').createView(), base.createView(), this.samp,
      this.u(
        ...rect,
        out.width, out.height, split, r.tonemap,
        r.blacks, r.whites, r.shadows, r.highlights,
        r.contrast, r.saturation, r.vibrance, r.vignette,
        r.beforeGain, r.beforeTonemap, this.sw / this.sh, Math.max(0, Math.log2(pxPerOut)),
        r.grain, r.curves.active ? 1 : 0, this.sw / gs, this.sh / gs,
        r.lut ? r.lut.mode : 0, r.lut ? r.lut.amount : 0, this.lut.width, 0,
      ),
      this.curve.createView(),
      this.lut.createView({ dimension: '3d' }),
      { buffer: this.layerBuf },
    ]);
  }

  /* ---------- Aperçu ---------- */

  render(r, W, H, split = -1) {
    if (!this.src) return;
    const d = this.device;
    const enc = d.createCommandEncoder();
    const base = this.base;
    const dev = this.tex('dev', W, H);
    this.draw(enc, this.p.develop, dev.createView(), [base.createView(), this.samp, this.devU(r, W, H, Math.max(0, Math.log2(base.width / W)))]);
    this.bloom(enc, r);
    const out = this.tex('out', W, H, 'rgba8unorm', 1, TU.COPY_SRC);
    this.finish(enc, r, dev, out, [0, 0, 1, 1], split);

    const readNow = !this.binsBusy && this.onHisto;
    if (readNow) {
      enc.clearBuffer(this.bins);
      const bg = d.createBindGroup({ layout: this.p.histo.getBindGroupLayout(0), entries: [{ binding: 0, resource: out.createView() }, { binding: 1, resource: { buffer: this.bins } }] });
      const cp = enc.beginComputePass();
      cp.setPipeline(this.p.histo);
      cp.setBindGroup(0, bg);
      cp.dispatchWorkgroups(Math.ceil(W / 16), Math.ceil(H / 16));
      cp.end();
      enc.copyBufferToBuffer(this.bins, 0, this.binsRead, 0, 4096);
    }
    enc.copyTextureToTexture({ texture: out }, { texture: this.ctx.getCurrentTexture() }, [W, H]);
    this.submit(enc);

    if (readNow) {
      this.binsBusy = true;
      this.binsRead.mapAsync(GPUMapMode.READ).then(() => {
        const a = new Uint32Array(this.binsRead.getMappedRange().slice(0));
        this.binsRead.unmap();
        this.binsBusy = false;
        this.onHisto(a);
      }, () => { this.binsBusy = false; });
    }
  }

  // Copie une texture 8 bits vers une ImageData (lignes alignées sur 256 octets côté GPU).
  async readback(enc, out) {
    const d = this.device, tw = out.width, th = out.height;
    const bpr = Math.ceil(tw * 4 / 256) * 256;
    const buf = d.createBuffer({ size: bpr * th, usage: BU.MAP_READ | BU.COPY_DST });
    enc.copyTextureToBuffer({ texture: out }, { buffer: buf, bytesPerRow: bpr }, [tw, th]);
    this.submit(enc);
    await buf.mapAsync(GPUMapMode.READ);
    const px = new Uint8Array(buf.getMappedRange());
    const img = new ImageData(tw, th);
    for (let y = 0; y < th; y++) img.data.set(px.subarray(y * bpr, y * bpr + tw * 4), y * tw * 4);
    buf.unmap();
    buf.destroy();
    return img;
  }

  // Petite image rendue depuis la base, pour les miniatures des préréglages.
  async snapshot(r, W, H) {
    const enc = this.device.createCommandEncoder();
    const base = this.base;
    const dev = this.tex('sdev', W, H);
    this.draw(enc, this.p.develop, dev.createView(), [base.createView(), this.samp, this.devU(r, W, H, Math.max(0, Math.log2(base.width / W)))]);
    this.bloom(enc, r);
    const out = this.tex('sout', W, H, 'rgba8unorm', 1, TU.COPY_SRC);
    this.finish(enc, r, dev, out, [0, 0, 1, 1], -1);
    return this.readback(enc, out);
  }

  // Une zone à 100 % (loupe) : débruitée à la volée si dn est fourni, sinon l'original.
  async region(r, x0, y0, w, h, dn, prm) {
    const enc = this.device.createCommandEncoder();
    this.bloom(enc, r);
    let lin;
    if (dn) {
      lin = this.tex('rden', w, h, 'rgba16float', 1, TU.STORAGE_BINDING);
      dn.tile(enc, x0, y0, w, h, lin, 0, 0, prm);
    } else {
      lin = this.tex('rlin', w, h);
      this.draw(enc, this.srcPipe, lin.createView(), [this.src.createView(), this.u(x0, y0, w, h, w, h, 0, 0, ...this.srcMode)]);
    }
    const dev = this.tex('rdev', w, h);
    this.draw(enc, this.p.develop, dev.createView(), [lin.createView(), this.samp, this.devU(r, w, h, 0)]);
    const out = this.tex('rout', w, h, 'rgba8unorm', 1, TU.COPY_SRC);
    this.finish(enc, r, dev, out, [x0 / this.sw, y0 / this.sh, (x0 + w) / this.sw, (y0 + h) / this.sh], -1, this.sw, this.sh);
    return this.readback(enc, out);
  }

  // Étalonnage cuit en LUT : une grille N³ de couleurs d'affichage passe par
  // le développement et la finition (sans bloom, vignette ni grain), puis revient.
  async bake(r, N) {
    const d = this.device, W = N * N, H = N;
    const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const f = new Float32Array(W * H * 4);
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let rr = 0; rr < N; rr++) {
      const i = (g * W + rr + b * N) * 4;
      f[i] = s2l(rr / (N - 1)); f[i + 1] = s2l(g / (N - 1)); f[i + 2] = s2l(b / (N - 1)); f[i + 3] = 1;
    }
    const grid = d.createTexture({ size: [W, H], format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
    d.queue.writeTexture({ texture: grid }, toHalf(f), { bytesPerRow: W * 8, rowsPerImage: H }, [W, H]);
    const enc = d.createCommandEncoder();
    const dev = this.tex('kdev', W, H);
    this.draw(enc, this.p.develop, dev.createView(), [grid.createView(), this.samp, this.devU(r, W, H, 0)]);
    this.bloom(enc, r);
    const out = this.tex('kout', W, H, 'rgba8unorm', 1, TU.COPY_SRC);
    this.finish(enc, r, dev, out, [0, 0, 1, 1], -1, W, H);
    const img = await this.readback(enc, out);
    grid.destroy();
    const data = new Float32Array(N ** 3 * 3);
    let k = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let rr = 0; rr < N; rr++) {
      const i = (g * W + rr + b * N) * 4;
      data[k++] = img.data[i] / 255; data[k++] = img.data[i + 1] / 255; data[k++] = img.data[i + 2] / 255;
    }
    return data;
  }

  /* ---------- Export ---------- */

  async export(r, W, H, onProgress) {
    const d = this.device;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    const enc0 = d.createCommandEncoder();
    this.bloom(enc0, r);
    this.submit(enc0);

    const [inTex, inPipe, inMode] = this.dn ? [this.dn, this.p.ingestF, [0, 1]] : [this.src, this.srcPipe, this.srcMode];
    const sx = this.sw / W, sy = this.sh / H;
    const nx = Math.ceil(W / TILE), ny = Math.ceil(H / TILE);
    let done = 0;
    for (let ty = 0; ty < ny; ty++) {
      for (let tx = 0; tx < nx; tx++) {
        const x0 = tx * TILE, y0 = ty * TILE;
        const tw = Math.min(TILE, W - x0), th = Math.min(TILE, H - y0);
        const enc = d.createCommandEncoder();
        const lin = this.tex('tlin', tw, th);
        this.draw(enc, inPipe, lin.createView(), [inTex.createView(), this.u(x0 * sx, y0 * sy, tw * sx, th * sy, tw, th, 0, 0, ...inMode)]);
        const dev = this.tex('tdev', tw, th);
        this.draw(enc, this.p.develop, dev.createView(), [lin.createView(), this.samp, this.devU(r, tw, th, 0)]);
        const out = this.tex('tout', tw, th, 'rgba8unorm', 1, TU.COPY_SRC);
        this.finish(enc, r, dev, out, [x0 / W, y0 / H, (x0 + tw) / W, (y0 + th) / H], -1, W, H);
        g.putImageData(await this.readback(enc, out), x0, y0);
        onProgress?.(++done / (nx * ny));
      }
    }
    for (const n of ['tlin', 'tdev', 'tout']) { this.pool.get(n)?.destroy(); this.pool.delete(n); }
    return canvas;
  }
}
