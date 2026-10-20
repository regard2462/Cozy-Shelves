// Interaction layer of the world: looking at things, taking books, the basket, sitting at tables,
// books lying on tables, paintings, teleports and the small animated props.
import * as THREE from 'three';
import { makeBookMesh, makeOpenBookMesh, loadCover, disposeBookMesh, hasCoverImage } from './books.js';
import { spineWidth, bookHeight } from './layout.js';
import { EYE } from './player.js';
import { lerp, clamp, easeInOut, easeOut, seeded, hashStr, boxGeo, cylGeo } from './geo.js';
import { M } from './materials.js';

const UP = new THREE.Vector3(0, 1, 0);
// an open book (books.js makeOpenBookMesh) has the top of its pages at its local -z, a closed one lies the other way
// round: turned by half a turn, its text reads the right way up for the one who sits in front of it
const OPEN_TURN = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
const CENTER = new THREE.Vector2(0, 0);
/** E or a click sits you down only from this close (the look ray reaches 3.2 m, a long glide passed through tables). */
export const SEAT_REACH = 2.5;
const _hitPoint = new THREE.Vector3();
/** The primed white of the canvas on the easel (easelTexture). */
const EASEL_WHITE = '#f6f3ec';

export class Actions {
  constructor(world) {
    this.world = world;
    this.raycaster = new THREE.Raycaster(); this.raycaster.far = 3.2;
    this.reachRay = new THREE.Raycaster(); this.reachRay.far = SEAT_REACH + 1;
    this.target = null;       // current look target descriptor
    this.anims = [];
    this.basket = [];         // book ids
    this.tableBooks = new Map(); // id → { mesh, open, seatId, pos, quat }
    this.seatedId = null;
    this.musicPlaying = false;
    this.rayTimer = 0;
    this.lastHint = null;
    this.paintingTextures = new Map();
    this.occluders = [];      // boxes (Box3) of walls, floors, ceilings and bookcase carcasses: nothing is targeted through them
    this.pickables = [];      // { obj, box } of the interactables: the precise raycast only runs when the ray meets the box
    this._hits = [];
  }
  onBuilt() {
    // rebuild table books if any (after a library rebuild)
    for (const [, tb] of this.tableBooks) this.world.dynamic.add(tb.mesh);
    this.#buildPickBoxes();
    this.refreshDisplayTable();
    this.restorePaintings();
  }
  /**
   * Cheap stand-ins for the look ray. The walls, floors and ceilings come from the layout as boxes; a bookcase is its
   * side panels, top, plinth, back and shelf boards (the cases stand at right angles, their boxes are exact). An
   * interactable gets its bounding box. Raycasting the merged building and every carcass triangle by triangle took
   * a millisecond and more every few frames.
   */
  #buildPickBoxes() {
    const w = this.world, L = w.layout;
    const occ = [];
    if (L) {
      for (const b of L.walls) occ.push(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2)));
      for (const f of L.floors) occ.push(new THREE.Box3(new THREE.Vector3(f.x - f.w / 2, -0.2, f.z - f.d / 2), new THREE.Vector3(f.x + f.w / 2, 0, f.z + f.d / 2)));
      for (const c of L.ceilings) occ.push(new THREE.Box3(new THREE.Vector3(c.x - c.w / 2, c.y, c.z - c.d / 2), new THREE.Vector3(c.x + c.w / 2, c.y + 0.2, c.z + c.d / 2)));
    }
    // bookcase carcass in its own frame (furniture.js bookcase): [x0, y0, z0, x1, y1, z1]
    const W = 1.2, D = 0.34, H = 2.3;
    const parts = [
      [-W / 2 - 0.03, 0, -D / 2, -W / 2 + 0.05, H + 0.06, D / 2 + 0.02], [W / 2 - 0.05, 0, -D / 2, W / 2 + 0.03, H + 0.06, D / 2 + 0.02],   // sides with the stiles
      [-W / 2, H - 0.05, -D / 2, W / 2, H + 0.06, D / 2 + 0.04],                                                                          // top and cornice
      [-W / 2, 0, -D / 2, W / 2, 0.9, D / 2 + 0.012],                                                                                     // the cabinet below the books
      [-W / 2, 0, -D / 2, W / 2, H, -D / 2 + 0.022],                                                                                      // back panel
      ...[1.34, 1.7].map((y) => [-W / 2, y - 0.03, -D / 2, W / 2, y, D / 2 - 0.01]),                                                      // shelf boards between the rows
    ];
    const box = new THREE.Box3();
    for (const obj of w.bookcaseObjects?.values() || []) {
      obj.updateMatrixWorld(true);
      for (const [x0, y0, z0, x1, y1, z1] of parts) occ.push(box.set(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)).clone().applyMatrix4(obj.matrixWorld));
    }
    this.occluders = occ;
    // glass (the windows, the glass front and its terrace doors): tested precisely, they are few triangles. A box
    // around the whole glass front would also block the open doorway, and without them the loungers outside could be
    // aimed at (and sat on) from the hall through the glass.
    this.glass = (w.occluders || []).filter((o) => ['glazing', 'glassdoor'].includes(o.userData?.placement?.kind));
    // (a lamp brings a box round its solid parts, without the light it throws on walls and tables, and a reach of its
    // own: lamp-switch.js)
    this.pickables = w.interactables.map((obj) => ({ obj, box: obj.userData.pickBox ? obj.userData.pickBox.clone() : new THREE.Box3().setFromObject(obj).expandByScalar(0.02), reach: obj.userData.reach || obj.userData.placement?.meta?.reach || 0 }));
    this.farReach = Math.max(0, ...this.pickables.map((p) => p.reach));   // the longest reach beyond the normal one (#lookFar)
  }
  /**
   * Face-up recommendations on the display table in the book room: the must-read books (shortcuts in a
   * "00 Must-Read" folder), one department after the other, then the newest additions. Only books with a cover
   * image. When the room shows one department at a time, only that department's books.
   */
  refreshDisplayTable(ids) {
    const w = this.world;
    if (!w.displayTable) return;
    if (ids) this.displayIds = ids;
    let list = this.displayIds;
    if (!list || !list.length) {
      // not the books already read, not a second copy of a book (layout.js noPicks, shelf-arrange.js)
      const books = (w.library?.books || []).filter((b) => !b.borrowed && hasCoverImage(b) && !w.layout?.noPicks?.has(b.id));
      const pool = w.layout?.allDepartments ? books : books.filter((b) => b.department === w.department);
      const order = (w.layout?.departments || []).map((d) => d.id);
      const byDep = new Map();
      for (const b of pool) if (b.mustRead) { const k = b.departmentId || b.department; if (!byDep.has(k)) byDep.set(k, []); byDep.get(k).push(b); }
      for (const [k, arr] of byDep) arr.sort((a, b) => hashStr(a.id + k) - hashStr(b.id + k));
      const keys = [...byDep.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const picks = [];
      for (let r = 0; picks.length < 6 && keys.some((k) => byDep.get(k).length > r); r++) for (const k of keys) { const b = byDep.get(k)[r]; if (b && picks.length < 6) picks.push(b); }
      const newest = pool.filter((b) => !picks.includes(b)).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0) || hashStr(a.id) - hashStr(b.id));
      for (const b of newest) { if (picks.length >= 6) break; picks.push(b); }
      list = picks.map((b) => b.id);
    }
    list = list.filter((id) => hasCoverImage(w.booksById?.[id]));
    w.books.buildTableDisplay(w.displayTable.obj, w.displayTable.spec, list, w.booksById || {});
  }
  applySettings(s) {
    // paintings are applied by main via setPaintings; "Zuletzt geöffnetes Buch am Sitzplatz bereitlegen" here
    const seatBook = s?.lastBookAtSeat === true;
    if (seatBook === this.seatBook) return;
    this.seatBook = seatBook;
    if (this.world.player.seated && this.seatedId) this.#layoutTableBooks();
  }

  // ------------------------------------------------------------- textures for props ----
  screenTexture() {
    if (this._screen) return this._screen;
    const c = document.createElement('canvas'); c.width = 512; c.height = 384; const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a1207'; ctx.fillRect(0, 0, 512, 384);
    ctx.fillStyle = '#ffb040'; ctx.font = '28px "VT323", monospace';
    const lines = ['COZY SHELVES OS 1.0', '', '> KATALOG-TERMINAL', '> Bestand durchsuchen', '> Ausleihe & Verlauf', '> Lesetagebuch', '> Spiele', '', 'Taste E druecken _'];
    lines.forEach((l, i) => ctx.fillText(l, 24, 48 + i * 34));
    for (let y = 0; y < 384; y += 3) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, y, 512, 1); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this._screen = t; return t;
  }
  /** The canvas on the easel: plain primed white (no writing on it), or the watercolour painted last (setEaselImage). */
  easelTexture() {
    if (this._easel) return this._easel;
    const c = document.createElement('canvas'); c.width = 512; c.height = 400; const ctx = c.getContext('2d');
    ctx.fillStyle = EASEL_WHITE; ctx.fillRect(0, 0, 512, 400);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this._easel = t; this._easelCanvas = c; return t;
  }
  setEaselImage(url) {
    const tex = this.easelTexture();
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const c = this._easelCanvas; const ctx = c.getContext('2d'); ctx.fillStyle = EASEL_WHITE; ctx.fillRect(0, 0, c.width, c.height); const r = Math.min(c.width / img.width, c.height / img.height); const w = img.width * r, h = img.height * r; ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h); tex.needsUpdate = true; };
    img.src = url;
  }
  chessBoardProp() {
    const g = new THREE.Group(); g.name = 'chessprop';
    const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 ? '#8b5a2b' : '#e8d3a6'; ctx.fillRect(x * 32, y * 32, 32, 32); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(boxGeo(0.42, 0.02, 0.42), [M.wood('walnut'), M.wood('walnut'), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), M.wood('walnut'), M.wood('walnut'), M.wood('walnut')]); board.position.y = 0.01; board.castShadow = true; board.receiveShadow = true; g.add(board);
    const white = M.plain(0xf0e6d0, { roughness: 0.4 }), black = M.plain(0x2a2320, { roughness: 0.4 });
    const rnd = seeded(5);
    const sq = 0.36 / 8;
    for (let i = 0; i < 8; i++) { for (const [row, mat] of [[1, white], [6, black]]) { const p = new THREE.Mesh(cylGeo(0.008, 0.012, 0.03, 8), mat); p.position.set(-0.18 + sq * (i + 0.5), 0.035, -0.18 + sq * (row + 0.5)); g.add(p); } }
    for (let i = 0; i < 8; i++) { for (const [row, mat] of [[0, white], [7, black]]) { const h = [0.045, 0.05, 0.055, 0.07, 0.065, 0.055, 0.05, 0.045][i]; const p = new THREE.Mesh(cylGeo(0.01, 0.014, h, 8), mat); p.position.set(-0.18 + sq * (i + 0.5), 0.02 + h / 2, -0.18 + sq * (row + 0.5)); g.add(p); } }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.userData.footprint = null;
    return g;
  }

  // ------------------------------------------------------------- looking / hints ----
  update(dt) {
    for (const a of [...this.anims]) { if (a.update(dt)) this.anims.splice(this.anims.indexOf(a), 1); }
    this.rayTimer -= dt;
    if (this.rayTimer <= 0) { this.rayTimer = 0.05; this.#look(); this.#reach(); }
  }
  /** A seat further away than SEAT_REACH is aimed at, but out of reach: target.near tells the HUD (crosshair ring). */
  #reach() {
    const t = this.target;
    if (t?.type !== 'seat' || !t.seat) return;
    const near = this.seatDistance(t.seat) <= SEAT_REACH;
    if (near !== t.near) { t.near = near; this.world.opts.onTarget?.(t); }
  }
  /** Distance along the view ray to the seat's furniture right now (Infinity when the ray misses it). */
  seatDistance(seat) {
    if (!seat?.obj) return Infinity;
    this.reachRay.setFromCamera(CENTER, this.world.camera);
    const hit = this.reachRay.intersectObject(seat.obj, true)[0];
    return hit ? hit.distance : Infinity;
  }
  /**
   * What the crosshair points at. The shelf books are tested case by case as boxes (BookShelves.pick), everything
   * else only when the ray meets its bounding box; walls, floors and carcasses are boxes that end the ray.
   */
  #look() {
    const w = this.world;
    if (!w.player.enabled || w.player.transition) { this.#setTarget(null); return; }
    const rc = this.raycaster;
    rc.setFromCamera(CENTER, w.camera);
    const far = rc.far = w.player.seated ? 2.2 : 3.2;
    const ray = rc.ray;
    // the nearest wall, floor or carcass along the ray
    let limit = far, wall = Infinity;
    for (const b of this.occluders) {
      if (!ray.intersectBox(b, _hitPoint)) continue;
      if (b.containsPoint(ray.origin)) continue;             // standing inside a box (a doorway lintel above): no wall
      const d = _hitPoint.distanceTo(ray.origin);
      if (d < wall) wall = d;
    }
    limit = Math.min(far, wall);
    const glassHits = this._glassHits || (this._glassHits = []);
    for (const g of this.glass || []) {
      glassHits.length = 0;
      rc.far = limit;
      rc.intersectObject(g, true, glassHits);
      rc.far = far;
      if (glassHits.length && glassHits[0].distance < limit) limit = glassHits[0].distance;
    }
    // the shelf slot under the crosshair decides, also behind the pulled-out book; the hovered book's own slot, grown a
    // little, keeps it at the borders to its neighbours (BookShelves.hoverHit, pick)
    let held = w.books.hoverHit(ray);
    if (held != null && (held > limit || this.target?.entry !== w.books.hover)) held = null;
    let target = null;
    let best = held != null ? Math.min(limit, held + 0.001) : limit;
    const shelf = w.books.pick(ray, best);
    if (shelf) { target = { type: 'book', entry: shelf.entry, book: shelf.entry.book, distance: shelf.distance }; best = shelf.distance; }
    // everything else: precise hits, but only where the bounding box is in reach
    const hits = this._hits;
    const nearest = (obj) => {
      hits.length = 0;
      rc.far = best;
      rc.intersectObject(obj, true, hits);
      rc.far = far;
      for (const h of hits) if (!h.object.userData.hoverMesh && h.distance < best) return h;
      return null;
    };
    const inReach = (box) => { if (!box) return true; if (box.containsPoint(ray.origin)) return true; const p = ray.intersectBox(box, _hitPoint); return !!p && p.distanceTo(ray.origin) < best; };
    // face-out presentation copies (display boards, display table)
    for (const m of w.books.displayMeshes.concat(w.books.tableDisplay || [])) {
      if (!m.visible || !inReach(m.userData.box)) continue;
      const h = nearest(m); if (!h) continue;
      const id = m.userData.displayBook, b = w.booksById?.[id];
      if (b) { target = { type: 'book', entry: w.books.entry(id), book: b, display: true, distance: h.distance }; best = h.distance; }
    }
    // books lying on the table in front of a seat
    for (const [id, tb] of this.tableBooks) {
      const h = nearest(tb.mesh); if (!h) continue;
      target = { type: 'tablebook', id, book: tb.book, distance: h.distance }; best = h.distance;
    }
    // seats, pictures and everything with an E action
    let aim = null;   // where the ray met the thing aimed at (act() hands it on: the world map opens at that place)
    for (const { obj, box } of this.pickables) {
      if (!inReach(box)) continue;
      const h = nearest(obj); if (!h) continue;
      const it = h.object.userData.interact || obj.userData.interact;
      if (!it) continue;
      if (it.kind === 'seat') { if (w.player.seated) continue; target = { type: 'seat', seat: w.seats.get(it.seat), distance: h.distance }; }
      else if (it.kind === 'painting') target = { type: 'painting', slot: it.slot, distance: h.distance };
      else if (it.kind === 'lamp') target = this.#lampTarget(it, h.distance);
      else target = { type: 'interact', kind: it.kind, label: it.label, standAt: it.standAt, distance: h.distance };
      aim = target.type === 'interact' ? h : null;
      best = h.distance;
    }
    // the boxes in the audiobook cabinet (audiobook-shelf.js): each one is a target of its own, the card "Alle
    // Hörbücher" in its last place acts like the cabinet
    const ab = w.audiobooks?.pick(ray, best);
    if (ab) {
      target = ab.all || !ab.book ? { type: 'interact', kind: 'audiobooks', label: { de: 'Alle Hörbücher', en: 'All audiobooks' }, distance: ab.distance }
        : { type: 'audiobook', id: ab.book.id, index: ab.index, audiobook: ab.book, kind: 'audiobook:' + ab.book.id, distance: ab.distance };
      aim = null; best = ab.distance;
    }
    // the cat answers only when it is visible and within reach (cat.js)
    if (w.cat) {
      const h = nearest(w.cat.pick);
      const it = h && (h.object.userData.interact || w.cat.pick.userData.interact);
      if (it) { target = { type: 'interact', kind: it.kind, label: it.label, standAt: it.standAt, distance: h.distance }; aim = null; best = h.distance; }
    }
    if (!target && held != null) target = this.target;
    // a big thing on a wall (the world map, placement meta.reach) answers from as far as it is looked at
    if (!target && this.farReach) { target = this.#lookFar(ray, wall); aim = this.farHit; }
    this.aimHit = target?.type === 'interact' ? aim : null;
    // the projection screen can be aimed at from the sofa, far beyond the normal reach
    if (!target && w.cinema?.active) target = w.cinema.pick(w.camera, w.occluders);
    this.#setTarget(target);
  }
  /** Beyond the normal reach: the nearest interactable along the ray up to the longest meta.reach, before walls and
   *  glass. It counts only when it has such a reach itself (a chair further away stays out of reach and in the way). */
  #lookFar(ray, wall) {
    const rc = this.raycaster, far = rc.far;
    let best = Math.min(this.farReach, wall);
    // nothing to do unless the ray meets the box of such a thing (the precise tests below cost a little)
    if (!this.pickables.some((p) => p.reach && ray.intersectBox(p.box, _hitPoint) && _hitPoint.distanceTo(ray.origin) < Math.min(best, p.reach))) return null;
    const hits = this._hits;
    rc.far = best;
    for (const g of this.glass || []) { hits.length = 0; rc.intersectObject(g, true, hits); if (hits.length && hits[0].distance < best) best = hits[0].distance; }
    let found = null;
    for (const p of this.pickables) {
      if (!p.box.containsPoint(ray.origin)) { const q = ray.intersectBox(p.box, _hitPoint); if (!q || q.distanceTo(ray.origin) >= best) continue; }
      hits.length = 0; rc.far = best;
      rc.intersectObject(p.obj, true, hits);
      const h = hits.find((x) => !x.object.userData.hoverMesh && x.distance < best);
      if (h) { best = h.distance; found = { p, h }; }
    }
    rc.far = far;
    this.farHit = found?.h || null;
    const it = found && (found.h.object.userData.interact || found.p.obj.userData.interact);
    if (!it || it.kind === 'seat' || it.kind === 'painting' || found.h.distance > found.p.reach) return null;
    if (it.kind === 'lamp') return this.#lampTarget(it, found.h.distance);
    return { type: 'interact', kind: it.kind, label: it.label, standAt: it.standAt, distance: found.h.distance };
  }
  /** A lamp under the crosshair (lamp-switch.js): which one, its kind for the label and whether it is on. */
  #lampTarget(it, distance) {
    return { type: 'lamp', lamp: it.lamp, lampKind: it.lampKind, on: this.world.lampSwitch.isOn(it.lamp), distance };
  }
  #setTarget(t) {
    const w = this.world;
    // (a lamp is another target once it is switched: the label below the crosshair says the other thing then)
    const same = (a, b) => a === b || (a && b && a.type === b.type && (a.book?.id || a.seat?.id || a.lamp || a.kind || a.slot) === (b.book?.id || b.seat?.id || b.lamp || b.kind || b.slot) && a.on === b.on);
    if (same(this.target, t)) return;
    this.target = t;
    w.books.setHover(t?.type === 'book' && !t.display ? t.entry : null);
    w.audiobooks?.setHover(t?.type === 'audiobook' ? t.index : null);
    // the cover image for the card on the right; a book with only a title card gets it drawn there (hud.js)
    if (t?.book) t.coverUrl = hasCoverImage(t.book) ? w.books.coverUrlFor(t.book) : null;
    w.opts.onTarget?.(t);
  }

  // ------------------------------------------------------------- primary action ----
  /**
   * Keys and clicks from main.js. key: 'E' | 'F' | 'R' | 'Space' | 'Move' | 'Click'.
   *   Space: stands up from a seat, otherwise jumps.
   *   Move: a fresh press of W A S D or an arrow key; stands up once the sit-down has finished.
   *   Click: the left mouse button with the pointer caught: a book on the shelf shows its info card, a book on the
   *     table opens, everything else acts as with E.
   */
  act(key) {
    const t = this.target; const w = this.world;
    if (w.player.seated) {
      if (key === 'Space') { this.stand(); return true; }
      if (key === 'Move') { if (!w.player.seatedReady || w.player.transition || !w.player.enabled) return false; this.stand(); return true; }
    } else if (key === 'Space') return w.player.jump();
    if (key === 'Move' || !t) return false;
    if (key === 'Click') {
      if (t.type === 'book') { w.opts.onInteract?.('bookinfo', { id: t.book.id }); return true; }
      if (t.type === 'tablebook') { w.opts.onInteract?.('read', { id: t.id }); return true; }
      key = 'E';
    }
    if (t.type === 'book') {
      if (key === 'E') { this.takeBook(t.book.id); return true; }
      if (key === 'F') { w.opts.onInteract?.('bookinfo', { id: t.book.id }); return true; }
      if (key === 'R') { this.takeBook(t.book.id, { read: true }); return true; }
    }
    // an audiobook box: E (and a click) plays it or pauses it, F opens it in the panel
    if (t.type === 'audiobook') {
      if (key === 'E') { w.opts.onInteract?.('audiobook', { id: t.id, key: 'E' }); return true; }
      if (key === 'F' || key === 'R') { w.opts.onInteract?.('audiobook', { id: t.id, key: 'F' }); return true; }
      return false;
    }
    if (t.type === 'tablebook') {
      if (key === 'E') { w.opts.onInteract?.('read', { id: t.id }); return true; }
      if (key === 'F') { w.opts.onInteract?.('bookinfo', { id: t.id }); return true; }
      if (key === 'R') { this.returnBook(t.id); return true; }
    }
    // (already seated: a second quick click or E on the chair, before the look ray has let go of it)
    if (t.type === 'seat' && key === 'E') { if (w.player.seated || this.seatDistance(t.seat) > SEAT_REACH) return false; this.sit(t.seat.id); return true; }
    if (t.type === 'painting' && key === 'E') { w.opts.onInteract?.('gallery', { slot: t.slot }); return true; }
    if (t.type === 'lamp' && key === 'E') { this.switchLamp(t); return true; }
    if (t.type === 'interact' && t.kind === 'cat' && key === 'E') { w.cat?.pet(w.camera.position); return true; }
    if (t.type === 'interact' && t.kind === 'firebowl' && key === 'E') { w.fireBowl?.toggle(); w.opts.onTarget?.(t); return true; }
    if (t.type === 'interact' && key === 'E') { w.opts.onInteract?.(t.kind, { standAt: t.standAt, hit: this.aimHit }); return true; }
    return false;
  }
  /** E or a click on a lamp: it goes off or on with a click of its switch, the settings remember it (main.js
   *  onLamps), and the label below the crosshair says at once what E does now. */
  switchLamp(t) {
    const w = this.world;
    t.on = w.lampSwitch.toggle(t.lamp);
    w.opts.onSfx?.('click');
    w.opts.onLamps?.(w.lampSwitch.offList());
    w.opts.onTarget?.(t);
  }

  // ------------------------------------------------------------- basket / books ----
  hasInBasket(id) { return this.basket.includes(id); }
  async takeBook(id, { read = false, silent = false } = {}) {
    const w = this.world; const book = w.booksById[id]; if (!book) return;
    if (this.basket.includes(id)) { if (read) w.opts.onInteract?.('read', { id }); return; }
    if (this.basket.length >= 12) { w.opts.onInteract?.('basket-full', {}); return; }
    this.basket.push(id);
    const e = w.books.entry(id);
    w.books.setDisplayVisible(id, false);
    w.opts.onBasket?.(this.basket, { added: id });
    w.opts.onSfx?.('book-pull');
    const near = e && e.pos.distanceTo(w.camera.position) < 6;
    if (e && !e.hidden && !near) { w.books.setHidden(id, true); if (read) w.opts.onInteract?.('read', { id }); }
    else if (e && !e.hidden) {
      w.books.setHidden(id, true);
      const mesh = makeBookMesh(book, null, [e.w, e.h, e.d], { standing: true });
      loadCover(hasCoverImage(book) ? w.opts.coverUrl?.(id) : null).then((tex) => { if (tex && mesh.material[1]) { mesh.material[1] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }); mesh.material.needsUpdate = true; } });
      mesh.position.copy(e.pos); mesh.quaternion.copy(e.quat);
      w.dynamic.add(mesh);
      const cam = w.camera;
      const start = e.pos.clone(), q0 = e.quat.clone();
      const out = e.pos.clone().addScaledVector(e.forward, 0.28);
      let t = 0;
      const anim = { update: (dt) => {
        t += dt;
        if (t < 0.35) { const k = easeOut(t / 0.35); mesh.position.lerpVectors(start, out, k); }
        else if (t < 1.0) {
          const k = easeInOut((t - 0.35) / 0.65);
          const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
          const p = cam.position.clone().addScaledVector(fwd, 0.55).addScaledVector(UP, -0.12);
          mesh.position.lerpVectors(out, p, k);
          // face the camera with the front cover (+x local)
          const qFace = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, p, UP)).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2));
          mesh.quaternion.slerpQuaternions(q0, qFace, k);
        } else if (t < 1.55) {
          const k = easeInOut((t - 1.0) / 0.55);
          const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
          const from = cam.position.clone().addScaledVector(fwd, 0.55).addScaledVector(UP, -0.12);
          const to = cam.position.clone().addScaledVector(fwd, 0.5).addScaledVector(right, -0.42).addScaledVector(UP, -0.42);
          mesh.position.lerpVectors(from, to, k); const s = 1 - k * 0.8; mesh.scale.set(s, s, s);
        } else { w.dynamic.remove(mesh); disposeBookMesh(mesh); w.opts.onSfx?.('basket'); if (read) w.opts.onInteract?.('read', { id }); return true; }
        return false;
      } };
      this.anims.push(anim);
    } else if (read) w.opts.onInteract?.('read', { id });
    if (w.player.seated) this.#layoutTableBooks();
  }
  /** Put a book back on its shelf (from basket or table) */
  returnBook(id, { animate = true } = {}) {
    const w = this.world;
    const idx = this.basket.indexOf(id);
    if (idx >= 0) this.basket.splice(idx, 1);
    const tb = this.tableBooks.get(id);
    if (tb) { w.dynamic.remove(tb.mesh); disposeMeshTree(tb.mesh); this.tableBooks.delete(id); if (this.seatedId) this.putBack = id; }
    if (this.readAt?.id === id) this.readAt = null;
    w.books.setDisplayVisible(id, true);
    w.opts.onBasket?.(this.basket, { removed: id });
    const e = w.books.entry(id);
    if (!e) { w.opts.onReturned?.(id); return; }      // not on this room's shelves (other department)
    w.opts.onReturned?.(id);
    if (!animate) { w.books.setHidden(id, false); return; }
    const book = w.booksById[id];
    const mesh = makeBookMesh(book, null, [e.w, e.h, e.d], { standing: true });
    w.dynamic.add(mesh);
    const cam = w.camera; const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const from = cam.position.clone().addScaledVector(fwd, 0.5).addScaledVector(right, -0.42).addScaledVector(UP, -0.42);
    const out = e.pos.clone().addScaledVector(e.forward, 0.28);
    const q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, from, UP));
    let t = 0;
    this.anims.push({ update: (dt) => {
      t += dt;
      if (t < 0.9) { const k = easeInOut(t / 0.9); mesh.position.lerpVectors(from, out, k); mesh.quaternion.slerpQuaternions(q0, e.quat, k); const s = 0.3 + k * 0.7; mesh.scale.set(s, s, s); }
      else if (t < 1.2) { const k = easeOut((t - 0.9) / 0.3); mesh.position.lerpVectors(out, e.pos, k); mesh.scale.set(1, 1, 1); }
      else { w.dynamic.remove(mesh); disposeBookMesh(mesh); w.books.setHidden(id, false); w.opts.onSfx?.('book-place'); return true; }
      return false;
    } });
  }
  returnAll() {
    // decided once for the whole basket: returnBook takes each book out of it, so a per-book look at the length let the
    // last five of a full basket fly after all
    const animate = this.basket.length < 6;
    for (const id of [...this.basket]) this.returnBook(id, { animate });
    this.basket.length = 0; this.world.opts.onBasket?.(this.basket, {});
  }
  setBasket(ids) {
    this.basket = [...ids];
    // a book lying on a table is not on its shelf at the same time, also when it is not in the basket
    for (const id of new Set([...ids, ...this.tableBooks.keys()])) { this.world.books.setHidden(id, true); this.world.books.setDisplayVisible(id, false); }
  }

  // ------------------------------------------------------------- seats & tables ----
  sit(seatId) {
    const w = this.world; const seat = w.seats.get(seatId); if (!seat) return;
    this.seatedId = seatId;
    if (this.readAt?.seat !== seatId) this.readAt = null;   // the book left open belongs to the seat it was read at
    this.putBack = null;
    // while a film runs, the sofa looks up at the screen instead of down at the fire
    const pitch = seatId === 'sofa' && w.cinema?.active ? w.cinema.pitchFrom(seat.eye) : seat.pitch;
    w.player.sit({ eye: seat.eye, yaw: seat.yaw, pitch, standPos: seat.standPos, standYaw: seat.standYaw });
    w.opts.onSfx?.('sit');
    w.opts.onSeat?.(seat);
    setTimeout(() => this.#layoutTableBooks(), 300);
  }
  /** Already seated on the sofa when a film starts: raise the view to the screen. */
  aimAtScreen() {
    const w = this.world; const seat = w.seats.get(this.seatedId);
    if (!seat || !w.cinema) return;
    w.player.moveTo(seat.eye, seat.yaw, w.cinema.pitchFrom(seat.eye), 0.8);
  }
  stand() {
    const w = this.world; if (!w.player.seated) return;
    w.player.stand(); this.seatedId = null;
    w.opts.onSfx?.('stand'); w.opts.onSeat?.(null);
  }
  #tableFrame(seat) {
    // returns { origin: Vector3, right: Vector3, fwd: Vector3 } describing where books go for this seat
    const w = this.world;
    const yaw = seat.yaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    if (seat.table && w.surfaces.get(seat.table)) {
      const s = w.surfaces.get(seat.table); const surf = s.surface;
      const center = new THREE.Vector3(...(surf.offset || [0, 0, 0])).setY(surf.y).applyMatrix4(s.obj.matrixWorld);
      // put the row of books on the table right in front of the seat
      const origin = seat.eye.clone().addScaledVector(fwd, 0.62); origin.y = center.y;
      // keep the row inside the table surface (clamp in the table's local space)
      const inv = s.obj.matrixWorld.clone().invert();
      const local = origin.clone().applyMatrix4(inv);
      const off = surf.offset || [0, 0, 0];
      local.x = clamp(local.x, off[0] - surf.w / 2 + 0.12, off[0] + surf.w / 2 - 0.12);
      local.z = clamp(local.z, off[2] - surf.d / 2 + 0.12, off[2] + surf.d / 2 - 0.12);
      local.y = surf.y;
      origin.copy(local.applyMatrix4(s.obj.matrixWorld));
      return { origin, right, fwd, surface: true };
    }
    const origin = seat.eye.clone().addScaledVector(fwd, 0.42).addScaledVector(UP, -0.62);
    return { origin, right, fwd, surface: false };
  }
  /** The book opened last: the last one closed in the reader this session, else the one with the latest reading
   *  (the library sets `lastRead` whenever a book is opened or read). null when nothing has been read yet. */
  lastOpened() {
    const by = this.world.booksById || {};
    if (this.lastOpenedId && by[this.lastOpenedId]) return this.lastOpenedId;
    let best = null, at = 0;
    for (const b of Object.values(by)) if ((b.lastRead || 0) > at && !b.missing) { at = b.lastRead; best = b.id; }
    return best;
  }
  /** What lies in front of a seat: nothing by default. The book read there stays open after reading, and with the
   *  setting "Zuletzt geöffnetes Buch am Sitzplatz bereitlegen" the book opened last lies there as well, also when it
   *  is not in the basket. (Up to 0.5 every book of the basket was laid out.) */
  #seatBookIds() {
    const ids = [];
    if (this.seatBook) { const id = this.lastOpened(); if (id) ids.push(id); }
    if (this.readAt?.seat === this.seatedId && this.readAt.id && !ids.includes(this.readAt.id)) ids.push(this.readAt.id);
    // a book put back on its shelf (R) stays there while you sit
    return ids.filter((id) => this.world.booksById?.[id] && id !== this.putBack);
  }
  /** Take a book off the table (its shelf copy shows again unless it is in the basket). */
  #removeTableBook(id) {
    const w = this.world, tb = this.tableBooks.get(id); if (!tb) return;
    w.dynamic.remove(tb.mesh); disposeMeshTree(tb.mesh); this.tableBooks.delete(id);
    if (!this.basket.includes(id)) { w.books.setHidden(id, false); w.books.setDisplayVisible(id, true); }
  }
  #layoutTableBooks({ instant = false } = {}) {
    const w = this.world; if (!w.player.seated || !this.seatedId) return;
    const seat = w.seats.get(this.seatedId); if (!seat) return;
    const frame = this.#tableFrame(seat);
    const ids = this.#seatBookIds();
    // remove the table meshes of books that no longer lie at this seat
    for (const id of [...this.tableBooks.keys()]) if (!ids.includes(id)) this.#removeTableBook(id);
    const n = ids.length; const spacing = Math.min(0.3, frame.surface ? 1.6 / Math.max(1, n) : 0.26);
    ids.forEach((id, i) => {
      const book = w.booksById[id]; if (!book) return;
      // the same volume never stands on its shelf while it lies here (a basket book is hidden there already)
      w.books.setHidden(id, true); w.books.setDisplayVisible(id, false);
      const rnd = seeded(hashStr(id + this.seatedId));
      const x = (i - (n - 1) / 2) * spacing;
      const pos = frame.origin.clone().addScaledVector(frame.right, x).addScaledVector(frame.fwd, (rnd() - 0.5) * 0.06);
      const yawR = Math.atan2(frame.fwd.x, frame.fwd.z) + (rnd() - 0.5) * 0.25;
      let tb = this.tableBooks.get(id);
      if (!tb) {
        const h = bookHeight(book), wd = spineWidth(book), d = 0.17;
        const mesh = makeBookMesh(book, null, [wd, h, d], { standing: false });
        loadCover(hasCoverImage(book) ? w.opts.coverUrl?.(id) : null).then((tex) => { if (tex && !tb.open) { mesh.material[1] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }); mesh.material.needsUpdate = true; } });
        mesh.userData.tableBook = id; mesh.traverse((o) => { o.userData.tableBook = id; });
        tb = { mesh, open: false, book, seatId: this.seatedId, thickness: wd };
        this.tableBooks.set(id, tb); w.dynamic.add(mesh);
        mesh.position.copy(pos).setY(pos.y + 0.3); mesh.scale.set(0.01, 0.01, 0.01);
      }
      tb.seatId = this.seatedId;
      // animate to target
      const from = tb.mesh.position.clone(), q0 = tb.mesh.quaternion.clone(), s0 = tb.mesh.scale.clone();
      const target = pos.clone().setY(pos.y + (tb.open ? 0 : tb.thickness / 2));
      const qT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawR, 0));
      if (tb.open) qT.multiply(OPEN_TURN);
      tb.target = target; tb.quatT = qT;
      if (instant || (from.distanceTo(target) < 1e-3 && q0.angleTo(qT) < 1e-3 && s0.x === 1)) {
        tb.mesh.position.copy(target); tb.mesh.quaternion.copy(qT); tb.mesh.scale.set(1, 1, 1); tb.pos = target; tb.quat = qT;
        return;
      }
      // (the mesh of this moment: an open book that replaces it later is placed by markOpen itself)
      const mesh = tb.mesh;
      let t = 0; const delay = i * 0.08;
      this.anims.push({ update: (dt) => { t += dt; if (t < delay) return false; const k = easeInOut(clamp((t - delay) / 0.6, 0, 1)); mesh.position.lerpVectors(from, target, k); mesh.quaternion.slerpQuaternions(q0, qT, k); mesh.scale.lerpVectors(s0, new THREE.Vector3(1, 1, 1), k); if (k >= 1) { if (tb.mesh === mesh) { tb.pos = target; tb.quat = qT; w.opts.onSfx?.('book-place'); } return true; } return false; } });
    });
  }
  /** After reading: leave the book open on the table at the position where it was. Read at a seat where it did not
   *  lie (from the basket, the computer …), it now lies there, open. */
  markOpen(id, pageText) {
    if (!id) return;
    const w = this.world;
    this.lastOpenedId = id;
    if (this.putBack === id) this.putBack = null;
    if (w.player.seated && this.seatedId) { this.readAt = { id, seat: this.seatedId }; this.#layoutTableBooks({ instant: !this.tableBooks.has(id) }); }
    const tb = this.tableBooks.get(id); if (!tb) return;
    // where it lies (or is about to lie): an open book lies flat on the surface, a closed one half its thickness higher
    const at = (tb.target || tb.mesh.position).clone(), q = (tb.quatT || tb.mesh.quaternion).clone();
    if (!tb.open) { at.y -= tb.thickness / 2; q.multiply(OPEN_TURN); }
    w.dynamic.remove(tb.mesh); disposeMeshTree(tb.mesh);
    const open = makeOpenBookMesh(tb.book, pageText, [Math.max(0.3, bookHeight(tb.book) * 1.45), bookHeight(tb.book)]);
    open.position.copy(at); open.quaternion.copy(q);
    open.userData.tableBook = id; open.traverse((o) => { o.userData.tableBook = id; });
    tb.mesh = open; tb.open = true; tb.target = at.clone(); tb.quatT = q.clone(); w.dynamic.add(open);
  }

  // ------------------------------------------------------------- paintings ----
  setPaintings(list, mode) {
    const w = this.world;
    if (list) this.paintingList = list;
    if (mode) this.paintingMode = mode;
    this.hungBySlot = this.hungBySlot || new Map();
    const off = this.paintingMode === 'off' || this.paintingMode === 'none';
    for (const p of w.paintings) p.obj.visible = !off;
    if (off) return;
    const pool = this.paintingList || [];
    w.paintings.forEach((p, i) => {
      // a watercolour the user hung themselves always wins over the generated gallery
      const own = this.hungBySlot.get(p.slot);
      const item = own ? { url: own } : (pool.length ? pool[(p.slot ?? i) % pool.length] : null);
      if (!item?.url) return;
      this.#applyPaintingTexture(p, item);
    });
  }
  /** Re-hang everything after a world rebuild (build() throws the frames away). */
  restorePaintings() { if (this.paintingList?.length || this.hungBySlot?.size) this.setPaintings(null, null); }
  /** The picture into the frame: an item with `image` (a canvas or a bitmap, the quick sketches of ui/paintings.js) is
   *  a texture at once, one with `url` only is loaded and decoded first. */
  #applyPaintingTexture(p, item) {
    const apply = (tex) => { if (!tex) return; const cm = p.obj.userData.canvas; cm.material.map = tex; cm.material.color.set(0xffffff); cm.material.needsUpdate = true; p.url = item.url; };
    if (item.image) {
      if (!item.tex) { item.tex = new THREE.CanvasTexture(item.image); item.tex.colorSpace = THREE.SRGBColorSpace; item.tex.anisotropy = 8; }
      apply(item.tex);
      return;
    }
    loadCover(item.url).then(apply);
  }
  hangPainting(url, slot) {
    const w = this.world;
    let p = slot != null ? w.paintings.find((x) => x.slot === slot) : null;
    if (!p) { // nearest to the player
      let best = Infinity; for (const x of w.paintings) { const d = x.obj.position.distanceTo(w.player.position); if (d < best) { best = d; p = x; } }
    }
    if (!p) return null;
    this.hungBySlot = this.hungBySlot || new Map();
    this.hungBySlot.set(p.slot, url);
    this.#applyPaintingTexture(p, { url }); p.obj.visible = true;
    return p.slot;
  }

  // ------------------------------------------------------------- teleport ----
  teleport(placeId) {
    const w = this.world; const pl = w.places.find((p) => p.id === placeId); if (!pl) return false;
    this.leaveSeat();
    w.player.transition = null;
    w.player.setPose(pl.x, pl.z, pl.yaw, 0);
    return true;
  }
  /** Stand beside a seat: the places menu starts the move onto the seat from there. */
  standBy(seatId) {
    const w = this.world, s = w.seats.get(seatId); if (!s) return false;
    w.player.transition = null;
    w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0);
    return true;
  }
  /** Leave the current seat without the stand-up animation (teleport, go-to-book, rebuild). */
  leaveSeat() {
    const w = this.world;
    if (!w.player.seated && !this.seatedId) return;
    w.player.seated = null; w.player.seatedReady = false; this.seatedId = null;
    for (const id of [...this.tableBooks.keys()]) this.#removeTableBook(id);
    w.opts.onSeat?.(null);
  }
  /** Walk-to helper for interactables that want a fixed standing spot */
  standAt(spec) { if (!spec) return; const w = this.world; w.player.moveTo(new THREE.Vector3(spec[0], EYE, spec[1]), spec[2], 0, 0.7); }
  /** Move the player in front of the shelf where a book stands */
  goToBook(id) {
    // a second copy of a book that stands once: to the copy on the shelf (layout.js shownAs)
    const w = this.world; const e = w.books.entry(id) || w.books.entry(w.layout?.shownAs?.get(id)); if (!e) return false;
    const dist = 1.0;
    const p = e.pos.clone().addScaledVector(e.forward, dist); p.y = EYE;
    const yaw = Math.atan2(e.forward.x, e.forward.z); // face the shelf (look along -forward)
    const pitch = Math.atan2(e.pos.y - EYE, dist);    // and actually look AT the book, not over it
    this.leaveSeat();
    w.player.transition = null; w.player.setPose(p.x, p.z, yaw, pitch);
    return true;
  }
}

/** Dispose a book mesh, or a group of them (open books are groups). */
function disposeMeshTree(obj) {
  if (!obj) return;
  if (obj.isMesh) { disposeBookMesh(obj); return; }
  obj.traverse((o) => { if (o.isMesh) disposeBookMesh(o); });
}
