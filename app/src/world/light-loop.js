// The lamps in three's lighting chunk, only where they reach. Every lit shader loops over all point lights of the house
// (some twenty, their number compiled in) and evaluates the full BRDF for each, also where a lamp's light has fallen to
// nothing: getPointLightInfo multiplies its colour by the distance falloff, which is exactly zero beyond the light's
// `distance`, and RE_Direct then adds dotNL × 0 × BRDF. Skipping RE_Direct when the light does not reach the surface
// (`directLight.visible`, which three sets to colour != 0 and already uses to skip the shadow lookup) adds the same
// zeros by not adding them: the picture stays the same, the shader does a lamp's work only where the lamp lights. The
// same for the spot light (the cinema's spill, dark unless a film plays). Patched once into THREE.ShaderChunk, before any
// program is built and before materials.js and nature.js cut their variants out of the chunk (both import this first).
import * as THREE from 'three';

const RE = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const MARK = '/* lamps where they reach */';

/** True when the chunk carries the gate (also when it was patched before). */
export function patchLightLoop() {
  const C = THREE.ShaderChunk, src = C.lights_fragment_begin;
  if (src.includes(MARK)) return true;
  const a = src.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
  const b = src.indexOf('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )');
  const c = src.indexOf('#endif', src.indexOf(RE, b));
  if (a < 0 || b < a || c < b) return false;
  const gate = (part) => (part.split(RE).length === 2 ? part.replace(RE, `if ( directLight.visible ) ${RE}`) : null);
  const points = gate(src.slice(a, b)), spots = gate(src.slice(b, c));
  if (points == null || spots == null) return false;
  C.lights_fragment_begin = `${src.slice(0, a)}${MARK}\n${points}${spots}${src.slice(c)}`;
  return true;
}

// (?lampgate=0 leaves three's chunk as it is: the checks compare the pictures and the times of both)
let off = false;
try { off = new URLSearchParams(globalThis.location?.search || '').get('lampgate') === '0'; } catch {}
export const LIGHT_LOOP_GATED = off ? false : patchLightLoop();
