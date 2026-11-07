// 시스템 메모리 수집(가짜 os·vm_stat) · /mem · SSE mem (합성 데이터만, 실제 외부 명령 없음)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { SysMemCollector, memSample, parseVmStat, normSysmem, SYSMEM_DEFAULT } from '../sysmem.mjs';
import { createServer } from '../index.mjs';
import { DemoManager } from '../demo.mjs';

const GIB = 1024 ** 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('memSample: 사용 = 전체 − 가용, pct 소수 한 자리, 범위 밖 가용은 자름', () => {
  assert.deepEqual(memSample({ total: 64 * GIB, avail: 24 * GIB }), { used: 40 * GIB, total: 64 * GIB, pct: 62.5 });
  assert.equal(memSample({ total: 8 * GIB, avail: 9 * GIB }).used, 0);
  assert.equal(memSample({ total: 8 * GIB, avail: -1 }).pct, 100);
  assert.equal(memSample({ total: 0, avail: 0 }), null);
  assert.equal(memSample({ total: NaN, avail: 0 }), null);
});

test('normSysmem: 기본 켬·10초, 5～15 로 자름, false 는 끔', () => {
  assert.deepEqual(normSysmem(undefined), SYSMEM_DEFAULT);
  assert.deepEqual(normSysmem({ pollSec: 1 }), { on: true, pollSec: 5 });
  assert.deepEqual(normSysmem({ pollSec: 99 }), { on: true, pollSec: 15 });
  assert.deepEqual(normSysmem({ pollSec: 'x' }), { on: true, pollSec: 10 });
  assert.equal(normSysmem(false).on, false);
  assert.equal(normSysmem({ on: false }).on, false);
});

test('parseVmStat: free + inactive + speculative × page size, 형식이 다르면 null', () => {
  const text = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            200000.
Pages inactive:                           50000.
Pages speculative:                         5000.
Pages throttled:                              0.
Pages wired down:                         90000.
Pages purgeable:                           3000.
`;
  assert.equal(parseVmStat(text), (10000 + 50000 + 5000) * 16384);
  assert.equal(parseVmStat('nothing here'), null);
  assert.equal(parseVmStat('(page size of 4096 bytes)\nPages active: 5.'), null);
  assert.equal(parseVmStat(null), null);
});

test('수집기: Windows·Linux 는 freemem 그대로, 의미 있게 바뀔 때만 알림', () => {
  let free = 24 * GIB;
  const c = new SysMemCollector({ platform: 'win32', totalmem: () => 64 * GIB, freemem: () => free, vmStat: () => { throw new Error('호출 금지'); } });
  const got = [];
  c.onChange((v) => got.push(v));
  assert.equal(c.current(), null);
  c.sample();
  assert.equal(got.length, 1);
  assert.equal(got[0].pct, 62.5);
  free -= 10 * 1024 * 1024; // 10MB — 정수 % 도 64MiB 칸도 그대로
  c.sample();
  assert.equal(got.length, 1);
  assert.equal(c.current().used, 40 * GIB + 10 * 1024 * 1024); // 현재값은 늘 최신
  free -= GIB;
  c.sample();
  assert.equal(got.length, 2);
  assert.ok(got[1].pct > 63.9 && got[1].pct < 64.2);
});

test('수집기: macOS 는 vm_stat 보정값(가용 − freemem)을 길게 캐시해 더한다', async () => {
  let calls = 0, t = 1_000_000;
  const page = 4096;
  const vm = () => { calls++; return `Mach Virtual Memory Statistics: (page size of ${page} bytes)\nPages free: ${(1 * GIB) / page}.\nPages inactive: ${(5 * GIB) / page}.\nPages speculative: ${(1 * GIB) / page}.\n`; };
  const c = new SysMemCollector({ platform: 'darwin', totalmem: () => 16 * GIB, freemem: () => 1 * GIB, vmStat: vm, vmStatSec: 60, now: () => t });
  c.sample(); // 첫 틱: 보정 전(free 만) + 뒤에서 vm_stat
  assert.equal(c.current().used, 15 * GIB);
  await sleep(10);
  assert.equal(calls, 1);
  c.sample(); // 보정 반영: 가용 7GB
  assert.equal(c.current().used, 9 * GIB);
  t += 30_000; c.sample(); await sleep(5);
  assert.equal(calls, 1, '60초 안에는 다시 부르지 않음');
  t += 31_000; c.sample(); await sleep(5);
  assert.equal(calls, 2);
});

test('수집기: 꺼짐이면 값·타이머 없음, --demo 는 고정 값 한 번', () => {
  const off = new SysMemCollector({ on: false, totalmem: () => 8 * GIB, freemem: () => GIB }).start();
  assert.equal(off.timer, null);
  assert.equal(off.current(), null);
  const d = new SysMemCollector({ demo: true, totalmem: () => { throw new Error('호출 금지'); } }).start();
  assert.equal(d.timer, null);
  assert.equal(d.current().total, 32 * GIB);
  assert.ok(d.current().pct >= 80 && d.current().pct < 90);
});

test('수집기 start: 즉시 한 번 재고 주기 타이머(unref)', () => {
  const c = new SysMemCollector({ pollSec: 5, platform: 'linux', totalmem: () => 8 * GIB, freemem: () => 2 * GIB }).start();
  try {
    assert.ok(c.timer);
    assert.equal(c.pollMs, 5000);
    assert.equal(c.current().pct, 75);
  } finally { c.stop(); }
  assert.equal(c.timer, null);
});

// ── HTTP: /mem 토큰·값, SSE mem 이벤트 ──
const TOKEN = 'test-token-' + 'm'.repeat(32);
const H = { 'x-ccviz-token': TOKEN };
let server, webRoot;
after(() => { server?.close(); server?.closeAllConnections?.(); if (webRoot) fs.rmSync(webRoot, { recursive: true, force: true }); });
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') })); }).on('error', reject);
  });
}
function sseText(url, headers, ms) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => { let buf = ''; res.on('data', (c) => { buf += c; }); setTimeout(() => { req.destroy(); resolve(buf); }, ms); });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

test('HTTP: /mem 은 토큰 필요, 값만(used·total·pct), SSE 에 mem 이벤트(id 없음)', async () => {
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-memweb-'));
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>t</title>');
  let free = 4 * GIB;
  const mem = new SysMemCollector({ platform: 'win32', totalmem: () => 16 * GIB, freemem: () => free });
  mem.sample();
  const mgr = new DemoManager({ overviewOptions: { matchEveryMs: 3600_000, hub: { orphanDelayMs: 0, intervalMs: 200, projectsMinMs: 0 } } });
  server = createServer({ token: TOKEN, manager: mgr, webRoot, mem });
  const base = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
  assert.equal((await get(`${base}/mem`)).status, 401);
  const j = JSON.parse((await get(`${base}/mem`, H)).body);
  assert.deepEqual(j, { ok: true, used: 12 * GIB, total: 16 * GIB, pct: 75 });
  setTimeout(() => { free = 1 * GIB; mem.sample(); }, 250);
  const text = await sseText(`${base}/events?scope=all`, H, 700);
  const blocks = text.split('\n\n').filter((b) => b.startsWith('event: mem\n'));
  assert.equal(blocks.length, 2, '연결 직후 한 번 + 바뀐 뒤 한 번');
  assert.ok(blocks.every((b) => !/^id:/m.test(b)));
  const last = JSON.parse(blocks[1].split('\ndata: ')[1]);
  assert.deepEqual(Object.keys(last).sort(), ['pct', 'total', 'used']);
  assert.equal(last.used, 15 * GIB);
  mgr.stop?.();
});
