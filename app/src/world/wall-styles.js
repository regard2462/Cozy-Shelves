// The choices of the wall finish ("Wandgestaltung", settings.walls) without three.js: the settings panel shows them,
// walls.js puts them on the walls.

/** In the order of the settings. */
export const WALL_STYLES = ['white', 'cream', 'sage', 'dove', 'terracotta', 'graffiti'];
/** How the plain colours look on the wall (albedo, sRGB). Calm plaster tones that sit well on the sage panelling. */
export const WALL_COLORS = { white: '#e6e2dc', cream: '#efe2c4', sage: '#d2dbc4', dove: '#c5d0d8', terracotta: '#dcb8a2' };
export const WALL_LABELS = {
  white: { de: 'Weiß', en: 'White' }, cream: { de: 'Creme', en: 'Cream' }, sage: { de: 'Salbei', en: 'Sage' },
  dove: { de: 'Taubenblau', en: 'Dove blue' }, terracotta: { de: 'Terrakotta', en: 'Terracotta' }, graffiti: { de: 'Graffiti', en: 'Graffiti' },
};

/** Whether a mural is being painted right now (walls.js keeps it, 'walls:painting' on the bus tells every change). */
export const wallPainting = { busy: false };

/** The style and seed stored in the settings, always valid (seed 1 is the first graffiti variant). */
export function wallStyleOf(settings) {
  const w = settings?.walls || {};
  return { style: WALL_STYLES.includes(w.style) ? w.style : 'white', seed: Math.max(1, Math.floor(+w.seed) || 1) };
}
