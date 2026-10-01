/* =========================================================
   Rendu des particules sur la carte graphique (WebGL2).
   Même calcul que posAt() dans app.js, porté en GLSL :
   les positions sont calculées dans le vertex shader, les
   particules s'additionnent dans une texture flottante
   (mélange additif, dépôt par recouvrement de pixel, donc sans
   crénelage), puis la densité passe par la même table de couleurs.
   On demande le profil « haute performance » : sur une machine
   à deux cartes graphiques, le navigateur prend la carte dédiée.
   ========================================================= */

const VS_PARTICLES = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in float aK;
layout(location = 1) in float aU;
layout(location = 2) in float aOff;

uniform float uT, uFlow, uRot, uTilt, uTurb, uTurbScale, uEvolve, uWidth;
uniform float uArms, uTwist, uRings, uInner, uRingTwist;
uniform int uShape;          // 0 galaxie, 1 sphère, 2 courbe
uniform bool uAlternate;
uniform vec4 uOrb[5];        // cos(rx), sin(rx), cos(tz), sin(tz) pour chaque anneau en orbite
uniform vec2 uSize;          // taille du tampon en pixels
uniform vec4 uXf;            // unit, ox, oy, (inutilisé)
uniform vec2 uRotM;          // cos et sin de l'angle de cadrage
uniform float uWeight, uPt;
uniform sampler2D uCurve;    // 1024 × 1 : x, y, nx, ny
uniform sampler2D uNoise;    // 256 × 256

out vec2 vPos;
out float vW;

const float TAU = 6.283185307179586;
const float DUST = 65535.0, ORBIT = 60000.0;

float vnoise(vec2 p) {
  vec2 f = floor(p), fr = p - f;
  vec2 s = fr * fr * (3.0 - 2.0 * fr);
  int i0 = int(f.x) & 255, i1 = (int(f.x) + 1) & 255, j0 = int(f.y) & 255, j1 = (int(f.y) + 1) & 255;
  float a = texelFetch(uNoise, ivec2(i0, j0), 0).r, b = texelFetch(uNoise, ivec2(i1, j0), 0).r;
  float c = texelFetch(uNoise, ivec2(i0, j1), 0).r, d = texelFetch(uNoise, ivec2(i1, j1), 0).r;
  return a + (b - a) * s.x + (c - a) * s.y + (a - b - c + d) * s.x * s.y;
}
float fbm(vec2 p) { return vnoise(p) + 0.5 * vnoise(p * 2.03 + vec2(17.1, 31.7)); }

void main() {
  float k = aK, u = aU, off = aOff, t = uT;
  vec2 P; float W = 1.0; bool turb = true;
  if (k == DUST) {
    float a = t * uRot * TAU * 0.25, c = cos(a), s = sin(a);
    vec2 q = vec2(u, off) * 1.8;
    P = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
    turb = false;
  } else if (k >= ORBIT) {
    int j = int(k - ORBIT);
    float a = (u + t * uFlow * 2.0) * TAU;
    float R = 0.84 + float(j) * 0.1;
    float x = cos(a) * R, y = off * 0.005, z = sin(a) * R;
    vec4 o = uOrb[j];
    float y1 = y * o.x - z * o.y, z1 = y * o.y + z * o.x;
    float x2 = x * o.z - y1 * o.w, y2 = x * o.w + y1 * o.z;
    vec3 q = vec3(x2, y2, z1) * 0.85;
    float sc = 3.0 / (3.0 - q.z);
    P = q.xy * sc; W = 0.2 + 0.8 * clamp((q.z / 0.7 + 1.0) / 2.0, 0.0, 1.0);
    turb = false;
  } else if (uShape == 1) {
    float lon0 = (u + t * uFlow) * TAU, sp = t * uRot * TAU;
    float c0 = cos(lon0), s0 = sin(lon0), rr = sqrt(max(0.0, 1.0 - off * off));
    float cl = c0 * cos(sp) - s0 * sin(sp), sl = s0 * cos(sp) + c0 * sin(sp);
    float R = 0.62 * (1.0 + uWidth * (k / 500.0 - 1.0));
    if (uTurb > 0.0) {
      float f = uTurbScale, e = t * uEvolve;
      R *= 1.0 + uTurb * 1.6 * fbm(vec2(rr * c0 * f + e + 3.1, (off + rr * s0 * 0.7) * f - e * 0.6));
    }
    float x = rr * cl * R, y = off * R, z = rr * sl * R;
    float ct = cos(uTilt), st = sin(uTilt);
    vec3 q = vec3(x, y * ct - z * st, y * st + z * ct);
    float sc = 3.0 / (3.0 - q.z);
    P = q.xy * sc; W = 0.2 + 0.8 * clamp((q.z / 0.7 + 1.0) / 2.0, 0.0, 1.0);
    turb = false;
  } else if (uShape == 0) {
    float uu = fract(u + t * uFlow);
    float r = 0.025 + uu * 0.975;
    float th = k / uArms * TAU + uTwist * log(1.0 + r * 8.0) + t * uRot * TAU;
    float w = off * uWidth * (0.35 + r), c = cos(th), s = sin(th);
    P = vec2(r * c - w * s, r * s + w * c);
  } else {
    float dir = uAlternate && mod(k, 2.0) == 1.0 ? -1.0 : 1.0;
    float uu = fract(u + t * uFlow * dir);
    float f = uu * 1024.0, i0 = floor(f), fr = f - i0;
    vec4 a = texelFetch(uCurve, ivec2(int(i0), 0), 0), b = texelFetch(uCurve, ivec2(int(mod(i0 + 1.0, 1024.0)), 0), 0);
    vec2 base = mix(a.xy, b.xy, fr);
    float sk = uRings > 1.0 ? uInner + (1.0 - uInner) * k / (uRings - 1.0) : 1.0;
    vec2 q = (base + a.zw * off * uWidth) * sk;
    float ra = k * uRingTwist + t * uRot * TAU, rc = cos(ra), rs = sin(ra);
    P = vec2(q.x * rc - q.y * rs, q.x * rs + q.y * rc);
  }
  if (turb && uTurb > 0.0) {
    float f = uTurbScale, e = t * uEvolve;
    P += uTurb * vec2(fbm(vec2(P.x * f + e, P.y * f)), fbm(vec2(P.x * f + 41.3, P.y * f - e)));
  }
  // Même cadrage que transform() : pixel i du tampon CPU = coordonnée i
  vec2 X = uXf.yz + vec2(P.x * uRotM.x - P.y * uRotM.y, P.x * uRotM.y + P.y * uRotM.x) * uXf.x;
  vPos = X;
  vW = uWeight * W;
  gl_Position = vec4((X + 0.5) / uSize * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uPt + 2.0;
}`;

// Chaque pixel reçoit la part de la particule (un carré de côté « taille ») qui le recouvre :
// pour une taille de 1, c'est exactement le dépôt bilinéaire du rendu processeur.
const FS_PARTICLES = `#version 300 es
precision highp float;
in vec2 vPos;
in float vW;
uniform float uPt;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy - 0.5;
  vec2 ov = clamp(min(p + 0.5, vPos + uPt * 0.5) - max(p - 0.5, vPos - uPt * 0.5), 0.0, 1.0);
  float w = ov.x * ov.y;
  if (w <= 0.0) discard;
  o = vec4(vW * w / (uPt * uPt), 0.0, 0.0, 1.0);
}`;

const VS_QUAD = `#version 300 es
const vec2 Q[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(Q[gl_VertexID], 0.0, 1.0); }`;

const FS_FADE = `#version 300 es
precision highp float;
uniform float uKeep;
out vec4 o;
void main() { o = vec4(uKeep); }`;

// Densité vers couleur, par la même table que toneMap() ; le tampon est retourné (ligne 0 en haut)
const FS_TONE = `#version 300 es
precision highp float;
uniform sampler2D uDensity;
uniform sampler2D uLut;
uniform float uScale;
uniform vec2 uSize;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float d = texelFetch(uDensity, ivec2(p.x, int(uSize.y) - 1 - p.y), 0).r;
  int j = min(int(d * uScale), 1023);
  o = vec4(texelFetch(uLut, ivec2(j, 0), 0).rgb, 1.0);
}`;

function compile(gl, vs, fs) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const loc = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, ""); loc[name] = gl.getUniformLocation(prog, name); }
  return { prog, loc };
}

export function createGpu() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    powerPreference: "high-performance", antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: true, desynchronized: true
  });
  if (!gl) return null;
  // Rendu dans une texture flottante : RGBA32F si on peut y mélanger, sinon RGBA16F
  if (!gl.getExtension("EXT_color_buffer_float")) return null;
  const float32 = !!gl.getExtension("EXT_float_blend");
  const fmt = float32 ? { internal: gl.RGBA32F, type: gl.FLOAT } : { internal: gl.RGBA16F, type: gl.HALF_FLOAT };

  let parts, fade, tone;
  try {
    parts = compile(gl, VS_PARTICLES, FS_PARTICLES);
    fade = compile(gl, VS_QUAD, FS_FADE);
    tone = compile(gl, VS_QUAD, FS_TONE);
  } catch (e) {
    console.warn("Loop : shaders WebGL indisponibles, rendu par le processeur", e);
    return null;
  }

  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));

  const vao = gl.createVertexArray();
  const bufK = gl.createBuffer(), bufU = gl.createBuffer(), bufO = gl.createBuffer();
  gl.bindVertexArray(vao);
  [[bufK, 0], [bufU, 1], [bufO, 2]].forEach(([b, i]) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(i); });
  gl.bindBuffer(gl.ARRAY_BUFFER, bufK); gl.vertexAttribPointer(0, 1, gl.UNSIGNED_SHORT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufU); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufO); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const quadVao = gl.createVertexArray();

  const tex = (w, h, internal, format, type, data, filter = gl.NEAREST) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  let curveTex = null, noiseTex = null, lutTex = null;
  let density = null, fbo = null, fw = 0, fh = 0;
  let count = 0, lastP = null, curveV = -1, lutV = -1;

  function ensureTarget(w, h) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (fw === w && fh === h && density) return;
    if (density) gl.deleteTexture(density);
    if (fbo) gl.deleteFramebuffer(fbo);
    density = tex(w, h, fmt.internal, gl.RGBA, fmt.type, null);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, density, 0);
    fw = w; fh = h;
    clear();
  }

  function clear() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fw, fh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // Données envoyées seulement quand elles changent
  function sync(src) {
    if (src.P !== lastP) {
      lastP = src.P; count = src.P.n;
      gl.bindBuffer(gl.ARRAY_BUFFER, bufK); gl.bufferData(gl.ARRAY_BUFFER, src.P.k, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufU); gl.bufferData(gl.ARRAY_BUFFER, src.P.u, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufO); gl.bufferData(gl.ARRAY_BUFFER, src.P.off, gl.STATIC_DRAW);
    }
    if (src.curveVersion !== curveV) {
      curveV = src.curveVersion;
      const data = new Float32Array(1024 * 4);
      for (let i = 0; i < 1024; i++) {
        data[i * 4] = src.curve[i * 2]; data[i * 4 + 1] = src.curve[i * 2 + 1];
        data[i * 4 + 2] = src.normals[i * 2]; data[i * 4 + 3] = src.normals[i * 2 + 1];
      }
      if (curveTex) gl.deleteTexture(curveTex);
      curveTex = tex(1024, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, data);
    }
    if (!noiseTex) noiseTex = tex(256, 256, gl.R32F, gl.RED, gl.FLOAT, src.noise);
    if (src.lutVersion !== lutV) {
      lutV = src.lutVersion;
      if (lutTex) gl.deleteTexture(lutTex);
      lutTex = tex(1024, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(src.lut.buffer.slice(0)));
    }
  }

  function drawParticles(src, time, weight) {
    const S = src.S, L = parts.loc;
    gl.useProgram(parts.prog);
    gl.uniform1f(L.uT, time);
    gl.uniform1f(L.uFlow, S.flow); gl.uniform1f(L.uRot, S.rot); gl.uniform1f(L.uTilt, S.tilt);
    gl.uniform1f(L.uTurb, S.turb); gl.uniform1f(L.uTurbScale, S.turbScale); gl.uniform1f(L.uEvolve, S.evolve);
    gl.uniform1f(L.uWidth, S.width); gl.uniform1f(L.uArms, S.arms); gl.uniform1f(L.uTwist, S.twist);
    gl.uniform1f(L.uRings, S.rings); gl.uniform1f(L.uInner, S.inner); gl.uniform1f(L.uRingTwist, S.ringTwist);
    gl.uniform1i(L.uShape, S.shape === "galaxie" ? 0 : S.shape === "sphere" ? 1 : 2);
    gl.uniform1i(L.uAlternate, S.alternate ? 1 : 0);
    const orb = new Float32Array(20);
    src.orbitTilt.forEach(([tx, tz], j) => { const rx = tx + time * S.rot * 0.6; orb.set([Math.cos(rx), Math.sin(rx), Math.cos(tz), Math.sin(tz)], j * 4); });
    gl.uniform4fv(L.uOrb, orb);
    const xf = src.transform(fw, fh);
    gl.uniform2f(L.uSize, fw, fh);
    gl.uniform4f(L.uXf, xf.unit, xf.ox, xf.oy, 0);
    gl.uniform2f(L.uRotM, xf.ca, xf.sa);
    const pt = Math.max(1, S.size | 0);
    gl.uniform1f(L.uWeight, weight); gl.uniform1f(L.uPt, pt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, curveTex); gl.uniform1i(L.uCurve, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(L.uNoise, 1);
    gl.bindVertexArray(vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function fadeBy(keep) {
    gl.useProgram(fade.prog);
    gl.uniform1f(fade.loc.uKeep, keep);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  function present(src) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, fw, fh);
    gl.useProgram(tone.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, density); gl.uniform1i(tone.loc.uDensity, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutTex); gl.uniform1i(tone.loc.uLut, 1);
    gl.uniform1f(tone.loc.uScale, 1023 / src.DMAX);
    gl.uniform2f(tone.loc.uSize, fw, fh);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  return {
    canvas, renderer, maxSize, float32,
    // Une image en direct : le tampon s'estompe, puis on ajoute les particules du moment
    frame(src, w, h, time, weight, keep, advance) {
      ensureTarget(w, h);
      sync(src);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, fw, fh);
      if (advance) { fadeBy(keep); drawParticles(src, time, weight); }
      present(src);
      return canvas;
    },
    // Tampon complet d'un coup : les images passées pèsent trail^i (comme primeBuffer)
    prime(src, w, h, time, samples, base, trail) {
      ensureTarget(w, h);
      sync(src);
      clear();
      for (let i = 0; i < samples; i++) drawParticles(src, time - i / 60, base * Math.pow(trail, i));
      present(src);
      return canvas;
    },
    lost: () => gl.isContextLost()
  };
}
