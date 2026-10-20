// Developer probe: resolves every Windows shortcut (.lnk) below LNK_DIR in the main process and prints the target
// and whether it exists (shell.readShortcutLink).
const fs = require('fs'), path = require('path');
module.exports = async ({ app }) => {
  const lnks = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.lnk$/i.test(e.name)) lnks.push(p); } };
  walk(process.env.LNK_DIR);
  const res = await app.evaluate(({ shell }, list) => list.map((p) => { try { return { lnk: p, target: shell.readShortcutLink(p).target }; } catch (x) { return { lnk: p, err: x.message }; } }), lnks);
  for (const r of res) { r.exists = !!r.target && fs.existsSync(r.target); if (!r.exists) console.log('LNK ' + JSON.stringify(r)); }
  console.log('LNK-SUMMARY ' + JSON.stringify({ n: res.length, ok: res.filter((r) => r.exists).length }));
};
