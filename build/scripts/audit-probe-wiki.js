// Probe: an encyclopedia article. Images of the article (loaded, size, proxy), the drop cap of the first paragraph
// and the figures of the lead section.
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  for (const [title, lang] of [['Bibliothek', 'de'], ['Library', 'en']]) {
    await k.open('wiki', { title, lang }, 9000);
    const r = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('.wiki-content img')];
      const first = document.querySelector('.wiki-content > section:first-child > p, .wiki-content > p');
      return {
        images: imgs.length,
        loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
        broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src').slice(0, 90)).slice(0, 4),
        pending: imgs.filter((i) => !i.complete).length,
        lazy: imgs.filter((i) => i.loading === 'lazy').length,
        srcs: imgs.slice(0, 3).map((i) => i.getAttribute('src').slice(0, 90)),
        firstP: first ? first.textContent.slice(0, 60) : null,
        figures: document.querySelectorAll('.wiki-content figure').length,
      };
    });
    log(`WIKI ${title}: ${JSON.stringify(r)}`);
    await shot('wiki-' + lang);
    await k.closeAll();
  }
  // search with suggestions, a suggestion opens its article; "Zufall" opens a random article; DE/EN switch
  await k.open('wiki', {}, 6000);
  await page.evaluate(() => { const i = document.querySelector('.wiki-search'); i.value = 'Goethe'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(2500);
  const sugs = await page.evaluate(() => [...document.querySelectorAll('.wiki-sug b')].map((b) => b.textContent).slice(0, 4));
  await page.evaluate(() => document.querySelector('.wiki-sug')?.click());
  await sleep(5000);
  log('SEARCH suggestions=' + JSON.stringify(sugs) + ' opened=' + (await k.text('.wiki-content > section:first-child > p, .wiki-content > p')).slice(0, 60));
  await k.clickText('.wiki-panel .btn', 'Zufall', 6000);
  log('RANDOM title=' + (await page.evaluate(() => document.querySelector('.wiki-title, h1')?.textContent || '')).slice(0, 60) + ' paragraphs=' + await k.count('.wiki-content p'));
  await k.clickText('.wiki-panel button', 'EN', 6000);
  log('LANG-EN featured=' + (await k.text('.wiki-panel')).slice(0, 120));
  await k.closeAll();
  log('BAD ' + JSON.stringify(k.badResponses.slice(0, 10)));
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 10)));
};
