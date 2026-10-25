// Compare user notebooks to an earlier backup without changing source data.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
const backup = resolve(process.argv[2]);
const inventory = JSON.parse(await readFile(join(backup, 'inventory.json'), 'utf8'));
const directory = resolve('server-data/notebooks');
const names = await readdir(directory);
const missing = [];
const changed = [];
for (const file of inventory) {
  if (!names.includes(file.name)) { missing.push(file.name); continue; }
  const bytes = await readFile(join(directory, file.name));
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) changed.push(file.name);
}
const groups = {};
for (const file of inventory) {
  const base = file.name.replace(/-\d{3}(?=\.[^.]+$)/, '');
  groups[base] = (groups[base] || 0) + 1;
}
const report = { originalCount: inventory.length, currentCount: names.length, missing, changed,
  groups: Object.entries(groups).filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]) };
await writeFile(join(backup, 'preservation-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (missing.length || changed.some((name) => !name.startsWith('space-'))) process.exitCode = 1;
