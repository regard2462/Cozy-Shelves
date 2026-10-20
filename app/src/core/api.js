// Access to the Electron backend (window.api, see electron/preload.js).
// When running in a plain browser (module development / tests) a small in-memory mock is used.
import { makeMockApi } from './api-mock.js';

// Electron prefixes every error thrown in an IPC handler: "Error invoking remote method 'feeds:fetch': Error: …".
// The panels show error messages to the user, so the prefix is removed once, here.
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/;
export function cleanError(e) {
  if (e && typeof e.message === 'string' && IPC_PREFIX.test(e.message)) {
    try { e.message = e.message.replace(IPC_PREFIX, ''); } catch { /* a frozen error keeps its text */ }
  }
  return e;
}

/**
 * A plain copy of the bridged API whose functions clean rejected promises. It is built once: window.api is
 * frozen by contextBridge, so a Proxy that hands out wrapped sub-objects would break the Proxy invariants.
 * Functions that return no promise (api.on → unsubscribe, library.coverUrl → string) pass through unchanged.
 */
function wrap(src) {
  const out = {};
  for (const key of Object.keys(src)) {
    const v = src[key];
    if (typeof v === 'function') {
      out[key] = (...args) => {
        const r = v(...args);
        return r && typeof r.then === 'function' ? r.catch((e) => { throw cleanError(e); }) : r;
      };
    } else if (v && typeof v === 'object' && !Array.isArray(v)) out[key] = wrap(v);
    else out[key] = v;
  }
  return out;
}

export const api = window.api ? wrap(window.api) : makeMockApi();
// the browser version (api-web.js) installs a window.api of its own and says so (isElectron: false)
export const isElectron = !!window.api && window.api.isElectron !== false;
