// The channels of MediathekViewWeb as the panel shows them: display name, colour (for typographic cards),
// group (Sender grid) and whether they belong to the German-language default selection.
// `id` is the exact channel name of the API (channel.keyword). The English-language sources of 0.7 (group 'en',
// `source` = the module in sources/) are channels of the panel as well; arte English stays a MediathekViewWeb channel.
'use strict';

const CHANNELS = [
  // ARD
  { id: 'ARD', name: 'ARD', long: 'ARD · Das Erste', color: '#0b2a5c', group: 'ard', de: true, big: true },
  { id: 'tagesschau24', name: 'tagesschau24', color: '#0b2a5c', group: 'ard', de: true },
  { id: 'ONE', name: 'ONE', color: '#b0124a', group: 'ard', de: true },
  { id: 'ARD-alpha', name: 'ARD alpha', color: '#3a3a3a', group: 'ard', de: true },
  { id: 'Funk.net', name: 'funk', color: '#2d2d2d', group: 'ard', de: true },
  // ZDF
  { id: 'ZDF', name: 'ZDF', color: '#e0701a', group: 'zdf', de: true, big: true },
  { id: 'ZDFinfo', name: 'ZDFinfo', color: '#c4631a', group: 'zdf', de: true },
  { id: 'ZDFneo', name: 'ZDFneo', color: '#b3184f', group: 'zdf', de: true },
  { id: 'ZDF-tivi', name: 'ZDFtivi', color: '#d88a12', group: 'zdf', de: true },
  // shared channels
  { id: 'ARTE.DE', name: 'arte', color: '#e0461d', group: 'joint', de: true, big: true },
  { id: '3Sat', name: '3sat', color: '#c41a2c', group: 'joint', de: true, big: true },
  { id: 'PHOENIX', name: 'phoenix', color: '#0a6475', group: 'joint', de: true, big: true },
  { id: 'KiKA', name: 'KiKA', color: '#3f8a2d', group: 'joint', de: true, big: true },
  // regional ARD broadcasters
  { id: 'BR', name: 'BR', long: 'Bayerischer Rundfunk', color: '#1a6fb0', group: 'regional', de: true },
  { id: 'HR', name: 'hr', long: 'Hessischer Rundfunk', color: '#0f6a85', group: 'regional', de: true },
  { id: 'MDR', name: 'MDR', long: 'Mitteldeutscher Rundfunk', color: '#1b5c9e', group: 'regional', de: true },
  { id: 'NDR', name: 'NDR', long: 'Norddeutscher Rundfunk', color: '#1d3f78', group: 'regional', de: true },
  { id: 'Radio Bremen TV', name: 'Radio Bremen', color: '#b8151d', group: 'regional', de: true },
  { id: 'RBB', name: 'rbb', long: 'Rundfunk Berlin-Brandenburg', color: '#c8251f', group: 'regional', de: true },
  { id: 'SR', name: 'SR', long: 'Saarländischer Rundfunk', color: '#0d6b82', group: 'regional', de: true },
  { id: 'SWR', name: 'SWR', long: 'Südwestrundfunk', color: '#2b1c56', group: 'regional', de: true },
  { id: 'WDR', name: 'WDR', long: 'Westdeutscher Rundfunk', color: '#123e63', group: 'regional', de: true },
  // international
  { id: 'DW', name: 'DW', long: 'Deutsche Welle', color: '#10508f', group: 'intl', de: true },
  { id: 'ORF', name: 'ORF', color: '#c1121f', group: 'intl', de: true, note: { de: 'Die meisten Sendungen sind nur in Österreich abrufbar.', en: 'Most programmes are only available in Austria.' } },
  { id: 'SRF', name: 'SRF', color: '#a3162b', group: 'intl', de: true },
  { id: 'ARTE.FR', name: 'arte français', color: '#e0461d', group: 'intl', de: false },
  { id: 'ARTE.ES', name: 'arte español', color: '#e0461d', group: 'intl', de: false },
  { id: 'ARTE.IT', name: 'arte italiano', color: '#e0461d', group: 'intl', de: false },
  { id: 'ARTE.PL', name: 'arte polski', color: '#e0461d', group: 'intl', de: false },
  // English-language sources (sources/*.js) and arte's English programmes
  { id: 'DW.EN', name: 'DW', long: 'DW English', color: '#05509b', group: 'en', de: false, lang: 'en', source: 'dw', search: true },
  { id: 'NHK', name: 'NHK WORLD', long: 'NHK WORLD-JAPAN', color: '#c8102e', group: 'en', de: false, lang: 'en', source: 'nhk', search: true },
  { id: 'ARTE.EN', name: 'arte', long: 'arte in English', color: '#e0461d', group: 'en', de: false, lang: 'en', source: 'arte-en', search: true },
  { id: 'NASA', name: 'NASA', long: 'NASA Image and Video Library', color: '#0b3d91', group: 'en', de: false, lang: 'en', source: 'nasa', search: true,
    note: { de: 'Aufnahmen der NASA sind in den USA gemeinfrei.', en: 'NASA footage is in the public domain in the United States.' } },
  { id: 'IA', name: 'Internet Archive', long: { de: 'Gemeinfreie Filme', en: 'Public-domain films' }, color: '#3c3c3c', group: 'en', de: false, lang: 'en', source: 'archive', search: true,
    note: { de: 'Gemeinfreie Filme aus dem Internet Archive, meist auf Englisch.', en: 'Public-domain films from the Internet Archive, mostly in English.' } },
  { id: 'TED', name: 'TED', long: 'TED Talks', color: '#e62b1e', group: 'en', de: false, lang: 'en', source: 'ted', search: true,
    note: { de: 'TED hat im Mai 2025 aufgehört, neue Vorträge als Video-Podcast zu veröffentlichen. Die Vorträge stehen unter CC BY-NC-ND 4.0.', en: 'TED stopped publishing new talks as a video podcast in May 2025. The talks are licensed under CC BY-NC-ND 4.0.' } },
];

const GROUPS = [
  { id: 'ard', label: { de: 'ARD', en: 'ARD' } },
  { id: 'zdf', label: { de: 'ZDF', en: 'ZDF' } },
  { id: 'joint', label: { de: 'Gemeinschaftsprogramme', en: 'Joint channels' } },
  { id: 'regional', label: { de: 'Landesrundfunkanstalten', en: 'Regional broadcasters' } },
  { id: 'intl', label: { de: 'International', en: 'International' } },
  { id: 'en', label: { de: 'Englischsprachig', en: 'English-language' }, lang: 'en' },
];

const byId = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
/** Channels the API knows but that are no public broadcasters (Rocket Beans TV) stay out of the panel. */
const EXCLUDED = new Set(['rbtv', 'RBTV']);
const germanIds = () => CHANNELS.filter((c) => c.de).map((c) => c.id);
const info = (id) => byId[id] || { id, name: id, color: '#5a4632', group: 'intl', de: false };

module.exports = { CHANNELS, GROUPS, byId, info, germanIds, EXCLUDED };
