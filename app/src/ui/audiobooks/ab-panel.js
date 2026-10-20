// The panel "Hörbücher": the audiobooks of the audiobook folders (electron/audiobooks) and their player.
//   Bibliothek: "Weiterhören" (begun, not finished), all audiobooks with cover, author and progress, search and order
//   Player:     cover, title, author, narrator, series; sliders over the whole book and the chapter; back 15 s,
//               forward 30 s, previous and next chapter; speed; sleep timer; the chapters (a click jumps there)
// The player itself (ab-player.js) lives on when the panel closes. Keys: Space play or pause, ← / → 15 s back and 30 s
// forward, Esc from the player back to the list, Alt+← / Alt+→ back and forward; every control is a button.
import { h, clear } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';
import { createNavHistory } from '../nav-history.js';
import { abStore, recentOrder, continueList, progressOf } from './ab-store.js';
import { audiobookPlayer, RATES, SLEEP_MINUTES } from './ab-player.js';
import { clock, length, remaining, rateLabel, chapterName, errorText, byLine, seriesLine, sleepText, coverUrl } from './ab-format.js';

const SORTS = ['recent', 'title', 'author', 'added'];
const sortLabel = (k) => tr({ recent: { de: 'Zuletzt gehört', en: 'Recently played' }, title: { de: 'Titel und Reihe', en: 'Title and series' }, author: { de: 'Autor', en: 'Author' }, added: { de: 'Neu hinzugefügt', en: 'Recently added' } }[k]);
const collator = () => new Intl.Collator(i18n.lang === 'de' ? 'de' : 'en', { numeric: true, sensitivity: 'base' });
const SORT_KEY = 'lesesaal.audiobooks.sort';

export async function mount(container, ctx, params = {}) {
  const { bus } = ctx;
  const player = audiobookPlayer;
  player.attach(ctx);
  abStore.start();
  let sort = 'recent';
  try { const s = localStorage.getItem(SORT_KEY); if (SORTS.includes(s)) sort = s; } catch {}
  const st = { view: 'library', id: null, query: '', detail: null, token: 0 };
  const sfx = (n) => ctx.audio?.sfx?.(n);

  const panel = h('div.panel.ab-panel', { role: 'dialog', 'aria-label': tr({ de: 'Hörbücher', en: 'Audiobooks' }) });
  const header = h('div.panel-header.ab-header');
  const body = h('div.ab-body');
  const nowbar = h('div.ab-nowbar.hidden');
  panel.append(header, body, nowbar);
  container.appendChild(panel);

  // back and forward: the list and every audiobook opened from it are steps
  let restoring = false;
  const hist = createNavHistory({ onGo: (e) => { restoring = true; try { show(e.view, e.id, { record: false }); } finally { restoring = false; } } });
  const navBtns = hist.buttons();
  const record = () => { if (!restoring) hist.push({ view: st.view, id: st.id }); };

  // ---- header ------------------------------------------------------------------------------------------------
  const search = h('input.input.ab-search', { type: 'search', placeholder: tr({ de: 'Titel, Autor, Sprecher, Reihe …', en: 'Title, author, narrator, series …' }), 'aria-label': tr({ de: 'Hörbücher durchsuchen', en: 'Search audiobooks' }) });
  let searchTimer = null;
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { st.query = search.value; renderLibrary(); }, 120); });
  const sortSel = h('select.input.ab-sort', { 'aria-label': tr({ de: 'Reihenfolge', en: 'Order' }), onchange: () => { sort = sortSel.value; try { localStorage.setItem(SORT_KEY, sort); } catch {} renderLibrary(); } });
  function renderHeader() {
    clear(header);
    clear(sortSel); for (const k of SORTS) sortSel.appendChild(h('option', { value: k }, sortLabel(k)));
    sortSel.value = sort;
    search.placeholder = tr({ de: 'Titel, Autor, Sprecher, Reihe …', en: 'Title, author, narrator, series …' });
    // the names for the screen reader follow the language as well (the settings open over this panel)
    search.setAttribute('aria-label', tr({ de: 'Hörbücher durchsuchen', en: 'Search audiobooks' }));
    sortSel.setAttribute('aria-label', tr({ de: 'Reihenfolge', en: 'Order' }));
    panel.setAttribute('aria-label', tr({ de: 'Hörbücher', en: 'Audiobooks' }));
    const lib = st.view === 'library';
    header.append(
      navBtns,
      h('span.ab-logo', { 'aria-hidden': 'true' }, '🎧'),
      h('span.ab-title', tr({ de: 'Hörbücher', en: 'Audiobooks' })),
      lib ? h('div.ab-tools', search, sortSel) : h('button.btn.small.ghost.ab-back', { onclick: () => show('library') }, '‹ ' + tr({ de: 'Alle Hörbücher', en: 'All audiobooks' })),
      h('span.spacer'),
      h('button.btn.small', { title: tr({ de: 'Hörbuchordner in den Einstellungen', en: 'Audiobook folders in the settings' }), onclick: () => ctx.openPanel('settings', { section: 'audiobooks' }) }, tr({ de: 'Ordner', en: 'Folders' })),
      h('button.btn.small.icon', { title: tr({ de: 'Schließen (Esc)', en: 'Close (Esc)' }), 'aria-label': tr({ de: 'Schließen', en: 'Close' }), onclick: () => ctx.close() }, '✕'),
    );
  }

  // ---- library -----------------------------------------------------------------------------------------------
  function sorted(list) {
    const c = collator();
    const key = (b) => (b.series ? `${b.series}\u0001${String(b.seriesIndex ?? 999).padStart(5, '0')}` : b.title || '');
    switch (sort) {
      case 'title': return [...list].sort((a, b) => c.compare(key(a), key(b)));
      case 'author': return [...list].sort((a, b) => c.compare(a.author || '￿', b.author || '￿') || c.compare(key(a), key(b)));
      case 'added': return [...list].sort((a, b) => (b.added || 0) - (a.added || 0) || c.compare(a.title, b.title));
      default: return recentOrder(list, player.current?.id);
    }
  }
  const matches = (b, q) => !q || [b.title, b.author, b.narrator, b.series, b.genre].some((x) => x && String(x).toLowerCase().includes(q));
  function cover(b, size = 'thumb', cls = 'ab-cov') {
    const img = h('img', { src: coverUrl(b, size), alt: '', loading: 'lazy', decoding: 'async', draggable: false });
    img.addEventListener('error', () => { img.src = coverUrl({ ...b, cover: null }, size); }, { once: true });
    const p = progressOf(b);
    return h('div.' + cls, img,
      p > 0 && p < 1 ? h('div.ab-cov-progress', h('i', { style: { width: (p * 100).toFixed(1) + '%' } })) : null,
      b.progress?.finished ? h('span.ab-cov-done', { title: tr({ de: 'Gehört', en: 'Finished' }) }, '✓') : null);
  }
  function card(b) {
    const playing = player.current?.id === b.id;
    const el = h('div.ab-card', { role: 'button', tabindex: '0', dataset: { id: b.id }, class: playing ? 'current' : '', 'aria-label': `${b.title}${b.author ? ', ' + b.author : ''}`,
      onclick: () => openBook(b.id), onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); openBook(b.id); } } },
    h('div.ab-card-art', cover(b),
      h('button.ab-card-play', { type: 'button', tabindex: '-1', title: playing && player.state.playing ? tr({ de: 'Pause', en: 'Pause' }) : tr({ de: 'Abspielen', en: 'Play' }), 'aria-label': tr({ de: 'Abspielen', en: 'Play' }),
        onclick: (e) => { e.stopPropagation(); playBook(b.id); } }, playing && player.state.playing ? '❚❚' : '▶')),
    h('div.ab-card-title', { title: b.title }, b.title),
    h('div.ab-card-author', b.author || ' '),
    h('div.ab-card-meta', b.series ? h('span.ab-card-series', seriesLine(b)) : null,
      h('span', b.progress && !b.progress.finished && b.progress.position > 1 ? remaining(b.duration - b.progress.position) : length(b.duration))));
    return el;
  }
  function continueCard(b) {
    const left = Math.max(0, b.duration - (b.progress?.position || 0));
    return h('div.ab-cont', { role: 'button', tabindex: '0', dataset: { id: b.id }, onclick: () => openBook(b.id), onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); openBook(b.id); } } },
      cover(b, 'thumb', 'ab-cov.ab-cont-art'),
      h('div.ab-cont-body', h('div.ab-cont-title', b.title), h('div.ab-cont-author', b.author || ''), h('div.ab-cont-left', remaining(left)),
        h('button.btn.small.primary.ab-cont-play', { type: 'button', onclick: (e) => { e.stopPropagation(); playBook(b.id); } }, '▶ ' + tr({ de: 'Weiterhören', en: 'Continue' }))));
  }
  function emptyState() {
    const folders = abStore.folders;
    if (!abStore.loaded) return h('div.ab-empty', h('div.ab-spinner'));
    if (!folders.length) {
      return h('div.ab-empty',
        h('div.ab-empty-icon', { 'aria-hidden': 'true' }, '🎧'),
        h('h2', tr({ de: 'Noch kein Hörbuchordner', en: 'No audiobook folder yet' })),
        h('p', tr({ de: 'Wähle den Ordner, in dem deine Hörbücher liegen. Jeder Ordner mit Audiodateien wird ein Hörbuch, Unterordner wie CD1 und CD2 gehören dazu. Eine M4B-Datei mit Kapiteln ist ein Hörbuch für sich. Nummerierte Unterordner werden zu einer Reihe.', en: 'Choose the folder that holds your audiobooks. Every folder with audio files becomes an audiobook, sub folders such as CD1 and CD2 belong to it. An M4B file with chapters is an audiobook of its own. Numbered sub folders become a series.' })),
        h('p.muted.small', tr({ de: 'Formate: MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV', en: 'Formats: MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV' })),
        h('button.btn.primary', { onclick: addFolder }, '＋ ' + tr({ de: 'Hörbuchordner hinzufügen', en: 'Add audiobook folder' })));
    }
    const sc = abStore.scan;
    if (sc?.active) return h('div.ab-empty', h('div.ab-spinner'), h('p', scanText(sc)));
    return h('div.ab-empty', h('div.ab-empty-icon', { 'aria-hidden': 'true' }, '🎧'),
      h('p', tr({ de: 'In den Hörbuchordnern liegen keine Audiodateien.', en: 'There are no audio files in the audiobook folders.' })),
      h('p.muted.small', folders.map((f) => f.path).join(' · ')),
      h('button.btn', { onclick: () => abStore.rescan() }, '↻ ' + tr({ de: 'Neu einlesen', en: 'Scan again' })));
  }
  const scanText = (sc) => (sc.phase === 'tags' && sc.total ? tr({ de: 'Hörbücher werden eingelesen: {d} von {t} Dateien', en: 'Reading audiobooks: {d} of {t} files' }, { d: sc.done, t: sc.total }) : tr({ de: 'Die Hörbuchordner werden durchsucht …', en: 'Looking through the audiobook folders …' }));
  // the parts of the list that change on their own: the notes about the scan and the row "Weiterhören"
  let bannerEl = null, contEl = null, libKey = null;
  /** What decides the cards and their order: when only covers or progress change, the list is not drawn again. */
  const listKey = () => abStore.books.map((b) => [b.id, b.title, b.author, b.narrator, b.series, b.seriesIndex, Math.round(b.duration), b.added].join('\u0001')).join('\u0002') + '|' + sort + '|' + st.query + '|' + i18n.lang;
  function renderBanner() {
    if (!bannerEl) return;
    clear(bannerEl);
    const sc = abStore.scan;
    if (sc?.active) bannerEl.appendChild(h('div.ab-banner', h('div.ab-spinner.small'), scanText(sc)));
    if (sc?.unavailable?.length) bannerEl.appendChild(h('div.ab-banner.warn', tr({ de: 'Nicht erreichbar: {p}', en: 'Not reachable: {p}' }, { p: sc.unavailable.join(' · ') })));
  }
  function renderContinue() {
    if (!contEl) return;
    clear(contEl);
    const q = st.query.trim().toLowerCase();
    const cont = continueList(abStore.books).filter((b) => matches(b, q)).slice(0, 6);
    if (cont.length && !q) contEl.append(h('h3.ab-section', tr({ de: 'Weiterhören', en: 'Continue listening' })), h('div.ab-continue', cont.map(continueCard)));
  }
  /** One card drawn again (its progress changed). */
  function updateCard(id) {
    const el = body.querySelector(`.ab-card[data-id="${CSS.escape(id || '')}"]`), b = abStore.get(id);
    if (!el || !b) return;
    const focused = el.contains(document.activeElement), next = card(b);
    el.replaceWith(next);
    if (focused) next.focus();
  }
  /** New pictures (the covers are made while the first scan runs): only the images change. */
  function refreshCovers() {
    for (const el of body.querySelectorAll('.ab-card, .ab-cont')) {
      const b = abStore.get(el.dataset.id), img = el.querySelector('.ab-cov img');
      const want = b && coverUrl(b, 'thumb');
      if (img && want && img.getAttribute('src') !== want) img.src = want;
    }
  }
  function renderLibrary() {
    if (st.view !== 'library') return;
    const scroll = body.querySelector('.ab-library')?.scrollTop || 0;
    clear(body);
    bannerEl = contEl = null; libKey = null;
    const books = abStore.books;
    header.querySelector('.ab-tools')?.classList.toggle('hidden', !books.length);   // nothing to search yet
    if (!books.length) { body.appendChild(emptyState()); return; }
    const wrap = h('div.ab-library');
    bannerEl = h('div.ab-banners'); contEl = h('div.ab-cont-wrap');
    wrap.append(bannerEl, contEl);
    renderBanner(); renderContinue();
    const q = st.query.trim().toLowerCase();
    libKey = listKey();
    const list = sorted(books.filter((b) => matches(b, q)));
    wrap.appendChild(h('h3.ab-section', q ? tr({ de: '{n} Treffer', en: '{n} matches' }, { n: list.length }) : tr({ de: 'Alle Hörbücher ({n})', en: 'All audiobooks ({n})' }, { n: books.length })));
    if (!list.length) wrap.appendChild(h('p.muted.ab-none', tr({ de: 'Kein Hörbuch passt zur Suche.', en: 'No audiobook matches the search.' })));
    wrap.appendChild(h('div.ab-grid', list.map(card)));
    body.appendChild(wrap);
    wrap.scrollTop = scroll;
  }

  // ---- one audiobook: its page with the player -----------------------------------------------------------------
  let ui = null;   // the live elements of the player view
  async function loadDetail(id) {
    const token = ++st.token;
    const rec = player.current?.id === id ? player.current : await abStore.book(id);
    if (token !== st.token) return;
    st.detail = rec;
    renderBook();
  }
  function renderBook() {
    clear(body); ui = null;
    const summary = abStore.get(st.id);
    shownKey = pageKey(summary);
    const b = st.detail ? { ...st.detail, ...(summary || {}), tracks: st.detail.tracks, chapters: st.detail.chapters } : summary;
    if (!b) { body.appendChild(h('div.ab-empty', st.detail === null && abStore.loaded ? h('p', tr({ de: 'Dieses Hörbuch gibt es nicht mehr.', en: 'This audiobook is no longer there.' })) : h('div.ab-spinner'))); return; }
    const facts = [length(b.duration)];
    if (b.chapters?.length > 1 || b.chapterCount > 1) facts.push(tr({ de: '{n} Kapitel', en: '{n} chapters' }, { n: b.chapters?.length || b.chapterCount }));
    if ((b.tracks?.length || b.trackCount) > 1) facts.push(tr({ de: '{n} Dateien', en: '{n} files' }, { n: b.tracks?.length || b.trackCount }));
    if (b.year) facts.push(String(b.year));
    if (b.genre) facts.push(b.genre);
    const desc = b.description ? h('p.ab-desc', b.description) : null;
    if (desc) desc.addEventListener('click', () => desc.classList.toggle('open'));
    const side = h('div.ab-book-side',
      h('div.ab-big-cover', h('img', { src: coverUrl(b, 'large'), alt: '', draggable: false, onerror: (e) => { e.target.src = coverUrl({ ...b, cover: null }, 'large'); } })),
      h('h2.ab-book-title', b.title),
      b.author || b.narrator ? h('div.ab-book-by', byLine(b)) : null,
      b.series ? h('div.ab-book-series', seriesLine(b)) : null,
      h('div.ab-book-facts', facts.join(' · ')),
      desc,
      h('div.ab-book-actions',
        h('button.btn.small.ghost', { onclick: () => { player.markFinished(b.id, !b.progress?.finished); } }, b.progress?.finished ? tr({ de: 'Als ungehört markieren', en: 'Mark as not finished' }) : tr({ de: 'Als gehört markieren', en: 'Mark as finished' })),
        h('button.btn.small.ghost', { title: b.path || '', onclick: () => abStore.reveal(b.id) }, tr({ de: 'Im Ordner zeigen', en: 'Show in folder' }))));
    const main = h('div.ab-book-main', playerBox(b), chapterList(b));
    body.appendChild(h('div.ab-book', side, main));
    syncPlayer(player.state, true);
  }
  function playerBox(b) {
    const isCur = () => player.current?.id === b.id;
    const curOnly = [];
    const btn = (cls, label, title, fn, needsCur = true) => { const el = h('button.btn.icon.ab-ctl' + cls, { type: 'button', title, 'aria-label': title, onclick: fn }, label); if (needsCur) curOnly.push(el); return el; };
    const chapterNow = h('div.ab-now');
    const chapSlider = h('input.range.ab-slider', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': tr({ de: 'Stelle im Kapitel', en: 'Position in the chapter' }) });
    const bookSlider = h('input.range.ab-slider', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': tr({ de: 'Stelle im Hörbuch', en: 'Position in the audiobook' }) });
    const chapCur = h('span.ab-time'), chapLeft = h('span.ab-time.right'), bookCur = h('span.ab-time'), bookLeft = h('span.ab-time.right');
    const playBtn = btn('.main', '▶', tr({ de: 'Abspielen (Leertaste)', en: 'Play (Space)' }), () => { if (isCur()) player.toggle(); else playBook(b.id); }, false);
    const rateBtn = h('button.btn.small.ab-rate', { type: 'button', 'aria-haspopup': 'menu', title: tr({ de: 'Geschwindigkeit', en: 'Speed' }), onclick: (e) => { e.stopPropagation(); rateMenu(rateBtn); } });
    const sleepBtn = h('button.btn.small.ab-sleep', { type: 'button', 'aria-haspopup': 'menu', title: tr({ de: 'Schlaftimer', en: 'Sleep timer' }), onclick: (e) => { e.stopPropagation(); sleepMenu(sleepBtn); } });
    const vol = h('input.range.ab-volume', { type: 'range', min: 0, max: 1, step: 0.02, value: player.state.volume, 'aria-label': tr({ de: 'Lautstärke', en: 'Volume' }), oninput: (e) => player.setVolume(+e.target.value) });
    const err = h('div.ab-error.hidden');
    const seekFrom = (slider, kind) => {
      let dragging = false;
      slider.addEventListener('input', () => { dragging = true; slider.dataset.drag = '1'; preview(); });
      slider.addEventListener('change', () => {
        dragging = false; delete slider.dataset.drag;
        const t = target();
        if (isCur()) player.seek(t); else playBook(b.id, { at: t });
      });
      const target = () => {
        const s = player.state, k = +slider.value / 1000;
        if (kind === 'book') return k * (isCur() ? s.duration : b.duration);
        return isCur() ? s.chapterStart + k * (s.chapterEnd - s.chapterStart) : 0;
      };
      const preview = () => { const t = target(); if (kind === 'book') bookCur.textContent = clock(t); else chapCur.textContent = clock(t - (isCur() ? player.state.chapterStart : 0)); };
      return () => dragging;
    };
    const chapDrag = seekFrom(chapSlider, 'chapter'), bookDrag = seekFrom(bookSlider, 'book');
    ui = { b, chapterNow, chapSlider, bookSlider, chapCur, chapLeft, bookCur, bookLeft, playBtn, rateBtn, sleepBtn, err, chapDrag, bookDrag, isCur, curOnly };
    return h('div.ab-player',
      chapterNow,
      h('div.ab-seekrow', chapCur, chapSlider, chapLeft),
      h('div.ab-controls',
        btn('', '⏮', tr({ de: 'Voriges Kapitel', en: 'Previous chapter' }), () => (isCur() ? player.prevChapter() : null)),
        btn('.skip', h('span', '−15'), tr({ de: '15 Sekunden zurück (←)', en: 'Back 15 seconds (←)' }), () => (isCur() ? player.skip(-15) : null)),
        playBtn,
        btn('.skip', h('span', '+30'), tr({ de: '30 Sekunden vor (→)', en: 'Forward 30 seconds (→)' }), () => (isCur() ? player.skip(30) : null)),
        btn('', '⏭', tr({ de: 'Nächstes Kapitel', en: 'Next chapter' }), () => (isCur() ? player.nextChapter() : null))),
      h('div.ab-seekrow.book', bookCur, bookSlider, bookLeft),
      h('div.ab-extra', rateBtn, sleepBtn, h('span.ab-vol', { 'aria-hidden': 'true' }, '🔉'), vol),
      err);
  }
  function chapterList(b) {
    const list = h('div.ab-chapters', { role: 'list', 'aria-label': tr({ de: 'Kapitel', en: 'Chapters' }) });
    const chapters = b.chapters || [];
    const tracks = b.tracks || [];
    const startOf = (c) => (tracks[c.track]?.start || 0) + c.offset;
    chapters.forEach((c, i) => {
      const end = i + 1 < chapters.length ? startOf(chapters[i + 1]) : b.duration;
      list.appendChild(h('button.ab-chap', { type: 'button', role: 'listitem', dataset: { i: String(i) }, title: tr({ de: 'Hier weiterhören', en: 'Listen from here' }),
        onclick: () => { sfx('click'); if (player.current?.id === b.id) player.seekChapter(i, { play: true }); else playBook(b.id, { chapter: i }); } },
      h('span.ab-chap-n', String(i + 1)), h('span.ab-chap-title', chapterName(c, i)), h('span.ab-chap-time', clock(startOf(c))), h('span.ab-chap-len', clock(Math.max(0, end - startOf(c))))));
    });
    if (!chapters.length) list.appendChild(h('div.ab-spinner.small'));
    return h('div.ab-chapters-wrap', h('h3.ab-section', tr({ de: 'Kapitel', en: 'Chapters' })), list);
  }
  /** The live parts of the player view, several times a second while it plays. */
  function syncPlayer(s, force = false) {
    if (!ui || st.view !== 'book') return;
    const cur = ui.isCur();
    const b = ui.b;
    const dur = cur ? s.duration : b.duration;
    const pos = cur ? s.position : (b.progress?.position || 0);
    const ci = cur ? s.chapter : (b.chapters?.length ? chapterIndex(b, pos) : -1);
    const chs = b.chapters || [];
    const cStart = cur ? s.chapterStart : chStart(b, ci), cEnd = cur ? s.chapterEnd : (ci + 1 < chs.length ? chStart(b, ci + 1) : dur);
    ui.chapterNow.textContent = ci >= 0 && chs.length ? `${tr({ de: 'Kapitel {n} von {t}', en: 'Chapter {n} of {t}' }, { n: ci + 1, t: chs.length })} · ${chapterName(chs[ci], ci)}` : '';
    if (!ui.chapDrag()) { ui.chapSlider.value = String(Math.round(cEnd > cStart ? ((pos - cStart) / (cEnd - cStart)) * 1000 : 0)); ui.chapCur.textContent = clock(pos - cStart); }
    ui.chapLeft.textContent = '−' + clock(Math.max(0, cEnd - pos));
    if (!ui.bookDrag()) { ui.bookSlider.value = String(Math.round(dur ? (pos / dur) * 1000 : 0)); ui.bookCur.textContent = clock(pos); }
    ui.bookLeft.textContent = remaining(Math.max(0, dur - pos) / (cur ? s.rate : (b.progress?.rate || player.rate || 1)));
    const playing = cur && s.playing;
    for (const el of ui.curOnly) el.disabled = !cur;
    ui.chapSlider.disabled = !cur;
    ui.playBtn.textContent = playing ? '❚❚' : '▶';
    ui.playBtn.title = playing ? tr({ de: 'Pause (Leertaste)', en: 'Pause (Space)' }) : tr({ de: 'Abspielen (Leertaste)', en: 'Play (Space)' });
    ui.playBtn.classList.toggle('busy', cur && s.buffering && !s.error);
    ui.rateBtn.textContent = rateLabel(cur ? s.rate : (b.progress?.rate || player.rate));
    const sl = cur ? s.sleep : null;
    ui.sleepBtn.textContent = '☾ ' + (sl ? sleepText(sl) : tr({ de: 'Schlaftimer', en: 'Sleep timer' }));
    ui.sleepBtn.classList.toggle('on', !!sl);
    const e = cur ? errorText(s.error) : null;
    ui.err.classList.toggle('hidden', !e); if (e) ui.err.textContent = e;
    // the chapter that plays
    const key = (cur ? 'c' : 'n') + ci;
    if (force || ui.lastChapter !== key) {
      ui.lastChapter = key;
      for (const el of body.querySelectorAll('.ab-chap')) el.classList.toggle('current', +el.dataset.i === ci);
      body.querySelector('.ab-chap.current')?.scrollIntoView({ block: 'nearest' });
    }
  }
  const chStart = (b, i) => { const c = b.chapters?.[i]; return c ? (b.tracks?.[c.track]?.start || 0) + c.offset : 0; };
  function chapterIndex(b, pos) { let i = 0; (b.chapters || []).forEach((c, k) => { if (chStart(b, k) <= pos + 0.05) i = k; }); return i; }

  // ---- menus: speed and sleep timer ---------------------------------------------------------------------------
  let menu = null;
  function closeMenu() { if (menu) { menu.el.remove(); menu.anchor?.focus(); menu = null; } }
  function openMenu(anchor, items) {
    closeMenu();
    const el = h('div.ab-menu', { role: 'menu' }, items.map(([label, on, fn]) => h('button.ab-menu-item', { type: 'button', role: 'menuitemradio', 'aria-checked': on ? 'true' : 'false', class: on ? 'on' : '', onclick: (e) => { e.stopPropagation(); fn(); closeMenu(); } }, label)));
    const r = anchor.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    el.style.left = Math.max(8, r.left - pr.left) + 'px'; el.style.bottom = (pr.bottom - r.top + 6) + 'px';
    panel.appendChild(el);
    menu = { el, anchor };
    (el.querySelector('.on') || el.firstChild)?.focus();
  }
  function rateMenu(anchor) {
    const cur = player.current ? player.state.rate : player.rate;
    openMenu(anchor, RATES.map((r) => [rateLabel(r), Math.abs(r - cur) < 0.001, () => player.setRate(r)]));
  }
  function sleepMenu(anchor) {
    const s = player.state.sleep;
    const items = SLEEP_MINUTES.map((m) => [tr({ de: '{m} Minuten', en: '{m} minutes' }, { m }), s?.mode === 'minutes' && s.minutes === m, () => setSleep(m)]);
    items.push([tr({ de: 'Bis zum Ende des Kapitels', en: 'Until the end of the chapter' }), s?.mode === 'chapter', () => setSleep('chapter')]);
    items.push([tr({ de: 'Aus', en: 'Off' }), !s, () => setSleep(null)]);
    openMenu(anchor, items);
  }
  function setSleep(m) {
    if (!player.current) { ctx.toast?.(tr({ de: 'Der Schlaftimer läuft, sobald ein Hörbuch spielt.', en: 'The sleep timer runs once an audiobook plays.' })); return; }
    player.setSleep(m);
    if (m === 'chapter') ctx.toast?.(tr({ de: 'Das Hörbuch hält am Ende des Kapitels an.', en: 'The audiobook stops at the end of the chapter.' }));
    else if (m) ctx.toast?.(tr({ de: 'Schlaftimer: {m} Minuten', en: 'Sleep timer: {m} minutes' }, { m }));
  }
  panel.addEventListener('click', (e) => { if (menu && !menu.el.contains(e.target)) closeMenu(); });

  // ---- the bar of what plays (in the list) ---------------------------------------------------------------------
  function renderNowbar(s = player.state) {
    const b = s.book;
    nowbar.classList.toggle('hidden', !b || st.view === 'book');
    if (!b || st.view === 'book') return;
    const key = b.id + '|' + s.playing + '|' + s.chapter;
    if (nowbar.dataset.key !== key) {
      nowbar.dataset.key = key;
      clear(nowbar);
      nowbar.append(
        h('img.ab-nowbar-art', { src: coverUrl(b, 'thumb'), alt: '' }),
        h('div.ab-nowbar-text', h('div.ab-nowbar-title', b.title), h('div.ab-nowbar-sub', [b.author, s.chapter >= 0 && b.chapters?.length > 1 ? chapterName(b.chapters[s.chapter], s.chapter) : null].filter(Boolean).join(' · '))),
        h('button.btn.icon.small.ab-nb-back', { title: tr({ de: '15 Sekunden zurück', en: 'Back 15 seconds' }), onclick: () => player.skip(-15) }, '↺'),
        h('button.btn.icon.ab-nb-play', { title: s.playing ? tr({ de: 'Pause', en: 'Pause' }) : tr({ de: 'Weiter', en: 'Play' }), onclick: () => player.toggle() }, s.playing ? '❚❚' : '▶'),
        h('button.btn.icon.small.ab-nb-fwd', { title: tr({ de: '30 Sekunden vor', en: 'Forward 30 seconds' }), onclick: () => player.skip(30) }, '↻'),
        h('button.btn.small.ab-nb-open', { onclick: () => openBook(b.id) }, tr({ de: 'Zum Player', en: 'Open player' })),
        h('div.ab-nowbar-line', h('i')));
    }
    const line = nowbar.querySelector('.ab-nowbar-line > i');
    if (line) line.style.width = (s.duration ? (s.position / s.duration) * 100 : 0).toFixed(2) + '%';
  }

  /** The card of the audiobook that plays: its frame and its button, without drawing the list again. */
  function markCurrent(s) {
    for (const el of body.querySelectorAll('.ab-card')) {
      const cur = el.dataset.id === s.book?.id;
      el.classList.toggle('current', cur);
      const btn = el.querySelector('.ab-card-play');
      if (btn) { btn.textContent = cur && s.playing ? '❚❚' : '▶'; btn.title = cur && s.playing ? tr({ de: 'Pause', en: 'Pause' }) : tr({ de: 'Abspielen', en: 'Play' }); }
    }
  }

  // ---- actions --------------------------------------------------------------------------------------------------
  async function addFolder() {
    const f = await abStore.addFolder().catch(() => null);
    if (f) { ctx.toast?.(tr({ de: 'Der Ordner wird nach Hörbüchern durchsucht.', en: 'The folder is being searched for audiobooks.' })); abStore.refresh(); }
  }
  async function playBook(id, opts = {}) {
    sfx('click');
    if (player.current?.id === id && opts.at == null && opts.chapter == null) { player.toggle(); return; }
    const ok = await player.open(id, opts);
    if (!ok) ctx.toast?.(errorText('missing'));
  }
  function openBook(id) { sfx('click'); show('book', id); }
  function show(view, id = null, { record: rec = true } = {}) {
    closeMenu();
    st.view = view; st.id = view === 'book' ? id : null;
    if (rec) record();
    renderHeader();
    if (view === 'book') {
      st.detail = player.current?.id === id ? player.current : undefined;
      renderBook();
      if (!st.detail) loadDetail(id);
    } else { ui = null; renderLibrary(); }
    renderNowbar();
  }

  // ---- live updates ---------------------------------------------------------------------------------------------
  let libTimer = null;
  // what the page of an audiobook shows of its record: it is drawn again only when that changes
  const pageKey = (b) => (b ? [b.title, b.author, b.narrator, b.series, b.seriesIndex, b.cover?.large, Math.round(b.duration), b.chapterCount, b.trackCount, !!b.progress?.finished].join('|') : '');
  let shownKey = null;
  const offStore = abStore.onChange(({ reason, id } = {}) => {
    if (st.view === 'library') {
      // while a large folder is read and its covers are made, and while an audiobook saves where it is, the list stays
      if (reason === 'scan') { if (abStore.books.length && libKey) renderBanner(); else { clearTimeout(libTimer); libTimer = setTimeout(renderLibrary, 400); } return; }
      if (reason === 'progress' && libKey) { updateCard(id); renderContinue(); return; }
      if (libKey && listKey() === libKey) { refreshCovers(); renderBanner(); return; }
      clearTimeout(libTimer); libTimer = setTimeout(renderLibrary, 60);
      return;
    }
    if (reason === 'scan' || (reason === 'progress' && id !== st.id)) return;
    const b = abStore.get(st.id);
    if (!b && abStore.loaded && reason !== 'progress') { st.detail = null; renderBook(); return; }
    const key = pageKey(b);
    if (key === shownKey) return;
    shownKey = key;
    if (reason === 'update' && player.current?.id !== st.id && b && st.detail && (st.detail.chapters?.length !== b.chapterCount || Math.abs((st.detail.duration || 0) - b.duration) > 1)) loadDetail(st.id);
    else renderBook();
  });
  let lastBookKey = null;
  const offPlayer = player.onChange((s) => {
    const key = (s.book?.id || '') + '|' + s.playing + '|' + (s.book ? s.chapter : '');
    if (st.view === 'book') {
      // the audiobook of this page started: its record comes from the player from now on
      if (s.book?.id === st.id && st.detail !== s.book) { st.detail = s.book; renderBook(); }
      else syncPlayer(s);
    } else if (key !== lastBookKey) {
      const sameBook = lastBookKey?.split('|')[0] === (s.book?.id || '');
      lastBookKey = key;
      if (sameBook) markCurrent(s); else renderLibrary();
    }
    renderNowbar(s);
  });
  const offLang = bus.on('i18n:change', () => { renderHeader(); if (st.view === 'book') renderBook(); else renderLibrary(); renderNowbar(); });

  // ---- start -------------------------------------------------------------------------------------------------------
  const first = params.id || (params.show === 'player' ? player.current?.id : null);
  restoring = true;
  if (first) show('book', first, { record: false }); else show('library', null, { record: false });
  restoring = false;
  hist.push({ view: st.view, id: st.id });
  abStore.start().then(() => { if (st.view === 'library') renderLibrary(); else if (!st.detail) loadDetail(st.id); });

  return {
    unmount() { offStore(); offPlayer(); offLang(); navBtns.dispose?.(); clearTimeout(libTimer); clearTimeout(searchTimer); closeMenu(); ++st.token; },
    onNav(dir) { hist.go(dir); return true; },
    onKey(e) {
      if (hist.onKey(e)) return true;
      if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const items = [...menu.el.querySelectorAll('.ab-menu-item')];
        const i = items.indexOf(document.activeElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        return true;
      }
      if (e.key === 'Escape') {
        if (menu) { closeMenu(); return true; }
        if (st.view === 'book') { show('library'); return true; }
        return false;
      }
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
      if (e.key === ' ' || e.code === 'Space') {
        if (st.view === 'book' && player.current?.id !== st.id) { playBook(st.id); return true; }
        if (player.current) { player.toggle(); return true; }
        return false;
      }
      if (e.key === 'ArrowLeft' && player.current) { player.skip(-15); return true; }
      if (e.key === 'ArrowRight' && player.current) { player.skip(30); return true; }
      return false;
    },
  };
}
