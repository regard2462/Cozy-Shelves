// Network layer for the catalog sources: thin wrappers around feeds/common (timeouts, UA, charset
// sniffing) plus a small memory/disk cache. Sources receive this object as `net`, tests inject a fake.
// Two things are handled here for every source:
//   * hosts without a TLS listener (zeno.org!) – one https→http downgrade retry, remembered per host,
//   * memoisation keys that contain the options which change the response (xml sniffing, Accept).
'use strict';
const path = require('path');
const C = require('../feeds/common');

const MEMO_TTL = 10 * 60 * 1000;
const STREAM_CONNECT_TIMEOUT = 30000;
/** Errors that can mean "this host does not speak TLS" – Chromium net:: codes plus Node/undici ones. */
const DOWNGRADE_RE = /ERR_CONNECTION_TIMED_OUT|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_SSL|ERR_CERT|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ERR_ADDRESS_UNREACHABLE|timeout after|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPROTO|socket hang up/i;

const isDowngradable = (err) => DOWNGRADE_RE.test(String((err && err.message) || err || ''));
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };
const toHttp = (url) => String(url).replace(/^https:/i, 'http:');

function createNet({ cacheDir, ua, io } = {}) {
  const memo = new Map();
  const cache = cacheDir ? new C.DiskCache(path.join(cacheDir), { memoryLimit: 20 }) : null;
  // hosts that answered only over plain http (learned at runtime, e.g. www.zeno.org)
  const httpOnly = new Set();
  const F = { fetchText: C.fetchText, fetchJson: C.fetchJson, fetchRaw: C.fetchRaw, fetchStream: defaultStream, ...(io || {}) };
  // No blanket 'Api-User-Agent': only the MediaWiki APIs ask for it (mediawiki.js sets it per call);
  // on every other host it is just an unusual header for bot management to score on.
  const headers = (h) => ({ ...(h || {}) });

  /** Run `fn` for `url`; on a TLS-level failure retry once over http:// and remember the host. */
  async function attempt(url, fn) {
    let target = String(url);
    // net.fetch would also answer file: and the app's own schemes (feeds/common.js fetchRaw): web addresses only, here
    // as well because tests and the download inject their own fetch functions
    if (!C.isWebAddress(target)) throw new Error('not a web address: ' + target.slice(0, 120));
    const host = hostOf(target);
    if (host && httpOnly.has(host) && /^https:/i.test(target)) target = toHttp(target);
    try {
      return await fn(target);
    } catch (e) {
      if (!/^https:/i.test(target) || !isDowngradable(e)) throw e;
      const r = await fn(toHttp(target));
      if (host) httpOnly.add(host);
      return r;
    }
  }

  const memoGet = (key, ttl) => { const m = memo.get(key); return m && Date.now() - m.at < ttl ? m.data : undefined; };
  const memoSet = (key, data) => { memo.set(key, { at: Date.now(), data }); if (memo.size > 200) memo.delete(memo.keys().next().value); };

  const net = {
    ua: ua || C.BROWSER_UA,
    /** true once this host had to be downgraded to plain http */
    isHttpOnly: (url) => { const h = hostOf(url); return !!(h && httpOnly.has(h)); },
    async json(url, opts = {}) {
      const key = `j:${url}|${(opts.headers && opts.headers.Accept) || ''}`;
      const hit = memoGet(key, opts.ttl ?? MEMO_TTL);
      if (hit !== undefined) return hit;
      const data = await attempt(url, (u) => F.fetchJson(u, { timeout: opts.timeout || 20000, ua: opts.ua || net.ua, headers: headers(opts.headers) }));
      if ((opts.ttl ?? MEMO_TTL) > 0) memoSet(key, data);
      return data;
    },
    /** Some APIs (LibriVox, DSpace) answer JSON with odd content types or HTML error pages – parse leniently. */
    async jsonLenient(url, opts = {}) {
      const r = await net.text(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const t = r.text.trim();
      try { return JSON.parse(t); } catch {}
      const i = t.search(/[\[{]/);
      if (i >= 0) { try { return JSON.parse(t.slice(i)); } catch {} }
      throw new Error('invalid JSON from ' + url);
    },
    async text(url, opts = {}) {
      // the key must contain everything that changes the decoded text: charset sniffing (xml) and the
      // Accept header (an API answering JSON vs. the same URL answering its HTML landing page)
      const key = `t:${url}|${opts.xml ? 'x' : ''}|${(opts.headers && opts.headers.Accept) || ''}`;
      const hit = memoGet(key, opts.ttl ?? MEMO_TTL);
      if (hit !== undefined) return hit;
      const r = await attempt(url, (u) => F.fetchText(u, { timeout: opts.timeout || 25000, ua: opts.ua || net.ua, headers: headers(opts.headers), xml: !!opts.xml }));
      if (r.ok && (opts.ttl ?? MEMO_TTL) > 0) memoSet(key, r);
      return r;
    },
    raw(url, opts = {}) { return attempt(url, (u) => F.fetchRaw(u, { timeout: opts.timeout || 30000, ua: opts.ua || net.ua, headers: headers(opts.headers) })); },
    /** Streaming fetch with a connect deadline (Electron net.fetch when available). Returns the Response. */
    stream(url, opts = {}) {
      return attempt(url, (u) => F.fetchStream(u, {
        headers: { 'User-Agent': net.ua, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7', ...headers(opts.headers) },
        signal: opts.signal, timeout: opts.timeout || STREAM_CONNECT_TIMEOUT,
      }));
    },
    cache: {
      get(key) { return cache ? cache.get(key) : null; },
      set(key, data) { return cache ? cache.set(key, data) : { at: Date.now(), data }; },
    },
    clear() { memo.clear(); },
  };
  return net;
}

/** fetch with a connect / first-byte deadline; the caller's signal still aborts the body afterwards. */
async function defaultStream(url, { headers, signal, timeout = STREAM_CONNECT_TIMEOUT } = {}) {
  let doFetch = globalThis.fetch;
  try { const e = require('electron'); if (e && typeof e === 'object' && e.net && typeof e.net.fetch === 'function') doFetch = e.net.fetch.bind(e.net); } catch {}
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('Zeitüberschreitung beim Verbinden')), timeout);
  let sig = ctrl.signal;
  if (signal) {
    if (typeof AbortSignal.any === 'function') sig = AbortSignal.any([signal, ctrl.signal]);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  try {
    const res = await doFetch(url, { method: 'GET', redirect: 'follow', signal: sig, headers });
    return res;
  } catch (e) {
    if (ctrl.signal.aborted && !(signal && signal.aborted)) throw new Error('Zeitüberschreitung beim Verbinden mit ' + url);
    throw e;
  } finally { clearTimeout(timer); }
}

module.exports = { createNet, isDowngradable };
