// "Einzelne Geräusche" in the settings (section Klang): a switch for each sound of the world, all on by default. The
// world still decides what plays (audio/soundscape.js); a sound switched off stays silent even when the world brings
// it. Stored in settings.audio.sounds (the old keys audio.fire, rain, clock and wind of 0.6 are not read).
import { tr } from '../core/i18n.js';

// the switches in their order: key of settings.audio.sounds (SOUND_SWITCHES), label, hint
const SWITCHES = [
  ['rain', { de: 'Regen', en: 'Rain' }, { de: 'mit den Tropfen an der Scheibe und dem Trommeln auf dem Dach', en: 'with the drops on the window and the drumming on the roof' }],
  ['wind', { de: 'Wind', en: 'Wind' }, { de: 'mit dem Rauschen der Blätter', en: 'with the rustling of the leaves' }],
  ['thunder', { de: 'Donner', en: 'Thunder' }, null],
  ['fire', { de: 'Kaminfeuer', en: 'Fireplace' }, null],
  ['firebowl', { de: 'Feuerschale', en: 'Fire bowl' }, { de: 'im Garten', en: 'in the garden' }],
  ['clock', { de: 'Wanduhr', en: 'Wall clock' }, null],
  ['birds', { de: 'Vögel', en: 'Birds' }, { de: 'auch Waldkauz, Enten und Teichhuhn', en: 'also the owl, the ducks and the moorhen' }],
  ['frogs', { de: 'Frösche', en: 'Frogs' }, null],
  ['crickets', { de: 'Grillen', en: 'Crickets' }, null],
  ['water', { de: 'Wasser am Steg', en: 'Water at the jetty' }, { de: 'Wellen am Ufer und unter dem Steg', en: 'waves at the shore and under the jetty' }],
  ['steps', { de: 'Schritte', en: 'Footsteps' }, null],
];

/**
 * @param ui { s: () => settings, set(patch), toggle(label, get, apply, opts), groupTitle(text), note(text) } the
 *   primitives of app/src/ui/settings.js
 */
export function soundSwitchRows({ s, set, toggle, groupTitle, note }) {
  const on = (k) => s().audio?.sounds?.[k] !== false;
  return [
    groupTitle(tr({ de: 'Einzelne Geräusche', en: 'Single sounds' })),
    note(tr({ de: 'Ein ausgeschaltetes Geräusch bleibt still, auch wenn die Welt es bringt.', en: 'A sound switched off stays silent, even when the world brings it.' })),
    ...SWITCHES.map(([k, label, hint]) => {
      const row = toggle(tr(label), () => on(k), (v) => set({ audio: { sounds: { [k]: v } } }), { hint: hint ? tr(hint) : null });
      row.dataset.sound = k;
      return row;
    }),
  ];
}
