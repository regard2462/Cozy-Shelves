// Procedural Staunton-style chess pieces for the 3D board (lathe profiles + extruded knight head).
// All geometries are in "square units": one square = 1, king height ≈ 0.95.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Smooth lathe from control points [r, y] (Catmull-Rom through the points). */
function lathe(points, { segments = 48, samples = 90 } = {}) {
  const curve = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const pts = curve.getPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  pts[0].x = 0; pts[pts.length - 1].x = 0;
  return nonIndexed(new THREE.LatheGeometry(pts, segments));
}

const nonIndexed = (g) => (g.index ? g.toNonIndexed() : g);

/** Base part shared by all pieces (a turned foot with a soft fillet). */
const foot = (r, h = 0.11) => [[0, 0], [r * 0.6, 0], [r - 0.02, 0], [r, 0.02], [r, h * 0.6], [r - 0.02, h * 0.85], [r - 0.06, h]];

function pawnGeometry() {
  return lathe([
    ...foot(0.26, 0.10),
    [0.14, 0.14], [0.11, 0.20], [0.10, 0.27], [0.11, 0.31], [0.15, 0.33], [0.155, 0.35], [0.12, 0.37],
    [0.10, 0.39], [0.13, 0.42], [0.15, 0.47], [0.13, 0.52], [0.08, 0.555], [0.03, 0.57], [0, 0.575],
  ]);
}

function rookGeometry() {
  const body = lathe([
    ...foot(0.29, 0.11),
    [0.19, 0.15], [0.17, 0.20], [0.165, 0.30], [0.165, 0.40], [0.18, 0.44], [0.22, 0.46], [0.225, 0.48],
    [0.225, 0.55], [0.20, 0.555], [0.14, 0.545], [0.10, 0.53], [0, 0.53],
  ]);
  // crenellations
  const parts = [body];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const box = new THREE.BoxGeometry(0.075, 0.06, 0.065);
    box.rotateY(-a);
    box.translate(Math.cos(a) * 0.185, 0.575, Math.sin(a) * 0.185);
    parts.push(nonIndexed(box));
  }
  return mergeGeometries(parts, false);
}

function bishopGeometry() {
  const body = lathe([
    ...foot(0.27, 0.11),
    [0.16, 0.15], [0.13, 0.21], [0.115, 0.30], [0.11, 0.37], [0.15, 0.405], [0.165, 0.42], [0.135, 0.44],
    [0.11, 0.46], [0.13, 0.49], [0.155, 0.545], [0.15, 0.60], [0.115, 0.655], [0.07, 0.69], [0.045, 0.70],
    [0.04, 0.72], [0.045, 0.74], [0.03, 0.755], [0, 0.76],
  ]);
  // the slit of the mitre: a thin dark groove is faked with a slim box slightly inset (same material)
  return body;
}

function queenGeometry() {
  const body = lathe([
    ...foot(0.30, 0.12),
    [0.19, 0.16], [0.155, 0.22], [0.13, 0.32], [0.12, 0.43], [0.135, 0.51], [0.17, 0.545], [0.185, 0.56],
    [0.15, 0.58], [0.125, 0.60], [0.14, 0.64], [0.175, 0.71], [0.20, 0.77], [0.195, 0.79], [0.16, 0.80],
    [0.11, 0.81], [0.08, 0.83], [0.05, 0.85], [0, 0.86],
  ]);
  const parts = [body];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const s = new THREE.SphereGeometry(0.032, 14, 10);
    s.translate(Math.cos(a) * 0.185, 0.80, Math.sin(a) * 0.185);
    parts.push(nonIndexed(s));
  }
  const top = new THREE.SphereGeometry(0.045, 18, 12);
  top.translate(0, 0.885, 0);
  parts.push(nonIndexed(top));
  return mergeGeometries(parts, false);
}

function kingGeometry() {
  const body = lathe([
    ...foot(0.31, 0.12),
    [0.20, 0.16], [0.165, 0.23], [0.14, 0.33], [0.13, 0.45], [0.145, 0.53], [0.18, 0.565], [0.195, 0.58],
    [0.16, 0.60], [0.135, 0.62], [0.15, 0.66], [0.185, 0.73], [0.205, 0.79], [0.19, 0.815], [0.14, 0.835],
    [0.09, 0.845], [0.05, 0.86], [0, 0.865],
  ]);
  const v = new THREE.BoxGeometry(0.034, 0.15, 0.034); v.translate(0, 0.925, 0);
  const hbar = new THREE.BoxGeometry(0.11, 0.034, 0.034); hbar.translate(0, 0.945, 0);
  return mergeGeometries([body, nonIndexed(v), nonIndexed(hbar)], false);
}

function knightGeometry() {
  const base = lathe([
    ...foot(0.28, 0.11),
    [0.17, 0.15], [0.15, 0.19], [0.15, 0.22], [0.17, 0.235], [0.165, 0.25], [0, 0.25],
  ]);
  // side silhouette of the head (x = forward, y = up), counter-clockwise from the bottom back
  const P = [
    [-0.15, 0.24], [-0.20, 0.30], [-0.235, 0.40], [-0.225, 0.49], [-0.19, 0.555],            // back of the neck
    [-0.16, 0.565], [-0.145, 0.595], [-0.115, 0.60], [-0.10, 0.63], [-0.07, 0.64],          // mane notches
    [-0.05, 0.67], [-0.04, 0.73], [-0.01, 0.68], [0.02, 0.68], [0.04, 0.735], [0.065, 0.67], // ears
    [0.10, 0.64], [0.15, 0.61], [0.21, 0.57], [0.26, 0.525], [0.295, 0.47], [0.30, 0.43],   // forehead → nose
    [0.275, 0.40], [0.235, 0.395], [0.20, 0.41], [0.18, 0.39], [0.15, 0.365],               // muzzle / mouth / chin
    [0.11, 0.335], [0.08, 0.30], [0.08, 0.265], [0.11, 0.24],                                // throat
  ];
  const shape = new THREE.Shape();
  shape.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) shape.lineTo(P[i][0], P[i][1]);
  shape.closePath();
  const depth = 0.16;
  const head = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 5, curveSegments: 6 });
  head.translate(0, 0, -depth / 2);
  // taper the head towards the top and the muzzle so it reads as carved rather than as a slab
  const pos = head.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ty = Math.min(1, Math.max(0, (y - 0.25) / 0.48));
    const tx = Math.min(1, Math.max(0, (x - 0.05) / 0.25));
    pos.setZ(i, z * (1 - 0.35 * ty) * (1 - 0.3 * tx));
  }
  head.computeVertexNormals();
  // eyes
  const eyeL = new THREE.SphereGeometry(0.02, 10, 8); eyeL.translate(0.13, 0.545, depth / 2 + 0.02);
  const eyeR = new THREE.SphereGeometry(0.02, 10, 8); eyeR.translate(0.13, 0.545, -depth / 2 - 0.02);
  const g = mergeGeometries([base, nonIndexed(head), nonIndexed(eyeL), nonIndexed(eyeR)], false);
  g.rotateY(Math.PI / 2);   // forward (+x) → -z (towards the opponent for White)
  return g;
}

let cache = null;
/** { pawn, knight, bishop, rook, queen, king } BufferGeometries (shared). */
export function pieceGeometries() {
  if (cache) return cache;
  cache = { pawn: pawnGeometry(), rook: rookGeometry(), knight: knightGeometry(), bishop: bishopGeometry(), queen: queenGeometry(), king: kingGeometry() };
  for (const g of Object.values(cache)) g.computeBoundingBox();   // normals: keep the smooth lathe normals
  return cache;
}

export function disposePieceGeometries() {
  if (!cache) return;
  for (const g of Object.values(cache)) g.dispose();
  cache = null;
}
