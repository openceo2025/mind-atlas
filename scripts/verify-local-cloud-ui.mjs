// Isolated local-only UI verification. No calls to the owner's bridge/data.
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
import { createLocalCloudFiles } from './local-cloud-files.mjs';

const dir = await mkdtemp(join(tmpdir(), 'mind-atlas-cloud-ui-'));
const files = createLocalCloudFiles(dir);
const original = 'old-001.mindatlaspkg';
await writeFile(join(dir, original), 'original fixture');
await writeFile(join(dir, 'old-002.mindatlaspkg'), 'history fixture');
await writeFile(join(dir, 'space-test.mindatlaspkg'), 'live fixture');
let overwrites = 0;
let newSaves = 0;
const bridge = createHttpServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') { response.end(); return; }
  const send = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
  try {
    const path = new URL(request.url, 'http://fixture').pathname;
    if (path === '/health') return send({ ok: true });
    if (path === '/api/agent-runs/inbox') return send({ items: [] });
    if (path === '/api/cloud/notebooks' && request.method === 'GET') {
      const titles = await files.titles();
      const notebooks = [];
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.mindatlaspkg')) continue;
        const stats = await stat(join(dir, name));
        notebooks.push({ name, title: titles[name], size: stats.size, updatedAt: stats.mtime.toISOString() });
      }
      return send({ directory: 'Isolated fixtures', notebooks });
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (path === '/api/cloud/notebooks/rename') {
      const data = JSON.parse(body);
      return send(await files.rename(data.name, data.title));
    }
    if (path === '/api/cloud/notebooks' && request.method === 'POST') {
      const form = await new globalThis.Request('http://fixture', { method: 'POST', headers: request.headers, body }).formData();
      const file = form.get('package');
      const target = form.get('targetName');
      if (!target) {
        const name = `copy-${++newSaves}.mindatlaspkg`;
        await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
        const stats = await stat(join(dir, name));
        return send({ name, size: stats.size, updatedAt: stats.mtime.toISOString(), directory: 'Isolated fixtures' });
      }
      const saved = await files.overwrite(target, file.name, Buffer.from(await file.arrayBuffer()), form.get('expectedUpdatedAt'));
      overwrites++;
      return send(saved);
    }
    send({ error: 'Offline fixture: this API is unavailable' }, 503);
  } catch (error) { send({ error: error.message }, error.status || 500); }
});
await new Promise((resolve) => bridge.listen(0, '127.0.0.1', resolve));
const bridgeUrl = `http://127.0.0.1:${bridge.address().port}`;
process.env.VITE_MIND_ATLAS_PUBLIC_SERVICE = 'false';
process.env.VITE_MIND_ATLAS_BRIDGE_URL = bridgeUrl;
const probe = createHttpServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const vite = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
await vite.listen();
const baseUrl = vite.resolvedUrls.local[0];
let browser;
try {
  if (process.argv.includes('--existing-suite')) {
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run verify:ui'], {
      env: { ...process.env, MIND_ATLAS_URL: baseUrl }, stdio: 'inherit', windowsHide: true,
    });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    if (code !== 0) throw new Error(`Existing UI suite exited ${code}; offline fixture does not provide provider/workspace APIs.`);
  } else {
    try { browser = await chromium.launch({ headless: true }); }
    catch { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'en-US' });
      page.on('pageerror', (error) => console.error('Fixture page error:', error.message));
      await page.addInitScript(() => {
        const now = new Date().toISOString();
        localStorage.setItem('mind-atlas-locale-v1', 'en');
        localStorage.setItem('mind-atlas-onboarding-v1', JSON.stringify({ version: 1, firstRun: false, rootNodeCreated: true, nodeEditorOpened: true, nodeEditCompleted: true, nodeCountReached: true, pan: true, zoom: true, nodeDrag: true, childNodeCreated: true, spaceBasicsCompleted: true, basicCompleted: true, aiUnlocked: true, titlePromptApplied: true, startedAt: now, completedAt: now }));
        localStorage.setItem('mind-atlas-notebook-v2', JSON.stringify({ id: 'fixture-root', kind: 'root', nodeType: 'note', title: 'Fixture', subtitle: '', body: 'Replacement fixture', color: '#8df5cf', radius: 80, position: [0, 0, 0], author: 'human', status: 'waiting', attachments: [], tags: [], summary: '', nextDecision: '', createdAt: now, updatedAt: now, children: [] }));
      });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('Open atlas menu').click();
      await page.getByRole('button', { name: /Cloud save/ }).click();
      const dialog = page.locator('.cloud-load-dialog');
      await expect(dialog).toBeVisible();
      const initialCount = await dialog.locator('.cloud-package-button').count();
      if (newSaves !== (width === 1280 ? 0 : 1)) throw new Error('Opening Cloud save created an unsolicited file');
      await dialog.locator('.cloud-package-button').filter({ hasText: original }).click();
      page.once('dialog', (prompt) => prompt.accept(`Renamed ${width}`));
      await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(dialog).toContainText(`Renamed ${width}`);
      // Cancelling must not write anything.
      const before = overwrites;
      page.once('dialog', (prompt) => prompt.dismiss());
      await dialog.getByRole('button', { name: 'Overwrite', exact: true }).click();
      await page.waitForTimeout(100);
      if (overwrites !== before) throw new Error('Cancelled overwrite wrote a file');
      page.once('dialog', (prompt) => prompt.accept());
      await dialog.getByRole('button', { name: 'Overwrite', exact: true }).click();
      await expect(dialog).toContainText('Overwritten:');
      if (overwrites !== before + 1) throw new Error('Overwrite not sent');
      await expect(dialog.locator('.cloud-package-button')).toHaveCount(initialCount);
      await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
      await dialog.locator('.cloud-package-button').filter({ hasText: 'space-test' }).click();
      await expect(dialog.getByRole('button', { name: 'Overwrite', exact: true })).toBeDisabled();
      const horizontalOverflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      if (horizontalOverflow) throw new Error(`Cloud dialog overflows at ${width}px`);
      page.once('dialog', (prompt) => prompt.accept(`Copy ${width}`));
      await dialog.getByRole('button', { name: 'Save current as...', exact: true }).click();
      await expect(dialog).toContainText(`Saved: Copy ${width}`);
      await expect(dialog.locator('.cloud-package-button')).toHaveCount(initialCount + 1);
      await dialog.getByRole('button', { name: 'Close cloud loader' }).click();
      await page.getByLabel('Open atlas menu').click();
      await page.getByRole('button', { name: /Cloud load/ }).click();
      await expect(dialog).toContainText(`Copy ${width}`);
      await page.close();
      console.log(`Local cloud UI ${width}px: save manager, rename, overwrite, cancel, save as, reopen, history and space guard passed`);
    }
    if (await readFile(join(dir, 'old-002.mindatlaspkg'), 'utf8') !== 'history fixture') throw new Error('History changed');
    console.log(`Offline UI verification passed. Fixtures: ${dir}`);
  }
} finally {
  await browser?.close();
  await vite.close();
  bridge.closeAllConnections();
  await new Promise((resolve) => bridge.close(resolve));
}
