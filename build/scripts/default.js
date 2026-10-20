module.exports = async ({ win, shot, sleep }) => {
  await sleep(4000); await shot('01-start');
  await sleep(15000); await shot('02-later');
  const txt = await win.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log(txt);
};
