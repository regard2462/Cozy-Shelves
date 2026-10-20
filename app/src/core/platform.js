// Where the app runs and what the backend offers. The desktop (Electron) has everything; the browser version
// (app/src/core/api-web.js) sets `api.platform` and lists in `api.features` what it leaves out, and the UI asks here
// instead of testing window.api everywhere.
//   platform  'desktop' | 'web' | 'android'   (the Android app is the web build in a WebView, see docs/strands/android-plan.md)
//   has(f)    is the feature there? Unknown features are there (the desktop lists none).
//   touch     the primary input is a touch screen (a phone, a tablet); the pointer events of input/touch.js then
//             steer the player, the on-screen controls come with the Android strand
import { api } from './api.js';

const qp = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
const forced = qp.get('platform');
export const platform = ['desktop', 'web', 'android'].includes(forced) ? forced : (api.platform || 'desktop');
export const isWeb = platform !== 'desktop';
export const isAndroid = platform === 'android';
export const touch = typeof window !== 'undefined' && (qp.get('touch') === '1' || (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches));

/** Is this feature available on this platform? The desktop has every feature. */
export function has(feature) {
  const f = api.features;
  return !f || f[feature] !== false;
}

/** The note shown when a desktop-only thing is used in the browser (bilingual, one sentence). */
export const UNAVAILABLE = {
  de: 'Das gibt es nur in der Cozy-Shelves-App für den Desktop.',
  en: 'This is only available in the Cozy Shelves desktop app.',
};

/**
 * Graphics defaults for the first start on this device: a phone or a tablet starts with the quality 'mobile' (no bloom,
 * shadows, ambient occlusion or god rays, a budget of pixels: world.js), a browser on a computer starts medium, the
 * desktop app keeps its own defaults. The user's own choice in the settings always wins (this only fills a fresh
 * profile; core/api-web.js has the same for the browser version).
 */
export function graphicsPreset() {
  if (isAndroid || touch) return { quality: 'mobile', bloom: false, shadows: false, ssao: false, godrays: false, resolutionScale: 1 };
  if (isWeb) return { quality: 'medium', bloom: true, shadows: true, ssao: false, godrays: false, resolutionScale: 1 };
  return null;
}
