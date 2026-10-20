// Shelf lighting without real lights: every bookcase compartment has a warm LED strip under the board above
// it (an emissive bar in furniture.js). Its light on the books, the back panel and the boards is added in the
// shader as emissive light that falls off from the top of the compartment to its floor. It costs nothing per
// lamp, so it can stay on everywhere: the old per-case point lights came from a small pool that only served
// the cases nearest to the camera, and the shelves further away went dark.
import * as THREE from 'three';
import { SHELF_LEVELS, BOOKCASE } from './furniture.js';

/** Shared by every patched material: colour × strength of the strips (world.js sets it every frame). */
export const SHELF_GLOW = { value: new THREE.Color(0, 0, 0) };

const glsl = (v) => v.toFixed(4);
// built on first use: furniture.js imports this module too, so its constants are not there yet at load time
let PROFILE = null;
function profile() {
  if (PROFILE) return PROFILE;
  // compartments (world y, the cases stand on the floor): [floor, ceiling] of each lit row
  const rows = [
    [SHELF_LEVELS[0], SHELF_LEVELS[1] - 0.03],
    [SHELF_LEVELS[1], SHELF_LEVELS[2] - 0.03],
    [SHELF_LEVELS[2], BOOKCASE.h - 0.05],
  ];
  PROFILE = `
float shelfGlowAt(float y) {
  float g = 0.0;
  ${rows.map(([a, b]) => `if (y > ${glsl(a - 0.004)} && y < ${glsl(b + 0.004)}) { float t = clamp((y - ${glsl(a)}) / ${glsl(b - a)}, 0.0, 1.0); g = mix(0.28, 1.0, t * t * (1.6 - 0.6 * t)); }`).join('\n  ')}
  return g;
}`;
  return PROFILE;
}

/**
 * Adds the strip light to a material (idempotent). Works for instanced meshes (the shelf books) and wraps an
 * onBeforeCompile the material may already have.
 */
export function withShelfGlow(material, strength = 1) {
  if (!material || material.userData.shelfGlow) return material;
  material.userData.shelfGlow = true;
  const prev = material.onBeforeCompile;
  // the program cache key must still tell the wrapped materials apart: the default key is the source of
  // onBeforeCompile, which after wrapping would be this same wrapper for every material
  const ownKey = material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? material.customProgramCacheKey : null;
  const prevSrc = prev ? prev.toString() : '';
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uShelfGlow = SHELF_GLOW;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vShelfY;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 shelfWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          shelfWP = instanceMatrix * shelfWP;
        #endif
        vShelfY = (modelMatrix * shelfWP).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vShelfY;\nuniform vec3 uShelfGlow;${profile()}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uShelfGlow * (${glsl(strength)} * shelfGlowAt(vShelfY));`);
  };
  material.customProgramCacheKey = () => (ownKey ? ownKey.call(material) : prevSrc) + '|shelfglow' + strength;
  material.needsUpdate = true;
  return material;
}
