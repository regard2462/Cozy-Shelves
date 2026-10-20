// Deterministic library layout: one (small) great hall, a short passage and ONE book room.
// The book room holds all departments along its walls (a very large library shows one department at a time,
// picked with the radial menu, app/src/ui/wheel.js). Everything is described as data
// (walls, floors, placements, slots, places, signs) and built by world.js.
import { BOOKCASE, SHELF_LEVELS } from './furniture.js';
import { seeded, hashStr } from './geo.js';
import { hasCoverImage } from './book-art.js';
import { BENCHES, JETTY, FEEDER, FIREBOWL } from './outdoor.js';
import { addWaitingRun } from './empty-library.js';
import { arrangeShelves, shelfOptions } from './shelf-arrange.js';

// ---------------------------------------------------------------- dimensions -----------------------
// The hall is deliberately compact: a cosy room, not a station concourse.
export const HALL = { x0: -8.5, x1: 8.5, z0: -5.5, z1: 5.5, h: 5.4, wall: 0.35 };
// Short passage from the hall's south wall into the book room.
export const PASSAGE = { x: 0, w: 3.4, h: 3.1, z0: -9.2, z1: -5.5 };
// The single book room. Big and open – shelves on the walls, the middle stays walkable.
export const ROOM = { x0: -11, x1: 11, z0: -23.6, z1: -9.2, h: 5.0 };
export const ROOM_H = ROOM.h;
// Kept for compatibility with older call sites.
export const CORRIDOR = { z0: PASSAGE.z0, z1: PASSAGE.z1, w: PASSAGE.w, h: PASSAGE.h };

const SLOT_SPACING = 1.26;      // bookcase pitch: the cases stand nearly flush, like a real wall of shelves
export const RECENT_SHELF = 'room:recent';
/** The case "Gelesen" left of the passage, opposite "Zuletzt gelesen" (shelf-arrange.js decides what stands on it). */
export const READ_SHELF = 'room:read';

export function spineWidth(book) {
  const pages = book.pageCount || 260;
  const w = 0.012 + pages * 0.00007;
  return Math.max(0.016, Math.min(0.062, w));
}
export function bookHeight(book) {
  const r = seeded(hashStr(book.id))();
  const base = book.format === 'pdf' ? 0.26 : 0.215;
  return base + (r - 0.5) * 0.05;
}

/**
 * Full layout.
 * @param departments  from api.library.getState()
 * @param booksById    id → book
 * @param opts         { department: string|null, recent: string[], shelves: settings.shelves (shelf-arrange.js) }
 */
export function buildLayout(departments, booksById, opts = {}) {
  const L = {
    walls: [], floors: [], ceilings: [], placements: [], rooms: [], places: [], colliders: [],
    openings: [], bookcases: [], labels: [], trim: [], booksById,
    signs: [], departmentRuns: [], directory: null, allDepartments: false,
    department: null, departments: departments || [],
  };
  buildHall(L);
  buildAudiobookCase(L);
  buildPassage(L);
  buildTerrace(L);
  buildBookRoom(L, departments || [], booksById, opts);
  return L;
}
/** What the cases show (shelf-arrange.js), measured by this room: as many books read as fill the case "Gelesen". */
export function arrangeFor(departments, booksById, shelves) {
  return arrangeShelves(departments, booksById, shelves, (ids) => packFull(ids, booksById).slice(0, ROWS_PER_CASE).reduce((a, r) => a + r.length, 0));
}
export { shelfOptions };

// ---------------------------------------------------------------- wall helpers ----------------------
function wallBox(L, x, y, z, w, h, d, mat = 'wall', extra = {}) {
  L.walls.push({ x, y, z, w, h, d, mat, ...extra });
  L.colliders.push({ min: [x - w / 2, y - h / 2, z - d / 2], max: [x + w / 2, y + h / 2, z + d / 2] });
}
/** wall along X (varying x) at fixed z, with openings [{c (x centre), w, h, y0}] */
function wallX(L, z, x0, x1, h, t, openings = [], mat = 'wall') {
  const cuts = [...openings].sort((a, b) => a.c - b.c);
  let cur = x0;
  for (const o of cuts) {
    const a = o.c - o.w / 2, b = o.c + o.w / 2;
    if (a > cur) wallBox(L, (cur + a) / 2, h / 2, z, a - cur, h, t, mat);
    const y0 = o.y0 || 0;
    if (y0 > 0) wallBox(L, o.c, y0 / 2, z, o.w, y0, t, mat);
    if (y0 + o.h < h) wallBox(L, o.c, (y0 + o.h + h) / 2, z, o.w, h - (y0 + o.h), t, mat);
    cur = b;
  }
  if (cur < x1) wallBox(L, (cur + x1) / 2, h / 2, z, x1 - cur, h, t, mat);
}
function wallZ(L, x, z0, z1, h, t, openings = [], mat = 'wall') {
  const cuts = [...openings].sort((a, b) => a.c - b.c);
  let cur = z0;
  for (const o of cuts) {
    const a = o.c - o.w / 2, b = o.c + o.w / 2;
    if (a > cur) wallBox(L, x, h / 2, (cur + a) / 2, t, h, a - cur, mat);
    const y0 = o.y0 || 0;
    if (y0 > 0) wallBox(L, x, y0 / 2, o.c, t, y0, o.w, mat);
    if (y0 + o.h < h) wallBox(L, x, (y0 + o.h + h) / 2, o.c, t, h - (y0 + o.h), o.w, mat);
    cur = b;
  }
  if (cur < z1) wallBox(L, x, h / 2, (cur + z1) / 2, t, h, z1 - cur, mat);
}
function place(L, kind, x, z, rot = 0, opts = {}, meta = {}) { const p = { kind, x, z, rot, opts, meta }; L.placements.push(p); return p; }

/**
 * Wainscoting / cornice runs along the INNER face of a wall, split around every opening that
 * reaches below the chair rail and around bookcases. (Running a solid band straight through a doorway is
 * what made the arches look as if they were boarded up with timber; running it behind a bookcase pushed it
 * through the carcass.)
 *   axis 'x': the run varies in x at a fixed z;  axis 'z': varies in z at a fixed x.
 *   face:  the inner face coordinate;  dir: +1 or -1 → which way the panelling faces.
 *   openings: [{ c, w, y0, margin }] – margin (default 5 cm) is the gap left on both sides.
 */
function wainscot(L, axis, face, dir, a0, a1, ceilingH, openings = []) {
  const blocking = openings.filter((o) => (o.y0 || 0) < 1.01).map((o) => { const m = o.margin ?? 0.05; return [o.c - o.w / 2 - m, o.c + o.w / 2 + m]; }).sort((p, q) => p[0] - q[0]);
  const runs = [];
  let cur = a0;
  for (const [a, b] of blocking) { if (a > cur) runs.push([cur, a]); cur = Math.max(cur, b); }
  if (cur < a1) runs.push([cur, a1]);
  for (const [a, b] of runs) {
    if (b - a < 0.08) continue;
    const mid = (a + b) / 2, len = b - a;
    L.trim.push({ axis, at: face, dir, mid, len, ceilingH });
  }
  // the cornice can run unbroken – it sits above every opening
  L.trim.push({ axis, at: face, dir, mid: (a0 + a1) / 2, len: a1 - a0, ceilingH, corniceOnly: true });
}

/**
 * A rectangular steel window (furniture.js glazing). The wall opening matches it exactly; an oak sill board
 * lies in the opening, so nothing sticks out into the panelling (the old marble sills ran into the chair rail).
 * `bays` vertical fields, `transom` = height of the horizontal bar above the sill (0 = none).
 */
function addWindow(L, { x, z, w, h, y0, rot, dir, bays = 1, transom = 0 }) {
  place(L, 'glazing', x, z, rot, { w, h, bays, transom, reveal: HALL.wall }, { y: y0 });
  L.openings.push({ kind: 'window', x, z, w, h, y0, rise: 0, dir });
  const along = (rot === 0 || Math.abs(rot) === Math.PI) ? x : z;
  return { c: along, w, h, y0 };
}

// ---------------------------------------------------------------- the hall -------------------------
// The north wall is one big glass front: slim steel bays from a low parapet (window bench height) to just
// under the cornice. It replaced three arched windows. Its two middle bays (`door`) are a pair of glazed doors
// down to the floor: they open onto the terrace when you walk up to them.
export const GLASS = { x0: -7.9, x1: 7.9, y0: 0.45, y1: 4.9, bays: 10, transom: 2.05, door: [4, 5] };
const BAY = (GLASS.x1 - GLASS.x0) / GLASS.bays;
/** The door opening: x range, height of the leaves (up to the transom bar). */
export const GLASS_DOOR = { x0: GLASS.x0 + GLASS.door[0] * BAY, x1: GLASS.x0 + (GLASS.door[1] + 1) * BAY, h: GLASS.y0 + 0.03 + GLASS.transom - 0.025 };
// Book room windows: a wide one in the back wall, a narrow one in each side wall.
export const BACK_WIN = { w: 4.4, h: 3.0, y0: 1.05 };
export const SIDE_WIN = { z: -20.0, w: 1.6, h: 2.9, y0: 1.1 };
// The passage openings are lined by the passage walls themselves; a timber casing covers their ends.
export const CASING_W = 0.36, CASING_D = 0.16;
// Everything that stands against a wall keeps this distance from the wall face (the panelling is 11–15 cm deep).
const WALL_GAP = 0.16;

function buildHall(L) {
  const { x0, x1, z0, z1, h, wall: t } = HALL;
  L.floors.push({ x: 0, z: 0, w: x1 - x0, d: z1 - z0, mat: 'floor' });
  L.ceilings.push({ x: 0, z: 0, w: x1 - x0, d: z1 - z0, y: h, mat: 'ceiling' });

  // --- north wall (+Z): the glass front ----------------------------------------------------------------
  const gw = GLASS.x1 - GLASS.x0, gh = GLASS.y1 - GLASS.y0, gc = (GLASS.x0 + GLASS.x1) / 2;
  const glassCut = { c: gc, w: gw, h: gh, y0: GLASS.y0 };
  // the parapet stops at the door: there the opening goes down to the floor
  const D = GLASS_DOOR;
  wallX(L, z1 + t / 2, x0 - t, x1 + t, h, t, [
    { c: (GLASS.x0 + D.x0) / 2, w: D.x0 - GLASS.x0, h: gh, y0: GLASS.y0 },
    { c: (D.x0 + D.x1) / 2, w: D.x1 - D.x0, h: GLASS.y1, y0: 0 },
    { c: (D.x1 + GLASS.x1) / 2, w: GLASS.x1 - D.x1, h: gh, y0: GLASS.y0 },
  ], 'wallpaper');
  // rot π: local +z faces into the hall, the frame sits inside the wall opening
  place(L, 'glazing', gc, z1, Math.PI, { w: gw, h: gh, bays: GLASS.bays, transom: GLASS.transom, reveal: t, open: GLASS.door, floor: -GLASS.y0 }, { y: GLASS.y0 });
  L.openings.push({ kind: 'glassfront', x: gc, z: z1, w: gw, h: gh, y0: GLASS.y0, dir: [0, 0, 1] });
  // the two door leaves (they open outwards, world.js updateDoor) and, while they are shut, a collider across
  place(L, 'glassdoor', (D.x0 + D.x1) / 2, z1, Math.PI, { w: D.x1 - D.x0, h: D.h, reveal: t }, { y: 0 });
  L.colliders.push({ min: [D.x0, 0, z1 - 0.06], max: [D.x1, D.h, z1 + t + 0.06], door: true });

  // --- south wall (-Z): the passage into the book room ------------------------------------------
  // the wall opening is as wide as the passage plus its two side walls: those walls line the opening
  const passCut = { c: PASSAGE.x, w: PASSAGE.w + 2 * t, h: PASSAGE.h, y0: 0 };
  wallX(L, z0 - t / 2, x0 - t, x1 + t, h, t, [passCut], 'wallpaper');
  L.openings.push({ kind: 'arch', x: PASSAGE.x, z: z0, w: PASSAGE.w, h: PASSAGE.h, thick: t, dir: 1 });

  // --- west wall (-X): fireplace, east wall (+X): the (decorative) front door --------------------
  wallZ(L, x0 - t / 2, z0 - t, z1 + t, h, t, [], 'wallpaper');
  wallZ(L, x1 + t / 2, z0 - t, z1 + t, h, t, [{ c: 0, w: 2.2, h: 3.0, y0: 0 }], 'wallpaper');
  place(L, 'door', x1 + 0.02, 0, -Math.PI / 2, { w: 2.0, h: 2.9 });
  L.colliders.push({ min: [x1 - 0.12, 0, -1.3], max: [x1 + 0.6, 3.0, 1.3] }); // the front door stays shut

  // --- panelling (skipping the doorway, the passage casing and the glass front) --------------------------
  wainscot(L, 'x', z1, -1, x0, x1, h, [{ ...glassCut, y0: 0 }]);
  wainscot(L, 'x', z0, 1, x0, x1, h, [{ c: PASSAGE.x, w: PASSAGE.w + 2 * CASING_W, y0: 0, margin: 0 }]);
  wainscot(L, 'z', x0, 1, z0, z1, h, []);
  wainscot(L, 'z', x1, -1, z0, z1, h, [{ c: 0, w: 2.2, y0: 0 }]);

  // --- ceiling beams & pendant lights -----------------------------------------------------------------
  for (const z of [-3.2, 0, 3.2]) L.placements.push({ kind: 'beam', x: 0, z, rot: 0, opts: { len: x1 - x0 + t * 2, w: 0.26, h: 0.34 }, meta: { y: h - 0.19 } });
  // between the beams, so the cable does not hang through one
  for (const x of [-4.4, 4.4]) place(L, 'pendant', x, 1.6, 0, { r: 0.6, h: 0.42, drop: h - 3.6 - 0.21 }, { y: 3.6 });
  place(L, 'pendant', 1.6, -2.4, 0, { r: 0.45, h: 0.34, drop: h - 2.75 - 0.17 }, { y: 2.75 });   // low over the reading table

  // --- fireplace lounge (west) -------------------------------------------------------------------
  place(L, 'fireplace', x0 + 0.33, 0, Math.PI / 2, { w: 2.5, ceiling: h });
  place(L, 'rug', x0 + 2.9, 0, Math.PI / 2, { w: 3.8, d: 3.2, seed: 21, palette: ['#b8664a', '#d4b27a', '#f2ece2', '#9c968b'], style: 'modern' });
  place(L, 'armchair', x0 + 2.3, 1.45, -Math.PI / 2 - 0.3, { color: '#a4623b', material: 'leather' }, { seat: 'fireplace', label: { de: 'Sessel am Kamin', en: 'Armchair by the fire' }, group: 'hall', cat: true });
  place(L, 'armchair', x0 + 2.3, -1.45, -Math.PI / 2 + 0.3, { color: '#3f6f6d', material: 'fabric', seed: 3 }, { seat: 'fireplace2', label: { de: 'Zweiter Kaminsessel', en: 'Second fireside chair' }, group: 'hall' });
  // a low table between the armchairs keeps the view on the fire (and on the screen) free
  place(L, 'sidetable', x0 + 2.25, 0, 0, { r: 0.34, h: 0.42 }, { surface: true, id: 'firetable' });
  place(L, 'candle', x0 + 2.25, 0.08, 0, {}, { y: 0.42 });
  place(L, 'sidetable', x0 + 4.6, 1.72, 0, { r: 0.26, h: 0.58 }, { surface: true, id: 'sofatable' });
  place(L, 'tablelamp', x0 + 4.6, 1.72, 0, {}, { y: 0.58 });
  place(L, 'sofa', x0 + 4.6, 0, -Math.PI / 2, { color: '#b4674a', seats: 3, seed: 4 }, { seat: 'sofa', label: { de: 'Sofa vor dem Kamin', en: 'Sofa facing the fire' }, group: 'hall', cat: true });
  place(L, 'floorlamp', x0 + 0.95, 3.6, 0);
  place(L, 'floorlamp', x0 + 0.95, -3.6, 0);
  place(L, 'clock', x0 + 0.43, 0, Math.PI / 2, {}, { y: 2.75 });    // on the face of the chimney breast (at x0 + 0.265 it was 13 cm inside it)
  // plants stand in the corners, clear of every piece of furniture (the palm used to grow into the card catalogue)
  place(L, 'plant', x0 + 0.64, z1 - 0.64, 0, { kind: 'ficus', seed: 2 });

  // --- home cinema: roll-down screen in front of the chimney breast, projector behind the sofa ------
  // (app/src/world/cinema.js: the screen only comes down while a film plays)
  place(L, 'screen', x0 + 0.55, 0, Math.PI / 2, {}, { y: 0 });
  place(L, 'projector', x0 + 6.2, 0, -Math.PI / 2, {}, { interact: 'mediathek', label: { de: 'Beamer (Mediathek)', en: 'Projector (media library)' }, group: 'hall', standAt: [x0 + 7.4, 0.2, 0] });
  place(L, 'plant', x0 + 0.66, z0 + 0.66, 0, { kind: 'fern', seed: 5 });

  // --- music sideboard with the record player (south wall, east of the passage) & the radio ------------
  const sbZ = z0 + WALL_GAP + 0.23;
  place(L, 'sideboard', 6.35, sbZ, 0, { w: 2.2, d: 0.46, h: 0.76 }, { surface: true, id: 'musicboard' });
  place(L, 'recordplayer', 5.85, sbZ + 0.02, 0, {}, { y: 0.76, interact: 'records', label: { de: 'Plattenspieler', en: 'Record player' }, group: 'hall', standAt: [5.85, z0 + 1.75, 0] });
  place(L, 'records', 6.95, sbZ, 0, {}, { y: 0.76 });
  place(L, 'candle', 7.3, sbZ + 0.08, 0, {}, { y: 0.76 });
  place(L, 'sidetable', -7.4, z0 + 1.35, 0, { r: 0.28, h: 0.6 }, { surface: true });
  place(L, 'radio', -7.4, z0 + 1.35, 0.45, {}, { y: 0.6, interact: 'podcasts', label: { de: 'Radio (Podcasts)', en: 'Radio (podcasts)' }, group: 'hall', standAt: [-6.5, z0 + 2.2, 0] });

  // --- entrance (east wall) -----------------------------------------------------------------------
  place(L, 'cardcatalog', x1 - 0.55, -4.1, -Math.PI / 2, {}, { interact: 'catalog', label: { de: 'Online-Katalog (Fernleihe)', en: 'Online catalogue' }, group: 'entrance', standAt: [x1 - 1.9, -4.1, 0] });
  place(L, 'desk', x1 - 0.85, -2.0, Math.PI / 2, { w: 2.5, d: 0.75, wood: 'oak' }, { surface: true });
  place(L, 'computer', x1 - 0.85, -2.6, -Math.PI / 2, {}, { y: 0.78, interact: 'computer', label: { de: 'Computer 1', en: 'Computer 1' }, group: 'entrance', standAt: [x1 - 2.1, -2.6, 0] });
  place(L, 'computer', x1 - 0.85, -1.4, -Math.PI / 2, {}, { y: 0.78, interact: 'computer', label: { de: 'Computer 2', en: 'Computer 2' }, group: 'entrance', standAt: [x1 - 2.1, -1.4, 0] });
  place(L, 'bankerlamp', x1 - 0.85, -2.0, -Math.PI / 2, {}, { y: 0.78 });
  place(L, 'returncounter', x1 - 1.05, 1.5, -Math.PI / 2, {}, { interact: 'return', label: { de: 'Rückgabe-Theke', en: 'Return desk' }, group: 'entrance', standAt: [x1 - 2.5, 1.5, 0] });
  place(L, 'newsrack', x1 - 0.45, 3.55, -Math.PI / 2, {}, { interact: 'news', label: { de: 'Zeitungsständer', en: 'Newspaper rack' }, group: 'entrance', standAt: [x1 - 1.9, 3.55, 0] });
  place(L, 'plant', x1 - 0.66, z1 - 0.66, 0, { kind: 'fern', seed: 12 });
  L.places.push({ id: 'entrance', label: { de: 'Eingang', en: 'Entrance' }, group: 'hall', x: x1 - 3.0, z: 0.2, yaw: -Math.PI / 2 + 0.25 });

  // --- reading table, chess table & the window bench -------------------------------------------------
  place(L, 'table', 1.6, -2.4, 0, { w: 2.5, d: 1.15, wood: 'oak' }, { surface: true, id: 'table1' });
  place(L, 'bankerlamp', 1.6, -2.4, 0, {}, { y: 0.76 });
  place(L, 'rug', 1.6, -2.4, 0, { w: 5.0, d: 3.2, seed: 8, palette: ['#3f6f6d', '#c9a86a', '#efe9df', '#9c968b'], style: 'modern' });
  for (const [dx, dz, rot, s, n] of [[-0.75, 0.85, Math.PI, 'a', 1], [0.75, 0.85, Math.PI, 'b', 2], [-0.75, -0.85, 0, 'c', 3], [0.75, -0.85, 0, 'd', 4]])
    place(L, 'chair', 1.6 + dx, -2.4 + dz, rot, { wood: 'oak', cushion: ['#3f6f6d', '#c9973f', '#b4674a', '#8fa487'][n - 1] }, { seat: 'table1' + s, label: { de: 'Lesetisch · Stuhl ' + n, en: 'Reading table · chair ' + n }, group: 'hall', table: 'table1' });

  // the chess table stands by the window just west of the terrace door, a fig tree east of it
  const chessX = GLASS_DOOR.x0 - 0.87;
  place(L, 'sidetable', chessX, z1 - 1.5, 0, { r: 0.42, h: 0.7 }, { surface: true, id: 'chesstable' });
  place(L, 'chessboardprop', chessX, z1 - 1.5, 0.15, {}, { y: 0.7, interact: 'chess', label: { de: 'Schachtisch', en: 'Chess table' }, group: 'hall', standAt: [chessX, z1 - 2.7, 0] });
  place(L, 'chair', chessX, z1 - 0.78, Math.PI, { wood: 'oak', cushion: '#3f6f6d' }, { seat: 'chess1', label: { de: 'Schachtisch am Fenster', en: 'Chess table by the window' }, group: 'hall', table: 'chesstable' });
  place(L, 'chair', chessX, z1 - 2.22, 0, { wood: 'oak', cushion: '#3f6f6d' }, { seat: 'chess2', label: { de: 'Schachtisch (gegenüber)', en: 'Chess table (opposite)' }, group: 'hall', table: 'chesstable' });
  place(L, 'plant', GLASS_DOOR.x1 + 0.87, z1 - 0.8, 0, { kind: 'ficus', seed: 17 });

  // a cushioned bench along the glass, in two parts: from the corners up to the chess table and the fig tree
  const benchD = 0.62, benchZ = z1 - benchD / 2 - 0.02;   // its oak top ends 1 cm before the wall
  const benchIn = GLASS_DOOR.x1 + 1.72, benchOut = 7.2, benchW = benchOut - benchIn;
  place(L, 'windowbench', -(benchIn + benchOut) / 2, benchZ, 0, { w: benchW, d: benchD, cushion: '#6f8f8a', seed: 3 }, { seat: 'windowseat', label: { de: 'Fensterbank (West)', en: 'Window seat (west)' }, group: 'hall', cat: true });
  place(L, 'windowbench', (benchIn + benchOut) / 2, benchZ, 0, { w: benchW, d: benchD, cushion: '#d4a45c', seed: 7 }, { seat: 'windowseat2', label: { de: 'Fensterbank (Ost)', en: 'Window seat (east)' }, group: 'hall' });

  // --- lectern & easel flank the passage on the south wall -----------------------------------------
  place(L, 'lectern', -3.1, z0 + 0.75, 0, {}, { interact: 'wiki', label: { de: 'Lexikon (Wikipedia)', en: 'Encyclopedia (Wikipedia)' }, group: 'entrance', standAt: [-3.1, z0 + 2.0, 0] });
  place(L, 'ereader', -5.25, z0 + WALL_GAP + 0.24, 0, {}, { interact: 'browser', label: { de: 'Lesegerät (Lesebrowser)', en: 'E-reader (reading browser)' }, group: 'entrance', standAt: [-5.25, z0 + 1.75, 0] });
  // close to the wall: at z0 + 1.0 only 62 cm were left between the easel and the chairs of the reading table
  place(L, 'easel', 3.3, z0 + 0.77, 0.1, {}, { interact: 'watercolor', label: { de: 'Staffelei (Aquarell)', en: 'Easel (watercolour)' }, group: 'entrance', standAt: [3.3, z0 + 2.0, 0] });

  // --- wall lights & gallery ---------------------------------------------------------------------------
  for (const x of [-4.55, 4.55]) place(L, 'sconce', x, z0 + 0.04, 0, {}, { y: 2.8 });   // between the paintings and the passage
  place(L, 'sconce', x0 + 0.04, 3.4, Math.PI / 2, {}, { y: 3.3 });   // picture lights above the two paintings
  place(L, 'sconce', x0 + 0.04, -3.4, Math.PI / 2, {}, { y: 3.3 });
  place(L, 'sconce', x1 - 0.04, -2.0, -Math.PI / 2, {}, { y: 2.7 });  // above the computer desk
  place(L, 'sconce', x1 - 0.04, 2.0, -Math.PI / 2, {}, { y: 2.6 });   // above the return desk

  const gallery = [
    [-6.4, z0 + 0.05, 0, 1.4, 1.05, 2.45, 0],
    [6.4, z0 + 0.05, 0, 1.4, 1.05, 2.3, 1],
    [x1 - 0.05, -4.1, -Math.PI / 2, 1.1, 0.85, 3.05, 2],
    [x1 - 0.05, 3.55, -Math.PI / 2, 1.1, 0.85, 3.05, 3],
    [x0 + 0.05, 3.4, Math.PI / 2, 1.05, 1.3, 2.35, 4],
    [x0 + 0.05, -3.4, Math.PI / 2, 1.05, 1.3, 2.35, 5],
  ];
  for (const [x, z, rot, w, hh, y, slot] of gallery) place(L, 'painting', x, z, rot, { w, h: hh }, { y, slot });
  // (this place was called "Galerie" until 0.6, after the paintings on the hall's walls)
  L.places.push({ id: 'hall', label: { de: 'Mitte der Halle', en: 'Middle of the hall' }, group: 'hall', x: 0, z: z0 + 2.7, yaw: Math.PI });
  L.places.push({ id: 'fireside', label: { de: 'Kamin', en: 'Fireplace' }, group: 'hall', x: x0 + 3.9, z: 0, yaw: Math.PI / 2 });
  L.places.push({ id: 'cinema', label: { de: 'Heimkino (Leinwand)', en: 'Home cinema (screen)' }, group: 'hall', x: x0 + 7.3, z: 0.9, yaw: Math.PI / 2 - 0.08 });
  L.places.push({ id: 'window', label: { de: 'Glasfront', en: 'Glass front' }, group: 'hall', x: 2.2, z: z1 - 2.6, yaw: Math.PI + 0.25 });
}

// ---------------------------------------------------------------- audiobooks -------------------------
// An oak cabinet for audiobook boxes stands against the south wall between the easel and the music sideboard, also
// before the first audiobook folder (settings.audiobooks.folders): then its ledges are empty, and E opens the panel
// "Hörbücher", which offers to add a folder (app/src/world/audiobook-shelf.js builds it and its boxes).
export const AUDIOBOOK_CASE = { x: 4.47, w: 1.16, d: 0.3 };
function buildAudiobookCase(L) {
  const { z0 } = HALL;
  const z = z0 + WALL_GAP + AUDIOBOOK_CASE.d / 2;
  place(L, 'audiobooks', AUDIOBOOK_CASE.x, z, 0, {}, { interact: 'audiobooks', label: { de: 'Hörbücher', en: 'Audiobooks' }, group: 'hall', standAt: [AUDIOBOOK_CASE.x, z0 + 1.75, 0] });
  // in the places menu (G): far enough in front of the cabinet to see all of it
  L.places.push({ id: 'audiobooks', label: { de: 'Hörbücher', en: 'Audiobooks' }, group: 'hall', x: AUDIOBOOK_CASE.x, z: z0 + 2.45, yaw: 0 });
}

// ---------------------------------------------------------------- the passage ----------------------
// The two side walls run through both wall openings and line them, the ceiling only spans the free part
// between the walls: nothing is coplanar any more (the old ceiling lay on the lintels and z-fought with the
// casing, and the side walls stuck 35 cm out into the book room).
function buildPassage(L) {
  const { x, w, h, z0, z1 } = PASSAGE;
  const t = HALL.wall;
  const half = w / 2;
  L.floors.push({ x, z: (z0 + z1) / 2, w, d: z1 - z0, mat: 'floor2' });
  L.ceilings.push({ x, z: (z0 + z1) / 2, w, d: (z1 - z0) - 2 * t, y: h, mat: 'ceiling' });
  wallZ(L, x - half - t / 2, z0, z1, h, t, []);
  wallZ(L, x + half + t / 2, z0, z1, h, t, []);
  place(L, 'rug', x, (z0 + z1) / 2, 0, { w: w - 1.0, d: (z1 - z0) - 0.5, seed: 41, palette: ['#b8664a', '#3f6f6d', '#efe9df', '#a39d92'], style: 'modern' });
  // a small gallery: one picture on the west wall with a light above it, a wall light opposite
  place(L, 'painting', x - half + 0.05, (z0 + z1) / 2, Math.PI / 2, { w: 1.3, h: 0.95 }, { y: 1.65, slot: 6 });
  place(L, 'sconce', x - half + 0.04, (z0 + z1) / 2, Math.PI / 2, {}, { y: 2.55, glow: 0.22 });
  place(L, 'sconce', x + half - 0.04, (z0 + z1) / 2, -Math.PI / 2, {}, { y: 2.35 });
  place(L, 'pendant', x, (z0 + z1) / 2, 0, { r: 0.32, h: 0.26, drop: h - 2.55 - 0.13 }, { y: 2.55 });
}

// ---------------------------------------------------------------- the terrace ------------------------
// Through the glass doors onto a wooden deck at floor level with two loungers, and on into the garden: the lawn, the
// meadow, the knoll and the shore of the lake with the jetty (outdoor.js: the walkable area and its natural limits).
// The deck, the string lights and the lanterns are drawn by garden.js from these numbers; the furniture on the deck
// and the benches outside are placed here.
export const FACADE_Z = HALL.z1 + HALL.wall;
export const TERRACE = {
  deck: { x0: -8.8, x1: 8.8, z0: FACADE_Z, z1: 9.7 },
  area: { x0: -11, x1: 11, z1: 14.2 },                 // the deck and the lawn in front of it (you may walk much further: outdoor.js REGION)
  posts: [-8.4, -4.2, 4.2, 8.4], postZ: 9.62,          // string light posts along the front edge of the deck
  lanterns: [[-2.2, 6.2], [2.2, 6.2], [-4.2, 9.12], [4.2, 9.12]],
  planters: [-7.8, -5.4, 5.4, 7.8], planterZ: 9.26,
};
function buildTerrace(L) {
  const T = TERRACE;
  L.outdoor = T;
  for (const [s, id] of [[-1, 'lounger1'], [1, 'lounger2']]) {
    place(L, 'lounger', s * 3.5, 7.75, -s * 0.2, { seed: id === 'lounger1' ? 1 : 2 }, { seat: id, label: s < 0 ? { de: 'Liegestuhl auf der Terrasse (West)', en: 'Lounger on the terrace (west)' } : { de: 'Liegestuhl auf der Terrasse (Ost)', en: 'Lounger on the terrace (east)' }, group: 'terrace' });
    place(L, 'sidetable', s * 4.62, 7.15, 0, { r: 0.25, h: 0.46, wood: 'ash' }, { surface: true, id: 'terrace-table-' + (s < 0 ? 'w' : 'e') });
  }
  for (const x of T.planters) place(L, 'planter', x, T.planterZ, 0, { w: 1.6, seed: Math.round(x * 10) });
  // posts and lanterns are drawn by garden.js; they still block the way
  for (const x of T.posts) L.colliders.push({ min: [x - 0.08, 0, T.postZ - 0.08], max: [x + 0.08, 2.8, T.postZ + 0.08] });
  for (const [x, z] of T.lanterns) L.colliders.push({ min: [x - 0.14, 0, z - 0.14], max: [x + 0.14, 0.4, z + 0.14] });
  // (where you can walk outside is outdoor.js REGION: player.js keeps you inside it, no colliders here)
  L.places.push({ id: 'terrace', label: { de: 'Terrasse', en: 'Terrace' }, group: 'hall', x: 0.6, z: 8.7, yaw: Math.PI + 0.15 });
  // the benches outside: on the jetty's platform and on the knoll (outdoor.js BENCHES)
  for (const b of BENCHES) place(L, 'parkbench', b.x, b.z, b.rot, { seed: b.id.length }, { y: b.y, seat: b.id, label: b.label, group: 'garden' });
  const jp = JETTY.at(JETTY.len - JETTY.platLen - 1.4, 0);
  L.places.push({ id: 'jetty', label: { de: 'Steg am See', en: 'Jetty on the lake' }, group: 'garden', x: jp[0], z: jp[1], yaw: Math.atan2(-JETTY.dir[0], -JETTY.dir[1]) });
  // the feeding station on the meadow and the hide facing it (outdoor.js FEEDER, feeder.js); the place in the Orte menu
  // stands in front of the hide, looking at the rack
  const FD = FEEDER, FH = FEEDER.hide;
  place(L, 'feeder', FD.x, FD.z, FD.rot, {}, { y: FD.y });
  place(L, 'feederhide', FH.x, FH.z, FH.rot, {}, { y: FH.y, seat: 'feederhide', label: { de: 'Bank im Beobachtungsstand', en: 'Bench in the wildlife hide' }, group: 'garden' });
  L.places.push({ id: 'feeder', label: { de: 'Futterstelle', en: 'Feeding station' }, group: 'garden', x: FD.view.x, z: FD.view.z, yaw: FD.view.yaw });
  // the fire bowl on the lawn west of the path, log stumps round it to sit on (outdoor.js FIREBOWL, firebowl.js)
  place(L, 'firebowl', FIREBOWL.x, FIREBOWL.z, 0, {}, { y: FIREBOWL.y, interact: 'firebowl', label: { de: 'Feuerschale', en: 'Fire bowl' }, group: 'garden' });
  for (const s of FIREBOWL.seats) place(L, 'stump', s.x, s.z, s.rot, { seed: s.seed }, { y: s.y, seat: s.id, label: s.label, group: 'garden' });
  L.places.push({ id: 'firebowl', label: { de: 'Feuerschale', en: 'Fire bowl' }, group: 'garden', x: FIREBOWL.view.x, z: FIREBOWL.view.z, yaw: FIREBOWL.view.yaw });
}

// ---------------------------------------------------------------- the book room --------------------
// All departments stand in the room at once, along the walls in reading order: every department starts on a new
// case, every shelf (sub folder) on a new row, the rows are filled from the top shelf down. Only as many cases as
// the books need; the free wall carries pictures, plants and reading nooks. A department sign hangs above each
// run of cases, a directory board in the passage lists where each department stands. A library that does not fit
// into the room (some 3000 books and more) shows one department at a time again, chosen with the wheel.
const WALL_OFF = BOOKCASE.d / 2 + 0.03;          // case centre ↔ wall face
const ROW_W = BOOKCASE.innerW - 0.06;            // usable width of a row
const BOOK_GAP = 0.004;
const ROWS_PER_CASE = SHELF_LEVELS.length;
const TOP_DOWN = SHELF_LEVELS.map((_, i) => i).reverse();   // level indices, the top shelf first
const MIN_ROW_BOOKS = 3;                         // a shelf is spread over one more row only when every row keeps this many books
export const SIGN_Y = 2.78, SIGN_H = 0.3;        // department signs on the wall above the cases (the cases end at 2.36 m)
// The back wall left of the window belongs to the world map (the worldmap placement below): no cases, signs or
// pictures there. Its frame hangs from 0.83 m, below the chair rail: the panelling stops at the frame.
export const MAP_ZONE = { x0: -8.6, x1: -3.6 };
export const MAP_FRAME = { x0: -7.95, x1: -4.25, y0: 0.83, y1: 3.07 };

/**
 * The wall slots of the room as runs in reading order, left to right as you face each wall, starting left of the
 * entrance: the west wall front → back, the back wall west of the map (a spare slot, used only when needed), the back
 * wall east of the window, the east wall back → front, the front wall from the east corner to the passage and from
 * the passage to the west corner. The case right of the passage is the "recently read" case; with `withRead` the one
 * left of it is the case "Gelesen" (the front wall west of the passage then starts one slot further out).
 */
function roomSlots(withRead = false) {
  const { x0, x1, z0, z1 } = ROOM;
  const d = WALL_OFF;
  const side = [];
  for (let z = z1 - 1.0 - BOOKCASE.w / 2; z >= z0 + 1.0 + BOOKCASE.w / 2 - 1e-6; z -= SLOT_SPACING) {
    if (Math.abs(z - SIDE_WIN.z) < SIDE_WIN.w / 2 + BOOKCASE.w / 2 - 0.05) continue;   // the side windows
    side.push(+z.toFixed(4));
  }
  const nBack = Math.floor((x1 - x0 - 1.0) / SLOT_SPACING);
  const startX = -((nBack - 1) * SLOT_SPACING) / 2;
  const back = Array.from({ length: nBack }, (_, i) => +(startX + i * SLOT_SPACING).toFixed(4));
  const half = BOOKCASE.w / 2 + 0.03;                                           // with the stiles
  const clearWin = (x) => Math.abs(x) >= BACK_WIN.w / 2 + BOOKCASE.w / 2 + 0.1;
  const clearMap = (x) => x + half <= MAP_ZONE.x0 || x - half >= MAP_ZONE.x1;
  const front = [];
  for (let x = PASSAGE.w / 2 + CASING_W + BOOKCASE.w / 2 + 0.08; x <= x1 - 0.7 + 1e-6; x += SLOT_SPACING) front.push(+x.toFixed(4));
  const mk = (key, x, z, rot, wall) => ({ key, x, z, rot, wall });
  const segments = [
    { id: 'W', wall: 'left', slots: side.map((z, i) => mk('W' + i, x0 + d, z, Math.PI / 2, 'left')) },
    { id: 'BW', wall: 'back', spare: true, slots: back.filter((x) => x < 0 && clearWin(x) && clearMap(x)).map((x, i) => mk('BW' + i, x, z0 + d, 0, 'back')) },
    { id: 'BE', wall: 'back', slots: back.filter((x) => x > 0 && clearWin(x)).map((x, i) => mk('BE' + i, x, z0 + d, 0, 'back')) },
    { id: 'E', wall: 'right', slots: [...side].reverse().map((z, i) => mk('E' + i, x1 - d, z, -Math.PI / 2, 'right')) },
    { id: 'FE', wall: 'front', slots: front.slice(1).reverse().map((x, i) => mk('FE' + i, x, z1 - d, Math.PI, 'front')) },
    { id: 'FW', wall: 'front', slots: front.slice(withRead ? 1 : 0).map((x, i) => mk('FW' + i, -x, z1 - d, Math.PI, 'front')) },
  ];
  return { segments, recent: mk('recent', front[0], z1 - d, Math.PI, 'front'), read: withRead ? mk('read', -front[0], z1 - d, Math.PI, 'front') : null };
}

// --- packing -------------------------------------------------------------------------------------------------
const rowWidth = (ids, booksById) => ids.reduce((a, id) => a + spineWidth(booksById[id] || {}) + BOOK_GAP, 0);
/** Books into full rows, in order. */
function packFull(ids, booksById) {
  const rows = []; let row = [], w = 0;
  for (const id of ids) {
    const sw = spineWidth(booksById[id] || {}) + BOOK_GAP;
    if (row.length && w + sw > ROW_W) { rows.push(row); row = []; w = 0; }
    row.push(id); w += sw;
  }
  if (row.length) rows.push(row);
  return rows;
}
/** Books into exactly k rows of about the same width (null when that does not fit). */
function packInto(ids, booksById, k) {
  const rows = []; let i = 0, rest = rowWidth(ids, booksById);
  for (let r = 0; r < k; r++) {
    const target = rest / (k - r); const row = []; let w = 0;
    while (i < ids.length) {
      const sw = spineWidth(booksById[ids[i]] || {}) + BOOK_GAP;
      if (row.length && (w + sw > ROW_W || (r < k - 1 && w + sw / 2 > target))) break;
      row.push(ids[i++]); w += sw;
    }
    rest -= w; rows.push(row);
  }
  return i === ids.length && rows.every((r) => r.length) ? rows : null;
}
/**
 * The rows of one department: every shelf starts on a new row; the rows its cases would leave empty go to the shelves
 * with the fullest rows (a shelf spread over three rows looks better than one full row and two empty ones).
 */
function planDepartment(dep, booksById) {
  const shelves = (dep.shelves || []).map((s) => {
    const ids = (s.bookIds || []).filter((id) => booksById[id]);
    // the rows are counted in the shelf's title order (shelf-arrange.js `canonical`): another sort order then keeps the
    // cases where they are, only the books move
    const sorted = !!s.canonical && s.canonical !== s.bookIds;
    const canon = sorted ? s.canonical.filter((id) => booksById[id]) : ids;
    return { name: s.name, neutral: !!s.neutral, ids, width: rowWidth(ids, booksById), rows: packFull(canon, booksById), sorted };
  }).filter((s) => s.ids.length);
  const minRows = shelves.reduce((a, s) => a + s.rows.length, 0);
  let spare = Math.max(1, Math.ceil(minRows / ROWS_PER_CASE)) * ROWS_PER_CASE - minRows;
  const count = shelves.map((s) => s.rows.length);
  while (spare > 0) {
    let best = -1, bestW = 0;
    shelves.forEach((s, i) => {
      const k = count[i] + 1, perRow = s.width / k;
      if (s.ids.length / k >= MIN_ROW_BOOKS && perRow > bestW) { best = i; bestW = perRow; }
    });
    if (best < 0) break;
    count[best]++; spare--;
  }
  const rows = [];
  shelves.forEach((s, i) => {
    // a shelf over several rows gets rows of about the same length (not 28 books and then 2); in another order than the
    // title the same number of rows
    const parts = count[i] > 1 || s.sorted ? (packInto(s.ids, booksById, count[i]) || (s.sorted ? packFull(s.ids, booksById) : s.rows)) : s.rows;
    parts.forEach((ids, k) => rows.push({ shelf: s, first: k === 0, ids }));
  });
  return { dep, rows, cases: Math.max(1, Math.ceil(rows.length / ROWS_PER_CASE)) };
}
/**
 * Cases to wall slots in reading order, the departments in their own order, each on consecutive slots. Among all
 * ways to do that the cheapest wins: a run that turns a corner costs a little, one that jumps over the world map
 * or the passage costs a lot, a slot left free between departments (a picture) costs little, the lone slot left of
 * the world map a bit. null: the departments do not fit.
 */
const CROSS = { 'W|BW': 1, 'BW|BE': 5, 'W|BE': 5, 'BE|E': 1.5, 'E|FE': 1, 'FE|FW': 5 };
const SKIP_COST = 0.3, SPARE_COST = 0.5;
function allocate(plans, segments) {
  const flat = [];
  for (const s of segments) for (const sl of s.slots) flat.push({ ...sl, seg: s.id, spare: !!s.spare });
  const N = flat.length, D = plans.length;
  if (plans.reduce((a, p) => a + p.cases, 0) > N) return null;
  const cross = (k) => (flat[k].seg === flat[k - 1].seg ? 0 : CROSS[flat[k - 1].seg + '|' + flat[k].seg] ?? 5);
  // prefix sums: crossings between k-1 and k, used spare slots
  const cx = [0], sp = [0];
  for (let k = 0; k < N; k++) { cx.push(cx[k] + (k > 0 ? cross(k) : 0)); sp.push(sp[k] + (flat[k].spare ? SPARE_COST : 0)); }
  const runCost = (s, n) => (cx[s + n] - cx[s + 1]) + (sp[s + n] - sp[s]);
  const memo = new Map();
  const solve = (d, i) => {
    if (d === D) return { cost: 0 };
    const key = d * (N + 1) + i;
    if (memo.has(key)) return memo.get(key);
    const n = plans[d].cases;
    let best = null;
    for (let s = i; s + n <= N; s++) {
      const rest = solve(d + 1, s + n);
      if (!rest) continue;
      const c = (s - i) * SKIP_COST + runCost(s, n) + rest.cost;
      if (!best || c < best.cost - 1e-9) best = { cost: c, start: s };
    }
    memo.set(key, best);
    return best;
  };
  if (!solve(0, 0)) return null;
  const out = [];
  for (let d = 0, i = 0; d < D; d++) {
    const { start } = solve(d, i);
    out.push({ plan: plans[d], slots: flat.slice(start, start + plans[d].cases) });
    i = start + plans[d].cases;
  }
  return out;
}

const WALL_NAME = {
  left: { de: 'linke Wand', en: 'left wall' }, back: { de: 'Rückwand', en: 'back wall' },
  right: { de: 'rechte Wand', en: 'right wall' }, front: { de: 'Eingangswand', en: 'entrance wall' },
};

function buildBookRoom(L, departments, booksById, opts) {
  const { x0, x1, z0, z1, h } = ROOM;
  const t = HALL.wall;
  const w = x1 - x0, d = z1 - z0, cx = 0, cz = (z0 + z1) / 2;

  L.floors.push({ x: cx, z: cz, w, d, mat: 'floor' });
  L.ceilings.push({ x: cx, z: cz, w, d, y: h, mat: 'ceiling' });

  // --- walls: a wide steel window in the back wall, one in each side wall -----------------------------
  const backWin = addWindow(L, { x: 0, z: z0, w: BACK_WIN.w, h: BACK_WIN.h, y0: BACK_WIN.y0, rot: 0, dir: [0, 0, -1], bays: 3, transom: 2.1 });
  wallX(L, z0 - t / 2, x0 - t, x1 + t, h, t, [backWin]);
  wallX(L, z1 + t / 2, x0 - t, x1 + t, h, t, [{ c: PASSAGE.x, w: PASSAGE.w + 2 * t, h: PASSAGE.h, y0: 0 }]);
  L.openings.push({ kind: 'arch', x: PASSAGE.x, z: z1, w: PASSAGE.w, h: PASSAGE.h, thick: t, dir: -1 });
  const leftWin = addWindow(L, { x: x0, z: SIDE_WIN.z, w: SIDE_WIN.w, h: SIDE_WIN.h, y0: SIDE_WIN.y0, rot: Math.PI / 2, dir: [-1, 0, 0], transom: 2.0 });
  const rightWin = addWindow(L, { x: x1, z: SIDE_WIN.z, w: SIDE_WIN.w, h: SIDE_WIN.h, y0: SIDE_WIN.y0, rot: -Math.PI / 2, dir: [1, 0, 0], transom: 2.0 });
  wallZ(L, x0 - t / 2, z0 - t, z1 + t, h, t, [leftWin]);
  wallZ(L, x1 + t / 2, z0 - t, z1 + t, h, t, [rightWin]);

  // --- which books stand where ---------------------------------------------------------------------------
  // what the cases show (shelf-arrange.js): the books read on the case "Gelesen", one copy of a book that exists twice,
  // the chosen order inside every shelf. A department whose books all stand elsewhere gets no case.
  const arr = arrangeFor(departments, booksById, opts.shelves);
  const { segments, recent: recentSlot, read: readSlot } = roomSlots(arr.options.finishedShelf);
  Object.assign(L, { arrangeKey: arr.key, hidden: arr.hidden, shownAs: arr.shownAs, noPicks: arr.noPicks, finished: arr.finished, shelfOptions: arr.options });
  const onRead = new Set(arr.finished);
  const deps = arr.departments.filter((dp) => dp.count > 0 && dp.shelves.some((s) => s.bookIds.length));
  const recent = (opts.recent || []).filter((id) => booksById[id] && !arr.hidden.has(id) && !onRead.has(id)).slice(0, 27);
  // A book on the "recently read" case is not on its department shelf at the same time (the same volume would exist
  // twice). The rows are planned with it, so reading a book never moves the cases around.
  const onRecent = new Set(recent);
  let plans = deps.map((dp) => planDepartment(dp, booksById));
  let alloc = allocate(plans, segments);
  L.allDepartments = !!alloc;
  if (!alloc) {
    // too many books for the walls: one department at a time, as it used to be
    const pick = deps.find((dp) => dp.name === opts.department) || deps.slice().sort((a, b) => b.count - a.count)[0];
    plans = pick ? [planDepartment(pick, booksById)] : [];
    const capacity = segments.reduce((a, s) => a + s.slots.length, 0);
    if (plans[0] && plans[0].cases > capacity) { plans[0].rows = plans[0].rows.slice(0, capacity * ROWS_PER_CASE); plans[0].cases = capacity; }   // room full
    alloc = allocate(plans, segments) || [];
  }
  L.department = L.allDepartments
    ? (deps.some((dp) => dp.name === opts.department) ? opts.department : deps[0]?.name || null)
    : (plans[0]?.dep.name || null);

  const cases = [];
  const makeCase = (slot, dep) => {
    const bc = { id: 'room:' + slot.key, x: slot.x, z: slot.z, rot: slot.rot, wall: slot.wall, wood: 'oak', dep: dep ? { id: dep.id, name: dep.name, nameEn: dep.nameEn || dep.name } : null, rows: SHELF_LEVELS.map((y, li) => ({ level: li, y, items: [] })), display: [] };
    cases.push(bc); return bc;
  };
  const fillRow = (row, ids) => {
    let x = 0;
    for (const id of ids) {
      if (onRecent.has(id)) continue;
      const sw = spineWidth(booksById[id] || {});
      row.items.push({ id, x, w: sw });
      x += sw + BOOK_GAP;
    }
  };
  L.departmentRuns = [];
  for (const { plan, slots } of alloc) {
    const cs = slots.map((sl) => makeCase(sl, plan.dep));
    plan.rows.forEach((r, i) => {
      const bc = cs[Math.floor(i / ROWS_PER_CASE)]; if (!bc) return;
      const row = bc.rows[TOP_DOWN[i % ROWS_PER_CASE]];
      fillRow(row, r.ids);
      // the shelf's name where it starts, and again where it continues in the next case
      if (!r.shelf.neutral && (r.first || i % ROWS_PER_CASE === 0)) row.section = r.shelf.name;
    });
    // the parts of the run on each wall (a department that turns a corner gets a sign on both walls)
    const parts = [];
    for (const sl of slots) { const last = parts[parts.length - 1]; if (last && last.seg === sl.seg) last.slots.push(sl); else parts.push({ seg: sl.seg, wall: sl.wall, slots: [sl] }); }
    L.departmentRuns.push({ id: plan.dep.id, name: plan.dep.name, nameEn: plan.dep.nameEn || plan.dep.name, cases: cs.map((c) => c.id), first: { x: slots[0].x, z: slots[0].z, rot: slots[0].rot }, walls: [...new Set(parts.map((p) => p.wall))], parts });
  }
  // a library without books: a few empty cases wait on the left wall, with a sign and a card (empty-library.js)
  if (!deps.length) addWaitingRun(L, segments, makeCase);

  // face-out copies on the sloped board of every case: must-read books first (shortcuts in "00 Must-Read"), then a
  // deterministic pick of the case's own stock. Only books with a cover image, never a generated title card.
  const hasCover = (id) => hasCoverImage(booksById[id]);
  for (const bc of cases) {
    const own = bc.rows.flatMap((r) => r.items.map((it) => it.id)).filter(hasCover);
    if (!own.length) continue;
    const rnd = seeded(hashStr(bc.id + (bc.dep?.id || '')));
    const must = own.filter((id) => booksById[id]?.mustRead).sort((a, b) => hashStr(a + bc.id) - hashStr(b + bc.id));
    const picks = must.slice(0, 2);
    for (let k = 0; k < 8 && picks.length < 2; k++) {
      const id = own[Math.floor(rnd() * own.length)];
      if (id && !picks.includes(id)) picks.push(id);
    }
    bc.display = picks;
  }

  // --- the "recently read" case, right of the passage ------------------------------------------------------
  const rc = { id: RECENT_SHELF, x: recentSlot.x, z: recentSlot.z, rot: recentSlot.rot, wall: 'front', wood: 'ash', recent: true, rows: SHELF_LEVELS.map((y, l) => ({ level: l, y, items: [] })), display: [] };
  {
    const ids = [...recent];
    for (const level of TOP_DOWN) {
      if (!ids.length) break;
      const row = rc.rows[level];
      let width = 0;
      while (ids.length) {
        const sw = spineWidth(booksById[ids[0]] || {});
        if (width + sw > ROW_W && row.items.length) break;
        row.items.push({ id: ids[0], x: width, w: sw });
        width += sw + BOOK_GAP; ids.shift();
      }
    }
    rc.display = recent.filter(hasCover).slice(0, 2);
  }
  cases.push(rc);
  // --- the case "Gelesen", left of the passage: the books read, newest first from the top shelf down -------------------
  // Walnut instead of oak. On its sloped board lie the two read last (with a cover), like the recommendations of a
  // department's case. (Its card and its plaque of 0.7 are gone: the reading goal and the streak are in the statistics.)
  let rd = null;
  if (readSlot) {
    rd = { id: READ_SHELF, x: readSlot.x, z: readSlot.z, rot: readSlot.rot, wall: 'front', wood: 'walnut', read: true, rows: SHELF_LEVELS.map((y, l) => ({ level: l, y, items: [] })), display: [] };
    packFull(arr.finished, booksById).slice(0, ROWS_PER_CASE).forEach((ids, i) => {
      const row = rd.rows[TOP_DOWN[i]];
      let x = 0;
      for (const id of ids) { const sw = spineWidth(booksById[id] || {}); row.items.push({ id, x, w: sw }); x += sw + BOOK_GAP; }
    });
    rd.display = arr.finished.filter(hasCover).slice(0, 2);
    cases.push(rd);
  }
  for (const bc of cases) {
    L.bookcases.push(bc);
    L.placements.push({ kind: 'bookcase', x: bc.x, z: bc.z, rot: bc.rot, opts: { wood: bc.wood }, meta: { bookcase: bc.id } });
  }

  // --- signs: one above each part of a department's run, one above the recently-read case ------------------
  const fwd = (rot) => [Math.sin(rot), Math.cos(rot)];
  const onWall = (x, z, rot) => { const [fx, fz] = fwd(rot); return { x: x - fx * (WALL_OFF - 0.018), z: z - fz * (WALL_OFF - 0.018) }; };
  L.signs = [];
  for (const run of L.departmentRuns) {
    for (const part of run.parts) {
      const a = part.slots[0], b = part.slots[part.slots.length - 1];
      const p = onWall((a.x + b.x) / 2, (a.z + b.z) / 2, a.rot);
      L.signs.push({ kind: 'department', dep: run.id, text: { de: run.name, en: run.nameEn }, x: p.x, y: SIGN_Y, z: p.z, rot: a.rot, maxW: part.slots.length * SLOT_SPACING - 0.16, h: SIGN_H });
    }
  }
  { const p = onWall(rc.x, rc.z, rc.rot); L.signs.push({ kind: 'recent', text: { de: 'Zuletzt gelesen', en: 'Recently read' }, x: p.x, y: SIGN_Y, z: p.z, rot: rc.rot, maxW: SLOT_SPACING - 0.16, h: SIGN_H }); }
  if (rd) { const p = onWall(rd.x, rd.z, rd.rot); L.signs.push({ kind: 'read', text: { de: 'Gelesen', en: 'Read' }, x: p.x, y: SIGN_Y, z: p.z, rot: rd.rot, maxW: SLOT_SPACING - 0.16, h: SIGN_H }); }

  // --- directory board in the passage, on its east wall: which department stands on which wall ---------------
  L.directory = {
    x: PASSAGE.x + PASSAGE.w / 2 - 0.02, y: 1.48, z: (PASSAGE.z0 + PASSAGE.z1) / 2, rot: -Math.PI / 2, w: 1.8, h: 1.2,
    all: L.allDepartments,
    // one department at a time: all of them are listed, the one in the room with its walls
    entries: L.allDepartments
      ? L.departmentRuns.map((r, i) => ({ n: i + 1, id: r.id, name: { de: r.name, en: r.nameEn }, walls: r.walls }))
      : deps.map((dp, i) => ({ n: i + 1, id: dp.id, name: { de: dp.name, en: dp.nameEn || dp.name }, walls: L.departmentRuns.find((r) => r.id === dp.id)?.walls || [] })),
    recentWall: 'front',
    readWall: rd ? 'front' : null,
  };

  // --- the panelling only shows where no case stands (behind a case it used to run through the carcass) --------
  const used = new Set(cases.map((bc) => bc.x.toFixed(3) + ':' + bc.z.toFixed(3)));
  const allSlots = [...segments.flatMap((s) => s.slots), recentSlot, ...(readSlot ? [readSlot] : [])];
  const usedSlots = allSlots.filter((sl) => used.has(sl.x.toFixed(3) + ':' + sl.z.toFixed(3)));
  const spans = (wall, along) => usedSlots.filter((sl) => sl.wall === wall).map((sl) => ({ c: sl[along], w: BOOKCASE.w + 0.08, y0: 0, margin: 0 }));
  // the world map hangs lower than the chair rail: panel and rail stop 2 cm short of its frame, the skirting runs on
  // beneath it
  const mapGap = { c: (MAP_FRAME.x0 + MAP_FRAME.x1) / 2, w: MAP_FRAME.x1 - MAP_FRAME.x0, y0: MAP_FRAME.y0, margin: 0.02 };
  wainscot(L, 'x', z0, 1, x0, x1, h, [backWin, mapGap, ...spans('back', 'x')]);
  L.trim.push({ axis: 'x', at: z0, dir: 1, mid: mapGap.c, len: mapGap.w + 2 * mapGap.margin, ceilingH: h, skirtOnly: true });
  wainscot(L, 'x', z1, -1, x0, x1, h, [{ c: PASSAGE.x, w: PASSAGE.w + 2 * CASING_W, y0: 0, margin: 0 }, ...spans('front', 'x')]);
  // a case at the end of the front wall stands in the corner: the side wall's panelling stops at it
  const corner = (sgn) => usedSlots.filter((sl) => sl.wall === 'front' && Math.sign(sl.x) === sgn && Math.abs(sgn * (sgn > 0 ? x1 : x0) - sgn * sl.x) < BOOKCASE.w / 2 + 0.35).map((sl) => ({ c: sl.z, w: 1.6, y0: 0, margin: 0 }));
  wainscot(L, 'z', x0, 1, z0, z1, h, [leftWin, ...spans('left', 'z'), ...corner(-1)]);
  wainscot(L, 'z', x1, -1, z0, z1, h, [rightWin, ...spans('right', 'z'), ...corner(1)]);

  // --- the free wall: pictures, plants and reading nooks ---------------------------------------------------------
  let paintingSlot = 7;
  const painting = (x, z, rot, pw, ph, y) => place(L, 'painting', x, z, rot, { w: pw, h: ph }, { y, slot: paintingSlot++ });
  // on the side walls between the window and the back corner
  painting(x0 + 0.05, -22.05, Math.PI / 2, 0.9, 1.15, 1.72);
  painting(x1 - 0.05, -22.05, -Math.PI / 2, 0.9, 1.15, 1.72);
  place(L, 'plant', -3.02, z0 + 0.66, 0, { kind: 'ficus', seed: 33 });    // between the window and the world map
  let nook = 0;
  for (const seg of segments) {
    const runs = [];
    for (const sl of seg.slots) {
      const free = !used.has(sl.x.toFixed(3) + ':' + sl.z.toFixed(3));
      const last = runs[runs.length - 1];
      if (free && last && last.open) last.slots.push(sl);
      else if (free) runs.push({ slots: [sl], open: true });
      else if (last) last.open = false;
    }
    for (const r of runs) {
      const n = r.slots.length, a = r.slots[0], b = r.slots[n - 1], rot = a.rot;
      const [fx, fz] = fwd(rot);
      const mid = onWall((a.x + b.x) / 2, (a.z + b.z) / 2, rot);
      const along = [fz, -fx];                                                 // along the wall
      const at = (s, off = 0.05) => ({ x: mid.x + along[0] * s + fx * off, z: mid.z + along[1] * s + fz * off });
      if (n === 1) { const p = at(0); painting(p.x, p.z, rot, 0.85, 1.12, 1.72); continue; }
      if (n === 2) { const p = at(0); painting(p.x, p.z, rot, 1.6, 1.05, 1.74); continue; }
      // three and more free slots: a reading nook with an armchair, a lamp on a side table, a picture and a plant
      const p = at(0); painting(p.x, p.z, rot, 1.5, 1.0, 1.98);
      const chair = at(-0.1, 0.62), table = at(0.72, 0.4), green = at(-1.15, 0.64);
      place(L, 'armchair', chair.x, chair.z, rot, { color: ['#3f6f6d', '#c9973f', '#b4674a'][nook % 3], material: 'fabric', seed: 40 + nook }, { seat: 'nook' + nook, label: { de: 'Lesesessel im Bücherzimmer', en: 'Reading armchair in the book room' }, group: 'rooms' });
      place(L, 'sidetable', table.x, table.z, 0, { r: 0.24, h: 0.56 }, { surface: true });
      place(L, 'tablelamp', table.x, table.z, 0, {}, { y: 0.56 });
      place(L, 'plant', green.x, green.z, 0, { kind: 'ficus', seed: 50 + nook });
      if (n >= 5) for (const s of [-1, 1]) { const q = at(s * (n * SLOT_SPACING / 2 - 0.75)); painting(q.x, q.z, rot, 0.8, 1.05, 1.72); }
      nook++;
    }
  }

  // --- ceiling & light -------------------------------------------------------------------------------
  for (const z of [-11.5, -16.4, -21.3]) L.placements.push({ kind: 'beam', x: cx, z, rot: 0, opts: { len: w + t * 2, w: 0.26, h: 0.34 }, meta: { y: h - 0.19 } });
  for (const z of [-11.9, -21.1]) place(L, 'pendant', cx, z, 0, { r: 0.62, h: 0.44, drop: h - 3.4 - 0.22 }, { y: 3.4 });
  place(L, 'pendant', cx, -16.6, 0, { r: 0.5, h: 0.36, drop: h - 2.8 - 0.18 }, { y: 2.8 });   // over the reading table
  for (const z of [-11.4, -15.4, -22.6]) { place(L, 'sconce', x0 + 0.05, z, Math.PI / 2, { glow: 0.42 }, { y: 4.0 }); place(L, 'sconce', x1 - 0.05, z, -Math.PI / 2, { glow: 0.42 }, { y: 4.0 }); }

  // --- furniture on the middle line: the walls stay free for browsing -------------------------------------------
  place(L, 'displaytable', 0, -12.1, 0, { w: 1.8, d: 0.95 }, { surface: true, id: 'displaytable' });
  // one big rug under the reading table, a smaller one in the reading corner; they do not overlap
  place(L, 'rug', 0, -16.4, 0, { w: 11.0, d: 7.2, seed: 63, palette: ['#c98b5a', '#e6d8bb', '#5d7a74', '#a9bdb3'], style: 'modern' });
  place(L, 'table', 0, -16.6, 0, { w: 2.6, d: 1.2, wood: 'oak' }, { surface: true, id: 'roomtable' });
  for (const dx of [-0.75, 0.75]) place(L, 'bankerlamp', dx, -16.6, 0, {}, { y: 0.76 });
  for (const [dx, dz, rot, s, n] of [[-0.78, 0.88, Math.PI, 'a', 1], [0.78, 0.88, Math.PI, 'b', 2], [-0.78, -0.88, 0, 'c', 3], [0.78, -0.88, 0, 'd', 4]])
    place(L, 'chair', dx, -16.6 + dz, rot, { wood: 'oak', cushion: ['#b4674a', '#3f6f6d', '#c9973f', '#8fa487'][n - 1] }, { seat: 'room' + s, label: { de: 'Lesetisch im Bücherzimmer · Stuhl ' + n, en: 'Reading table · chair ' + n }, group: 'rooms', table: 'roomtable' });

  // reading corner in front of the big window: two armchairs, a lamp on a small table between them
  place(L, 'rug', 0, -21.45, 0, { w: 4.4, d: 2.4, seed: 71, palette: ['#3f6f6d', '#c98b77', '#efe9de', '#a39d92'], style: 'modern' });
  place(L, 'armchair', -1.9, -21.3, 0.32, { color: '#c9973f', material: 'fabric', seed: 11 }, { seat: 'roomchair1', label: { de: 'Sessel am Fenster', en: 'Armchair by the window' }, group: 'rooms', cat: true });
  place(L, 'armchair', 1.9, -21.3, -0.32, { color: '#3f6f6d', material: 'fabric', seed: 9 }, { seat: 'roomchair2', label: { de: 'Sessel am Fenster (rechts)', en: 'Armchair by the window (right)' }, group: 'rooms' });
  place(L, 'sidetable', 0, -21.85, 0, { r: 0.3, h: 0.58 }, { surface: true, id: 'roomside' });
  place(L, 'tablelamp', 0, -21.85, 0, {}, { y: 0.58 });

  // the world map on the back wall, left of the window (app/src/world/worldmap: the 'worldmap' kind). A wall map is
  // looked at from a few steps away: E and the click reach it from 6 m (world-actions.js #lookFar), not only from the
  // 3.2 m of everything else
  place(L, 'worldmap', -6.1, ROOM.z0 + 0.06, 0, { w: 3.6, h: 2.1 }, { y: 1.95, interact: 'worldmap', label: { de: 'Weltkarte', en: 'World map' }, group: 'rooms', standAt: [-6.1, ROOM.z0 + 2.4, 0], reach: 6 });
  // in the places menu (G): in front of the map, facing it, its middle under the crosshair
  L.places.push({ id: 'worldmap', label: { de: 'Weltkarte', en: 'World map' }, group: 'rooms', x: -6.1, z: ROOM.z0 + 2.4, yaw: 0 });

  L.places.push({ id: 'books', label: { de: 'Bücherzimmer', en: 'Book room' }, group: 'rooms', x: 0, z: z1 - 1.8, yaw: Math.PI });
  L.places.push({ id: 'reading', label: { de: 'Lesetisch (Bücherzimmer)', en: 'Reading table (book room)' }, group: 'rooms', x: 0, z: -14.6, yaw: Math.PI });
  L.places.push({ id: 'recent', label: { de: 'Zuletzt gelesen', en: 'Recently read' }, group: 'rooms', x: rc.x, z: rc.z - 1.5, yaw: Math.PI });   // facing the case
  if (rd) L.places.push({ id: 'finished', label: { de: 'Regal „Gelesen“', en: '“Read” shelf' }, group: 'rooms', x: rd.x, z: rd.z - 1.5, yaw: Math.PI });
  L.rooms.push({ id: 'room:books', name: L.allDepartments ? 'Bücher' : (L.department || 'Bücher'), x0, x1, z0, z1, type: 'library', bookcases: cases.map((b) => b.id) });
}
