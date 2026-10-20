// The book room of a library without books (the welcome card's "Später", a folder without books, or a folder whose
// first books are still being read): a few empty cases wait on the left wall, where the first department would start.
// The sign above them says "Deine Bücher", a card on a shelf and the directory in the passage say how books get in,
// and a plant, a vase or a photo stands on their shelves (shelf-decor.js), so that they look furnished.
import * as THREE from 'three';
import { SHELF_LEVELS } from './furniture.js';
import { planeGeo } from './geo.js';
import { signs, SIGN_DENSITY } from './signs.js';
import { tr } from '../core/i18n.js';

export const WAITING_CASES = 4;
export const WAITING_NAME = { de: 'Deine Bücher', en: 'Your books' };
/** The last line of the directory board in an empty library. */
export const ADD_BOOKS_HINT = { de: 'Bücher hinzufügen: Esc → Einstellungen → Bücherordner', en: 'Add books: Esc → Settings → Book folders' };
const CARD_LINES = { de: ['Hier stehen bald', 'deine Bücher.'], en: ['Your books will', 'stand here soon.'] };
const CARD_HOW = { de: ['Esc → Einstellungen', '→ Bücherordner'], en: ['Esc → Settings', '→ Book folders'] };
/** The shelf the card stands on (the middle one, at eye level from a step away). */
export const CARD_LEVEL = 1;

/**
 * The waiting run (layout.js buildBookRoom, only when no department has books): the first slots of the left wall
 * become empty cases under a sign of their own; the directory lists them like a department.
 * @param makeCase  layout.js makeCase(slot, dep)
 */
export function addWaitingRun(L, segments, makeCase) {
  const seg = segments.find((s) => s.id === 'W') || segments[0];
  const slots = (seg?.slots || []).slice(0, WAITING_CASES);
  if (!slots.length) return null;
  const cases = slots.map((sl) => { const bc = makeCase(sl, null); bc.waiting = true; return bc; });
  cases[0].card = true;
  const run = { id: 'waiting', waiting: true, name: WAITING_NAME.de, nameEn: WAITING_NAME.en, cases: cases.map((c) => c.id), first: { x: slots[0].x, z: slots[0].z, rot: slots[0].rot }, walls: [seg.wall], parts: [{ seg: seg.id, wall: seg.wall, slots }] };
  L.departmentRuns.push(run);
  L.emptyLibrary = true;
  return run;
}

/** The card on the middle shelf of the first waiting case (world.js #buildShelfLabels), drawn like the card in the
 *  empty "recently read" case: dark type on warm white, at the density of the shelf labels (signs.js). */
export function waitingCard(caseObj) {
  const LW = 560, LH = 350, metres = [0.4, 0.25], W = Math.round(metres[0] * SIGN_DENSITY.shelf), k = W / LW, H = Math.round(LH * k);
  const lines = tr(CARD_LINES), how = tr(CARD_HOW);
  const sign = signs.get(`card|${W}x${H}|${[...lines, ...how].join('|')}`, { kind: 'card', w: W, h: H, metres, bg: '#faf8f3', draw: (g) => {
    g.scale(k, k);
    g.strokeStyle = '#d6cdbd'; g.lineWidth = 3; g.strokeRect(12, 12, LW - 24, LH - 24);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#2c2a27'; g.font = '600 46px "EB Garamond", Georgia, serif';
    lines.forEach((line, i) => g.fillText(line, LW / 2, 84 + i * 58));
    g.fillStyle = '#1f5b58'; g.fillRect(LW / 2 - 60, 180, 120, 3);
    g.fillStyle = '#4f4a42'; g.font = '600 30px "Segoe UI", Arial, sans-serif';
    how.forEach((line, i) => g.fillText(line, LW / 2, 232 + i * 44));
  } });
  const mat = signs.use(sign, new THREE.MeshStandardMaterial({ roughness: 0.85 })); mat.userData.disposable = true;
  const card = new THREE.Mesh(planeGeo(metres[0], metres[1]), mat);
  card.name = 'waiting-card';
  const local = new THREE.Vector3(0, SHELF_LEVELS[CARD_LEVEL] + 0.13, 0.03);
  card.position.copy(local.applyMatrix4(caseObj.matrixWorld));
  card.quaternion.setFromRotationMatrix(caseObj.matrixWorld).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.18));
  return card;
}
