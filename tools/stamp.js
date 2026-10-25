// Gives the site's files a fresh version number (run: node tools/stamp.js, then commit and push).
// index.html loads app.js?v=N, app.js loads characters.js?v=N, and so on, so a browser that cached an older copy of one
// file can never mix it with a newer copy of another (GitHub Pages lets browsers keep files for 10 minutes).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = ['index.html', 'app.js', 'characters.js'];
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;

for (const f of files) {
  const file = path.join(root, f);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/(\.js)\?v=[0-9A-Za-z]+/g, `$1?v=${version}`);
  if (after !== before) fs.writeFileSync(file, after);
  console.log(`${f}: ${(after.match(/\?v=/g) || []).length} reference(s) -> v=${version}`);
}
