import { chromium } from 'playwright-core';
import { lookup } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BlockList, isIP } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, dataDir } from './store.js';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8], ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24], ['192.168.0.0',16], ['198.18.0.0',15], ['224.0.0.0',3]]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 96], ['::ffff:0:0',96], ['fc00::',7], ['fe80::',10], ['ff00::',8]]) blocked.addSubnet(address, prefix, 'ipv6');
blocked.addAddress('::1', 'ipv6');

const execute = promisify(execFile);
export function normalizeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('올바른 웹 주소를 입력해 주세요.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('일반 HTTP 또는 HTTPS 주소만 등록할 수 있습니다.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') && !isIP(host)) throw new Error('공개된 웹 주소를 입력해 주세요.');
  if (isIP(host) && blocked.check(host, isIP(host) === 6 ? 'ipv6' : 'ipv4')) throw new Error('내부 네트워크 주소는 사용할 수 없습니다.');
  return url.href;
}
export async function publicUrl(value) {
  const url = new URL(normalizeUrl(value));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try { addresses = await lookup(host, { all: true }); }
  catch (error) {
    if (!['EAI_AGAIN', 'ENOTFOUND'].includes(error.code)) throw error;
    // TLS-verified public DNS for proxy-only environments. Never bypass IP checks.
    const records = await Promise.all(['A','AAAA'].map(async type => {
      const endpoint = `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`;
      const { stdout } = await execute('curl', ['--fail','--silent','--show-error','--max-time','10',endpoint], { maxBuffer: 65536 });
      const result = JSON.parse(stdout);
      if (result.Status !== 0) throw new Error('DNS lookup failed');
      return (result.Answer || []).filter(record => [1,28].includes(record.type)).map(record => ({ address: record.data, family: record.type === 28 ? 6 : 4 }));
    }));
    addresses = records.flat();
  }
  if (!addresses.length || addresses.some(({ address, family }) => blocked.check(address, family === 6 ? 'ipv6' : 'ipv4'))) throw new Error('내부 네트워크 주소는 사용할 수 없습니다.');
  return url.href;
}

const queue = [];
let running = false;
export function scheduleCapture(id) {
  if (!queue.includes(id)) queue.push(id);
  db.prepare("UPDATE apps SET capture_status='pending' WHERE id=?").run(id);
  void drain();
}
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    const app = db.prepare('SELECT * FROM apps WHERE id=?').get(id);
    if (!app) continue;
    let browser;
    try {
      await publicUrl(app.url);
      const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
      if (!executablePath) throw new Error('Chromium is not installed');
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: false });
      await context.route('**/*', async route => {
        try { await publicUrl(route.request().url()); await route.continue(); }
        catch { await route.abort(); }
      });
      const page = await context.newPage();
      page.on('popup', popup => void popup.close());
      const response = await page.goto(app.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      if (!response || response.status() >= 400) throw new Error('Page unavailable');
      await page.waitForTimeout(1800);
      const file = `${id}-${Date.now()}.jpg`;
      await page.screenshot({ path: resolve(dataDir, 'thumbnails', file), type: 'jpeg', quality: 80, timeout: 10000 });
      db.prepare("UPDATE apps SET capture=?, capture_status='ready' WHERE id=? AND url=?").run(`/thumbnails/${file}`, id, app.url);
    } catch {
      db.prepare("UPDATE apps SET capture_status='failed' WHERE id=? AND url=?").run(id, app.url);
    } finally { await browser?.close(); }
  }
  running = false;
}
