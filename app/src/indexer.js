// Hidden indexer window: extracts metadata, cover image, page count and a text sample
// from a book file (core/index-book.js: foliate-js for EPUB/MOBI/AZW3/FB2/CBZ, pdf.js for PDF).
// It also decodes pictures for the main process (image jobs): covers from the internet and the check whether
// page 1 of a book is a cover at all (electron/library/cover-match.js has the measurements, web-covers.js the rest).
import { indexBook, imageJob } from './core/index-book.js';

const log = (...a) => { const el = document.getElementById('log'); if (el) el.textContent = (a.join(' ') + '\n' + el.textContent).slice(0, 5000); };

async function run(job) {
  log('index', job.name);
  const result = await indexBook(job);
  if (result.error) log('failed', job.name, result.error);
  await window.indexerApi.result(job.id, result);
}

window.indexerApi.onJob((job) => run(job));
window.indexerApi.onImageJob?.(async (job) => {
  let result;
  try { result = await imageJob(job); } catch (e) { result = { ok: false, error: e.message }; }
  window.indexerApi.imageResult(job.id, result);
});
window.indexerApi.ready();
