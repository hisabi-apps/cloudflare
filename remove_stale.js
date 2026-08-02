const fs = require('fs');
const path = 'c:/Users/LENOVO/hisabi_univ_fixed/hisabi_univ_pro/cloudflare_r2_backend/index.js';
let text = fs.readFileSync(path, 'utf8');
const subjectStart = text.indexOf("app.get('/api/subjects'");
const filesRoot = text.indexOf("app.get('/files', (req, res) => {", subjectStart);
if (subjectStart < 0 || filesRoot < 0) {
  throw new Error(`markers not found subjectStart=${subjectStart} filesRoot=${filesRoot}`);
}
text = text.slice(0, subjectStart) + text.slice(filesRoot);
fs.writeFileSync(path, text, 'utf8');
console.log('removed stale inline block', subjectStart, filesRoot);
