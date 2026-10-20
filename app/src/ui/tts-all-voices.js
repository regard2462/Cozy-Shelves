// Settings → Vorlesen → "Alle Stimmen herunterladen": every voice of the app in one go, with the total size, one
// progress bar for everything and one per voice, cancel and resume. Voices that are on this computer are skipped, a
// voice that fails is listed with its reason and can be tried again. The downloads run in the read-aloud client
// (tts-client.js downloadAllVoices): they go on when the settings close, and the rows here show them again.
import { h, clear } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { bus } from '../core/bus.js';

const size = (bytes) => {
  const mb = (bytes || 0) / 1048576;
  if (mb >= 1000) return (mb / 1024).toFixed(1).replace('.', tr({ de: ',', en: '.' })) + ' GB';
  return Math.max(1, Math.round(mb)) + ' MB';
};
const voiceName = (v) => (v.kind === 'en' ? tr({ de: 'Englisch (Kokoro, 28 Stimmen)', en: 'English (Kokoro, 28 voices)' }) : v.name);

/**
 * The rows of the settings section.
 * @param {{ getTts: () => Promise<object|null>, keep: (off: () => void) => void, groupTitle: (t: string) => Element }} opts
 */
export function allVoicesRows({ getTts, keep, groupTitle, onDone }) {
  const box = h('div.tts-all', { role: 'group', 'aria-label': tr({ de: 'Alle Stimmen', en: 'All voices' }) }, h('span.small.muted', tr({ de: 'Stimmen werden geprüft …', en: 'Checking the voices …' })));
  let client = null, inventory = null, snap = null;

  async function refresh() {
    client = client || await getTts();
    if (!client?.voiceInventory) { clear(box); box.append(h('span.small.muted', tr({ de: 'Die Sprachausgabe ist nicht verfügbar.', en: 'Speech output is not available.' }))); return; }
    snap = client.downloads;
    if (!snap.running) { try { inventory = await client.voiceInventory(); } catch { inventory = inventory || []; } }
    if (box.isConnected || !inventory) render();
  }

  function render() {
    clear(box);
    const running = !!snap?.running;
    const list = running || snap?.items?.length ? snap.items : (inventory || []).map((v) => ({ ...v, state: v.installed ? 'skipped' : 'pending' }));
    const missing = (inventory || []).filter((v) => !v.installed);
    const remaining = missing.reduce((n, v) => n + Math.max(0, (v.bytes || 0) - (v.received || 0)), 0);
    const partial = missing.some((v) => (v.received || 0) > 0);
    // failures of the last run that are still missing (a voice loaded in the meantime is no failure any more)
    const failed = (snap?.items || []).filter((x) => x.state === 'failed' && (!inventory || missing.some((v) => v.id === x.id)));
    const onlyFailed = missing.length > 0 && missing.every((v) => failed.some((x) => x.id === v.id));
    if (running) {
      const pct = Math.round((snap.progress || 0) * 100);
      box.append(h('div.tts-all-row',
        h('div.tts-all-bar', { role: 'progressbar', 'aria-label': tr({ de: 'Alle Stimmen', en: 'All voices' }), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('i', { style: { width: pct + '%' } })),
        h('span.tts-all-sum', `${size(snap.received)} / ${size(snap.total)}`),
        h('button.btn.small', { type: 'button', onclick: () => client.cancelDownloads() }, tr({ de: 'Abbrechen', en: 'Cancel' }))));
    } else if (missing.length && !onlyFailed) {
      box.append(h('div.tts-all-row',
        h('button.btn.small.primary.tts-all-start', { type: 'button', onclick: () => start() },
          partial ? tr({ de: 'Download fortsetzen (noch {s})', en: 'Resume the download ({s} left)' }, { s: size(remaining) })
            : tr({ de: 'Alle Stimmen herunterladen ({s})', en: 'Download all voices ({s})' }, { s: size(remaining) })),
        h('span.tts-all-sum', missing.length === 1
          ? tr({ de: '1 von {m} Stimmen fehlt noch.', en: '1 of {m} voices is not here yet.' }, { m: (inventory || []).length })
          : tr({ de: '{n} von {m} Stimmen fehlen noch.', en: '{n} of {m} voices are not here yet.' }, { n: missing.length, m: (inventory || []).length }))));
    } else if (inventory && !missing.length) {
      box.append(h('div.tts-all-row', h('span.tts-all-sum', tr({ de: 'Alle {n} Stimmen sind auf diesem Rechner.', en: 'All {n} voices are on this computer.' }, { n: inventory.length }))));
    }
    if (failed.length && !running) {
      box.append(h('div.tts-all-row',
        h('span.tts-all-fail', failed.length === 1
          ? tr({ de: 'Die Stimme {v} konnte nicht geladen werden.', en: 'The voice {v} could not be downloaded.' }, { v: voiceName(failed[0]) })
          : tr({ de: '{n} Stimmen konnten nicht geladen werden.', en: '{n} voices could not be downloaded.' }, { n: failed.length })),
        h('button.btn.small', { type: 'button', onclick: () => start(failed.map((x) => x.id)) }, tr({ de: 'Erneut versuchen', en: 'Try again' }))));
    }
    // one line per voice while the downloads run, and after a run (what was skipped, what failed)
    if (running || snap?.items?.length) {
      box.append(h('ul.tts-all-list', list.map((v) => {
        const pct = v.bytes ? Math.min(100, Math.round(((v.received || 0) / v.bytes) * 100)) : 0;
        const state = {
          skipped: tr({ de: 'vorhanden', en: 'already here' }),
          pending: tr({ de: 'wartet', en: 'waiting' }),
          downloading: `${size(v.received)} / ${size(v.bytes)}`,
          done: tr({ de: 'fertig', en: 'done' }),
          failed: tr({ de: 'fehlgeschlagen', en: 'failed' }),
        }[v.state] || '';
        return h('li.tts-all-item', { class: v.state, title: v.error || '' },
          h('span', voiceName(v)),
          h('div.tts-all-bar', { 'aria-hidden': 'true' }, h('i', { style: { width: (v.state === 'skipped' || v.state === 'done' ? 100 : pct) + '%' } })),
          h('span.tts-all-state', state));
      })));
    }
    box.append(h('p.settings-note.small.muted', tr({
      de: 'Lädt jede deutsche Stimme und das englische Modell einmal von Hugging Face. Stimmen, die schon da sind, werden übersprungen, ein abgebrochener Download geht beim nächsten Mal dort weiter, wo er stand.',
      en: 'Downloads every German voice and the English model once from Hugging Face. Voices that are already here are skipped, a cancelled download goes on where it stopped the next time.',
    })));
  }

  async function start(only) {
    client = client || await getTts();
    if (!client?.downloadAllVoices) return;
    client.downloadAllVoices(only ? { only } : undefined).then(() => refresh()).catch(() => refresh());
  }

  // a finished run: the inventory again, and the voice list of the section (its "60 MB laden" notes) via onDone
  keep(bus.on('tts:downloads', (s) => { snap = s; if (box.isConnected) render(); if (!s.running) { refresh(); onDone?.(); } }));
  keep(bus.on('i18n:change', () => { if (box.isConnected) render(); }));
  refresh();
  return [groupTitle(tr({ de: 'Alle Stimmen', en: 'All voices' })), box];
}
