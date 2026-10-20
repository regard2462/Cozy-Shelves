// The season of the world, shared by every module that changes with it (the garden's plants: blossoms, leaves, snow;
// the animals and birds: who is about; the garden sounds). Data only, no meshes.
//   settings.season: 'auto' (the calendar month, northern hemisphere) | 'spring' | 'summer' | 'autumn' | 'winter'
// A module reads seasonOf(settings.season) when it builds or when the settings change.
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** The season of a date in the northern hemisphere: March to May spring, June to August summer, September to
 *  November autumn, December to February winter. */
export function seasonOfDate(d = new Date()) {
  const m = d.getMonth();
  return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
}

/** The season a setting asks for ('auto', a missing or an unknown value: the calendar). */
export function seasonOf(setting, d = new Date()) {
  return SEASONS.includes(setting) ? setting : seasonOfDate(d);
}
