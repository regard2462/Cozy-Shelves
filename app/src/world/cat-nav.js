// Path finding for the library cat. A fine occupancy grid over the building's floor, built from every collider
// that stands in the cat's height band: rugs are flat and walkable, beams, lintels and wall lamps hang above it.
// A cell is blocked as soon as any point in it is closer than the cat's radius to an obstacle (or to the edge of
// the floor), so a route that only crosses free cells keeps the whole body circle clear of furniture and walls.
import * as THREE from 'three';

export const CAT_TOP = 0.42;          // top of the walking cat's height band (ears included), metres

/** A collider the walking cat would bump into. */
export function catObstacle(c, top = CAT_TOP) { return c.max[1] > 0.04 && c.min[1] < top; }

/** Distance on the floor plane from (x, z) to the ground rectangle of an AABB collider (0 inside). */
export function boxDistance(c, x, z) {
  const dx = Math.max(c.min[0] - x, 0, x - c.max[0]);
  const dz = Math.max(c.min[2] - z, 0, z - c.max[2]);
  return Math.hypot(dx, dz);
}

const SQRT2 = Math.SQRT2;
// jump directions tried around a seat's free side (radians relative to the direction the seat faces)
const HOP_TURNS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.57, -1.57, 1.9, -1.9, 2.3, -2.3, 2.7, -2.7, Math.PI];

export class CatNav {
  /**
   * @param colliders world AABBs ({min:[x,y,z], max:[x,y,z]}); only the ones in the cat's height band count
   * @param opts { floors: [{x, z, w, d}] – the walkable building (the cat never leaves it), cell, radius }
   */
  constructor(colliders, { floors = null, cell = 0.2, radius = 0.2 } = {}) {
    this.cell = cell; this.radius = radius;
    this.obstacles = (colliders || []).filter((c) => catObstacle(c));
    this.floors = (floors || []).map((f) => [f.x - f.w / 2, f.z - f.d / 2, f.x + f.w / 2, f.z + f.d / 2]);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const grow = (a, b, c, d) => { x0 = Math.min(x0, a); z0 = Math.min(z0, b); x1 = Math.max(x1, c); z1 = Math.max(z1, d); };
    if (this.floors.length) for (const f of this.floors) grow(...f);
    else for (const c of this.obstacles) grow(c.min[0], c.min[2], c.max[0], c.max[2]);
    if (!Number.isFinite(x0)) { x0 = -1; z0 = -1; x1 = 1; z1 = 1; }
    const m = radius + cell;
    this.x0 = x0 - m; this.z0 = z0 - m;
    this.w = Math.ceil((x1 + m - this.x0) / cell); this.h = Math.ceil((z1 + m - this.z0) / cell);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    // 1) the cat's disc around every point of the cell has to lie on the floor (inside the building)
    if (this.floors.length) for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) if (!this.#onFloor(i, j)) this.blocked[j * this.w + i] = 1;
    // 2) walls and furniture, grown by the radius: every cell that touches the grown box is blocked
    for (const c of this.obstacles) {
      const i0 = Math.max(0, Math.floor((c.min[0] - radius - this.x0) / cell)), i1 = Math.min(this.w - 1, Math.ceil((c.max[0] + radius - this.x0) / cell) - 1);
      const j0 = Math.max(0, Math.floor((c.min[2] - radius - this.z0) / cell)), j1 = Math.min(this.h - 1, Math.ceil((c.max[2] + radius - this.z0) / cell) - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.blocked[j * this.w + i] = 1;
    }
    // 3) connected regions: a spot whose landing place lies in another region than the cat is unreachable
    this.region = new Int32Array(n).fill(-1);
    let id = 0; const stack = [];
    for (let s = 0; s < n; s++) {
      if (this.blocked[s] || this.region[s] >= 0) continue;
      this.region[s] = id; stack.push(s);
      while (stack.length) {
        const cur = stack.pop(); const ci = cur % this.w, cj = (cur - ci) / this.w;
        for (const [di, dj] of NEIGHBOURS) {
          const ni = ci + di, nj = cj + dj;
          if (!this.#passable(ci, cj, di, dj)) continue;
          const k = nj * this.w + ni;
          if (this.region[k] < 0) { this.region[k] = id; stack.push(k); }
        }
      }
      id++;
    }
    this.regions = id;
    this.regionSize = new Int32Array(id);
    for (const r of this.region) if (r >= 0) this.regionSize[r]++;
  }

  /** Is the whole disc (radius) around every point of cell (i, j) on some floor rectangle? */
  #onFloor(i, j) {
    const c = this.cell, r = this.radius;
    const ax = this.x0 + i * c - r, bx = ax + c + 2 * r, az = this.z0 + j * c - r, bz = az + c + 2 * r;
    for (const f of this.floors) if (ax >= f[0] - 1e-6 && bx <= f[2] + 1e-6 && az >= f[1] - 1e-6 && bz <= f[3] + 1e-6) return true;
    // near the seams between two floors (hall → passage) sample the grown square
    const steps = Math.max(2, Math.ceil((bx - ax) / 0.08));
    for (let a = 0; a <= steps; a++) for (let b = 0; b <= steps; b++) {
      const x = ax + (bx - ax) * a / steps, z = az + (bz - az) * b / steps;
      let inside = false;
      for (const f of this.floors) if (x >= f[0] - 1e-6 && x <= f[2] + 1e-6 && z >= f[1] - 1e-6 && z <= f[3] + 1e-6) { inside = true; break; }
      if (!inside) return false;
    }
    return true;
  }
  /** 8-neighbourhood without cutting corners: a diagonal step needs both side cells free. */
  #passable(i, j, di, dj, avoid) {
    const ni = i + di, nj = j + dj;
    if (!this.freeCell(ni, nj, avoid)) return false;
    if (di && dj && (!this.freeCell(i + di, j, avoid) || !this.freeCell(i, j + dj, avoid))) return false;
    return true;
  }

  inside(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }
  /** Free cell (optionally also clear of a temporary round obstacle `avoid` = {x, z, r}, e.g. the player). */
  freeCell(i, j, avoid) {
    if (!this.inside(i, j) || this.blocked[j * this.w + i]) return false;
    if (avoid) {
      const ax = this.x0 + i * this.cell, az = this.z0 + j * this.cell;
      const dx = Math.max(ax - avoid.x, 0, avoid.x - (ax + this.cell)), dz = Math.max(az - avoid.z, 0, avoid.z - (az + this.cell));
      if (dx * dx + dz * dz < avoid.r * avoid.r) return false;
    }
    return true;
  }
  cellX(x) { return Math.floor((x - this.x0) / this.cell); }
  cellZ(z) { return Math.floor((z - this.z0) / this.cell); }
  freeAt(x, z, avoid) { return this.freeCell(this.cellX(x), this.cellZ(z), avoid); }
  regionAt(x, z) { const i = this.cellX(x), j = this.cellZ(z); return this.inside(i, j) ? this.region[j * this.w + i] : -1; }
  center(i, j) { return new THREE.Vector3(this.x0 + (i + 0.5) * this.cell, 0, this.z0 + (j + 0.5) * this.cell); }

  /**
   * Line of sight on the grid: true when every cell the segment a→b touches is free (a supercover walk, so a
   * segment through the corner of four cells needs all of them). With the grown obstacles this means that
   * the cat's body circle stays clear of everything along the whole segment.
   */
  lineFree(ax, az, bx, bz, avoid) {
    const c = this.cell;
    let i = this.cellX(ax), j = this.cellZ(az);
    const ie = this.cellX(bx), je = this.cellZ(bz);
    if (!this.freeCell(i, j, avoid)) return false;
    const dx = bx - ax, dz = bz - az;
    const si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sj = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = si ? c / Math.abs(dx) : Infinity, tdz = sj ? c / Math.abs(dz) : Infinity;
    let tx = si ? ((si > 0 ? this.x0 + (i + 1) * c - ax : ax - (this.x0 + i * c)) / Math.abs(dx)) : Infinity;
    let tz = sj ? ((sj > 0 ? this.z0 + (j + 1) * c - az : az - (this.z0 + j * c)) / Math.abs(dz)) : Infinity;
    let guard = Math.abs(ie - i) + Math.abs(je - j) + 4;
    while ((i !== ie || j !== je) && guard-- > 0) {
      if (Math.min(tx, tz) > 1) break;                          // numerically at the end already
      if (Math.abs(tx - tz) < 1e-9) {
        // exactly through a corner: both side cells are touched as well
        if (!this.freeCell(i + si, j, avoid) || !this.freeCell(i, j + sj, avoid)) return false;
        i += si; j += sj; tx += tdx; tz += tdz;
      } else if (tx < tz) { i += si; tx += tdx; } else { j += sj; tz += tdz; }
      if (!this.freeCell(i, j, avoid)) return false;
    }
    return this.freeCell(ie, je, avoid);
  }

  /**
   * Walkable polyline from a to b (floor points, both in free cells of the same region) or null.
   * A* over the free cells, then shortened wherever the grid line of sight allows it.
   */
  path(a, b, avoid = null) {
    const si = this.cellX(a.x), sj = this.cellZ(a.z), gi = this.cellX(b.x), gj = this.cellZ(b.z);
    // the start may lie next to `avoid` (the cat walks away from it), the goal may not
    if (!this.freeCell(si, sj) || !this.freeCell(gi, gj, avoid)) return null;
    const start = sj * this.w + si, goal = gj * this.w + gi;
    if (this.region[start] !== this.region[goal]) return null;
    let cells;
    if (start === goal) cells = [start];
    else {
      const n = this.w * this.h;
      const g = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
      const heap = new Heap();
      const hcost = (k) => { const ki = k % this.w, kj = (k - ki) / this.w; const dx = Math.abs(ki - gi), dz = Math.abs(kj - gj); return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz); };
      g[start] = 0; heap.push(start, hcost(start));
      let found = false;
      while (heap.size) {
        const cur = heap.pop();
        if (closed[cur]) continue;
        closed[cur] = 1;
        if (cur === goal) { found = true; break; }
        const ci = cur % this.w, cj = (cur - ci) / this.w;
        for (const [di, dj] of NEIGHBOURS) {
          if (!this.#passable(ci, cj, di, dj, avoid)) continue;
          const k = (cj + dj) * this.w + ci + di;
          if (closed[k]) continue;
          const ng = g[cur] + (di && dj ? SQRT2 : 1);
          if (ng < g[k]) { g[k] = ng; prev[k] = cur; heap.push(k, ng + hcost(k)); }
        }
      }
      if (!found) return null;
      cells = [];
      for (let k = goal; k >= 0; k = prev[k]) { cells.push(k); if (k === start) break; }
      cells.reverse();
    }
    const pts = [new THREE.Vector3(a.x, 0, a.z)];
    for (let k = 1; k < cells.length - 1; k++) { const ci = cells[k] % this.w; pts.push(this.center(ci, (cells[k] - ci) / this.w)); }
    pts.push(new THREE.Vector3(b.x, 0, b.z));
    return this.smooth(pts, avoid);
  }

  /** String pulling: from every kept point jump to the furthest point still in line of sight. */
  smooth(pts, avoid) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineFree(pts[i].x, pts[i].z, pts[j].x, pts[j].z, avoid)) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }

  /** Every segment of the polyline crosses free cells only (used by the checks). */
  polylineFree(pts, avoid) {
    for (let k = 0; k < pts.length - 1; k++) if (!this.lineFree(pts[k].x, pts[k].z, pts[k + 1].x, pts[k + 1].z, avoid)) return false;
    return pts.length > 0 && this.freeAt(pts[0].x, pts[0].z, avoid);
  }

  /**
   * Where the cat lands when it jumps off a seat at `spot`: outside the seat's collider, on the floor, preferably
   * on the side the seat faces (`out`, a floor direction) and not in a small pocket between furniture. The jump
   * itself may only cross the seat it starts on (the colliders that contain the spot), never anything else.
   * Returns { point, own, region } or null. Seats whose landing places lie in different regions cannot reach
   * each other: path() refuses those trips.
   */
  landing(spot, out, { region = -1, maxHop = 1.5, pocket = 60 } = {}) {
    const own = this.obstacles.filter((c) => spot.x >= c.min[0] - 1e-3 && spot.x <= c.max[0] + 1e-3 && spot.z >= c.min[2] - 1e-3 && spot.z <= c.max[2] + 1e-3);
    const others = this.obstacles.filter((c) => !own.includes(c) && boxDistance(c, spot.x, spot.z) < maxHop + this.radius + 0.5);
    const base = Math.atan2(out.z, out.x);
    let best = null;
    for (const turn of HOP_TURNS) {
      const dx = Math.cos(base + turn), dz = Math.sin(base + turn);
      for (let d = 0.25; d <= maxHop + 1e-6; d += 0.05) {
        const x = spot.x + dx * d, z = spot.z + dz * d;
        if (!this.freeAt(x, z)) continue;
        const reg = this.regionAt(x, z);
        if (region >= 0 && reg !== region) continue;
        if (!this.hopClear(spot.x, spot.z, x, z, others)) break;   // further out in this direction would cross it too
        const cramped = this.regionSize[reg] < pocket;
        const score = d + Math.abs(turn) * 0.45 + (cramped ? 5 : 0);
        if (!best || score < best.score) best = { point: new THREE.Vector3(x, 0, z), own, score, region: reg };
        if (!cramped) break;                                         // a pocket: maybe open floor lies further out
      }
    }
    return best;
  }
  /**
   * The straight jump a→b stays clear (by the radius) of every collider in `others`. A seat that stands close to
   * a wall is fine as long as the jump does not get any closer to it than the resting cat already is.
   */
  hopClear(ax, az, bx, bz, others) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 0.04));
    const allow = others.map((c) => Math.min(this.radius, boxDistance(c, ax, az)) - 1e-6);
    for (let k = 1; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
      for (let o = 0; o < others.length; o++) if (boxDistance(others[o], x, z) < allow[o]) return false;
    }
    return true;
  }
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Small binary min-heap of (index, priority). */
class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p; let i = k.length; k.push(key); p.push(pri);
    while (i > 0) { const up = (i - 1) >> 1; if (p[up] <= pri) break; k[i] = k[up]; p[i] = p[up]; i = up; }
    k[i] = key; p[i] = pri;
  }
  pop() {
    const k = this.k, p = this.p; const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        k[i] = k[c]; p[i] = p[c]; i = c;
      }
      k[i] = lk; p[i] = lp;
    }
    return top;
  }
}
