// The night sky's data, without any meshes: how the sky turns over the garden (the sidereal time at 50° north), where
// the stars stand, the Milky Way's frame and the moon's phase on a date. sky.js draws them, sky-state.js keeps the clock.
//
// Directions: the world's y is up and +z the north the stars turn round (the celestial pole stands 50° above the
// northern horizon, in front of the glass front). The sky turns the way the sun goes in this world (environment.js
// sunPosition): everything rises on the side of -x and sets on the side of +x, so -x is east as far as the sky goes.
import * as THREE from 'three';

export const LATITUDE = 50;    // degrees north: the stars as seen from the middle of Europe
export const LONGITUDE = 10;   // degrees east (the sidereal time of the clock hour)
export const SYNODIC = 29.530588853;   // days from new moon to new moon
const RAD = Math.PI / 180;

/**
 * The sun's direction at a clock hour: a simple arc, sunrise about 6:30, sunset about 20:30 (a long summer evening
 * feels cosier). Below the horizon the sun goes on sinking at the pace it set, down to 20° (it used to drop there at
 * once: the dusk of the day cycle jumped to night). (environment.js exports it as before.)
 */
export function sunPosition(hour, out = new THREE.Vector3()) {
  const t = (hour - 6.5) / 14;
  const elev = t < 0 ? Math.max(-0.35, t * Math.PI * 0.95) : t > 1 ? Math.max(-0.35, (1 - t) * Math.PI * 0.95) : Math.sin(t * Math.PI) * 0.95;
  const az = -Math.PI * 0.85 + Math.min(1.1, Math.max(-0.1, t)) * Math.PI * 1.3;
  const e = Math.max(elev, -0.3);
  return out.set(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)).normalize();
}
/** The sun's ecliptic longitude (radians) at a time in ms (UTC), to a fraction of a degree. */
export function sunLongitude(ms) {
  const d = jdOf(ms) - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * RAD;
  return (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
}
/**
 * The moon among the stars at a time in ms (UTC), as an equatorial unit vector: on the ecliptic, as far from the sun as
 * its phase says (a full moon opposite it), up to 5° above or below it. Turned with the sky (skyRotation) it rises in the
 * east and sets in the west at the hours its phase gives it, and a winter full moon rides high.
 */
export function moonEquatorial(ms, phase, out = new THREE.Vector3()) {
  const d = jdOf(ms) - 2451545.0;
  const lambda = sunLongitude(ms) + phase * Math.PI * 2;
  const beta = 5.128 * RAD * Math.sin((93.272 + 13.22935 * d) * RAD);
  const eps = 23.439 * RAD, cb = Math.cos(beta);
  const x = cb * Math.cos(lambda), y = cb * Math.sin(lambda), z = Math.sin(beta);
  return out.set(x, y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps));
}

/** The astronomical day number (JD) of a time in ms (UTC). */
export const jdOf = (ms) => ms / 86400000 + 2440587.5;

/** The moon's phase at a time in ms: 0 new moon, 0.25 first quarter, 0.5 full moon, 0.75 last quarter. */
export function moonPhase(ms = Date.now()) {
  // a new moon on 6 January 2000, 18:14 UT, and the mean length of a lunation
  const p = (jdOf(ms) - 2451550.26) / SYNODIC;
  return p - Math.floor(p);
}
/** The lit part of the moon's disc for a phase (0 … 1). */
export const moonLit = (phase) => (1 - Math.cos(2 * Math.PI * phase)) / 2;
/** How bright the moon's light is for a phase, 1 at full moon: steeper than the lit part (a half moon gives far less
 *  than half the light of a full one), softened so that a half moon still lights the garden. */
export const moonBrightness = (phase) => Math.pow(moonLit(phase), 1.6);

/** Local sidereal time in radians for a time in ms (UTC), at LONGITUDE. */
export function siderealAngle(ms) {
  const d = jdOf(ms) - 2451545.0;
  const deg = 280.46061837 + 360.98564736629 * d + LONGITUDE;
  return ((deg % 360) + 360) % 360 * RAD;
}

/** The time (ms, UTC) at which the local clock of a day shows `hour` (fractions and hours beyond 24 allowed). `day` is any
 *  time on that day; the clock follows the computer's time zone on that day. */
export function clockTime(hour, day = Date.now()) {
  const d = new Date(day); d.setHours(0, 0, 0, 0);
  return d.getTime() + hour * 3600000;
}

const _m = new THREE.Matrix3();
/**
 * The rotation from equatorial directions (x towards the vernal equinox, z the celestial pole) to the world at a
 * sidereal time `lst` (radians): out = B · Rz(-lst), B the observer's frame (east towards -x, the zenith up, north +z).
 */
export function skyRotation(lst, out = new THREE.Matrix3()) {
  const phi = LATITUDE * RAD, sp = Math.sin(phi), cp = Math.cos(phi), c = Math.cos(lst), s = Math.sin(lst);
  // rows of B: world x = -east, world y = zenith, world z = north (in hour-angle coordinates)
  const B = [[0, -1, 0], [cp, 0, sp], [-sp, 0, cp]];
  // Rz(-lst): x' = x c + y s, y' = -x s + y c
  const R = [[c, s, 0], [-s, c, 0], [0, 0, 1]];
  const e = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e[i * 3 + j] = B[i][0] * R[0][j] + B[i][1] * R[1][j] + B[i][2] * R[2][j];
  return out.set(e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8]);
}

/** Unit vector of a right ascension (hours) and declination (degrees) in equatorial coordinates. */
export function equatorial(raH, decD, out = new THREE.Vector3()) {
  const a = raH * 15 * RAD, d = decD * RAD;
  return out.set(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
}

/** The galactic frame in equatorial coordinates (rows: towards the centre in Sagittarius, 90° along, the north pole). */
export const GALACTIC = (() => {
  const z = equatorial(192.85948 / 15, 27.12825), x0 = equatorial(266.40510 / 15, -28.93617);
  const x = x0.clone().addScaledVector(z, -x0.dot(z)).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix3().set(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
})();
/** World → galactic for a sky rotation (the transpose of the rotation brings a world direction back to the sky). */
export function galacticRotation(sky, out = new THREE.Matrix3()) {
  return out.copy(GALACTIC).multiply(_m.copy(sky).transpose());
}

// The bright stars: right ascension (hours), declination (degrees), visual magnitude, colour index B-V. The figures
// people know (the Big Dipper, Cassiopeia, Orion, the summer triangle, the Pleiades …) stand where they belong.
const BRIGHT = [
  [2.530, 89.264, 1.98, 0.60], [14.845, 74.156, 2.08, 1.47], [15.346, 71.834, 3.05, 0.06],                   // Little Dipper
  [11.062, 61.751, 1.79, 1.07], [11.031, 56.382, 2.37, -0.02], [11.897, 53.695, 2.44, 0.0], [12.257, 57.033, 3.31, 0.08],
  [12.901, 55.960, 1.77, -0.02], [13.399, 54.925, 2.23, 0.02], [13.792, 49.313, 1.86, -0.19], [13.420, 54.988, 4.01, 0.16], // Big Dipper, Alcor
  [9.525, 51.677, 3.17, 0.46], [8.987, 48.042, 3.14, 0.22], [10.372, 41.499, 3.06, 1.6],                    // the bear's paws
  [0.675, 56.537, 2.24, 1.17], [0.153, 59.150, 2.28, 0.34], [0.945, 60.717, 2.15, -0.15], [1.430, 60.235, 2.68, 0.13], [1.907, 63.670, 3.38, -0.15], // Cassiopeia
  [20.691, 45.280, 1.25, 0.09], [20.371, 40.257, 2.23, 0.67], [20.770, 33.970, 2.48, 1.03], [19.750, 45.131, 2.87, -0.03], [19.512, 27.960, 3.08, 1.13], // Cygnus
  [18.616, 38.784, 0.03, 0.0], [18.835, 33.363, 3.52, 0.0], [18.982, 32.690, 3.24, -0.05],                  // Lyra
  [19.846, 8.868, 0.77, 0.22], [19.771, 10.613, 2.72, 1.52], [19.922, 6.407, 3.71, 0.86],                   // Aquila
  [14.261, 19.182, -0.05, 1.23], [14.750, 27.074, 2.37, 0.97], [15.578, 26.715, 2.23, -0.02], [13.420, -11.161, 0.97, -0.23],
  [10.140, 11.967, 1.36, -0.11], [11.818, 14.572, 2.14, 0.09], [10.333, 19.842, 2.08, 1.13], [11.235, 20.524, 2.56, 0.12], // Leo
  [7.755, 28.026, 1.14, 1.0], [7.577, 31.888, 1.58, 0.03], [6.629, 16.399, 1.93, 0.0], [6.383, 22.514, 2.87, 1.64],
  [5.278, 45.998, 0.08, 0.8], [5.992, 44.948, 1.9, 0.03], [4.950, 33.166, 2.69, 1.53],                       // Auriga
  [4.599, 16.509, 0.85, 1.54], [5.438, 28.608, 1.65, -0.13],
  [5.919, 7.407, 0.5, 1.85], [5.242, -8.202, 0.13, -0.03], [5.419, 6.350, 1.64, -0.22], [5.533, -0.299, 2.23, -0.22],
  [5.604, -1.202, 1.69, -0.18], [5.679, -1.943, 1.77, -0.21], [5.796, -9.670, 2.09, -0.17], [5.586, 9.934, 3.39, -0.18], // Orion
  [6.753, -16.716, -1.46, 0.0], [6.378, -17.956, 1.98, -0.24], [6.977, -28.972, 1.5, -0.21], [7.140, -26.393, 1.84, 0.68], [7.401, -29.303, 2.45, -0.08],
  [7.655, 5.225, 0.34, 0.42], [7.453, 8.289, 2.89, -0.09], [5.546, -17.822, 2.58, 0.21],
  [3.791, 24.105, 2.87, -0.09], [3.819, 24.053, 3.62, -0.08], [3.748, 24.113, 3.7, -0.11], [3.764, 24.367, 3.87, -0.07], // the Pleiades
  [3.772, 23.948, 4.18, -0.06], [3.753, 24.467, 4.3, -0.11], [3.820, 24.137, 5.05, -0.08], [3.747, 24.289, 5.45, -0.04],
  [3.405, 49.861, 1.79, 0.48], [3.136, 40.956, 2.12, -0.05], [3.964, 40.010, 2.89, -0.18], [3.715, 47.788, 3.01, -0.13], // Perseus
  [0.140, 29.090, 2.06, -0.11], [1.162, 35.621, 2.05, 1.58], [2.065, 42.330, 2.1, 1.37],                     // Andromeda
  [23.079, 15.205, 2.48, -0.04], [23.063, 28.083, 2.42, 1.67], [0.221, 15.184, 2.83, -0.23], [21.736, 9.875, 2.38, 1.53], // Pegasus
  [16.490, -26.432, 1.06, 1.83], [17.560, -37.104, 1.62, -0.22], [17.622, -42.998, 1.86, 0.4], [16.006, -22.622, 2.29, -0.12], [16.091, -19.806, 2.62, -0.07], // Scorpius
  [18.403, -34.385, 1.85, -0.03], [18.921, -26.297, 2.05, -0.13], [18.350, -29.828, 2.7, 1.38], [18.466, -25.422, 2.81, 1.04], [19.044, -29.880, 2.6, 0.08], // Sagittarius
  [22.961, -29.622, 1.16, 0.09], [17.582, 12.560, 2.07, 0.15], [17.173, -15.725, 2.43, 0.06],
  [17.943, 51.489, 2.23, 1.52], [17.507, 52.301, 2.79, 0.98], [14.073, 64.376, 3.65, -0.05], [16.400, 61.514, 2.74, 0.91], // Draco
  [2.120, 23.462, 2.0, 1.15], [1.911, 20.808, 2.64, 0.13], [0.727, -17.987, 2.04, 1.02], [3.038, 4.090, 2.54, 1.64],
  [9.460, -8.659, 1.98, 1.44], [12.934, 38.318, 2.81, -0.12], [13.036, 10.959, 2.83, 0.94], [15.738, 6.426, 2.63, 1.17],
  [21.310, 62.585, 2.45, 0.22], [21.478, 70.561, 3.23, -0.22], [12.498, -16.515, 2.94, -0.05], [12.263, -17.542, 2.58, -0.11],
  [16.504, 21.490, 2.78, 0.94], [16.688, 31.603, 2.81, 0.65], [17.244, 14.390, 3.06, 1.16],                   // Hercules
  [21.526, -5.571, 2.87, 0.83], [21.784, -16.127, 2.85, 0.29], [15.283, -9.383, 2.61, -0.07], [14.848, -16.042, 2.75, 0.15],
  [8.060, -40.003, 2.25, -0.27], [8.159, -47.337, 1.78, -0.22], [1.628, -57.237, 0.46, -0.16],               // (below the horizon from here)
];

/**
 * The stars as attribute arrays: `eq` the equatorial unit vectors, `mag` visual magnitude and a random number,
 * `color` linear RGB. The bright stars above and some 5000 fainter ones, denser towards the Milky Way, to magnitude 6.8.
 */
export function starCatalog(seed = 91) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const eq = [], mag = [], col = [];
  const v = new THREE.Vector3(), g = new THREE.Vector3();
  const push = (dir, m, bv) => { eq.push(dir.x, dir.y, dir.z); mag.push(m, rnd()); const c = bvColor(bv); col.push(c[0], c[1], c[2]); };
  for (const [ra, dec, m, bv] of BRIGHT) push(equatorial(ra, dec, v), m, bv);
  // the faint ones: uniform on the sphere, kept more often near the galactic plane; magnitudes as many as the sky has
  // (about 3.6 times more stars with each magnitude), from 3.4 on (the bright ones are all above)
  const N = 5200;
  for (let n = 0; n < N;) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    v.set(r * Math.cos(a), r * Math.sin(a), z);
    const b = Math.abs(Math.asin(g.copy(v).applyMatrix3(GALACTIC).z));
    if (rnd() > (0.32 + 0.68 * Math.exp(-b / (14 * RAD))) ) continue;
    // cumulative counts N(<m) ∝ 10^(0.56 m): m from a uniform u by the inverse
    const u = rnd(), m0 = 3.4, m1 = 6.8, k = 0.56 * Math.LN10;
    const m = Math.log(Math.exp(k * m0) + u * (Math.exp(k * m1) - Math.exp(k * m0))) / k;
    // colours: mostly white to yellow, some orange, a few blue-white and red
    const q = rnd();
    const bv = q < 0.12 ? -0.25 + rnd() * 0.25 : q < 0.62 ? rnd() * 0.65 : q < 0.92 ? 0.65 + rnd() * 0.65 : 1.3 + rnd() * 0.5;
    push(v, m, bv);
    n++;
  }
  return { eq: new Float32Array(eq), mag: new Float32Array(mag), color: new Float32Array(col), count: mag.length / 2, bright: BRIGHT.length };
}

/** A star's colour (linear RGB, brightest channel 1) from its B-V index: blue-white, white, yellow, orange, red. */
export function bvColor(bv) {
  const t = Math.min(1, Math.max(0, (bv + 0.3) / 2.1));
  const stops = [[0, [0.62, 0.74, 1.0]], [0.16, [0.82, 0.88, 1.0]], [0.3, [1.0, 0.98, 0.95]], [0.5, [1.0, 0.9, 0.74]], [0.72, [1.0, 0.76, 0.5]], [1, [1.0, 0.58, 0.32]]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (t - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}
