// Host lists for the reading browser's content blocker (electron/browser/index.js).
// A compact selection of the ad, tracking and measurement networks that EasyList / EasyPrivacy block on
// almost every news site, including the German measurement services (INFOnline/IVW, etracker, Webtrekk).
// Matching is by host suffix: "ads.example.com" matches the entry "example.com".
'use strict';

const ADS = `
doubleclick.net googlesyndication.com googleadservices.com googletagservices.com adservice.google.com adservice.google.de
2mdn.net admob.com adnxs.com adnxs-simple.com adsrvr.org advertising.com amazon-adsystem.com
adform.net adform.com adition.com adscale.de adtech.de adtechus.com adzerk.net appnexus.com bidswitch.net casalemedia.com
contextweb.com criteo.com criteo.net districtm.io dotomi.com emxdgt.com exponential.com gumgum.com indexww.com inmobi.com
lijit.com media.net mathtag.com moatads.com mookie1.com openx.net outbrain.com outbrainimg.com taboola.com
taboolasyndication.com plista.com pubmatic.com quantserve.com quantcount.com rubiconproject.com sharethrough.com
smartadserver.com sonobi.com spotxchange.com spotx.tv springserve.com teads.tv tremorhub.com triplelift.com 3lift.com
turn.com yieldlab.net yieldlab.de yieldlove.com yieldlove-ad-serving.net yieldmo.com zemanta.com 33across.com
adsafeprotected.com doubleverify.com serving-sys.com flashtalking.com adroll.com seedtag.com theadex.com adalliance.io
adup-tech.com ligatus.com nativendo.de adspirit.de ayads.co relevant-digital.com 360yield.com improvedigital.com a-mo.net
smaato.net bidr.io justpremium.com adhese.com richaudience.com onetag-sys.com sovrn.com permutive.com permutive.app
id5-sync.com liveintent.com rlcdn.com tapad.com crwdcntrl.net bluekai.com exelator.com demdex.net everesttech.net
adsymptotic.com agkn.com eyeota.net semasio.net nuggad.net emetriq.de emetriq.com meetrics.net meetrics.de xplosion.de
adsco.re adkernel.com adnami.io advertserve.com amgdgt.com
betweendigital.com bidtellect.com bttrack.com clickagy.com connatix.com consumable.com cpx.to
dianomi.com e-planning.net engageya.com exoclick.com fqtag.com gemius.pl gemius.com hadronid.net
imrworldwide.com innovid.com intentiq.com ipredictive.com kargo.com krxd.net lkqd.net mgid.com mobfox.com
nexac.com omnitagjs.com onaudience.com popads.net popcash.net propellerads.com pubnative.net
revcontent.com rfihub.com rhythmone.com rtbhouse.com rtmark.net sekindo.com smartclip.net
smartstream.tv stickyadstv.com tidaltv.com tribalfusion.com undertone.com unrulymedia.com videohub.tv
vidoomy.com w55c.net weborama.fr weborama.com xaxis.com yieldmanager.com zedo.com
adsnative.com adocean.pl ad4mat.de ad4mat.net
`;

const TRACKERS = `
google-analytics.com googletagmanager.com analytics.google.com ssl.google-analytics.com stats.g.doubleclick.net
ioam.de iocnt.net ivwbox.de infonline.de webtrekk.net wt-eu02.net wt-safetag.com etracker.com etracker.de
econda-monitor.de xiti.com ati-host.net chartbeat.com chartbeat.net scorecardresearch.com comscore.com hotjar.com
hotjar.io mouseflow.com crazyegg.com fullstory.com clarity.ms luckyorange.com inspectlet.com bat.bing.com
connect.facebook.net static.ads-twitter.com ads-twitter.com analytics.twitter.com snap.licdn.com px.ads.linkedin.com
analytics.tiktok.com ct.pinterest.com sc-static.net tr.snapchat.com cdn.segment.com api.segment.io mixpanel.com
api.amplitude.com cdn.amplitude.com heapanalytics.com optimizely.com cdn.optimizely.com nr-data.net
js-agent.newrelic.com omtrdc.net 2o7.net mc.yandex.ru statcounter.com bounceexchange.com bouncex.net cxense.com
cdn.onesignal.com onesignal.com pushengage.com kameleoon.eu kameleoon.com trbo.com
quantummetric.com contentsquare.net cdn.mxpnl.com dpm.demdex.net metrics.brightcove.com
parsely.com cdn.parsely.com pixel.wp.com stats.wp.com matomo.cloud piwik.pro
`;

// Query parameters that only exist to follow the reader around. They are removed from every top-level
// navigation while the blocker is on (the page itself never needs them).
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name', 'utm_reader',
  'utm_referrer', 'utm_social', 'utm_brand', 'utm_pubreferrer', 'utm_swu', 'utm_viz_id',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', '_hsenc', '_hsmi',
  'mkt_tok', 'yclid', 'ysclid', 'twclid', 'ttclid', 'li_fat_id', 's_cid', 'wt_mc', 'wt_zmc', 'ref_src',
  '__twitter_impression', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'at_medium', 'at_campaign', 'at_custom1',
  'at_custom2', 'at_custom3', 'at_custom4', 'ncid', 'cmpid', 'ito', 'xtor',
];

const toSet = (s) => new Set(s.split(/\s+/).map((x) => x.trim().toLowerCase()).filter((x) => x && /^[a-z0-9.-]+$/.test(x)));
const BLOCKED = new Set([...toSet(ADS), ...toSet(TRACKERS)]);

/** true when `host` or one of its parent domains is on the list. */
function isBlockedHost(host) {
  let h = String(host || '').toLowerCase().replace(/\.$/, '');
  for (let i = 0; i < 8 && h; i++) {
    if (BLOCKED.has(h)) return true;
    const dot = h.indexOf('.');
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return false;
}

/** The entry of the list that matches `host` (used to allow a blocked network on its own site). */
function blockedEntry(host) {
  let h = String(host || '').toLowerCase();
  for (let i = 0; i < 8 && h; i++) {
    if (BLOCKED.has(h)) return h;
    const dot = h.indexOf('.');
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return null;
}

/** Removes the tracking parameters from a URL; returns the URL unchanged when there are none. */
function stripTracking(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (!u.search) return url;
  let changed = false;
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.includes(key.toLowerCase())) { u.searchParams.delete(key); changed = true; }
  }
  return changed ? u.href : url;
}

module.exports = { isBlockedHost, blockedEntry, stripTracking, TRACKING_PARAMS, size: BLOCKED.size };
