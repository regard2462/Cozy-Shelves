// Settings → Bücherordner: covers and metadata from the internet, the image search engines asked for covers, and
// "Alle Cover jetzt laden" with its progress (n of m, the book asked about right now, found and not found, books per
// minute), pause, continue and cancel, and "Erneut versuchen" for the books without a match
// (electron/library/web-covers.js, cover-batch.js, image-engines.js).
import { h, clear, formatDate, formatDuration } from '../core/dom.js';
import { tr } from '../core/i18n.js';

const T = (de, en, vars) => tr({ de, en }, vars);
const ENGINES = [['bing', 'Bing'], ['yandex', 'Yandex'], ['duckduckgo', 'DuckDuckGo']];

/**
 * The rows of the section. `getS()` the current settings, `set(patch)` stores some, the row builders come from the
 * settings panel (toggle, note, groupTitle), `keep(off)` ends a subscription when the section is left.
 */
export function coverSettingsRows({ api, ctx, getS, set, toggle, note, groupTitle, keep }) {
  const lang = () => ctx.i18n?.lang || 'de';
  const status = h('p.settings-note.small.muted.cv-status');
  const box = h('div.cv-batch');
  let st = null;

  const time = (ms) => (ms >= 60e3 ? formatDuration(ms / 1000) : T('{n} s', '{n} s', { n: Math.max(1, Math.round(ms / 1000)) }));
  const clock = (t) => new Date(t).toLocaleTimeString(lang() === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' });
  function draw() {
    if (!st || !box.isConnected) return;
    // the line under the switches: how far the covers and the metadata have come
    const parts = [T('{n} Cover aus dem Internet', '{n} covers from the internet', { n: st.web })];
    if (st.enabled && st.pending) parts.push(T('{n} noch offen', '{n} still to do', { n: st.pending }));
    if (st.enabled && st.waiting) parts.push(T('{n} für die Bildersuche', '{n} for the image search', { n: st.waiting }));
    if (st.missed) parts.push(T('{n} ohne Treffer', '{n} without a match', { n: st.missed }));
    if (st.meta) parts.push(T('{n} Bücher mit ergänzten Metadaten', '{n} books with completed metadata', { n: st.meta }));
    if (st.enabled && st.waiting && st.imageNext > Date.now()) parts.push(T('Bildersuche wieder ab {t}', 'Image search again from {t}', { t: clock(st.imageNext) }));
    status.textContent = parts.join(' · ');
    // "Alle Cover jetzt laden"
    clear(box);
    const b = st.batch || { state: 'idle' };
    const active = b.state === 'running' || b.state === 'paused';
    const btn = (label, cmd, primary = false) => h(primary ? 'button.btn.small.primary' : 'button.btn.small', { type: 'button', disabled: !st.enabled, onclick: () => command(cmd) }, label);
    if (active) {
      const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
      const now = b.state === 'paused' ? T('Angehalten', 'Paused')
        : b.waiting ? T('Wartet, bis alle Bücher eingelesen sind', 'Waiting until all books are read in')
        : b.current?.length ? T('Gerade: {t}', 'Now: {t}', { t: b.current.join(' · ') })
        : b.engineWait > Date.now() ? T('Wartet auf eine freie Bildersuche ({n} Bücher)', 'Waiting for a free image search ({n} books)', { n: b.later })
        : '…';
      box.append(
        h('div.cv-progress', h('div.progress-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(b.total), 'aria-valuenow': String(b.done) }, h('i', { style: { width: pct + '%' } })),
          h('span.cv-count', T('{d} von {n}', '{d} of {n}', { d: b.done, n: b.total }))),
        h('div.cv-line', [T('{f} gefunden · {m} nicht gefunden', '{f} found · {m} not found', { f: b.found, m: b.missed + (b.failed || 0) }),
          b.perMinute ? T(' · {r} Bücher pro Minute', ' · {r} books a minute', { r: Math.round(b.perMinute) }) : ''].join('')),
        h('div.cv-line.cv-now', now),
        h('div.cv-buttons', b.state === 'paused' ? btn(T('Fortsetzen', 'Continue'), 'resume', true) : btn(T('Pause', 'Pause'), 'pause'), btn(T('Abbrechen', 'Cancel'), 'cancel')));
    } else {
      if (b.state === 'done' && b.total) box.append(h('div.cv-line', T('Fertig: {f} Cover gefunden, {m} nicht gefunden, in {t}.', 'Done: {f} covers found, {m} not found, in {t}.', { f: b.found, m: b.missed + (b.failed || 0), t: time(b.elapsed || 0) })));
      if (b.state === 'cancelled') box.append(h('div.cv-line', T('Abgebrochen nach {d} von {n} Büchern.', 'Cancelled after {d} of {n} books.', { d: b.done, n: b.total })));
      const todo = (st.pending || 0) + (st.waiting || 0);
      const start = btn(T('Alle Cover jetzt laden', 'Load all covers now'), 'start', true);
      if (!todo) start.disabled = true;
      box.append(h('div.cv-buttons', start,
        h('span.small.muted', todo ? T('{n} Bücher ohne Cover', '{n} books without a cover', { n: todo }) : T('Kein Buch mehr offen', 'No book left to look up'))));
      if (st.missed) {
        box.append(h('div.cv-buttons',
          h('span.small', T('{n} Bücher ohne Treffer, zuletzt gesucht am {d}.', '{n} books without a match, last searched on {d}.', { n: st.missed, d: formatDate(st.lastMiss, lang()) })),
          btn(T('Erneut versuchen', 'Try again'), 'retry')));
      }
    }
  }
  async function refresh() {
    try { st = await api.invoke?.('covers:status'); } catch {}
    draw();
  }
  async function command(cmd) {
    try { st = (await api.invoke?.('covers:batch', cmd)) || st; } catch {}
    draw();
  }
  setTimeout(refresh, 0);
  const timer = setInterval(refresh, 4000);
  keep(() => clearInterval(timer));
  // the progress arrives as it happens (a few times a second at most); when the run ends or stops, the counts above too
  keep(api.on?.('covers:batch', (b) => {
    if (!st) return;
    const was = st.batch?.state;
    st.batch = b;
    draw();
    if (was !== b.state && b.state !== 'running') refresh();
  }));

  /** The image search engines, each one a switch of its own (a button that keeps its state). */
  function engineRow() {
    const el = h('div.cv-engines', { role: 'group', 'aria-label': T('Bildersuche mit', 'Image search with') });
    // the switches as the reader set them (the stored settings follow a moment later)
    let on = { ...(getS().coverEngines || {}) };
    const drawEngines = () => {
      const focused = document.activeElement && el.contains(document.activeElement) ? document.activeElement.textContent : null;
      clear(el);
      for (const [k, label] of ENGINES) {
        const active = on[k] !== false;
        const b = el.appendChild(h('button.cv-engine', { type: 'button', class: active ? 'on' : '', 'aria-pressed': active ? 'true' : 'false',
          onclick: () => { on = { ...on, [k]: !active }; drawEngines(); set({ coverEngines: on }).then(refresh); } }, label));
        if (focused === label) b.focus();
      }
    };
    drawEngines();
    return h('div.setting', h('label', T('Bildersuche mit', 'Image search with'),
      h('span.setting-hint', T('für Bücher, die die Kataloge nicht kennen; jede Suchmaschine nur ein paar Mal in der Minute', 'for books the catalogues do not know; each search engine only a few times a minute'))), el);
  }

  /** The reader's own key for Google Books (free from Google; without one Google currently answers nothing). */
  function keyRow() {
    const input = h('input.input.cv-key', { type: 'password', value: getS().googleBooksKey || '', placeholder: T('ohne Schlüssel', 'no key'), spellcheck: 'false', autocomplete: 'off', 'aria-label': T('Schlüssel für Google Books', 'Key for Google Books') });
    let tm = null;
    input.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => set({ googleBooksKey: input.value.trim() }).then(refresh), 700); });
    keep(() => clearTimeout(tm));
    return h('div.setting', h('label', T('Schlüssel für Google Books', 'Key for Google Books'),
      h('span.setting-hint', T('freiwillig: ein kostenloser API-Schlüssel aus der Google Cloud Console; ohne Schlüssel antwortet Google Books zurzeit nicht', 'optional: a free API key from the Google Cloud console; without one Google Books does not answer at the moment'))), input);
  }

  return [
    groupTitle(T('Cover und Metadaten', 'Covers and metadata')),
    toggle(T('Fehlende Cover aus dem Internet laden', 'Load missing covers from the internet'), () => getS().webCovers !== false, (v) => set({ webCovers: v }).then(refresh),
      { hint: T('aus Open Library, Goodreads, Apple Books, der Deutschen Nationalbibliothek, Amazon und dem Internet Archive, sonst über die Bildersuche', 'from Open Library, Goodreads, Apple Books, the German National Library, Amazon and the Internet Archive, else through the image search') }),
    engineRow(),
    toggle(T('Metadaten aus dem Internet ergänzen', 'Complete metadata from the internet'), () => getS().webMetadata !== false, (v) => set({ webMetadata: v }).then(refresh),
      { hint: T('Autor, Jahr, Verlag, ISBN, Sprache und Reihe, wenn das Buch sie nicht selbst nennt', 'author, year, publisher, ISBN, language and series, when the book does not name them itself') }),
    keyRow(),
    status,
    box,
    note(T(
      'Gesendet werden nur Titel, Autor und ISBN (oder die ASIN aus dem Dateinamen) eines Buchs, und nur für Bücher: Notizen, Dokumente und kurze PDFs bleiben auf dem Rechner. Die Buchkataloge antworten in Sekunden; jeder hat sein eigenes kleines Budget, und viele Bücher fragen verschiedene Kataloge zugleich. Kennen sie ein Buch nicht, fragt Cozy Shelves die Bildersuche von Bing, Yandex und DuckDuckGo, mit strengem Jugendschutzfilter und jede nur ein paar Mal in der Minute. Das Bild, das die meisten Treffer zeigen, wird zum Cover. Bilder laden nur aus dem Bildspeicher der Suchmaschine oder über den Bildproxy von DuckDuckGo, die Websites dahinter sehen deine Adresse nicht. In der Buchinfo lässt sich jedes Cover ändern.',
      'Only title, author and ISBN (or the ASIN in the file name) of a book are sent, and only for books: notes, documents and short PDFs stay on this computer. The book catalogues answer within seconds; each has a small budget of its own, and many books ask different catalogues at once. When they do not know a book, Cozy Shelves asks the image search of Bing, Yandex and DuckDuckGo, with strict safe search and each only a few times a minute. The picture most results show becomes the cover. Pictures load only from the search engine’s image cache or through DuckDuckGo’s image proxy, so the websites behind them never see your address. The book info lets you change every cover.')),
  ];
}
