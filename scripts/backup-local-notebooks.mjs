// Offline, local-only backup. Never modifies the source directory.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const source = resolve('server-data/notebooks');
const destination = resolve('artifacts/local-cloud-backups', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(destination, { recursive: true });
const inventory = [];
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const bytes = await readFile(join(source, entry.name));
  await writeFile(join(destination, entry.name), bytes, { flag: 'wx' });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const copied = await readFile(join(destination, entry.name));
  if (createHash('sha256').update(copied).digest('hex') !== sha256) throw new Error('Backup verification failed');
  inventory.push({ name: entry.name, size: bytes.length, sha256 });
}
await writeFile(join(destination, 'inventory.json'), JSON.stringify(inventory, null, 2));
console.log(JSON.stringify({ destination, count: inventory.length, bytes: inventory.reduce((sum, file) => sum + file.size, 0) }));
