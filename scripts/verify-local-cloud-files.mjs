import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalCloudFiles } from './local-cloud-files.mjs';

// Real filesystem fixtures only. Never connect to 5173/8787 or user notebooks.
const dir = await mkdtemp(join(tmpdir(), 'mind-atlas-cloud-test-'));
const store = createLocalCloudFiles(dir);
let checks = 0;
async function rejects(action, status) {
  await assert.rejects(action, (error) => error.status === status);
  checks++;
}
for (const extension of ['mindatlaspkg', 'kif', 'pgn', 'sgf']) {
  const name = `old-001.${extension}`;
  const other = `old-002.${extension}`;
  await writeFile(join(dir, name), 'original');
  await writeFile(join(dir, other), 'history');
  const renamed = await store.rename(name, '新しい名前');
  assert.equal(renamed.name, name);
  assert.equal((await store.titles())[name], '新しい名前');
  assert.equal(await readFile(join(dir, name), 'utf8'), 'original');
  const updated = await store.overwrite(name, `current.${extension}`, Buffer.from('updated'), renamed.updatedAt);
  assert.equal(updated.name, name);
  assert.equal(updated.title, '新しい名前');
  assert.equal(await readFile(join(dir, name), 'utf8'), 'updated');
  assert.equal(await readFile(join(dir, other), 'utf8'), 'history');
  const backupNames = await readdir(join(dir, '.overwrite-backups'));
  const backup = backupNames.find((file) => file.endsWith(`-${name}`));
  assert.equal(await readFile(join(dir, '.overwrite-backups', backup), 'utf8'), 'original');
  await rejects(() => store.overwrite(name, `current.${extension}`, Buffer.from('stale'), '2000-01-01T00:00:00.000Z'), 409);
  checks++;
}
await rejects(() => store.rename('../escape.mindatlaspkg', 'bad'), 400);
await rejects(() => store.rename('nested\\escape.kif', 'bad'), 400);
await rejects(() => store.rename('missing.kif', 'bad'), 404);
await rejects(() => store.rename('old-001.kif', '   '), 400);
await rejects(() => store.rename('old-001.kif', 'x'.repeat(241)), 400);
const old = await store.rename('old-001.kif', 'KIF');
await rejects(() => store.overwrite(old.name, 'wrong.sgf', Buffer.from('bad'), old.updatedAt), 400);
await rejects(() => store.overwrite(old.name, 'current.kif', Buffer.from('bad')), 409);
await writeFile(join(dir, 'space-test.mindatlaspkg'), 'live space');
await rejects(() => store.overwrite('space-test.mindatlaspkg', 'current.mindatlaspkg', Buffer.from('bad'), old.updatedAt), 409);
await Promise.all([
  store.rename('old-001.pgn', 'Chess'),
  store.rename('old-001.sgf', 'Go'),
]);
const reopened = createLocalCloudFiles(dir);
assert.equal((await reopened.titles())['old-001.pgn'], 'Chess');
assert.equal((await reopened.titles())['old-001.sgf'], 'Go');
assert.equal(await readFile(join(dir, 'space-test.mindatlaspkg'), 'utf8'), 'live space');
checks++;
console.log(`Local cloud files: ${checks} checks passed. Fixtures: ${dir}`);
