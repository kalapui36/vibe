import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('설정 없이 기본 비밀번호로 로그인하고 재시작해도 유지된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vibe-default-'));
  const base = 'http://127.0.0.1:3148';
  let server;
  async function start() {
    const env = { ...process.env, PORT: '3148', HOST: '127.0.0.1', DATA_DIR: dir };
    delete env.ADMIN_PASSWORD;
    server = spawn(process.execPath, ['server.js'], { env, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/api/session`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Server did not start');
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  }
  async function login(password) {
    return fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vibe-Request': '1' }, body: JSON.stringify({ password }) });
  }
  try {
    await start();
    assert.equal((await (await fetch(`${base}/api/session`)).json()).configured, true);
    assert.equal((await login('wrong')).status, 401);
    const response = await login('4021');
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/admin/apps`, { headers: { Cookie: cookie } })).status, 200);
    await stop();
    await start();
    assert.equal((await login('4021')).status, 200);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
