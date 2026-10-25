// Local bridge only. Display titles are separate from stable file identities,
// like hosted cloud notebook IDs. Never prune old files.
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class LocalCloudFileError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createLocalCloudFiles(directory) {
  let queue = Promise.resolve();
  const serialized = (action) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const pathFor = (name) => {
    if (typeof name !== 'string' || name !== basename(name) || /[\\/:\x00-\x1f]/.test(name)
      || !/\.(mindatlaspkg|kif|pgn|sgf)$/i.test(name)) {
      throw new LocalCloudFileError(400, 'Invalid cloud notebook file name');
    }
    return join(directory, name);
  };
  const metadataPath = join(directory, '.cloud-titles.json');
  async function titles() {
    try { return JSON.parse(await readFile(metadataPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  async function existing(name) {
    try { return await stat(pathFor(name)); }
    catch (error) {
      if (error.code === 'ENOENT') throw new LocalCloudFileError(404, 'Cloud notebook no longer exists. Refresh the list.');
      throw error;
    }
  }
  async function atomicWrite(path, bytes) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, path);
  }
  async function entry(name) {
    const info = await existing(name);
    const title = (await titles())[name];
    return { name, size: info.size, updatedAt: info.mtime.toISOString(), directory,
      ...(typeof title === 'string' ? { title } : {}) };
  }
  return {
    titles,
    rename: (name, title) => serialized(async () => {
      await existing(name);
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 240 || /[\x00-\x1f]/.test(title)) {
        throw new LocalCloudFileError(400, 'A title of 1 to 240 characters is required');
      }
      const current = await titles();
      await atomicWrite(metadataPath, JSON.stringify({ ...current, [name]: title.trim() }, null, 2));
      return entry(name);
    }),
    overwrite: (name, originalName, bytes, expectedUpdatedAt) => serialized(async () => {
      const before = await existing(name);
      // These are live shared trees, written through AtlasLink/SpaceStore.
      // A cloud file replacement must never detach their identity or metadata.
      if (name.startsWith('space-')) throw new LocalCloudFileError(409, 'Live spaces must be saved through their space, not replaced from the cloud file list.');
      if (extname(name).toLowerCase() !== extname(originalName).toLowerCase()) {
        throw new LocalCloudFileError(400, 'The selected file and current notebook must have the same format');
      }
      if (!expectedUpdatedAt || before.mtime.toISOString() !== expectedUpdatedAt) {
        throw new LocalCloudFileError(409, 'This file changed. Refresh the list before overwriting.');
      }
      const backups = join(directory, '.overwrite-backups');
      await mkdir(backups, { recursive: true });
      await copyFile(pathFor(name), join(backups, `${randomUUID()}-${name}`));
      await atomicWrite(pathFor(name), bytes);
      return entry(name);
    }),
  };
}
