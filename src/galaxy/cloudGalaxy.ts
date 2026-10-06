/**
 * Cloud files as galaxies.
 *
 * Every Mind Atlas file in the person's cloud list (the "Cloud load" list) is
 * shown in the galaxy view as its own galaxy, so the whole body of work is
 * visible at once and any file can be entered from there. The list is read when
 * the galaxy opens; each file's tree is then fetched in the background, a few
 * at a time, and cached in memory for this page session only — nothing extra is
 * written to the device, so signing out leaves no copy behind.
 *
 * Mode: shared-core. Hosted mode reads the signed-in account's cloud files;
 * local developer mode reads the bridge's cloud directory. Neither call is made
 * unless the galaxy is open.
 */
import { create } from 'zustand';
import { downloadCloudNotebookPackage, listCloudNotebookPackages } from '../ai/bridgeClient';
import { importNativeBoardRecord, importNativeBoardRecordFile } from '../features/board/boardRecord';
import { listHostedCloudNotebooks, loadHostedCloudNotebook } from '../hosted/serviceClient';
import { readNotebookPackageTree } from '../notebookPackage';
import { createTextOnlyNotebookRoot } from '../notebookTextOnly';
import type { AtlasNode, CloudNotebookEntry } from '../types';

export const CLOUD_SPACE_PREFIX = 'cloud:';
/** Files larger than this stay on the map as a single named star. */
const MAX_GALAXY_BYTES = 6 * 1024 * 1024;
const CONCURRENCY = 3;
const PALETTE = ['#7fb7ff', '#f2b56b', '#b59cf0', '#6fd8b0', '#f08fb3', '#9fd36b', '#6fc7e8', '#e8c36f', '#d494e8', '#8fa8ff'];

export type CloudFileStatus = 'pending' | 'loading' | 'ready' | 'error' | 'too-large';

export interface CloudGalaxyFile {
  key: string;
  spaceId: string;
  entry: CloudNotebookEntry;
  title: string;
  color: string;
  status: CloudFileStatus;
  root: AtlasNode | null;
  error?: string;
}

interface CloudGalaxyState {
  status: 'idle' | 'listing' | 'ready' | 'unavailable' | 'error';
  files: CloudGalaxyFile[];
  /** The file the current notebook was loaded from: it is already on the map as the active space. */
  currentKey: string | null;
  error: string;
}

export const useCloudGalaxy = create<CloudGalaxyState>(() => ({ status: 'idle', files: [], currentKey: null, error: '' }));

export function cloudFileKey(entry: CloudNotebookEntry) {
  return entry.id || entry.name;
}
export function cloudSpaceId(key: string) {
  return `${CLOUD_SPACE_PREFIX}${key}`;
}
export function isCloudSpaceId(spaceId: string) {
  return spaceId.startsWith(CLOUD_SPACE_PREFIX);
}

function colorFor(key: string) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return PALETTE[(hash >>> 0) % PALETTE.length];
}

/** A root keeps its own colour unless it is the untouched default every new notebook starts with. */
function ownColor(root: AtlasNode) {
  const color = (root.color || '').toLowerCase();
  return color && color !== '#8df5cf' ? root.color : null;
}

function titleFor(entry: CloudNotebookEntry) {
  return (entry.title || entry.name || 'Mind Atlas').replace(/\.(mindatlaspkg|mindatlas|json|kif|ki2|csa|pgn|sgf)$/i, '');
}

/** Trees fetched during this page session, keyed by file and its last update. */
const sessionCache = new Map<string, AtlasNode>();
let generation = 0;

function stamp(root: AtlasNode, title: string): AtlasNode {
  return { ...root, title: root.title || title };
}

async function fetchTree(entry: CloudNotebookEntry, hosted: boolean): Promise<AtlasNode> {
  if (hosted) {
    if (!entry.id) throw new Error('Cloud file id is missing.');
    const result = await loadHostedCloudNotebook(entry.id);
    if (result.record) return (await importNativeBoardRecord(result.record)).root;
    if (!result.root) throw new Error('Cloud file content is missing.');
    return createTextOnlyNotebookRoot(result.root);
  }
  const blob = await downloadCloudNotebookPackage(entry.name);
  if (/\.(kif|ki2|csa|pgn|sgf)$/i.test(entry.name)) {
    return (await importNativeBoardRecordFile(new File([blob], entry.name, { type: 'text/plain' }))).root;
  }
  return await readNotebookPackageTree(new File([blob], entry.name, { type: 'application/x-mindatlas-package' }));
}

function patchFile(key: string, patch: Partial<CloudGalaxyFile>, run: number) {
  if (run !== generation) return;
  useCloudGalaxy.setState(state => ({ files: state.files.map(file => (file.key === key ? { ...file, ...patch } : file)) }));
}

/**
 * Read the cloud list and fetch every file's tree in the background. Safe to
 * call repeatedly: a newer call supersedes an older one, and trees already
 * fetched for the same file version are reused.
 */
let lastAccount: string | null = null;

export async function refreshCloudGalaxy(options: { hosted: boolean; signedIn: boolean; accountId: string | null; currentKey: string | null }) {
  // Another account's files must never show, even from this session's cache.
  if (options.accountId !== lastAccount) {
    lastAccount = options.accountId;
    clearCloudGalaxy();
  }
  const run = ++generation;
  useCloudGalaxy.setState({ currentKey: options.currentKey });
  if (options.hosted && !options.signedIn) {
    useCloudGalaxy.setState({ status: 'unavailable', files: [], error: '' });
    return;
  }
  useCloudGalaxy.setState(state => ({ status: state.files.length ? state.status : 'listing', error: '' }));
  let entries: CloudNotebookEntry[];
  try {
    entries = (options.hosted ? await listHostedCloudNotebooks() : await listCloudNotebookPackages()).notebooks;
  } catch (error) {
    if (run !== generation) return;
    // Local mode without a running bridge simply has no cloud directory.
    useCloudGalaxy.setState({ status: options.hosted ? 'error' : 'unavailable', error: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (run !== generation) return;
  const previous = new Map(useCloudGalaxy.getState().files.map(file => [file.key, file]));
  const files: CloudGalaxyFile[] = entries
    .slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(entry => {
      const key = cloudFileKey(entry);
      const cached = sessionCache.get(`${key}@${entry.updatedAt}`);
      const kept = previous.get(key);
      const title = titleFor(entry);
      const tooLarge = entry.size > MAX_GALAXY_BYTES;
      return {
        key, spaceId: cloudSpaceId(key), entry, title, color: (cached && ownColor(cached)) ?? colorFor(key),
        status: cached ? 'ready' : tooLarge ? 'too-large' : kept?.status === 'ready' && kept.entry.updatedAt === entry.updatedAt ? 'ready' : 'pending',
        root: cached ?? (kept?.entry.updatedAt === entry.updatedAt ? kept.root : null),
      } satisfies CloudGalaxyFile;
    });
  useCloudGalaxy.setState({ status: 'ready', files });
  const queue = files.filter(file => file.status === 'pending' && file.key !== options.currentKey);
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (run !== generation) return;
      patchFile(next.key, { status: 'loading' }, run);
      try {
        const root = stamp(await fetchTree(next.entry, options.hosted), next.title);
        sessionCache.set(`${next.key}@${next.entry.updatedAt}`, root);
        // The file's galaxy takes its root's colour, like its planets in the universe.
        patchFile(next.key, { status: 'ready', root, color: ownColor(root) ?? next.color }, run);
      } catch (error) {
        patchFile(next.key, { status: 'error', error: error instanceof Error ? error.message : String(error) }, run);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/** A file too large to fetch is still a named star on the map. */
export function placeholderRoot(file: CloudGalaxyFile): AtlasNode {
  const now = file.entry.updatedAt || new Date().toISOString();
  return {
    id: `cloud-root-${file.key}`,
    kind: 'root',
    nodeType: 'note',
    title: file.title,
    subtitle: '',
    body: '',
    summary: '',
    author: 'human',
    status: 'waiting',
    color: file.color,
    texture: 'speckled',
    radius: 48,
    nextDecision: '',
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children: [],
  } as unknown as AtlasNode;
}

/** Forget the account's files (sign-out, account switch). */
export function clearCloudGalaxy() {
  generation++;
  sessionCache.clear();
  useCloudGalaxy.setState({ status: 'idle', files: [], currentKey: null, error: '' });
}
