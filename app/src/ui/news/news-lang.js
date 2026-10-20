// Which papers the newspaper shows (0.7): those in the language of the interface, English papers only with the English
// interface and German ones only with the German one. settings.news.otherLanguages ("Auch Zeitungen in anderen
// Sprachen") shows every paper. Pure functions, unit-tested in electron/feeds/test-feeds.js.

/** The language of a feed as two letters; a feed without one counts as German (the default of the feed list). */
export const langOfFeed = (f) => (String((f && f.lang) || '').slice(0, 2).toLowerCase() || 'de');

/** The feeds to show for the interface language `lang`; `others` shows all. `keep` (a feed id) stays in any case. */
export function feedsFor(feeds, lang, others = false, keep = null) {
  const l = String(lang || 'de').slice(0, 2).toLowerCase();
  return (feeds || []).filter((f) => others || langOfFeed(f) === l || (keep && f.id === keep));
}

/** The sections with at least one paper to show; 'custom' (own feeds) always stays, it offers "add a feed". */
export function categoriesFor(categories, visibleFeeds) {
  const used = new Set((visibleFeeds || []).map((f) => f.category));
  return (categories || []).filter((c) => c.id === 'custom' || used.has(c.id));
}

/** A key that changes whenever the shown papers change (language or the switch). */
export const filterKey = (lang, others) => `${String(lang || 'de').slice(0, 2)}|${others ? 1 : 0}`;
