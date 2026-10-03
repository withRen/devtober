/* =========================================================
   Shaders WGSL. Presque tout est un triangle plein écran
   avec un fragment shader : chaque passe lit une ou plusieurs
   textures et écrit dans une autre. Toutes les uniformes sont
   des vec4f, pour ne jamais se tromper d'alignement.
   ========================================================= */

const VERT = /* wgsl */ `
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VO;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}
`;

const COMMON = /* wgsl */ `
fn s2l(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
fn l2s(c0: vec3f) -> vec3f {
  let c = max(c0, vec3f(0.0));
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn maxc(c: vec3f) -> f32 { return max(c.r, max(c.g, c.b)); }
fn minc(c: vec3f) -> f32 { return min(c.r, min(c.g, c.b)); }
`;

/* Image source (8 bits sRGB, 16 bits ou flottante) vers une image linéaire.
   rect : zone de la source en pixels, dst : taille de sortie.
   Chaque pixel de sortie moyenne jusqu'à 8 × 8 échantillons de son empreinte. */
const ingest = (kind) => /* wgsl */ `
struct U { rect: vec4f, dst: vec4f, mode: vec4f };
@group(0) @binding(0) var src: texture_2d<${kind}>;
@group(0) @binding(1) var<uniform> u: U;
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let f = u.rect.zw / u.dst.xy;
  let n = vec2u(clamp(ceil(f), vec2f(1.0), vec2f(8.0)));
  let hi = vec2i(textureDimensions(src)) - 1;
  var acc = vec3f(0.0);
  for (var j = 0u; j < n.y; j++) {
    for (var i = 0u; i < n.x; i++) {
      let o = (vec2f(f32(i), f32(j)) + 0.5) / vec2f(n);
      let sp = u.rect.xy + (floor(pos.xy) + o) * f;
      let t = vec3f(textureLoad(src, clamp(vec2i(floor(sp)), vec2i(0), hi), 0).rgb);
      acc += select(t, s2l(t), u.mode.x > 0.5);
    }
  }
  return vec4f(acc / f32(n.x * n.y) * u.mode.y, 1.0);
}
`;

export const INGEST_F = VERT + COMMON + ingest('f32');
export const INGEST_U = VERT + COMMON + ingest('u32');

/* Niveau de mip suivant : une moyenne 2 × 2 par filtrage bilinéaire. */
export const MIP = VERT + /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@fragment fn fs(v: VO) -> @location(0) vec4f {
  return textureSampleLevel(src, smp, v.uv, 0.0);
}
`;

/* Développement, dans l'espace de la scène (linéaire) :
   reconstruction des hautes lumières, balance des blancs, exposition. */
export const DEVELOP = VERT + COMMON + /* wgsl */ `
struct U { wb: vec4f, p: vec4f, rect: vec4f, size: vec4f };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> u: U;
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = mix(u.rect.xy, u.rect.zw, pos.xy / u.size.xy);
  var c = max(textureSampleLevel(src, smp, uv, u.p.y).rgb, vec3f(0.0));
  // Une image 8 bits plafonne à 1 : on fait remonter ce qui frôle le blanc,
  // pour que le bloom ait de vraies hautes lumières à diffuser.
  let t = smoothstep(0.72, 1.0, maxc(c));
  c *= 1.0 + u.p.x * t * t * 7.0;
  c *= u.wb.rgb * u.wb.w;
  return vec4f(c, 1.0);
}
`;

/* Bloom, étape 1 : seuil à genou doux, en demi-résolution.
   Quatre lectures bilinéaires couvrent un carré de 4 × 4 pixels. */
export const PREFILTER = VERT + COMMON + /* wgsl */ `
struct U { p: vec4f, t: vec4f };   // seuil, genou, plafond ; taille d'un texel d'entrée
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> u: U;
@fragment fn fs(v: VO) -> @location(0) vec4f {
  let d = u.t.xy;
  var c = textureSampleLevel(src, smp, v.uv + vec2f(-d.x, -d.y), 0.0).rgb
        + textureSampleLevel(src, smp, v.uv + vec2f( d.x, -d.y), 0.0).rgb
        + textureSampleLevel(src, smp, v.uv + vec2f(-d.x,  d.y), 0.0).rgb
        + textureSampleLevel(src, smp, v.uv + vec2f( d.x,  d.y), 0.0).rgb;
  c = min(c * 0.25, vec3f(u.p.z));
  let m = maxc(c);
  let knee = max(u.p.y, 1e-4);
  var soft = clamp(m - u.p.x + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  let w = max(soft, m - u.p.x) / max(m, 1e-4);
  return vec4f(c * w, 1.0);
}
`;

/* Réduction à 13 lectures (Jimenez, Call of Duty : Advanced Warfare). */
export const DOWN = VERT + /* wgsl */ `
struct U { t: vec4f };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> u: U;
fn s(uv: vec2f, o: vec2f) -> vec3f { return textureSampleLevel(src, smp, uv + o * u.t.xy, 0.0).rgb; }
@fragment fn fs(v: VO) -> @location(0) vec4f {
  let a = s(v.uv, vec2f(-2.0, -2.0)); let b = s(v.uv, vec2f(0.0, -2.0)); let c = s(v.uv, vec2f(2.0, -2.0));
  let d = s(v.uv, vec2f(-1.0, -1.0)); let e = s(v.uv, vec2f(1.0, -1.0));
  let f = s(v.uv, vec2f(-2.0, 0.0)); let g = s(v.uv, vec2f(0.0, 0.0)); let h = s(v.uv, vec2f(2.0, 0.0));
  let i = s(v.uv, vec2f(-1.0, 1.0)); let j = s(v.uv, vec2f(1.0, 1.0));
  let k = s(v.uv, vec2f(-2.0, 2.0)); let l = s(v.uv, vec2f(0.0, 2.0)); let m = s(v.uv, vec2f(2.0, 2.0));
  var r = (d + e + i + j) * 0.125;
  r += (a + b + f + g) * 0.03125 + (b + c + g + h) * 0.03125;
  r += (f + g + k + l) * 0.03125 + (g + h + l + m) * 0.03125;
  return vec4f(r, 1.0);
}
`;

/* Remontée : filtre en tente 3 × 3 sur le niveau du dessous,
   mélangé au niveau courant selon la « diffusion ». */
export const UP = VERT + /* wgsl */ `
struct U { t: vec4f, p: vec4f };
@group(0) @binding(0) var low: texture_2d<f32>;
@group(0) @binding(1) var hi: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var<uniform> u: U;
fn s(uv: vec2f, o: vec2f) -> vec3f { return textureSampleLevel(low, smp, uv + o * u.t.xy, 0.0).rgb; }
@fragment fn fs(v: VO) -> @location(0) vec4f {
  var t = s(v.uv, vec2f(0.0, 0.0)) * 4.0;
  t += (s(v.uv, vec2f(-1.0, 0.0)) + s(v.uv, vec2f(1.0, 0.0)) + s(v.uv, vec2f(0.0, -1.0)) + s(v.uv, vec2f(0.0, 1.0))) * 2.0;
  t += s(v.uv, vec2f(-1.0, -1.0)) + s(v.uv, vec2f(1.0, -1.0)) + s(v.uv, vec2f(-1.0, 1.0)) + s(v.uv, vec2f(1.0, 1.0));
  let h = textureSampleLevel(hi, smp, v.uv, 0.0).rgb;
  return vec4f(mix(h, t / 16.0, u.p.x), 1.0);
}
`;

/* Traînée de Kawase : quatre lectures le long d'une direction,
   avec un pas qui grandit à chaque passe (1, 4, 16, 64…). */
export const STREAK = VERT + /* wgsl */ `
struct U { d: vec4f, a: vec4f };   // pas en uv ; atténuation, exposant
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> u: U;
@fragment fn fs(v: VO) -> @location(0) vec4f {
  var c = vec3f(0.0);
  var ws = 0.0;
  for (var s = 0; s < 4; s++) {
    let w = pow(u.a.x, u.a.y * f32(s));
    c += w * textureSampleLevel(src, smp, v.uv + u.d.xy * f32(s), 0.0).rgb;
    ws += w;
  }
  return vec4f(c / ws, 1.0);
}
`;

/* Ajout d'une couche de bloom dans l'accumulateur (mélange additif). */
export const ACCUM = VERT + /* wgsl */ `
struct U { c: vec4f };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> u: U;
@fragment fn fs(v: VO) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(src, smp, v.uv, 0.0).rgb * u.c.rgb, 1.0);
}
`;

/* Finition : bloom, tone mapping, puis les réglages d'affichage
   (noirs, blancs, ombres, hautes lumières, contraste, courbes, couleur, vignette). */
export const FINISH = VERT + COMMON + /* wgsl */ `
struct U { rect: vec4f, size: vec4f, lv: vec4f, tn: vec4f, bf: vec4f, gr: vec4f, lt: vec4f };
@group(0) @binding(0) var dev: texture_2d<f32>;
@group(0) @binding(1) var accA: texture_2d<f32>;
@group(0) @binding(2) var accS: texture_2d<f32>;
@group(0) @binding(3) var base: texture_2d<f32>;
@group(0) @binding(4) var smp: sampler;
@group(0) @binding(5) var<uniform> u: U;
@group(0) @binding(6) var curve: texture_2d<f32>;
@group(0) @binding(7) var lut: texture_3d<f32>;

/* Calques de réglages locaux : jusqu'à 8, chacun avec un masque
   (forme × plage de luminance ou de couleur) et ses propres réglages. */
struct Layer {
  m0: vec4f,   // forme (0 aucune, 1 radiale, 2 dégradé), plage (0, 1 luminance, 2 couleur), inverser, opacité
  m1: vec4f,   // radiale : centre, rayons ; dégradé : centre, angle, largeur
  m2: vec4f,   // transition (radiale), bas ou teinte, haut ou largeur, douceur
  m3: vec4f,   // saturation minimale (couleur), -, angle (radiale), -
  a0: vec4f,   // exposition, contraste, hautes lumières, ombres
  a1: vec4f,   // balance des blancs (multiplicateurs), saturation
  a2: vec4f,   // vibrance, bloom, -, -
  a3: vec4f,
};
struct Layers { n: vec4f, l: array<Layer, 8> };   // nombre, calque dont on montre le masque
@group(0) @binding(8) var<uniform> ls: Layers;

fn rgb2hsv(c: vec3f) -> vec3f {
  let mx = maxc(c); let mn = minc(c); let d = mx - mn;
  var h = 0.0;
  if (d > 1e-5) {
    if (mx == c.r) { h = (c.g - c.b) / d; }
    else if (mx == c.g) { h = 2.0 + (c.b - c.r) / d; }
    else { h = 4.0 + (c.r - c.g) / d; }
    h = fract(h / 6.0 + 1.0);
  }
  return vec3f(h, select(0.0, d / mx, mx > 1e-5), mx);
}

fn layerMask(i: u32, uv: vec2f, d: vec3f) -> f32 {
  let L = ls.l[i];
  let asp = u.bf.z;
  var g = 1.0;
  if (L.m0.x > 1.5) {
    // Dégradé : 1 d'un côté de la ligne, 0 de l'autre, sur la largeur donnée.
    let a = radians(L.m1.z);
    let s = dot((uv - L.m1.xy) * vec2f(asp, 1.0), vec2f(cos(a), sin(a)));
    g = 1.0 - smoothstep(-L.m1.w, L.m1.w, s);
  } else if (L.m0.x > 0.5) {
    // Radiale : une ellipse tournée, adoucie vers l'extérieur.
    let a = radians(L.m3.z);
    let p = (uv - L.m1.xy) * vec2f(asp, 1.0);
    let q = vec2f(p.x * cos(a) + p.y * sin(a), -p.x * sin(a) + p.y * cos(a)) / max(L.m1.zw, vec2f(1e-4));
    g = 1.0 - smoothstep(1.0 - L.m2.x, 1.0, length(q));
  }
  var r = 1.0;
  if (L.m0.y > 1.5) {
    // Couleur : distance de teinte (sur le cercle), et une saturation minimale.
    let hsv = rgb2hsv(clamp(d, vec3f(0.0), vec3f(1.0)));
    let dh = abs(fract(hsv.x - L.m2.y + 0.5) - 0.5);
    r = (1.0 - smoothstep(L.m2.z, L.m2.z + L.m2.w + 1e-4, dh)) * smoothstep(L.m3.x - 0.05, L.m3.x + 0.05, hsv.y);
  } else if (L.m0.y > 0.5) {
    let y = luma(clamp(d, vec3f(0.0), vec3f(1.0)));
    r = smoothstep(L.m2.y - L.m2.w, L.m2.y + L.m2.w, y) * (1.0 - smoothstep(L.m2.z - L.m2.w, L.m2.z + L.m2.w, y));
  }
  var m = g * r;
  if (L.m0.z > 0.5) { m = 1.0 - m; }
  return clamp(m * L.m0.w, 0.0, 1.0);
}

// Réglages d'un calque, sur une valeur d'affichage.
fn layerAdjust(i: u32, v0: vec3f) -> vec3f {
  let L = ls.l[i];
  var v = l2s(s2l(clamp(v0, vec3f(0.0), vec3f(1.0))) * exp2(L.a0.x) * L.a1.rgb);
  let y0 = clamp(luma(v), 0.0, 1.0);
  var y = y0 + L.a0.w * 1.6875 * y0 * (1.0 - y0) * (1.0 - y0) + L.a0.z * 1.6875 * y0 * y0 * (1.0 - y0);
  y = clamp(y, 0.0, 1.0);
  if (L.a0.y >= 0.0) { y = mix(y, y * y * (3.0 - 2.0 * y), L.a0.y); }
  else { y = 0.5 + (y - 0.5) * (1.0 + L.a0.y * 0.6); }
  v += y - y0;
  let yy = luma(v);
  let sat = clamp((maxc(v) - minc(v)) * 1.5, 0.0, 1.0);
  return yy + (v - yy) * max((1.0 + L.a1.w) * (1.0 + L.a2.x * (1.0 - sat)), 0.0);
}

// LUT 3D : lecture trilinéaire au centre des texels.
fn lutSample(v: vec3f) -> vec3f {
  let n = u.lt.z;
  return textureSampleLevel(lut, smp, clamp(v, vec3f(0.0), vec3f(1.0)) * ((n - 1.0) / n) + 0.5 / n, 0.0).rgb;
}
// Encodages Log des caméras, pour les LUT qui partent d'une image Log.
fn logEnc(c0: vec3f, t: f32) -> vec3f {
  let c = max(c0, vec3f(0.0));
  if (t < 2.5) {   // Sony S-Log3
    return select((c * (171.2102946929 - 95.0) / 0.01125 + 95.0) / 1023.0,
                  (420.0 + log2((c + 0.01) / 0.19) * 0.30103 * 261.5) / 1023.0, c >= vec3f(0.01125));
  }
  if (t < 3.5) {   // ARRI LogC3, EI 800
    return select(5.367655 * c + 0.092809, 0.24719 * log2(5.555556 * c + 0.052272) * 0.30103 + 0.385537, c > vec3f(0.010591));
  }
  // Panasonic V-Log
  return select(5.6 * c + 0.125, 0.241514 * log2(c + 0.00873) * 0.30103 + 0.598206, c >= vec3f(0.01));
}

fn agxCurve(x: vec3f) -> vec3f {
  let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c: vec3f) -> vec3f {
  let m = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                  0.0784335999999992, 0.878468636469772, 0.0784336,
                  0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let mi = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                   -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                   -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  let lo = -12.47393; let hi = 4.026069;
  var v = clamp(log2(max(m * c, vec3f(1e-10))), vec3f(lo), vec3f(hi));
  v = agxCurve((v - lo) / (hi - lo));
  return pow(max(mi * v, vec3f(0.0)), vec3f(2.2));
}
fn tonemap(c: vec3f, mode: f32) -> vec3f {
  if (mode > 1.5) { return agx(c); }
  if (mode > 0.5) {
    // Épaule douce : identique jusqu'à 0,6, puis tend vers 1 sans jamais l'atteindre.
    // Calculée sur la composante la plus forte pour garder la teinte ;
    // les très hautes lumières (cœur du bloom) partent vers le blanc.
    let mx = maxc(c);
    let k = 0.6;
    if (mx <= k) { return c; }
    let f = k + (1.0 - k) * (1.0 - exp(-(mx - k) / (1.0 - k)));
    return mix(c * (f / mx), vec3f(f), smoothstep(1.0, 10.0, mx));
  }
  return clamp(c, vec3f(0.0), vec3f(1.0));
}
fn hash(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.1030));
  let r = q + dot(q, q.yx + 33.33);
  return fract((r.x + r.y) * r.x);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = mix(u.rect.xy, u.rect.zw, pos.xy / u.size.xy);

  if (uv.x < u.size.z) {
    // Avant : l'image telle qu'elle a été décodée, avec le rendu par défaut.
    let b = textureSampleLevel(base, smp, uv, u.bf.w).rgb * u.bf.x;
    return vec4f(clamp(l2s(tonemap(b, u.bf.y)), vec3f(0.0), vec3f(1.0)), 1.0);
  }

  var c = textureLoad(dev, vec2i(pos.xy), 0).rgb;

  // Masques des calques, calculés une fois sur l'image avant bloom et réglages :
  // ils ne bougent pas quand on règle le calque lui-même.
  let nl = u32(ls.n.x);
  var masks: array<f32, 8>;
  var bloomK = 1.0;
  if (nl > 0u) {
    let d0 = l2s(tonemap(c, u.size.w));
    for (var i = 0u; i < nl; i++) {
      masks[i] = layerMask(i, uv, d0);
      bloomK += ls.l[i].a2.y * masks[i];
    }
  }
  bloomK = max(bloomK, 0.0);

  c += textureSampleLevel(accA, smp, uv, 0.0).rgb * bloomK;
  let sc = textureSampleLevel(accS, smp, uv, 0.0).rgb * bloomK;
  c += sc * (1.0 - clamp(c, vec3f(0.0), vec3f(1.0)));

  var v = l2s(tonemap(c, u.size.w));
  // LUT Log : elle remplace le rendu des hautes lumières, à partir de la lumière de la scène.
  if (u.lt.x > 1.5) { v = mix(v, lutSample(logEnc(c, u.lt.x)), u.lt.y); }

  // Noirs et blancs : niveaux, canal par canal.
  let b0 = -u.lv.x * 0.15;
  let w0 = 1.0 - u.lv.y * 0.25;
  v = (v - b0) / max(w0 - b0, 1e-3);

  // Ombres, hautes lumières et contraste, sur la luminance,
  // appliqués en décalage pour ne pas toucher à la saturation.
  let y0 = clamp(luma(v), 0.0, 1.0);
  var y = y0 + u.lv.z * 1.6875 * y0 * (1.0 - y0) * (1.0 - y0)
             + u.lv.w * 1.6875 * y0 * y0 * (1.0 - y0);
  y = clamp(y, 0.0, 1.0);
  if (u.tn.x >= 0.0) { y = mix(y, y * y * (3.0 - 2.0 * y), u.tn.x); }
  else { y = 0.5 + (y - 0.5) * (1.0 + u.tn.x * 0.6); }
  v += y - y0;

  // Courbes : une table de 1 024 valeurs par canal, lue au centre des texels.
  if (u.gr.y > 0.5) {
    let x = clamp(v, vec3f(0.0), vec3f(1.0)) * (1023.0 / 1024.0) + 0.5 / 1024.0;
    v = vec3f(textureSampleLevel(curve, smp, vec2f(x.r, 0.5), 0.0).r,
              textureSampleLevel(curve, smp, vec2f(x.g, 0.5), 0.0).g,
              textureSampleLevel(curve, smp, vec2f(x.b, 0.5), 0.0).b);
  }

  // Saturation et vibrance (la vibrance épargne ce qui est déjà saturé).
  let yy = luma(v);
  let sat = clamp((maxc(v) - minc(v)) * 1.5, 0.0, 1.0);
  let k = (1.0 + u.tn.y) * (1.0 + u.tn.z * (1.0 - sat));
  v = yy + (v - yy) * max(k, 0.0);

  // Calques locaux, dans l'ordre, chacun dosé par son masque.
  for (var i = 0u; i < nl; i++) { v = mix(v, layerAdjust(i, v), masks[i]); }

  // LUT d'affichage (sRGB, Rec.709) : après tous les réglages, avant la vignette et le grain.
  if (u.lt.x > 0.5 && u.lt.x < 1.5) { v = mix(v, lutSample(v), u.lt.y); }

  // Vignette : 1 dans les coins, quel que soit le format.
  let q = (uv - 0.5) * 2.0 * vec2f(u.bf.z, 1.0) / length(vec2f(u.bf.z, 1.0));
  v *= 1.0 + u.tn.w * smoothstep(0.3, 1.1, length(q));

  // Grain : bruit de valeur stable d'un rendu à l'autre, plus présent dans les tons moyens.
  if (u.gr.x > 0.0) {
    let g = (hash(floor(uv * u.gr.zw)) + hash(floor(uv * u.gr.zw) + 17.0) - 1.0);
    v += g * u.gr.x * 0.12 * (0.35 + 4.0 * yy * (1.0 - yy));
  }

  // Masque affiché : un voile rouge, comme dans Lightroom.
  if (ls.n.y >= 0.0 && u32(ls.n.y) < nl) { v = mix(clamp(v, vec3f(0.0), vec3f(1.0)), vec3f(0.95, 0.22, 0.28), masks[u32(ls.n.y)] * 0.6); }

  return vec4f(clamp(v, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

/* Histogramme : un thread par pixel de l'aperçu, quatre séries de 256 cases. */
export const HISTO = COMMON + /* wgsl */ `
@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>, 1024>;
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) g: vec3u) {
  let d = textureDimensions(img);
  if (g.x >= d.x || g.y >= d.y) { return; }
  let c = textureLoad(img, vec2i(g.xy), 0).rgb;
  let q = vec3u(clamp(c * 255.0 + 0.5, vec3f(0.0), vec3f(255.0)));
  atomicAdd(&bins[q.r], 1u);
  atomicAdd(&bins[256u + q.g], 1u);
  atomicAdd(&bins[512u + q.b], 1u);
  atomicAdd(&bins[768u + u32(clamp(luma(c) * 255.0 + 0.5, 0.0, 255.0))], 1u);
}
`;
