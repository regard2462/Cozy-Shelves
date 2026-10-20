// Physically based watercolor simulation (WebGL2) after
// Curtis, Anderson, Seims, Fleischer, Salesin: "Computer-Generated Watercolor", SIGGRAPH 1997.
//
// Three-layer paper model, all as GPU ping-pong textures:
//   shallow-water layer  : wet-area mask M, velocity (u,v) on a staggered grid, pressure p    -> texture "water" (M,u,v,p)
//   pigment in water     : concentrations g_k, 4 pigment slots per RGBA texture               -> textures "pig[i]"
//   pigment deposition   : d_k                                                                -> textures "dep[i]"
//   capillary layer      : saturation s (capacity c and height h come from the static paper) -> texture "cap" (s)
// Per time step: UpdateVelocities (+ evaporation, FlowOutward, capillary re-wetting), RelaxDivergence (Jacobi),
// blurred wet mask, MovePigment (conservative upwind advection), TransferPigment (density ρ, granulation ω,
// staining σ), SimulateCapillaryFlow (backruns). Rendering uses the Kubelka-Munk model with K/S per pigment
// derived from its colour on white and on black, composited over a procedurally textured paper.
//
// Public API: createWatercolorSim({ width, height, paperSeed, canvas, … }) – see bottom of file.

export const NUM_SLOTS_PER_TEX = 4;

// ---------------------------------------------------------------------------------------------------------------
// Pigment presets.  rw = reflectance at unit thickness over white, rb = over black (sRGB 0..1).
// rho = density (deposition rate), omega = granulation, sigma = staining (higher = harder to lift).
// ---------------------------------------------------------------------------------------------------------------
export const PIGMENTS = [
  { id: 'quinrose', de: 'Chinacridonrosa', en: 'Quinacridone Rose', rw: [0.87, 0.36, 0.56], rb: [0.16, 0.02, 0.08], rho: 0.0075, omega: 0.15, sigma: 3.5 },
  { id: 'indianred', de: 'Indischrot', en: 'Indian Red', rw: [0.66, 0.30, 0.26], rb: [0.30, 0.10, 0.08], rho: 0.0225, omega: 0.6, sigma: 1.2 },
  { id: 'cadyellow', de: 'Kadmiumgelb', en: 'Cadmium Yellow', rw: [0.98, 0.83, 0.16], rb: [0.62, 0.48, 0.05], rho: 0.0175, omega: 0.3, sigma: 1.3 },
  { id: 'hookers', de: 'Hookersgrün', en: "Hooker's Green", rw: [0.32, 0.56, 0.30], rb: [0.05, 0.14, 0.05], rho: 0.01, omega: 0.3, sigma: 2.0 },
  { id: 'cerulean', de: 'Coelinblau', en: 'Cerulean Blue', rw: [0.44, 0.69, 0.86], rb: [0.10, 0.25, 0.42], rho: 0.0225, omega: 0.75, sigma: 1.1 },
  { id: 'ultramarine', de: 'Ultramarin', en: 'French Ultramarine', rw: [0.22, 0.30, 0.78], rb: [0.03, 0.05, 0.28], rho: 0.015, omega: 0.9, sigma: 1.4 },
  { id: 'burntsienna', de: 'Sienna gebrannt', en: 'Burnt Sienna', rw: [0.73, 0.41, 0.22], rb: [0.22, 0.09, 0.03], rho: 0.0125, omega: 0.5, sigma: 1.6 },
  { id: 'paynes', de: 'Paynesgrau', en: "Payne's Gray", rw: [0.38, 0.42, 0.50], rb: [0.05, 0.06, 0.09], rho: 0.0125, omega: 0.5, sigma: 1.8 },
  { id: 'sapgreen', de: 'Saftgrün', en: 'Sap Green', rw: [0.50, 0.66, 0.24], rb: [0.09, 0.16, 0.03], rho: 0.0075, omega: 0.2, sigma: 2.8 },
  { id: 'ochre', de: 'Ocker', en: 'Yellow Ochre', rw: [0.87, 0.69, 0.33], rb: [0.36, 0.26, 0.08], rho: 0.02, omega: 0.55, sigma: 1.3 },
  { id: 'alizarin', de: 'Alizarinkarmesin', en: 'Alizarin Crimson', rw: [0.74, 0.16, 0.30], rb: [0.14, 0.02, 0.05], rho: 0.0075, omega: 0.1, sigma: 3.0 },
  { id: 'phthalo', de: 'Phthaloblau', en: 'Phthalo Blue', rw: [0.12, 0.38, 0.72], rb: [0.02, 0.06, 0.22], rho: 0.0063, omega: 0.05, sigma: 5.0 },
];

export const PAPERS = {
  rough: { amp: 1.0, scale: 7.0, fiber: 0.45, grain: 1.0 },
  cold: { amp: 0.62, scale: 4.5, fiber: 0.3, grain: 0.7 },
  hot: { amp: 0.28, scale: 3.0, fiber: 0.12, grain: 0.4 },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const acoth = (x) => 0.5 * Math.log((x + 1) / (x - 1));

/** Kubelka-Munk absorption K and scattering S (per RGB channel) from the colour on white / on black. */
export function kmFromColors(rw, rb) {
  const K = [0, 0, 0], S = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const Rw = clamp(rw[i], 0.02, 0.985);
    const Rb = clamp(rb[i], 0.004, Rw - 0.004);
    const a = 0.5 * (Rw + (Rb - Rw + 1) / Rb);
    const b = Math.sqrt(Math.max(a * a - 1, 1e-8));
    let arg = (b * b - (a - Rw) * (a - 1)) / (b * (1 - Rw));
    if (!(arg > 1.000001)) arg = 1.000001;
    const s = acoth(arg) / b;
    S[i] = Math.max(s, 1e-4);
    K[i] = Math.max(S[i] * (a - 1), 1e-5);
  }
  return { K, S };
}

/** Build a pigment definition from a single sRGB colour (custom colours from the colour picker). */
export function pigmentFromColor(rgb, opts = {}) {
  const rw = rgb.map((c) => clamp(c, 0.02, 0.98));
  const lum = 0.3 * rw[0] + 0.59 * rw[1] + 0.11 * rw[2];
  const transparency = opts.transparency ?? 0.85;
  const rb = rw.map((c) => clamp(c * c * (1 - transparency) + c * 0.06, 0.004, c - 0.01));
  return { id: opts.id || 'custom', de: opts.de || 'Eigene Farbe', en: opts.en || 'Custom colour', rw, rb, rho: opts.rho ?? 0.045, omega: opts.omega ?? (0.25 + 0.4 * (1 - lum)), sigma: opts.sigma ?? 2.0, custom: true };
}

export function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
export function rgbToHex(rgb) { return '#' + rgb.map((c) => Math.round(clamp(c, 0, 1) * 255).toString(16).padStart(2, '0')).join(''); }

// ---------------------------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------------------------
const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 v_uv;
void main() { vec2 p = P[gl_VertexID]; v_uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const header = (isFloat, npt) => `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
#define NPT ${npt}
#define VMAX 0.25
${isFloat ? `
vec4 decW(vec4 e) { return e; }
vec4 encW(vec4 w) { return w; }
vec4 encWd(vec4 w) { return w; }
vec4 decP(vec4 e) { return e; }
vec4 encP(vec4 p) { return p; }
vec4 encPd(vec4 p) { return p; }` : `
vec4 decW(vec4 e) { return vec4(e.x, (e.y - 0.5) * 0.5, (e.z - 0.5) * 0.5, e.w * 4.0); }
vec4 encW(vec4 w) { return vec4(w.x, w.y * 2.0 + 0.5, w.z * 2.0 + 0.5, w.w * 0.25); }
vec4 encWd(vec4 w) { return vec4(w.x, w.y * 2.0, w.z * 2.0, w.w * 0.25); }
vec4 decP(vec4 e) { return e * 2.0; }
vec4 encP(vec4 p) { return p * 0.5; }
vec4 encPd(vec4 p) { return p * 0.5; }`}
in vec2 v_uv;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
`;

// Procedural paper: height h (R), capillary capacity c (G), fibre detail (B).
const FS_PAPER = `
uniform float u_seed, u_amp, u_scale, u_fiber, u_res;
out vec4 o;
float fbm(vec2 p) { float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); n += a; p = p * 2.03 + vec2(13.1, 7.7); a *= 0.55; } return s / n; }
void main() {
  vec2 px = gl_FragCoord.xy * u_res;
  vec2 q = px / u_scale + u_seed * vec2(17.31, 5.17);
  float n = fbm(q);
  float fib = 0.0;
  for (int k = 0; k < 3; k++) {
    float a = float(k) * 1.07 + u_seed * 0.37;
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 r = R * px;
    float f = vnoise(vec2(r.x * 0.035, r.y * 0.75) + float(k) * 7.7 + u_seed);
    fib += pow(f, 3.0);
  }
  fib /= 3.0;
  float h = 0.5 + u_amp * (n - 0.5) * 1.7 + u_fiber * (fib - 0.25) + 0.03 * u_amp * (hash12(px + u_seed) - 0.5);
  h = clamp(h, 0.0, 1.0);
  float c = mix(0.3, 0.9, h);
  // smooth (low-frequency) height for the slope term of the flow
  float hs = 0.5 + u_amp * (vnoise(q * 0.5) * 0.6 + vnoise(q * 0.25 + 3.3) * 0.4 - 0.5) * 1.2;
  o = vec4(h, c, fib, clamp(hs, 0.0, 1.0));
}`;

// UpdateVelocities + evaporation + FlowOutward + capillary re-wetting.  water: (M, u_{i+1/2,j}, v_{i,j+1/2}, p)
const FS_VELOCITY = `
uniform sampler2D u_water, u_paper, u_cap, u_mblur;
uniform vec2 u_texel;
uniform float u_evap, u_eta, u_mu, u_kappa, u_slope, u_sigmaCap, u_dt, u_pscale, u_capReturn;
out vec4 o;
vec4 W(vec2 uv) { return decW(texture(u_water, uv)); }
void main() {
  vec2 dx = vec2(u_texel.x, 0.0), dy = vec2(0.0, u_texel.y);
  vec4 c = W(v_uv), r = W(v_uv + dx), l = W(v_uv - dx), t = W(v_uv + dy), b = W(v_uv - dy);
  vec4 tr = W(v_uv + dx + dy), br = W(v_uv + dx - dy), tl = W(v_uv - dx + dy);
  float s = texture(u_cap, v_uv).x;
  vec3 pap = texture(u_paper, v_uv).xyz;
  float M = c.x >= 0.5 ? 1.0 : 0.0;
  float p = clamp(c.w, 0.0, 4.0);
  float wetByCap = s > u_sigmaCap ? 1.0 : 0.0;
  if (M < 0.5 && wetByCap > 0.5) { M = 1.0; p += u_capReturn; }
  float mb = texture(u_mblur, v_uv).x;
  p -= u_evap * M;
  p -= u_eta * (1.0 - mb) * M;
  if (p <= 0.0) { p = 0.0; if (wetByCap < 0.5) M = 0.0; }
  // staggered velocities
  float u = c.y, v = c.z;
  float Mr = r.x >= 0.5 ? 1.0 : 0.0, Mt = t.x >= 0.5 ? 1.0 : 0.0;
  float fu = M * Mr, fv = M * Mt;           // active faces
  // advection term A (paper eq.)
  float uc = 0.5 * (l.y + c.y), ur = 0.5 * (c.y + r.y);
  float vc = 0.5 * (b.z + c.z), vt = 0.5 * (c.z + t.z);
  float uv_tr = 0.5 * (c.y + t.y) * 0.5 * (c.z + r.z);
  float uv_br = 0.5 * (c.y + b.y) * 0.5 * (b.z + br.z);
  float Au = uc * uc - ur * ur + uv_br - uv_tr;
  float uv_tl = 0.5 * (l.z + c.z) * 0.5 * (l.y + tl.y);
  float Av = vc * vc - vt * vt + uv_tl - uv_tr;
  // viscosity (Laplacian)
  float Bu = r.y + l.y + t.y + b.y - 4.0 * c.y;
  float Bv = r.z + l.z + t.z + b.z - 4.0 * c.z;
  float pr = clamp(r.w, 0.0, 4.0), pt = clamp(t.w, 0.0, 4.0);
  float hs = texture(u_paper, v_uv).w;
  float hr = texture(u_paper, v_uv + dx).w, ht = texture(u_paper, v_uv + dy).w;
  float un = u + u_dt * (Au + u_mu * Bu + u_pscale * (p - pr) - u_kappa * u) - u_slope * (hr - hs);
  float vn = v + u_dt * (Av + u_mu * Bv + u_pscale * (p - pt) - u_kappa * v) - u_slope * (ht - hs);
  un = clamp(un, -VMAX, VMAX) * fu;
  vn = clamp(vn, -VMAX, VMAX) * fv;
  o = encW(vec4(M, un, vn, p));
}`;

// RelaxDivergence – one Jacobi iteration.
const FS_RELAX = `
uniform sampler2D u_water;
uniform vec2 u_texel; uniform float u_xi;
out vec4 o;
vec4 W(vec2 uv) { return decW(texture(u_water, uv)); }
float dlt(vec4 c, vec4 l, vec4 b) { float M = c.x >= 0.5 ? 1.0 : 0.0; return u_xi * M * (c.y - l.y + c.z - b.z); }
void main() {
  vec2 dx = vec2(u_texel.x, 0.0), dy = vec2(0.0, u_texel.y);
  vec4 c = W(v_uv), r = W(v_uv + dx), l = W(v_uv - dx), t = W(v_uv + dy), b = W(v_uv - dy);
  vec4 br = W(v_uv + dx - dy), tl = W(v_uv - dx + dy);
  float dc = dlt(c, l, b), dr = dlt(r, c, br), dt = dlt(t, tl, c);
  float M = c.x >= 0.5 ? 1.0 : 0.0, Mr = r.x >= 0.5 ? 1.0 : 0.0, Mt = t.x >= 0.5 ? 1.0 : 0.0;
  float u = clamp(c.y + dr - dc, -VMAX, VMAX) * M * Mr;
  float v = clamp(c.z + dt - dc, -VMAX, VMAX) * M * Mt;
  float p = max(c.w - dc, 0.0);
  o = encW(vec4(M, u, v, p));
}`;

// Blurred wet mask (low resolution, separable).  pass 0: sample full-res water.M horizontally; pass 1: vertical.
const FS_BLUR = `
uniform sampler2D u_src; uniform vec2 u_step; uniform int u_pass;
out vec4 o;
const float w[5] = float[5](0.2270, 0.1945, 0.1216, 0.0540, 0.0162);
void main() {
  float acc = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = v_uv + float(i) * u_step;
    vec4 e = texture(u_src, uv);
    float m = u_pass == 0 ? min(decW(e).x, 1.0) : e.x;
    acc += w[abs(i)] * m;
  }
  o = vec4(acc, 0.0, 0.0, 1.0);
}`;

// MovePigment – conservative upwind advection on the staggered grid + slight diffusion inside the wet area.
const FS_ADVECT = `
uniform sampler2D u_water, u_pig;
uniform vec2 u_texel; uniform float u_diff;
out vec4 o;
vec4 W(vec2 uv) { return decW(texture(u_water, uv)); }
vec4 G(vec2 uv) { return decP(texture(u_pig, uv)); }
void main() {
  vec2 dx = vec2(u_texel.x, 0.0), dy = vec2(0.0, u_texel.y);
  vec4 c = W(v_uv), l = W(v_uv - dx), b = W(v_uv - dy), r = W(v_uv + dx), t = W(v_uv + dy);
  vec4 g = G(v_uv), gl = G(v_uv - dx), gr = G(v_uv + dx), gb = G(v_uv - dy), gt = G(v_uv + dy);
  float M = c.x >= 0.5 ? 1.0 : 0.0;
  float outF = max(0.0, c.y) + max(0.0, -l.y) + max(0.0, c.z) + max(0.0, -b.z);
  vec4 gn = g * (1.0 - min(outF, 1.0))
    + max(0.0, l.y) * gl + max(0.0, -c.y) * gr + max(0.0, b.z) * gb + max(0.0, -c.z) * gt;
  // diffusion between wet neighbours (symmetric -> conservative)
  float Ml = l.x >= 0.5 ? 1.0 : 0.0, Mr = r.x >= 0.5 ? 1.0 : 0.0, Mb = b.x >= 0.5 ? 1.0 : 0.0, Mt = t.x >= 0.5 ? 1.0 : 0.0;
  vec4 lap = Ml * (gl - g) + Mr * (gr - g) + Mb * (gb - g) + Mt * (gt - g);
  gn += M * u_diff * 0.25 * lap;
  o = encP(max(gn, vec4(0.0)));
}`;

// TransferPigment (MRT): pigment in water g <-> deposit d.  Dry cells (or forced drying) deposit everything.
const FS_TRANSFER = `
uniform sampler2D u_water, u_paper, u_pig, u_dep;
uniform vec4 u_rho, u_omega, u_sigma; uniform float u_force, u_dmax;
layout(location = 0) out vec4 o_g;
layout(location = 1) out vec4 o_d;
void main() {
  vec4 w = decW(texture(u_water, v_uv));
  vec4 g = decP(texture(u_pig, v_uv)), d = decP(texture(u_dep, v_uv));
  float h = texture(u_paper, v_uv).x;
  float M = w.x >= 0.5 ? 1.0 : 0.0;
  if (u_force > 0.5 || M < 0.5) {
    d = min(d + g, vec4(u_dmax)); g = vec4(0.0);
  } else {
    vec4 down = g * (1.0 - h * u_omega) * u_rho;
    vec4 up = d * (1.0 + (h - 1.0) * u_omega) * u_rho / u_sigma;
    down = min(down, max(vec4(u_dmax) - d, vec4(0.0)));
    up = min(up, max(vec4(1.0) - g, vec4(0.0)));
    d += down - up; g += up - down;
  }
  o_g = encP(max(g, vec4(0.0)));
  o_d = encP(clamp(d, vec4(0.0), vec4(u_dmax)));
}`;

// SimulateCapillaryFlow: absorb from shallow water, diffuse through the paper, slow evaporation.
const FS_CAPILLARY = `
uniform sampler2D u_water, u_paper, u_cap;
uniform vec2 u_texel; uniform float u_alpha, u_eps, u_delta, u_evapS, u_rate;
out vec4 o;
float S(vec2 uv) { return texture(u_cap, uv).x; }
float C(vec2 uv) { return texture(u_paper, uv).y; }
void main() {
  vec2 dx = vec2(u_texel.x, 0.0), dy = vec2(0.0, u_texel.y);
  vec4 w = decW(texture(u_water, v_uv));
  float s = S(v_uv), c = C(v_uv);
  float M = w.x >= 0.5 ? 1.0 : 0.0;
  if (M > 0.5 && w.w > 0.0) s += min(u_alpha, max(0.0, c - s));
  vec2 offs[4] = vec2[4](dx, -dx, dy, -dy);
  float gain = 0.0, loss = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 uv = v_uv + offs[i];
    float sn = S(uv), cn = C(uv);
    if (sn > s && sn > u_eps && s > u_delta) gain += max(0.0, min(sn - s, c - s)) * 0.25;
    if (s > sn && s > u_eps && sn > u_delta) loss += max(0.0, min(s - sn, cn - sn)) * 0.25;
  }
  s += u_rate * (gain - loss);
  s -= u_evapS * (1.0 - 0.5 * M);
  o = vec4(clamp(s, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

// Brush dab.  mode 0: water (additive to water), 1: pigment (additive to pig), 2: dry pigment (additive to dep),
// 3: lift (multiplicative on pig/dep).
const FS_DAB = `
uniform sampler2D u_paper;
uniform vec2 u_center, u_size; uniform float u_radius, u_aspect, u_angle, u_soft, u_edgeNoise, u_seed, u_water, u_thresh, u_res;
uniform vec4 u_amount; uniform int u_mode;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy - u_center;
  float ca = cos(u_angle), sa = sin(u_angle);
  p = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
  p.y /= u_aspect;
  float r = length(p) / u_radius;
  float ang = atan(p.y, p.x);
  float n = vnoise(vec2(ang * 3.0 + u_seed, r * 2.0 + u_seed * 3.1)) - 0.5;
  r += u_edgeNoise * n;
  float mask = 1.0 - smoothstep(1.0 - u_soft, 1.0, r);
  vec3 pap = texture(u_paper, gl_FragCoord.xy / u_size).xyz;
  if (u_mode == 0) {
    // additive: M += wet (clamped later), p += water * mask
    float wet = mask > 0.2 ? 1.0 : 0.0;
    o = encWd(vec4(wet, 0.0, 0.0, u_water * mask));
  } else if (u_mode == 1) {
    float grain = 1.0 - 0.35 * (pap.x - 0.5);
    o = encPd(u_amount * mask * grain);
  } else if (u_mode == 2) {
    float bristle = vnoise(vec2(p.x * 0.9 + u_seed * 7.0, p.y * 0.12)) ;
    float hit = smoothstep(u_thresh - 0.08, u_thresh + 0.08, pap.x * 0.7 + 0.3 * bristle);
    o = encPd(u_amount * mask * hit);
  } else {
    o = vec4(1.0) - mask * u_amount;
  }
}`;

// Kubelka-Munk composite over paper.
const FS_RENDER = `
uniform sampler2D u_water, u_paper, u_under, u_cap;
uniform sampler2D u_g0, u_d0;
#if NPT > 1
uniform sampler2D u_g1, u_d1;
#endif
#if NPT > 2
uniform sampler2D u_g2, u_d2;
#endif
uniform vec3 u_K[NPT * 4], u_S[NPT * 4];
uniform vec3 u_paperColor; uniform float u_grain, u_underOpacity, u_hasUnder, u_showWet, u_flipY; uniform vec2 u_texel;
out vec4 o;
void accum(vec4 x, int base, inout vec3 Kt, inout vec3 St, inout float X) {
  for (int i = 0; i < 4; i++) { float xi = x[i]; Kt += xi * u_K[base + i]; St += xi * u_S[base + i]; X += xi; }
}
void main() {
  vec2 uv = vec2(v_uv.x, u_flipY > 0.5 ? 1.0 - v_uv.y : v_uv.y);
  vec4 w = decW(texture(u_water, uv));
  vec3 pap = texture(u_paper, uv).xyz;
  float hx = texture(u_paper, uv + vec2(u_texel.x, 0.0)).x - texture(u_paper, uv - vec2(u_texel.x, 0.0)).x;
  float hy = texture(u_paper, uv + vec2(0.0, u_texel.y)).x - texture(u_paper, uv - vec2(0.0, u_texel.y)).x;
  float shade = 1.0 + u_grain * (0.10 * (pap.x - 0.5) + 0.35 * (-hx * 0.8 + hy * 0.45) + 0.03 * (pap.z - 0.25));
  vec3 R0 = u_paperColor * shade;
  if (u_hasUnder > 0.5) { vec4 u = texture(u_under, uv); float lum = dot(u.rgb, vec3(0.3, 0.59, 0.11)); R0 *= mix(1.0, 0.35 + 0.65 * lum, u_underOpacity * u.a); }
  vec3 Kt = vec3(0.0), St = vec3(0.0); float X = 0.0;
  accum(decP(texture(u_g0, uv)) + decP(texture(u_d0, uv)), 0, Kt, St, X);
#if NPT > 1
  accum(decP(texture(u_g1, uv)) + decP(texture(u_d1, uv)), 4, Kt, St, X);
#endif
#if NPT > 2
  accum(decP(texture(u_g2, uv)) + decP(texture(u_d2, uv)), 8, Kt, St, X);
#endif
  vec3 col = R0;
  if (X > 1e-5) {
    vec3 Kw = Kt / X, Sw = St / X;
    vec3 a = 1.0 + Kw / Sw;
    vec3 b = sqrt(max(a * a - 1.0, vec3(1e-6)));
    vec3 arg = min(b * St, vec3(20.0));
    vec3 sh = sinh(arg), ch = cosh(arg);
    vec3 den = a * sh + b * ch;
    vec3 R = sh / den, T = b / den;
    col = R + T * T * R0 / (1.0 - R * R0);
  }
  float wet = u_showWet * (w.x >= 0.5 ? 1.0 : 0.0) * clamp(w.w * 2.0, 0.15, 1.0);
  col *= 1.0 - 0.06 * wet;
  col += 0.04 * wet * vec3(0.9, 0.95, 1.0) * (0.5 + 0.5 * pap.x);
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// Simple blit / resample.
const FS_COPY = `
uniform sampler2D u_src; out vec4 o;
void main() { o = texture(u_src, v_uv); }`;

// ---------------------------------------------------------------------------------------------------------------
// GL helpers
// ---------------------------------------------------------------------------------------------------------------
function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('[watercolor] shader: ' + log + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n').slice(0, 2000)); }
    return s;
  };
  const p = gl.createProgram();
  const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[watercolor] link: ' + gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); uniforms[info.name.replace(/\[0\]$/, '')] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size }; }
  return { prog: p, uniforms };
}

export function createWatercolorSim(options = {}) {
  const {
    width = 1000, height = 700, paperSeed = 1, simScale = 1, pigments: pigmentsIn = PIGMENTS, paper = 'cold',
    undoLevels = 10, numPigmentTextures = 3, forceByte = false,
  } = options;
  const canvas = options.canvas || document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 not available');
  const NPT = Math.max(1, Math.min(3, numPigmentTextures | 0));
  const NSLOTS = NPT * NUM_SLOTS_PER_TEX;

  // --- float support --------------------------------------------------------------------------------------------
  let isFloat = false;
  const ext = forceByte ? null : (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  if (ext) {
    // verify that a half-float FBO is actually complete
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    isFloat = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(t);
  }
  const FMT = isFloat ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };

  // --- programs -------------------------------------------------------------------------------------------------
  const H = header(isFloat, NPT);
  const progs = {
    paper: compile(gl, VERT, H + FS_PAPER),
    velocity: compile(gl, VERT, H + FS_VELOCITY),
    relax: compile(gl, VERT, H + FS_RELAX),
    blur: compile(gl, VERT, H + FS_BLUR),
    advect: compile(gl, VERT, H + FS_ADVECT),
    transfer: compile(gl, VERT, H + FS_TRANSFER),
    capillary: compile(gl, VERT, H + FS_CAPILLARY),
    dab: compile(gl, VERT, H + FS_DAB),
    render: compile(gl, VERT, H + FS_RENDER),
    copy: compile(gl, VERT, H + FS_COPY),
  };
  const vao = gl.createVertexArray();

  let cur = null;
  function use(p) { if (cur !== p) { gl.useProgram(p.prog); cur = p; } }
  function uni(p, name, ...v) {
    const u = p.uniforms[name]; if (!u) return;
    const l = u.loc;
    switch (u.type) {
      case gl.FLOAT: v.length > 1 || Array.isArray(v[0]) ? gl.uniform1fv(l, Array.isArray(v[0]) ? v[0] : v) : gl.uniform1f(l, v[0]); break;
      case gl.INT: case gl.SAMPLER_2D: gl.uniform1i(l, v[0]); break;
      case gl.FLOAT_VEC2: gl.uniform2f(l, v[0], v[1]); break;
      case gl.FLOAT_VEC3: Array.isArray(v[0]) && v[0].length > 3 ? gl.uniform3fv(l, v[0]) : gl.uniform3f(l, v[0], v[1], v[2]); break;
      case gl.FLOAT_VEC4: gl.uniform4f(l, v[0], v[1], v[2], v[3]); break;
    }
  }
  let texUnit = 0;
  function bindTex(p, name, tex) { const u = p.uniforms[name]; if (!u) return; gl.activeTexture(gl.TEXTURE0 + texUnit); gl.bindTexture(gl.TEXTURE_2D, tex.tex); gl.uniform1i(u.loc, texUnit); texUnit++; }
  function beginDraw(p) { use(p); texUnit = 0; }
  function draw() { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  // --- textures / framebuffers ----------------------------------------------------------------------------------
  function makeTex(w, h, { fmt = FMT, filter = gl.NEAREST } = {}) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, gl.RGBA, fmt.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }
  function makePair(w, h, o) { return { a: makeTex(w, h, o), b: makeTex(w, h, o), swap() { const t = this.a; this.a = this.b; this.b = t; } }; }
  function delTex(t) { if (!t) return; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
  function delPair(p) { delTex(p.a); delTex(p.b); }
  function target(t, x = 0, y = 0, w = t.w, h = t.h) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(x, y, w, h); }
  const mrtFb = gl.createFramebuffer();
  function targetMRT(t0, t1) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, mrtFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0.tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t1.tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, t0.w, t0.h);
  }
  function clearTex(t, rgba) { target(t); gl.disable(gl.SCISSOR_TEST); gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
  const ZERO_W = isFloat ? [0, 0, 0, 0] : [0, 0.5, 0.5, 0];
  function copyTex(src, dst) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fb);
    gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, dst.w, dst.h, gl.COLOR_BUFFER_BIT, src.w === dst.w && src.h === dst.h ? gl.NEAREST : gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // --- state ----------------------------------------------------------------------------------------------------
  const S = {
    W: 0, H: 0, cw: 0, ch: 0,
    water: null, cap: null, pig: [], dep: [], paperSim: null, paperFull: null, mblur: null, mtmp: null, under: null,
    paperType: paper, paperSeed, hasUnder: false, underOpacity: 0.35,
  };
  // Time constants (evap, eta, evapS, depositScale) are set together by setDryingSpeed(); 1 = fast (~250 steps to dry).
  const params = {
    evap: 0.004, eta: 0.05, mu: 0.1, kappa: 0.015, slope: 0.01, dt: 1.0, pscale: 0.8, capReturn: 0.05,
    xi: 0.1, relaxIters: 10, diffusion: 0.3, depositScale: 1,
    alpha: 0.06, eps: 0.15, delta: 0.05, sigmaCap: 0.55, evapS: 0.004, capRate: 1.0,
    dmax: 1.6, grain: 1.0, paperColor: [0.975, 0.955, 0.905], showWet: 1, stepsPerFrame: 3, dryingSpeed: 1,
  };
  function setDryingSpeed(x) { params.dryingSpeed = x; params.evap = 0.004 * x; params.eta = 0.05 * x; params.evapS = 0.004 * x; params.depositScale = x; }
  const pigments = [...pigmentsIn];
  const km = pigments.map((p) => kmFromColors(p.rw, p.rb));
  const slots = new Array(NSLOTS).fill(null);      // slot -> pigment index
  const slotUse = new Float32Array(NSLOTS);
  let paused = false, activity = 0, stepCount = 0;
  const undoStack = [], redoStack = [];
  let seedCounter = 0;

  function alloc(w, h) {
    S.cw = w; S.ch = h;
    S.W = Math.max(16, Math.round(w * simScale)); S.H = Math.max(16, Math.round(h * simScale));
    canvas.width = w; canvas.height = h;
    S.water = makePair(S.W, S.H);
    S.cap = makePair(S.W, S.H);
    S.pig = []; S.dep = [];
    for (let i = 0; i < NPT; i++) { S.pig.push(makePair(S.W, S.H)); S.dep.push(makePair(S.W, S.H)); }
    S.paperSim = makeTex(S.W, S.H, { fmt: { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE }, filter: gl.NEAREST });
    S.paperFull = (S.W === w && S.H === h) ? S.paperSim : makeTex(w, h, { fmt: { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE }, filter: gl.LINEAR });
    const bw = Math.max(8, S.W >> 2), bh = Math.max(8, S.H >> 2);
    S.mblur = makeTex(bw, bh, { fmt: { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE }, filter: gl.LINEAR });
    S.mtmp = makeTex(bw, bh, { fmt: { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE }, filter: gl.LINEAR });
    if (isFloat) for (const pr of [S.water, S.cap, ...S.pig, ...S.dep]) for (const t of [pr.a, pr.b]) { gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); }
    resetState();
    genPaper();
  }
  function free() {
    for (const pr of [S.water, S.cap, ...S.pig, ...S.dep]) delPair(pr);
    if (S.paperFull !== S.paperSim) delTex(S.paperFull);
    delTex(S.paperSim); delTex(S.mblur); delTex(S.mtmp);
    for (const s of [...undoStack, ...redoStack]) freeSnap(s); undoStack.length = 0; redoStack.length = 0;
  }
  function resetState() {
    for (const t of [S.water.a, S.water.b]) clearTex(t, ZERO_W);
    for (const pr of [S.cap, ...S.pig, ...S.dep]) for (const t of [pr.a, pr.b]) clearTex(t, [0, 0, 0, 0]);
    clearTex(S.mblur, [0, 0, 0, 1]); clearTex(S.mtmp, [0, 0, 0, 1]);
    slotUse.fill(0);
    activity = 0;
  }
  function genPaper() {
    const pp = typeof S.paperType === 'object' ? S.paperType : (PAPERS[S.paperType] || PAPERS.cold);
    const p = progs.paper;
    for (const t of new Set([S.paperSim, S.paperFull])) {
      target(t); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
      beginDraw(p);
      uni(p, 'u_seed', (S.paperSeed % 1000) * 0.731 + 1.0); uni(p, 'u_amp', pp.amp); uni(p, 'u_scale', pp.scale); uni(p, 'u_fiber', pp.fiber);
      uni(p, 'u_res', S.cw / t.w);
      draw();
    }
    params.grain = pp.grain ?? 0.7;
  }

  // --- snapshots ------------------------------------------------------------------------------------------------
  // Snapshots copy only the pigment textures whose slots are in use (GPU memory: ~5.6 MB per texture at 1000x700).
  const texUsed = (i) => slots.slice(i * 4, i * 4 + 4).some((x) => x != null);
  function takeSnap() {
    const s = { water: makeTex(S.W, S.H), cap: makeTex(S.W, S.H), pig: [], dep: [], slots: [...slots], use: Float32Array.from(slotUse) };
    copyTex(S.water.a, s.water); copyTex(S.cap.a, s.cap);
    for (let i = 0; i < NPT; i++) {
      if (!texUsed(i)) { s.pig.push(null); s.dep.push(null); continue; }
      s.pig.push(makeTex(S.W, S.H)); s.dep.push(makeTex(S.W, S.H)); copyTex(S.pig[i].a, s.pig[i]); copyTex(S.dep[i].a, s.dep[i]);
    }
    return s;
  }
  function restoreSnap(s) {
    copyTex(s.water, S.water.a); copyTex(s.cap, S.cap.a);
    for (let i = 0; i < NPT; i++) {
      if (s.pig[i]) { copyTex(s.pig[i], S.pig[i].a); copyTex(s.dep[i], S.dep[i].a); }
      else { clearTex(S.pig[i].a, [0, 0, 0, 0]); clearTex(S.dep[i].a, [0, 0, 0, 0]); }
    }
    for (let i = 0; i < NSLOTS; i++) slots[i] = s.slots[i];
    slotUse.set(s.use);
    activity = Math.ceil(1.2 / params.evap) + Math.ceil(1 / params.evapS);
  }
  function freeSnap(s) { delTex(s.water); delTex(s.cap); s.pig.forEach(delTex); s.dep.forEach(delTex); }

  // --- pigment slots --------------------------------------------------------------------------------------------
  function slotFor(pigIdx) {
    let i = slots.indexOf(pigIdx);
    if (i >= 0) return i;
    i = slots.indexOf(null);
    if (i < 0) { i = 0; for (let k = 1; k < NSLOTS; k++) if (slotUse[k] < slotUse[i]) i = k; slotUse[i] = 0; }
    slots[i] = pigIdx;
    return i;
  }
  function slotVec(tex, prop) { const v = [0, 0, 0, 0]; for (let c = 0; c < 4; c++) { const pi = slots[tex * 4 + c]; const pg = pi == null ? null : pigments[pi]; v[c] = pg ? pg[prop] : (prop === 'sigma' ? 1 : prop === 'rho' ? 0.05 : 0.3); } return v; }

  // --- simulation passes ----------------------------------------------------------------------------------------
  const texel = () => [1 / S.W, 1 / S.H];
  function passVelocity() {
    const p = progs.velocity; target(S.water.b); beginDraw(p);
    bindTex(p, 'u_water', S.water.a); bindTex(p, 'u_paper', S.paperSim); bindTex(p, 'u_cap', S.cap.a); bindTex(p, 'u_mblur', S.mblur);
    uni(p, 'u_texel', ...texel());
    uni(p, 'u_evap', params.evap); uni(p, 'u_eta', params.eta); uni(p, 'u_mu', params.mu); uni(p, 'u_kappa', params.kappa); uni(p, 'u_slope', params.slope);
    uni(p, 'u_sigmaCap', params.sigmaCap); uni(p, 'u_dt', params.dt); uni(p, 'u_pscale', params.pscale); uni(p, 'u_capReturn', params.capReturn);
    draw(); S.water.swap();
  }
  function passRelax() {
    const p = progs.relax; beginDraw(p); uni(p, 'u_texel', ...texel()); uni(p, 'u_xi', params.xi);
    for (let i = 0; i < params.relaxIters; i++) { target(S.water.b); texUnit = 0; bindTex(p, 'u_water', S.water.a); draw(); S.water.swap(); }
  }
  function setFilter(t, f) { gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f); }
  function passBlur() {
    const p = progs.blur;
    // pass 0 samples the full-res mask with linear filtering (block average, keeps the blur centred on the edge)
    setFilter(S.water.a, gl.LINEAR);
    target(S.mtmp); beginDraw(p); bindTex(p, 'u_src', S.water.a); uni(p, 'u_pass', 0); uni(p, 'u_step', 1 / S.mtmp.w, 0); draw();
    setFilter(S.water.a, gl.NEAREST);
    target(S.mblur); texUnit = 0; bindTex(p, 'u_src', S.mtmp); uni(p, 'u_pass', 1); uni(p, 'u_step', 0, 1 / S.mtmp.h); draw();
  }
  function passAdvect() {
    const p = progs.advect; beginDraw(p); uni(p, 'u_texel', ...texel()); uni(p, 'u_diff', params.diffusion);
    for (let i = 0; i < NPT; i++) { target(S.pig[i].b); texUnit = 0; bindTex(p, 'u_water', S.water.a); bindTex(p, 'u_pig', S.pig[i].a); draw(); S.pig[i].swap(); }
  }
  function passTransfer(force = false) {
    const p = progs.transfer; beginDraw(p); uni(p, 'u_force', force ? 1 : 0); uni(p, 'u_dmax', params.dmax);
    for (let i = 0; i < NPT; i++) {
      targetMRT(S.pig[i].b, S.dep[i].b); texUnit = 0;
      bindTex(p, 'u_water', S.water.a); bindTex(p, 'u_paper', S.paperSim); bindTex(p, 'u_pig', S.pig[i].a); bindTex(p, 'u_dep', S.dep[i].a);
      uni(p, 'u_rho', ...slotVec(i, 'rho').map((r) => r * params.depositScale)); uni(p, 'u_omega', ...slotVec(i, 'omega')); uni(p, 'u_sigma', ...slotVec(i, 'sigma'));
      draw(); S.pig[i].swap(); S.dep[i].swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function passCapillary() {
    const p = progs.capillary; target(S.cap.b); beginDraw(p);
    bindTex(p, 'u_water', S.water.a); bindTex(p, 'u_paper', S.paperSim); bindTex(p, 'u_cap', S.cap.a);
    uni(p, 'u_texel', ...texel()); uni(p, 'u_alpha', params.alpha); uni(p, 'u_eps', params.eps); uni(p, 'u_delta', params.delta); uni(p, 'u_evapS', params.evapS); uni(p, 'u_rate', params.capRate);
    draw(); S.cap.swap();
  }
  function stepOnce() {
    gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
    passVelocity();
    passRelax();
    passBlur();
    passAdvect();
    passTransfer(false);
    passCapillary();
    stepCount++;
  }

  // --- rendering ------------------------------------------------------------------------------------------------
  function render(flipY = false) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, S.cw, S.ch); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
    const p = progs.render; beginDraw(p);
    // sim textures need linear sampling when the canvas is larger than the sim grid
    const lin = S.W !== S.cw || S.H !== S.ch;
    const list = [S.water.a, S.cap.a, ...S.pig.map((x) => x.a), ...S.dep.map((x) => x.a)];
    if (lin) for (const t of list) setFilter(t, gl.LINEAR);
    bindTex(p, 'u_water', S.water.a); bindTex(p, 'u_paper', S.paperFull); bindTex(p, 'u_cap', S.cap.a);
    bindTex(p, 'u_under', S.under || S.paperFull);
    bindTex(p, 'u_g0', S.pig[0].a); bindTex(p, 'u_d0', S.dep[0].a);
    if (NPT > 1) { bindTex(p, 'u_g1', S.pig[1].a); bindTex(p, 'u_d1', S.dep[1].a); }
    if (NPT > 2) { bindTex(p, 'u_g2', S.pig[2].a); bindTex(p, 'u_d2', S.dep[2].a); }
    const K = [], Sv = [];
    for (let i = 0; i < NSLOTS; i++) { const pi = slots[i]; const k = pi == null ? { K: [0.1, 0.1, 0.1], S: [0.1, 0.1, 0.1] } : km[pi]; K.push(...k.K); Sv.push(...k.S); }
    gl.uniform3fv(p.uniforms.u_K.loc, K); gl.uniform3fv(p.uniforms.u_S.loc, Sv);
    uni(p, 'u_paperColor', ...params.paperColor); uni(p, 'u_grain', params.grain); uni(p, 'u_underOpacity', S.underOpacity); uni(p, 'u_hasUnder', S.hasUnder ? 1 : 0);
    uni(p, 'u_showWet', params.showWet); uni(p, 'u_flipY', flipY ? 1 : 0); uni(p, 'u_texel', 1 / S.cw, 1 / S.ch);
    draw();
    if (lin) for (const t of list) setFilter(t, gl.NEAREST);
  }

  // --- brush ----------------------------------------------------------------------------------------------------
  function dab(targetTex, mode, o) {
    const p = progs.dab;
    const sx = S.W / S.cw, sy = S.H / S.ch;
    const cx = o.x * sx, cy = (S.ch - o.y) * sy;                  // canvas y is top-down, GL is bottom-up
    const rad = Math.max(0.75, o.radius * sx);
    const ext = rad * (1.3 + 0.3 * (o.edgeNoise ?? 0)) + 2;
    const x0 = Math.max(0, Math.floor(cx - ext)), y0 = Math.max(0, Math.floor(cy - ext));
    const x1 = Math.min(S.W, Math.ceil(cx + ext)), y1 = Math.min(S.H, Math.ceil(cy + ext));
    if (x1 <= x0 || y1 <= y0) return;
    target(targetTex); gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, x1 - x0, y1 - y0);
    gl.enable(gl.BLEND);
    if (mode === 3) gl.blendFunc(gl.DST_COLOR, gl.ZERO); else gl.blendFunc(gl.ONE, gl.ONE);
    beginDraw(p);
    bindTex(p, 'u_paper', S.paperSim);
    uni(p, 'u_center', cx, cy); uni(p, 'u_size', S.W, S.H); uni(p, 'u_radius', rad); uni(p, 'u_aspect', o.aspect ?? 1); uni(p, 'u_angle', -(o.angle ?? 0));
    uni(p, 'u_soft', o.soft ?? 0.5); uni(p, 'u_edgeNoise', o.edgeNoise ?? 0.12); uni(p, 'u_seed', (seedCounter++ % 997) * 0.37 + (o.seed ?? 0));
    uni(p, 'u_water', o.water ?? 0); uni(p, 'u_thresh', o.thresh ?? 0.55); uni(p, 'u_res', 1);
    const a = o.amount || [0, 0, 0, 0]; uni(p, 'u_amount', a[0], a[1], a[2], a[3]); uni(p, 'u_mode', mode);
    draw();
    gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
  }

  /**
   * One brush dab.  { x, y, radius } in canvas pixels; pigment = index into sim.pigments or null (clean water);
   * water 0..1, pressure 0..1, load (pigment amount factor), mode 'wet' | 'dry' | 'lift', aspect/angle for flat brushes.
   */
  function stroke(o) {
    const mode = o.mode || 'wet';
    const pressure = clamp(o.pressure ?? 0.5, 0.02, 1);
    const water = clamp(o.water ?? 0.5, 0, 1);
    const radius = Math.max(0.5, (o.radius ?? 10) * (0.55 + 0.45 * pressure));
    const common = { x: o.x, y: o.y, radius, aspect: o.aspect, angle: o.angle, soft: o.soft ?? (mode === 'dry' ? 0.3 : 0.22 + 0.38 * water), edgeNoise: o.edgeNoise ?? (0.08 + 0.12 * (1 - water)), seed: o.seed };
    activity = Math.max(activity, Math.ceil(1.2 / params.evap) + Math.ceil(1 / params.evapS));
    const load = o.load ?? 1;
    if (mode === 'lift') {
      const lift = clamp(load * (0.2 + 0.8 * pressure) * 0.35, 0, 1);
      for (let i = 0; i < NPT; i++) {
        const sig = slotVec(i, 'sigma');
        dab(S.pig[i].a, 3, { ...common, amount: [lift, lift, lift, lift] });
        dab(S.dep[i].a, 3, { ...common, amount: sig.map((s) => lift * 0.4 / s) });
      }
      if (water > 0.05) dab(S.water.a, 0, { ...common, water: 0.3 * water, soft: 0.6 });
      return;
    }
    if (mode === 'dry') {
      if (o.pigment == null) return;
      const slot = slotFor(o.pigment); slotUse[slot] += pressure;
      const amt = [0, 0, 0, 0]; amt[slot % 4] = load * 0.12 * (0.3 + 0.7 * pressure);
      dab(S.dep[slot >> 2].a, 2, { ...common, amount: amt, thresh: 0.75 - 0.3 * pressure - 0.2 * water });
      return;
    }
    // wet mode: water + pigment (both additive; several dabs overlap along a stroke)
    dab(S.water.a, 0, { ...common, water: (0.05 + 0.95 * water) * (0.4 + 0.6 * pressure) * 0.14 });
    if (o.pigment != null) {
      const slot = slotFor(o.pigment); slotUse[slot] += pressure;
      const amt = [0, 0, 0, 0]; amt[slot % 4] = load * 0.1 * (0.3 + 0.7 * pressure) * (1.2 - 0.5 * water);
      dab(S.pig[slot >> 2].a, 1, { ...common, amount: amt });
    }
  }

  // --- public API -----------------------------------------------------------------------------------------------
  alloc(width, height);
  const sim = {
    canvas, gl, isFloat, params, pigments, slots,
    get width() { return S.cw; }, get height() { return S.ch; }, get simWidth() { return S.W; }, get simHeight() { return S.H; },
    get paperType() { return S.paperType; }, get paperSeed() { return S.paperSeed; }, get stepCount() { return stepCount; },
    stroke,
    /** Convenience: dabs along a segment with spacing (fraction of radius). */
    strokeLine(x0, y0, x1, y1, o, spacing = 0.3) {
      const d = Math.hypot(x1 - x0, y1 - y0); const step = Math.max(0.5, (o.radius ?? 10) * spacing); const n = Math.max(1, Math.ceil(d / step));
      const ang = Math.atan2(y1 - y0, x1 - x0);
      for (let i = 0; i < n; i++) { const t = (i + 1) / n; stroke({ ...o, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, angle: o.angle ?? ang }); }
    },
    step(n = 1) { if (paused) return; for (let i = 0; i < n; i++) { if (activity <= 0) break; stepOnce(); activity--; } gl.bindFramebuffer(gl.FRAMEBUFFER, null); },
    /** true while water may still be moving (steps have an effect) */
    isActive() { return activity > 0 && !paused; },
    setWet(flag) { paused = !flag; },
    get paused() { return paused; },
    dry() { gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST); passTransfer(true); for (const t of [S.water.a, S.water.b]) clearTex(t, ZERO_W); for (const t of [S.cap.a, S.cap.b]) clearTex(t, [0, 0, 0, 0]); clearTex(S.mblur, [0, 0, 0, 1]); activity = 0; },
    clear() { resetState(); for (let i = 0; i < NSLOTS; i++) slots[i] = null; seedCounter = 0; },
    render, toDataURL(type = 'image/png', q) { render(false); return canvas.toDataURL(type, q); },
    /** push an undo snapshot (call before a stroke starts) */
    snapshot() { if (!undoLevels) return; undoStack.push(takeSnap()); while (undoStack.length > undoLevels) freeSnap(undoStack.shift()); for (const s of redoStack) freeSnap(s); redoStack.length = 0; },
    undo() { if (!undoStack.length) return false; redoStack.push(takeSnap()); const s = undoStack.pop(); restoreSnap(s); freeSnap(s); return true; },
    redo() { if (!redoStack.length) return false; undoStack.push(takeSnap()); const s = redoStack.pop(); restoreSnap(s); freeSnap(s); return true; },
    get canUndo() { return undoStack.length > 0; }, get canRedo() { return redoStack.length > 0; },
    setPaper(type, seed) {
      if (type != null) S.paperType = type; if (seed != null) S.paperSeed = seed; genPaper();
    },
    setParams(patch) { Object.assign(params, patch); },
    setDryingSpeed,
    addPigment(def) { pigments.push(def); km.push(kmFromColors(def.rw, def.rb)); return pigments.length - 1; },
    updatePigment(i, def) { pigments[i] = def; km[i] = kmFromColors(def.rw, def.rb); },
    /** drops pigments >= n (only safe when no slot uses them, e.g. after clear()) */
    truncatePigments(n) { if (slots.some((s) => s != null && s >= n)) return false; pigments.length = n; km.length = n; return true; },
    /** faint pencil underdrawing (img: HTMLImageElement | ImageBitmap | canvas | null) */
    loadImageAsUnderdrawing(img, opacity = 0.35) {
      S.underOpacity = opacity;
      if (!img) { S.hasUnder = false; return; }
      if (!S.under) { S.under = makeTex(4, 4, { fmt: { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE }, filter: gl.LINEAR }); }
      gl.bindTexture(gl.TEXTURE_2D, S.under.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      S.hasUnder = true;
    },
    setUnderdrawingOpacity(o) { S.underOpacity = o; },
    resize(w, h) {
      if (w === S.cw && h === S.ch) return;
      const old = { water: S.water, cap: S.cap, pig: S.pig, dep: S.dep, pf: S.paperFull, ps: S.paperSim, mb: S.mblur, mt: S.mtmp };
      for (const s of [...undoStack, ...redoStack]) freeSnap(s); undoStack.length = 0; redoStack.length = 0;
      alloc(w, h);
      copyTex(old.water.a, S.water.a); copyTex(old.cap.a, S.cap.a);
      for (let i = 0; i < NPT; i++) { copyTex(old.pig[i].a, S.pig[i].a); copyTex(old.dep[i].a, S.dep[i].a); }
      delPair(old.water); delPair(old.cap); old.pig.forEach(delPair); old.dep.forEach(delPair); if (old.pf !== old.ps) delTex(old.pf); delTex(old.ps); delTex(old.mb); delTex(old.mt);
      activity = 400;
    },
    /** Debug: read a simulation texture ('water'|'cap'|'pig0'|'dep0'…) as Float32Array (RGBA, bottom-up, decoded). */
    readTexture(name) {
      const t = name === 'water' ? S.water.a : name === 'cap' ? S.cap.a : name.startsWith('pig') ? S.pig[+name[3] || 0].a : name.startsWith('dep') ? S.dep[+name[3] || 0].a : S.paperSim;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      const isF = t !== S.paperSim && isFloat;
      const out = new Float32Array(t.w * t.h * 4);
      if (isF) gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, out);
      else { const b = new Uint8Array(t.w * t.h * 4); gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, b); for (let i = 0; i < b.length; i++) out[i] = b[i] / 255; if (name === 'water' && !isFloat) for (let i = 0; i < out.length; i += 4) { out[i + 1] = (out[i + 1] - 0.5) * 0.5; out[i + 2] = (out[i + 2] - 0.5) * 0.5; out[i + 3] *= 4; } }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { width: t.w, height: t.h, data: out };
    },
    /** Read back the composited image as ImageData-like {width,height,data} (RGBA, top-down). */
    readPixels() {
      render(true);
      const data = new Uint8Array(S.cw * S.ch * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, S.cw, S.ch, gl.RGBA, gl.UNSIGNED_BYTE, data);
      render(false);
      return { width: S.cw, height: S.ch, data };
    },
    destroy() {
      free(); if (S.under) delTex(S.under); gl.deleteFramebuffer(mrtFb); gl.deleteVertexArray(vao);
      for (const p of Object.values(progs)) gl.deleteProgram(p.prog);
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    },
  };
  return sim;
}
