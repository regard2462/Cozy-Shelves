// Why a film does not play or load, as a short German sentence for the panel and the mini player.
// kind: 'geo' | 'gone' | 'offline' | 'forbidden' | 'server' | 'live' | 'encrypted' | 'format' | 'unknown'
'use strict';

const MESSAGES = {
  geo: 'Diese Sendung ist in deinem Land gesperrt (Geoblocking). Die Sender dürfen manche Filme nur in Deutschland, Österreich oder der Schweiz zeigen.',
  'geo-at': 'Diese Sendung zeigt der ORF nur in Österreich (Geoblocking).',
  'geo-ch': 'Diese Sendung zeigt der SRF nur in der Schweiz (Geoblocking).',
  gone: 'Diese Sendung ist nicht mehr in der Mediathek. Die Sender bieten Filme nur für eine begrenzte Zeit an.',
  offline: 'Keine Verbindung zum Sender. Bitte die Internetverbindung prüfen.',
  forbidden: 'Der Sender verweigert den Abruf dieser Sendung.',
  server: 'Der Server des Senders hat gerade eine Störung. Bitte später noch einmal versuchen.',
  live: 'Live-Übertragungen lassen sich nicht herunterladen.',
  encrypted: 'Diese Sendung ist verschlüsselt und lässt sich nicht speichern.',
  format: 'Das Videoformat wird nicht unterstützt.',
  unknown: 'Die Sendung lässt sich gerade nicht abspielen.',
};

/**
 * Classify an HTTP answer / network error.
 *   status   HTTP status (0 = no answer)
 *   url      the address that was requested, finalUrl the one after redirects
 *   error    network error message (Chromium net:: codes, Node errors)
 */
function classify({ status = 0, url = '', finalUrl = '', error = '' } = {}) {
  const u = `${url} ${finalUrl}`;
  if (/geoprotection|geoblock|geo_block|\/geo-?sperre/i.test(finalUrl || '')) return /apa\.at|orf/i.test(u) ? 'geo-at' : 'geo';
  if (status === 451) return /apa\.at|orf/i.test(u) ? 'geo-at' : 'geo';
  if (error && !status) {
    if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo|ERR_NETWORK_CHANGED|ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_CONNECTION_RESET|ERR_ADDRESS_UNREACHABLE|fetch failed|ETIMEDOUT|ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT/i.test(error)) return 'offline';
    return 'unknown';
  }
  if (status === 403) {
    if (/cms-austria|apa\.at/i.test(u)) return 'geo-at';
    if (/srgssr|srf-vod|\/ch\//i.test(u) && !/\/world\//i.test(u)) return 'geo-ch';
    if (/akamaihd\.net\/(de|dach)\/|\/geo\/|deutschlandweit|geo/i.test(u)) return 'geo';
    return 'forbidden';
  }
  if (status === 404 || status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status >= 400) return 'forbidden';
  return 'unknown';
}

const message = (kind) => MESSAGES[kind] || MESSAGES.unknown;

module.exports = { classify, message, MESSAGES };
