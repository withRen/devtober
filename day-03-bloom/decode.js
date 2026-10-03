/* =========================================================
   Lecture des fichiers.
   - RAW : LibRaw en WebAssembly (dans un worker), sortie linéaire
     16 bits en primaires sRGB, balance des blancs de l'appareil.
   - .hdr (Radiance RGBE) : décodé ici, en demi-flottants.
   - Le reste (JPEG, PNG, WebP, AVIF…) : décodé par le navigateur,
     avec l'orientation EXIF ; on lit aussi quelques champs EXIF.
   Chaque lecteur rend { kind, w, h, …, meta, sdr, baseline }.
   ========================================================= */

export const RAW_EXT = /\.(cr2|cr3|crw|nef|nrw|arw|srf|sr2|raf|dng|orf|rw2|pef|srw|x3f|3fr|fff|iiq|erf|mef|mos|mrw|raw|rwl|kdc|dcr|k25)$/i;
export const ACCEPT = 'image/*,.hdr,' + RAW_EXT.source.match(/\((.*)\)/)[1].split('|').map((e) => '.' + e).join(',');

export async function decodeFile(file, maxDim, onStatus) {
  const name = file.name || 'image';
  if (RAW_EXT.test(name)) return decodeRaw(file, name, onStatus);
  if (/\.hdr$/i.test(name)) return decodeHdr(await file.arrayBuffer(), name);
  return decodeBitmap(file, name, maxDim);
}

/* ---------- RAW ---------- */

async function decodeRaw(file, name, onStatus) {
  if (!self.crossOriginIsolated) throw new Error('isolation');
  onStatus?.('Chargement du décodeur RAW…');
  const { default: LibRaw } = await import('./vendor/libraw/index.js');
  const raw = new LibRaw();
  try {
    onStatus?.('Lecture du fichier…');
    const buf = new Uint8Array(await file.arrayBuffer());
    onStatus?.('Dématriçage…');
    await raw.open(buf, {
      useCameraWb: true, outputBps: 16, outputColor: 1, gamm: [1, 1],
      noAutoBright: true, highlight: 0, userQual: 3,
    });
    const m = await raw.metadata(true);
    const img = await raw.imageData();
    if (!img || !img.width) throw new Error('raw');
    let data = img.data;
    if (!(data instanceof Uint16Array)) {
      // Selon la version, les 16 bits arrivent sous forme d'octets.
      const bytes = data.byteOffset % 2 ? data.slice() : data;
      data = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    }
    const colors = img.colors || 3;
    const lens = m.lens?.Lens || m.lens?.makernotes?.Lens || '';
    return {
      kind: 'u16', w: img.width, h: img.height, data, colors, name, sdr: false,
      baseline: rawBaseline(data, colors),
      meta: {
        format: 'RAW · ' + (name.split('.').pop() || '').toUpperCase(),
        camera: [m.camera_make, m.camera_model].filter(Boolean).join(' '),
        lens,
        iso: m.iso_speed || null,
        shutter: m.shutter || null,
        aperture: m.aperture || null,
        focal: m.focal_len || null,
        date: m.timestamp instanceof Date && !isNaN(m.timestamp) ? m.timestamp : null,
        bits: 16,
      },
    };
  } finally {
    raw.dispose();
  }
}

// Exposition de départ : le 99e centile de la composante la plus forte
// est ramené vers le blanc, comme le fait dcraw, sans jamais assombrir.
function rawBaseline(data, nc) {
  const n = data.length / nc;
  const step = Math.max(1, Math.floor(n / 200000));
  const hist = new Uint32Array(1024);
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const j = i * nc;
    let m = data[j];
    if (nc > 2) m = Math.max(m, data[j + 1], data[j + 2]);
    hist[m >> 6]++;
    count++;
  }
  let acc = 0, k = 1023;
  for (; k > 0; k--) { acc += hist[k]; if (acc > count * 0.01) break; }
  const p99 = Math.max(1, k) / 1023;
  return Math.min(3, Math.max(0, Math.log2(0.95 / p99)));
}

/* ---------- Radiance .hdr ---------- */

function decodeHdr(buf, name) {
  const b = new Uint8Array(buf);
  let p = 0;
  const line = () => { let s = ''; while (p < b.length && b[p] !== 10) s += String.fromCharCode(b[p++]); p++; return s; };
  if (!line().startsWith('#?')) throw new Error('hdr');
  for (let l = line(); l.trim() !== ''; l = line()) if (p >= b.length) throw new Error('hdr');
  const res = line().match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!res) throw new Error('hdr');
  const h = +res[1], w = +res[2];
  const out = new Float32Array(w * h * 4);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (w >= 8 && w < 32768 && b[p] === 2 && b[p + 1] === 2 && !(b[p + 2] & 128)) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < w;) {
          let n = b[p++];
          if (n > 128) { n -= 128; const v = b[p++]; while (n--) scan[(x++) * 4 + c] = v; }
          else { while (n--) scan[(x++) * 4 + c] = b[p++]; }
        }
      }
    } else {
      scan.set(b.subarray(p, p + w * 4));
      p += w * 4;
    }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3], o = (y * w + x) * 4;
      const f = e ? 2 ** (e - 136) : 0;
      out[o] = scan[x * 4] * f; out[o + 1] = scan[x * 4 + 1] * f; out[o + 2] = scan[x * 4 + 2] * f; out[o + 3] = 1;
    }
  }
  return { kind: 'f16', w, h, data: toHalf(out), name, sdr: false, baseline: 0, meta: { format: 'HDR · Radiance', bits: 32 } };
}

/* ---------- JPEG, PNG… ---------- */

async function decodeBitmap(file, name, maxDim) {
  const opts = { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' };
  let bitmap = await createImageBitmap(file, opts);
  if (bitmap.width > maxDim || bitmap.height > maxDim) {
    const s = maxDim / Math.max(bitmap.width, bitmap.height);
    bitmap.close();
    bitmap = await createImageBitmap(file, { ...opts, resizeWidth: Math.floor(bitmap.width * s), resizeHeight: Math.floor(bitmap.height * s), resizeQuality: 'high' });
  }
  let exif = {};
  if (/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(name)) {
    try { exif = readExif(new DataView(await file.slice(0, 1 << 17).arrayBuffer())); } catch { /* pas d'EXIF lisible */ }
  }
  const ext = (file.type.split('/')[1] || name.split('.').pop() || '').toUpperCase().replace('JPEG', 'JPEG');
  return {
    kind: 'bitmap', w: bitmap.width, h: bitmap.height, bitmap, name, sdr: true, baseline: 0,
    meta: { format: ext + ' · 8 bits', bits: 8, ...exif },
  };
}

// Lecteur EXIF minimal : appareil, objectif, ISO, vitesse, ouverture, focale, date.
function readExif(v) {
  if (v.getUint16(0) !== 0xffd8) return {};
  let o = 2;
  while (o < v.byteLength - 4) {
    const marker = v.getUint16(o), len = v.getUint16(o + 2);
    if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return parseTiff(v, o + 10);
    if ((marker & 0xff00) !== 0xff00) break;
    o += 2 + len;
  }
  return {};
}

function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (p) => v.getUint16(t + p, le), u32 = (p) => v.getUint32(t + p, le);
  const tags = {};
  const ifd = (p) => {
    const n = u16(p);
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
      const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
      const at = size * cnt > 4 ? u32(e + 8) : e + 8;
      if (type === 2) { let s = ''; for (let k = 0; k < cnt - 1; k++) s += String.fromCharCode(v.getUint8(t + at + k)); tags[tag] = s.trim(); }
      else if (type === 3) tags[tag] = u16(at);
      else if (type === 4) tags[tag] = u32(at);
      else if (type === 5) tags[tag] = u32(at) / (u32(at + 4) || 1);
    }
  };
  ifd(u32(4));
  if (tags[0x8769]) ifd(tags[0x8769]);
  const d = tags[0x9003] || tags[0x0132];
  const date = d ? new Date(d.replace(/^(\d+):(\d+):(\d+)/, '$1-$2-$3')) : null;
  return {
    camera: [tags[0x010f], tags[0x0110]].filter(Boolean).join(' ').replace(/^(\w+) \1 /i, '$1 '),
    lens: tags[0xa434] || '',
    iso: tags[0x8827] || null,
    shutter: tags[0x829a] || null,
    aperture: tags[0x829d] || null,
    focal: tags[0x920a] || null,
    date: date && !isNaN(date) ? date : null,
  };
}

/* ---------- Demi-flottants ---------- */

export function toHalf(f32) {
  if (typeof Float16Array === 'function') return new Uint16Array(new Float16Array(f32).buffer);
  const out = new Uint16Array(f32.length);
  const fv = new Float32Array(1), iv = new Uint32Array(fv.buffer);
  for (let i = 0; i < f32.length; i++) {
    fv[0] = f32[i];
    const x = iv[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
    if (e <= 0) out[i] = s;
    else if (e >= 31) out[i] = s | 0x7c00;
    else out[i] = s | (e << 10) | (m >>> 13);
  }
  return out;
}

/* ---------- Image de démonstration ----------
   Une enseigne au néon en forme de fleur, sur un mur de nuit,
   avec des lumières floues au loin. Les tubes et les lampes sont
   bien au-delà du blanc (jusqu'à × 8), comme dans une vraie photo
   HDR : c'est exactement ce dont le bloom a besoin. */

export function makeDemo(W = 2400, H = 1600) {
  const scene = document.createElement('canvas');
  scene.width = W; scene.height = H;
  const g = scene.getContext('2d');
  const glow = document.createElement('canvas');
  glow.width = W; glow.height = H;
  const e = glow.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Mur et sol
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0c0c0d'); sky.addColorStop(0.62, '#161514'); sky.addColorStop(0.63, '#0d0c0b'); sky.addColorStop(1, '#181614');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.05;
  for (let y = 0; y < H * 0.62; y += 46) {
    for (let x = (y / 46) % 2 ? -60 : 0; x < W; x += 120) { g.fillStyle = rnd() > 0.5 ? '#2b2825' : '#080807'; g.fillRect(x, y, 116, 42); }
  }
  g.globalAlpha = 1;

  // Lumières floues au loin (bokeh)
  g.save(); g.filter = 'blur(10px)';
  const bokehC = ['#ffb35c', '#ff6f91', '#7fc8ff', '#ffd98a', '#a8e6cf'];
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = H * (0.66 + rnd() * 0.3), r = 18 + rnd() * 46;
    g.globalAlpha = 0.18 + rnd() * 0.35; g.fillStyle = bokehC[i % bokehC.length];
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  g.globalAlpha = 1;

  // Tubes de néon : un trait large et teinté sur la scène, un cœur fin et brûlant sur la couche d'émission.
  const cx = W * 0.5, cy = H * 0.36;
  const tube = (path, col, core, width = 14) => {
    g.save(); g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = col; g.lineWidth = width; g.globalAlpha = 0.55; path(g); g.stroke();
    g.strokeStyle = core; g.lineWidth = width * 0.45; g.globalAlpha = 1; path(g); g.stroke();
    g.restore();
    e.save(); e.lineCap = e.lineJoin = 'round'; e.strokeStyle = core; e.lineWidth = width * 0.35; path(e); e.stroke(); e.restore();
  };
  const petals = 7, R = H * 0.16;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 - Math.PI / 2;
    tube((c) => { c.beginPath(); c.ellipse(cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62, R * 0.62, R * 0.27, a, 0, Math.PI * 2); }, '#ff2d7a', '#ffc2dc');
  }
  tube((c) => { c.beginPath(); c.arc(cx, cy, R * 0.2, 0, Math.PI * 2); }, '#ffae2d', '#fff0c8', 16);
  tube((c) => { c.beginPath(); c.moveTo(cx, cy + R * 1.25); c.bezierCurveTo(cx - 20, cy + R * 1.8, cx + 30, cy + R * 2.2, cx, cy + R * 2.75); }, '#38f2a0', '#d4ffe9');
  tube((c) => { c.beginPath(); c.moveTo(cx + 4, cy + R * 2.05); c.quadraticCurveTo(cx + R * 0.7, cy + R * 1.55, cx + R * 0.95, cy + R * 1.85); c.quadraticCurveTo(cx + R * 0.5, cy + R * 2.25, cx + 4, cy + R * 2.05); }, '#38f2a0', '#d4ffe9', 12);

  // Le mot, en tubes cyan
  const word = (c) => { c.font = `600 ${Math.round(H * 0.1)}px "Geist", system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; };
  g.save(); word(g); g.lineJoin = 'round';
  g.strokeStyle = '#2fd5ff'; g.globalAlpha = 0.55; g.lineWidth = 14; g.strokeText('bloom', cx, H * 0.83);
  g.strokeStyle = '#d6f6ff'; g.globalAlpha = 1; g.lineWidth = 6; g.strokeText('bloom', cx, H * 0.83);
  g.restore();
  e.save(); word(e); e.lineJoin = 'round'; e.strokeStyle = '#d6f6ff'; e.lineWidth = 5; e.strokeText('bloom', cx, H * 0.83); e.restore();

  // Lampes ponctuelles
  for (const [x, y, c] of [[W * 0.12, H * 0.2, '#fff1d6'], [W * 0.88, H * 0.24, '#fff1d6'], [W * 0.22, H * 0.72, '#ffd0a0'], [W * 0.79, H * 0.7, '#c8e4ff']]) {
    g.fillStyle = c; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    e.fillStyle = c; e.beginPath(); e.arc(x, y, 6, 0, Math.PI * 2); e.fill();
  }

  const a = g.getImageData(0, 0, W, H).data, b = e.getImageData(0, 0, W, H).data;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lut[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
  const f = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H * 4; i += 4) {
    f[i] = lut[a[i]] + lut[b[i]] * 7;
    f[i + 1] = lut[a[i + 1]] + lut[b[i + 1]] * 7;
    f[i + 2] = lut[a[i + 2]] + lut[b[i + 2]] * 7;
    f[i + 3] = 1;
  }
  return { kind: 'f16', w: W, h: H, data: toHalf(f), name: 'Démo néon', sdr: false, baseline: 0, demo: true, meta: { format: 'Démo · HDR généré', bits: 16 } };
}
