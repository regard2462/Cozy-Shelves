// Line icons of the reading browser: one stroke width, currentColor, no fills except where a state is shown
// (filled star). Monochrome on purpose, so the E-Ink theme stays black and white.
const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  forward: '<path d="M9 5l7 7-7 7"/>',
  reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v5h-5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  home: '<path d="M4.5 11L12 4.5 19.5 11"/><path d="M6.5 9.5V19.5h11V9.5"/>',
  star: '<path d="M12 3.8l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.7-5 2.7 1-5.6-4.1-4 5.6-.8z"/>',
  tabs: '<rect x="3.8" y="7.5" width="12.7" height="12.7" rx="2"/><path d="M8 4.3h9.7a2.5 2.5 0 0 1 2.5 2.5v9.7"/>',
  menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  reader: '<path d="M3.5 5.8c2.8-1.2 5.7-1.1 8.5.6 2.8-1.7 5.7-1.8 8.5-.6v13c-2.8-1.2-5.7-1.1-8.5.6-2.8-1.7-5.7-1.8-8.5-.6z"/><path d="M12 6.4v13"/>',
  speak: '<path d="M4.5 9.5h3L12 5.8v12.4l-4.5-3.7h-3z"/><path d="M15.3 9.2a4 4 0 0 1 0 5.6M17.8 6.8a7.4 7.4 0 0 1 0 10.4"/>',
  type: '<path d="M3.5 18.5L8.3 6.5l4.8 12M5.3 14.5h6"/><path d="M15 12.4c.7-.9 1.7-1.4 2.9-1.4 1.8 0 3 1 3 2.9v4.6M20.9 15.3c-.8-.6-1.8-.9-2.9-.9-1.7 0-2.9.8-2.9 2.1 0 1.2 1 1.9 2.3 1.9 1.4 0 2.6-.7 3.5-1.9"/>',
  shield: '<path d="M12 3.5l7 2.8v5.4c0 4.4-2.9 7.6-7 9.3-4.1-1.7-7-4.9-7-9.3V6.3z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  bookmark: '<path d="M6.5 4h11v16l-5.5-3.8L6.5 20z"/>',
  clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.6V12l3 2"/>',
  later: '<path d="M4.5 6.5h15M4.5 12h8.5M4.5 17.5h5.5"/><path d="M17 13.5v7M13.5 17h7"/>',
  book: '<path d="M5.5 4.5h10.3a2.7 2.7 0 0 1 2.7 2.7v12.3H8.2a2.7 2.7 0 0 1-2.7-2.7z"/><path d="M5.5 16.8a2.7 2.7 0 0 1 2.7-2.7h10.3"/>',
  stack: '<path d="M4 7.3l8-3.5 8 3.5-8 3.5z"/><path d="M4 12l8 3.5 8-3.5M4 16.7l8 3.5 8-3.5"/>',
  pdf: '<path d="M7 3.5h6.8l4.2 4.2v12.8H7z"/><path d="M13.8 3.5v4.2H18"/><path d="M9.5 13h5M9.5 16.3h5"/>',
  external: '<path d="M13.5 4.5h6v6M19.5 4.5l-8.5 8.5"/><path d="M17.5 13.5v6h-13v-13h6"/>',
  translate: '<path d="M4 6.2h9M8.5 4v2.2c0 3.9-1.9 6.9-4.5 8.5M6.2 9.8c1 2 3 3.6 5.4 4.6"/><path d="M12.8 20l4-9 4 9M14.3 17h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  prev: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  next: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  play: '<path d="M7.5 5.5l11 6.5-11 6.5z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  skipBack: '<path d="M6.5 5.5v13M18 6l-8.5 6 8.5 6z"/>',
  skipFwd: '<path d="M17.5 5.5v13M6 6l8.5 6L6 18z"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17l5-4.5 4 3.4 3-2.4 4 3.5"/>',
  code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
  mobile: '<rect x="7" y="3.5" width="10" height="17" rx="2"/><path d="M11 17.3h2"/>',
  text: '<path d="M5.5 6.5h13M12 6.5v12M9.5 18.5h5"/>',
  cookie: '<path d="M19.8 12.8A8 8 0 1 1 11.2 4.2a2.8 2.8 0 0 0 3.5 3.3 2.8 2.8 0 0 0 5.1 5.3z"/><circle cx="9" cy="10.5" r=".9"/><circle cx="14" cy="15" r=".9"/><circle cx="9.3" cy="15.3" r=".9"/>',
  trash: '<path d="M5 7h14M10 7V4.8h4V7M7 7l1 12.5h8L17 7"/>',
  edit: '<path d="M4.5 19.5l1-4.3L15.8 4.9a2 2 0 0 1 2.9 2.9L8.4 18.1z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  restore: '<path d="M9 7.5H4.5V3"/><path d="M4.8 7.5a8 8 0 1 1-.6 5.4"/>',
  folder: '<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.3l2 2H19A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  columns: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M12 5v14"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/>',
  collection: '<path d="M4.5 5h3.6v14H4.5zM9.8 5h3.6v14H9.8z"/><path d="M15 6l3.4-.9 2.9 13.4-3.4.9z"/>',
};

/** SVG markup for an icon (static strings only, never user input). */
export function icon(name, extra = '') {
  const body = P[name] || P.menu;
  const fill = name === 'star-on' ? P.star : null;
  if (fill) return `<svg class="br-ico" viewBox="0 0 24 24" aria-hidden="true" ${extra}><g fill="currentColor" stroke="currentColor">${fill}</g></svg>`;
  return `<svg class="br-ico" viewBox="0 0 24 24" aria-hidden="true" ${extra}><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
}
