/**
 * Public-mode check for cloud files in the galaxy and the card mark in the
 * universe, against a mocked service (no real account, no network).
 *
 * Signed in: a planet with a card space shows its card badge with the count
 * (cloud card list and this device's card storage); every cloud file appears in
 * the galaxy as its own galaxy, can be selected and opened (loaded like "Cloud
 * load"), and is then marked as the open file. Signed out: no cloud file is
 * listed or fetched.
 *
 * Usage: node scripts/verify-galaxy-cloud.mjs
 */
import { chromium, devices, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const out = 'artifacts/screenshots/galaxy-cloud';
await mkdir(out, { recursive: true });
let signedIn = true;
const host = '127.0.0.1';
const now = new Date().toISOString();
let serial = 0;
const node = (title, color, children = [], extra = {}) => ({ kind: 'thread', nodeType: 'note', author: 'human', texture: 'speckled', attachments: [], createdAt: now, updatedAt: now, nextDecision: '', tags: [], radius: 28, subtitle: '', summary: '', id: `n-${serial++}`, title, body: title, children, status: ['done', 'waiting', 'running', 'blocked', 'done', 'needs_review'][serial % 6], color, ...extra });
const tree = (title, color, branches) => ({ ...node(title, color, branches.map(([b, items]) => node(b, color, items.map(i => node(i, color, [node(`${i} メモ`, color), node(`${i} 次の行動`, color)])))), { kind: 'root' }) });

// The current notebook: one space, with two planets that have card spaces.
const current = tree('新規事業A', '#8fb6ff', [['市場調査', ['顧客インタビュー', '競合分析', '価格の仮説']], ['プロダクト開発', ['MVP設計', '技術選定']], ['営業', ['パイロット顧客', '提案資料']]]);
current.children[0].cardPlanetId = 'planet-cloud';
current.children[1].children[0].cardPlanetId = 'planet-local';
const cloudRoots = {
  c1: tree('読書メモ 2026', '#b494df', [['経営の本', ['価格の決め方', '顧客インタビューの技術']], ['設計の本', ['ドメイン駆動', 'MVP設計の原則']]]),
  c2: tree('旅行計画 秋', '#7fd6b0', [['行程', ['京都', '奈良']], ['予算', ['宿', '交通']]]),
  c3: tree('研究ノート LLM', '#f2b56b', [['論文', ['RAG', 'エージェント評価']], ['実験', ['技術選定のベンチマーク', '競合分析の自動化']]]),
  c4: tree('家計と資産', '#f08fb0', [['固定費', ['通信', '保険']], ['投資', ['積立', '予算の見直し']]]),
};
const entries = Object.entries(cloudRoots).map(([id, root], i) => ({ id, name: `${root.title}.mindatlas`, title: root.title, size: JSON.stringify(root).length, updatedAt: new Date(Date.now() - i * 86400000).toISOString(), visibility: 'private', fileFormat: 'json' }));
const requested = [];
const service = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}`);
  requested.push(url.pathname);
  if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/service/session') return json(200, { publicService: true, authenticated: signedIn, user: signedIn ? { id: 'usr_cloud', email: 'cloud@example.com', name: 'Cloud', pictureUrl: '', role: 'user' } : null, subscription: null, credit: null, entitlement: { aiEnabled: false, reason: 'subscription_required' }, chatOptions: { defaultService: 'openai', services: [] } });
  if (url.pathname === '/api/analytics/config') return json(200, { enabled: false });
  if (!signedIn && (url.pathname.startsWith('/api/cloud/') || url.pathname === '/api/spaces')) return json(401, { error: 'sign in' });
  if (url.pathname === '/api/cloud/notebooks') return json(200, { directory: 'Mind Atlas cloud', notebooks: entries, quota: { usedBytes: 1000, limitBytes: 10000000 } });
  const match = url.pathname.match(/^\/api\/cloud\/notebooks\/([^/]+)$/);
  if (match) { const e = entries.find(x => x.id === decodeURIComponent(match[1])); return e ? json(200, { entry: e, root: cloudRoots[e.id] }) : json(404, { error: 'missing' }); }
  if (url.pathname === '/api/spaces') return json(200, { spaces: [{ id: 'sp1', title: '市場調査', cardCount: 5, planetId: 'planet-cloud', updatedAt: now }], usedBytes: 0, limitBytes: 1 });
  return json(404, { error: 'not mocked' });
});
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, host, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
await new Promise(resolve => service.listen(0, host, resolve));
const servicePort = service.address().port;
const vitePort = await freePort();
const require = createRequire(import.meta.url);
const viteEntry = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteEntry, '--configLoader', 'runner', '--host', host, '--port', String(vitePort), '--strictPort'], { env: { ...process.env, VITE_MIND_ATLAS_PUBLIC_SERVICE: 'true', VITE_MIND_ATLAS_SERVICE_URL: `http://${host}:${servicePort}` }, stdio: 'ignore', windowsHide: true });
const appUrl = `http://${host}:${vitePort}`;
for (let i = 0; i < 60; i++) { try { const r = await fetch(appUrl); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }

const browser = await chromium.launch({ channel: process.env.MIND_ATLAS_BROWSER_CHANNEL ?? 'msedge', headless: true });
const results = [];
async function open(viewport) {
  const context = await browser.newContext(viewport === 'mobile' ? { ...devices['Pixel 7'], deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ root, now }) => {
    localStorage.setItem('mind-atlas-notebook-v2', JSON.stringify(root));
    localStorage.setItem('mind-atlas-ui-state-v1', JSON.stringify({ version: 1, savedAt: now, selectedNodeId: root.id, viewport: { x: 0, y: 0, zoom: .92 }, renderQuality: 'high', layoutMode: 'phyllotaxis', mobilePanelTab: 'command' }));
    localStorage.setItem('mind-atlas-onboarding-v1', JSON.stringify({ version: 1, firstRun: false, rootNodeCreated: true, nodeEditorOpened: true, nodeEditCompleted: true, nodeCountReached: true, pan: true, zoom: true, nodeDrag: true, childNodeCreated: true, spaceBasicsCompleted: true, basicCompleted: true, aiUnlocked: true, titlePromptApplied: true, startedAt: now, completedAt: now }));
  }, { root: current, now });
  await page.route('**/cloud-seed', route => route.fulfill({ contentType: 'text/html', body: '<html><body>seed</body></html>' }));
  await page.goto(`${appUrl}/cloud-seed`);
  // A card space made on this device for the MVP設計 planet (3 cards).
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('mindatlas-spatial', 2); r.onupgradeneeded = () => { for (const n of ['spaces', 'kv', 'embeddings', 'axisScores']) r.result.createObjectStore(n); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction('spaces', 'readwrite');
    tx.objectStore('spaces').put({ schema: 'mindatlas.space/1', id: 's-local', title: 'MVP設計', description: '', cards: { a: {}, b: {}, c: {} }, relations: [], axes: { x: '', y: '', z: '' }, trail: [], createdAt: 1, updatedAt: 2, anchor: { planetId: 'planet-local', nodeId: 'x', nodeTitle: 'MVP設計' } }, 's-local');
    await new Promise(r => { tx.oncomplete = r; });
    db.close();
  });
  await page.goto(`${appUrl}/?locale=ja`);
  await page.waitForSelector('.galaxy-open-button', { timeout: 60000 });
  return { context, page, errors };
}
try {
  for (const viewport of ['desktop', 'mobile']) {
    signedIn = true;
    requested.length = 0;
    const { context, page, errors } = await open(viewport);
    await expect(page.locator('.node-card-badge[aria-label="カード5枚"]')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: `${out}/${viewport}-universe.png` });
    await page.locator('.galaxy-open-button').click();
    await expect(page.locator('.knowledge-spaces button.is-cloud:not([disabled])')).toHaveCount(4, { timeout: 20000 });
    await expect(page.locator('.kg-label .kg-file').first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${viewport}-galaxy.png` });
    await page.locator('.knowledge-spaces button.is-cloud').filter({ hasText: '研究ノート LLM' }).click();
    await expect(page.getByRole('button', { name: 'このファイルを開く' })).toBeVisible();
    await page.getByRole('button', { name: 'このファイルを開く' }).click();
    await expect(page.locator('.knowledge-overlay')).toHaveCount(0, { timeout: 10000 });
    const firstBranch = cloudRoots.c3.children[0].id;
    await expect(page.locator(`[data-node-id="${firstBranch}"]`).first()).toBeAttached({ timeout: 10000 });
    await page.locator('.galaxy-open-button').click();
    await expect(page.locator('.knowledge-spaces button.is-cloud').filter({ hasText: 'いま開いているファイル' })).toHaveCount(1, { timeout: 15000 });
    const fetchedC1 = requested.filter(p => p === '/api/cloud/notebooks/c1').length;
    if (fetchedC1 !== 1) throw new Error(`Each cloud file should be fetched once per session for the galaxy, c1 was fetched ${fetchedC1} times.`);
    if (errors.length) throw new Error(errors.join('\n'));
    results.push({ viewport, cardBadge: true, cloudGalaxies: 4, openedFromGalaxy: true });
    await context.close();
  }
  // Signed out: nothing is asked of the cloud.
  signedIn = false;
  requested.length = 0;
  const { context, page } = await open('desktop');
  await page.locator('.galaxy-open-button').click();
  await page.waitForTimeout(3000);
  await expect(page.locator('.knowledge-spaces button.is-cloud')).toHaveCount(0);
  if (requested.some(p => p.startsWith('/api/cloud/'))) throw new Error('The signed-out galaxy requested cloud files.');
  results.push({ signedOut: true, cloudRequests: 0 });
  await context.close();
  console.log(JSON.stringify(results));
  console.log('Galaxy cloud files and card marks passed.');
} finally {
  await browser.close();
  vite.kill();
  service.close();
}
