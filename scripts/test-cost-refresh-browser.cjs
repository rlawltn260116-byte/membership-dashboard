const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((resolve, reject) => {
    const listen = port => {
      server.once('error', error => error.code === 'EADDRINUSE' && port < 43220 ? listen(port + 1) : reject(error));
      server.listen(port, '127.0.0.1', resolve);
    };
    listen(43200);
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let requests = 0, amount = 1000, syncedAt = '2026-09-27T08:34:07+09:00';
    const data = { users: [{ id: 'admin', name: 'Test' }], entries: [], clients: [], notices: [], revisits: [], targets: {} };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      if (url.hostname !== 'membership-7aef2-default-rtdb.firebaseio.com') return route.abort();
      let body = url.pathname === '/data/users.json' ? data.users : url.pathname === '/data.json' ? data : null;
      if (url.pathname === '/erp/costAnalysis/2026.json') {
        requests++;
        body = { schemaVersion: 1, months: { '2026-11': { syncedAt,
          rows: [{ code: 'a', name: 'Test group', sales: amount, cost: amount * 0.8, profit: amount * 0.2 }] } } };
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-11-01T14:00:00+09:00') });
    await page.addInitScript(() => sessionStorage.setItem('sj-current-user', JSON.stringify({ id: 'admin', expiresAt: Date.now() + 3600000 })));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#nav-cost').click();
    await page.waitForFunction(() => document.querySelector('.cost-sync') && !document.querySelector('.cost-sync').textContent.includes('불러오는 중'));
    assert.equal(await page.locator('.cost-sync-stale').count(), 1, JSON.stringify({ requests, errors, status: await page.locator('.cost-sync').textContent() }));
    assert.equal(requests, 1);
    amount = 2000;
    syncedAt = '2026-11-01T13:50:00+09:00';
    await page.clock.fastForward(5 * 60 * 1000 + 1000);
    await page.waitForFunction(() => document.querySelector('.cost-metric strong')?.textContent.includes('2,000'));
    assert.equal(await page.locator('.cost-sync-stale').count(), 0);
    amount = 3000;
    await page.getByRole('button', { name: '데이터 새로고침', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cost-metric strong')?.textContent.includes('3,000'));
    const beforeLeave = requests;
    await page.locator('#nav-sales').click();
    await page.clock.fastForward(5 * 60 * 1000 + 1000);
    assert.equal(requests, beforeLeave, 'Inactive cost view must not refresh');
    await page.locator('#nav-cost').click();
    await page.waitForFunction(() => !document.querySelector('[data-cost-action="refresh"]').disabled);
    assert.ok(requests > beforeLeave);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results', 'cost-sync-desktop.png'), animations: 'disabled' });
    await page.evaluate(() => doLogout());
    const afterLogout = requests;
    await page.clock.fastForward(5 * 60 * 1000 + 1000);
    assert.equal(requests, afterLogout);
    assert.deepEqual(errors, []);
    console.log('PASS: stale indicator, timed reload, manual reload, inactive-tab isolation, logout cancellation');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
