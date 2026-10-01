// Brace-balance sanity check for a CSS file (catches splice mistakes).
const fs = require('fs');
const p = process.argv[2];
const css = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let depth = 0;
let line = 1;
let bad = null;
for (const ch of css) {
  if (ch === '\n') line += 1;
  if (ch === '{') depth += 1;
  if (ch === '}') {
    depth -= 1;
    if (depth < 0 && !bad) bad = line;
  }
}
console.log(`${p}`);
console.log(`  final depth: ${depth} ${depth === 0 ? '(balanced)' : '(UNBALANCED)'}`);
if (bad) console.log(`  closing brace without opener at line ~${bad}`);
process.exit(depth === 0 && !bad ? 0 : 1);
