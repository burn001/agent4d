// 3차 · 5차: 한도 수집·병합·독립 수집기 (임시 HOME, 가짜 fetch. 실제 자격증명·네트워크 사용 안 함)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LimitsCollector, mergeLimits, normWindow, parseOauthUsage, parseStatuslineFile, OAUTH_URL } from '../limits.mjs';
import { UsagePoller, USAGE_URL, nextSaturday13Kst, parseUsageBody } from '../usage.mjs';
import { main as limitsCli } from '../../bin/limits.mjs';
import { normLimits } from '../config.mjs';

const FAKE_TOKEN = 'sk-ant-oat01-FAKE' + 'Z'.repeat(80) + 'END';
let dir, home, claude;
const logs = [];
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-lim-'));
  home = path.join(dir, 'home'); claude = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(claude, { recursive: true });
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const writeCred = (extra = {}) => fs.writeFileSync(path.join(claude, '.credentials.json'), JSON.stringify({
  claudeAiOauth: { accessToken: FAKE_TOKEN, refreshToken: 'rt-FAKE-' + 'Q'.repeat(60), expiresAt: Date.now() + 8 * 3600e3, subscriptionType: 'max', ...extra } }));
const writeSl = (capturedAt, five = 23.5, seven = 41.2) => fs.writeFileSync(path.join(home, 'ratelimits.json'), JSON.stringify({
  v: 1, source: 'statusline', capturedAt, sessionId: 's', ccVersion: '2.1.309',
  five_hour: { used_percentage: five, resets_at: Math.floor(Date.now() / 1000) + 3 * 3600 },
  seven_day: { used_percentage: seven, resets_at: Math.floor(Date.now() / 1000) + 4 * 86400 } }));
const usageBody = (f = 7, s = 19) => JSON.stringify({ five_hour: { utilization: f, resets_at: new Date(Date.now() + 2 * 3600e3).toISOString() },
  seven_day: { utilization: s, resets_at: new Date(Date.now() + 20 * 3600e3).toISOString() }, seven_day_opus: null, extra_usage: null });

function fakeFetch(seq) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, beta: init.headers['anthropic-beta'] });
    const r = seq.length > 1 ? seq.shift() : seq[0];
    if (r.throws) throw r.throws;
    const h = r.headers || {};
    return { status: r.status, text: async () => r.body ?? '', headers: { get: (k) => h[k.toLowerCase()] ?? null } };
  };
  fn.calls = calls;
  return fn;
}
const mk = (opts) => new LimitsCollector({ home, claudeHome: claude, logger: (m) => logs.push(m), pollMs: 60_000, useFileCache: false, ...opts });
const mkPoller = (opts) => new UsagePoller({ home, claudeDir: claude, logger: (m) => logs.push(m), useFileCache: false, ...opts });

test('정규화: pct 범위·숫자 아님은 null, resets_at 초·ISO 모두 ISO, 만료·stale', () => {
  const now = Date.parse('2026-10-23T05:00:00Z');
  assert.equal(normWindow(101, 1792742400, 'statusline', '2026-10-23T04:59:00Z', now), null);
  assert.equal(normWindow('x', 1792742400, 'statusline', '2026-10-23T04:59:00Z', now), null);
  const w = normWindow(23.46, 1792742400, 'statusline', '2026-10-23T04:59:00Z', now);
  assert.equal(w.pct, 23.5);
  assert.equal(w.resetsAt, new Date(1792742400 * 1000).toISOString());
  const exp = normWindow(50, '2026-10-23T04:00:00Z', 'oauth', '2026-10-23T03:00:00Z', now);
  assert.ok(exp.expired && exp.resetsInSec === 0);
  const m = mergeLimits({ sl: { capturedAt: '2026-10-23T04:40:00Z', five_hour: { pct: 10, resetsAt: 1792742400 } }, nowMs: now, staleSec: 600 });
  assert.equal(m.ageSec, 1200);
  assert.equal(m.stale, true);
  assert.equal(m.seven_day, null);
});

test('병합: 창마다 더 새로운 쪽, 출처가 섞이면 더 오래된 창의 출처', () => {
  const now = Date.parse('2026-10-23T05:00:00Z');
  const sl = { capturedAt: '2026-10-23T04:58:00Z', five_hour: { pct: 30, resetsAt: 1792742400 }, seven_day: { pct: 40, resetsAt: 1792742400 } };
  const oa = { capturedAt: '2026-10-23T04:59:00Z', five_hour: { pct: 31, resetsAt: '2026-10-23T08:00:00Z' }, seven_day: null };
  const m = mergeLimits({ sl, oa, nowMs: now });
  assert.equal(m.five_hour.source, 'oauth');
  assert.equal(m.seven_day.source, 'statusline');
  assert.equal(m.source, 'statusline');
  assert.equal(m.capturedAt, '2026-10-23T04:58:00.000Z');
  assert.equal(parseStatuslineFile('{"v":2}'), null);
  assert.equal(parseOauthUsage('{"five_hour":null}'), null);
  assert.equal(parseOauthUsage(usageBody()).five_hour.pct, 7);
});

test('auto(비권장): statusLine 값이 신선하면 그 값, 수집기 값이 더 새로우면 그 값 / statusline 은 API 를 부르지 않음 / off', async () => {
  writeCred();
  writeSl(new Date(Date.now() - 30e3).toISOString());
  const f = fakeFetch([{ status: 200, body: usageBody() }]);
  const c = mk({ fetchImpl: f, source: 'auto' });
  c.readStatusline();
  const L0 = c.current();
  assert.equal(L0.source, 'statusline');
  assert.equal(L0.five_hour.pct, 23.5);
  await c.poller.refresh();
  const L = c.current();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, OAUTH_URL);
  assert.equal(f.calls[0].url, USAGE_URL);
  assert.equal(f.calls[0].beta, 'oauth-2025-04-20');
  assert.equal(L.five_hour.source, 'oauth');
  assert.equal(L.five_hour.pct, 7);
  assert.equal(L.plan, 'max');
  const f2 = fakeFetch([{ status: 200, body: usageBody() }]);
  const c2 = mk({ fetchImpl: f2, source: 'statusline' });
  assert.equal(c2.poller, null);
  await c2.get();
  assert.equal(f2.calls.length, 0);
  assert.deepEqual(await mk({ source: 'off' }).get(), { ok: true, source: null, five_hour: null, seven_day: null, disabled: true });
  fs.rmSync(path.join(home, 'ratelimits.json'), { force: true });
});

test('기본은 꺼짐(옵트인): source 를 주지 않으면 off·네트워크 0, normLimits 기본도 off', async () => {
  const f = fakeFetch([{ status: 200, body: usageBody(1, 2) }]);
  const c = mk({ fetchImpl: f });
  assert.equal(c.source, 'off');
  assert.equal((await c.get()).disabled, true);
  assert.equal(f.calls.length, 0);
  assert.equal(normLimits(null).source, 'off');
  assert.equal(normLimits({ source: 'oauth' }).source, 'oauth');
});

test('옵트인 oauth(독립 수집기): /limits 첫 요청은 첫 조회를 기다리고, 그 뒤엔 주기를 따른다', async () => {
  writeCred();
  const f = fakeFetch([{ status: 200, body: usageBody(12, 34) }]);
  const c = mk({ fetchImpl: f, source: 'oauth' });
  assert.equal(c.source, 'oauth');
  const L = await c.get();
  assert.equal(f.calls.length, 1);
  assert.equal(L.source, 'oauth');
  assert.equal(L.five_hour.pct, 12);
  assert.equal(L.seven_day.pct, 34);
  assert.equal(L.stale, false);
  assert.equal(L.error, undefined);
  await c.get(); await c.get();
  assert.equal(f.calls.length, 1, '값이 있으면 /limits 요청이 호출을 늘리지 않음');
});

test('수집 주기: 평소 180초, 5h 또는 7d 가 80% 이상이면 60초, 429 Retry-After 가 더 길면 그것', async () => {
  writeCred();
  let now = Date.parse('2026-10-23T05:00:00Z');
  const f = fakeFetch([{ status: 200, body: usageBody(50, 60) }, { status: 200, body: usageBody(50, 80) }, { status: 200, body: usageBody(81, 10) },
    { status: 429, headers: { 'retry-after': '600' } }]);
  const p = mkPoller({ fetchImpl: f, now: () => now });
  assert.equal(p.nextDelayMs(), 180_000, '값이 없으면 평소 주기');
  await p.refresh();
  assert.equal(p.nextDelayMs(), 180_000);
  now += 180e3; await p.refresh();
  assert.equal(p.value.seven_day.pct, 80);
  assert.equal(p.nextDelayMs(), 60_000, '7d 80% → 60초');
  now += 60e3; await p.refresh();
  assert.equal(p.nextDelayMs(), 60_000, '5h 81% → 60초');
  now += 60e3; await p.refresh();
  assert.equal(p.failed, true);
  assert.equal(p.lastError.status, 429);
  assert.equal(p.nextDelayMs(), 600_000, 'Retry-After 600초');
  assert.equal(p.value.five_hour.pct, 81, '실패해도 마지막 값 유지');
  const n = f.calls.length;
  now += 100e3; await p.refresh();
  assert.equal(f.calls.length, n, 'Retry-After 안에는 부르지 않음');
});

test('start(): 첫 조회 즉시, 그 뒤 nextDelayMs 로 다음 예약', async () => {
  writeCred();
  const f = fakeFetch([{ status: 200, body: usageBody(85, 10) }]);
  const p = mkPoller({ fetchImpl: f });
  const got = new Promise((r) => p.onChange(r));
  p.start();
  await got;
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.length, 1);
  assert.ok(p.timer, '다음 조회 예약됨');
  p.stop();
  assert.equal(p.timer, null);
});

test('60초 캐시: 메모리·파일 캐시 적중이면 HTTP 없음, force 는 무시, 파일 캐시에 토큰 없음', async () => {
  writeCred();
  const cacheFile = path.join(home, 'usage-cache.json');
  fs.rmSync(cacheFile, { force: true });
  let now = Date.now();
  const f = fakeFetch([{ status: 200, body: usageBody(20, 30) }]);
  const a = mkPoller({ fetchImpl: f, now: () => now, useFileCache: true });
  await a.refresh();
  now += 30e3; await a.refresh();
  assert.equal(f.calls.length, 1, '메모리 캐시 30초');
  const b = mkPoller({ fetchImpl: f, now: () => now, useFileCache: true });
  await b.refresh();
  assert.equal(f.calls.length, 1, '다른 수집기도 파일 캐시로 중복 호출 안 함');
  assert.equal(b.value.five_hour.pct, 20);
  await b.refresh({ force: true });
  assert.equal(f.calls.length, 2, 'force');
  now += 61e3; await a.refresh();
  assert.equal(f.calls.length, 3, '60초 지나면 다시 부름');
  const text = fs.readFileSync(cacheFile, 'utf8');
  assert.ok(!text.includes('FAKE') && !/token|Bearer/i.test(text));
  fs.rmSync(cacheFile, { force: true });
});

test('7d 리셋 시각이 없으면 다음 토요일 13:00 KST 로 추정(estimated)', () => {
  // 2026-10-23 은 금요일
  assert.equal(new Date(nextSaturday13Kst(Date.parse('2026-10-23T05:00:00Z'))).toISOString(), '2026-10-24T04:00:00.000Z');
  assert.equal(new Date(nextSaturday13Kst(Date.parse('2026-10-24T03:59:00Z'))).toISOString(), '2026-10-24T04:00:00.000Z', '토요일 13시 전이면 오늘');
  assert.equal(new Date(nextSaturday13Kst(Date.parse('2026-10-24T04:00:00Z'))).toISOString(), '2026-10-31T04:00:00.000Z', '13시 정각 이후면 다음 주');
  assert.equal(new Date(nextSaturday13Kst(Date.parse('2026-10-24T16:00:00Z'))).toISOString(), '2026-10-31T04:00:00.000Z', 'KST 일요일 새벽');
  const now = Date.parse('2026-10-23T05:00:00Z');
  const v = parseUsageBody(JSON.stringify({ five_hour: { utilization: 5, resets_at: null }, seven_day: { utilization: 40, resets_at: null } }), now);
  assert.equal(v.seven_day.resetsAt, '2026-10-24T04:00:00.000Z');
  assert.equal(v.seven_day.estimated, true);
  assert.equal(v.five_hour.resetsAt, null);
  const L = mergeLimits({ oa: { capturedAt: new Date(now).toISOString(), ...v }, nowMs: now });
  assert.equal(L.seven_day.estimated, true);
  assert.equal(L.seven_day.resetsInSec, 23 * 3600);
  assert.equal(L.five_hour.pct, 5, '5h 리셋 시각이 없어도 값은 보여 줌');
  assert.equal(L.five_hour.resetsAt, null);
  const real = parseUsageBody(usageBody(), now);
  assert.equal(real.seven_day.estimated, false);
  assert.equal(mergeLimits({ oa: { capturedAt: new Date(now).toISOString(), ...real }, nowMs: now }).seven_day.estimated, undefined);
});

test('401 → 자격증명 파일을 다시 읽어 1회 재시도(새 토큰으로), 그래도 실패면 마지막 값 + stale', async () => {
  writeCred();
  let now = Date.now();
  const f = fakeFetch([{ status: 200, body: usageBody(10, 20) }, { status: 401 }, { status: 200, body: usageBody(11, 21) },
    { status: 401, body: '{"error":{"type":"authentication_error","message":"OAuth token has expired"}}' }, { status: 401 }]);
  const c = mk({ fetchImpl: f, now: () => now, source: 'oauth' });
  await c.poller.refresh();
  now += 200e3;
  const orig = fs.readFileSync;
  // 첫 읽기 뒤 401 이 나면 다시 읽는다 — 그 사이 Claude Code 가 토큰을 갱신했다고 가정
  let reads = 0;
  fs.readFileSync = function (file, ...rest) {
    if (String(file).endsWith('.credentials.json') && ++reads === 2) writeCred({ accessToken: FAKE_TOKEN + '2' });
    return orig.call(this, file, ...rest);
  };
  try { await c.poller.refresh(); } finally { fs.readFileSync = orig; }
  assert.equal(f.calls.length, 3, '401 뒤 한 번 더');
  assert.ok(f.calls[1].auth.endsWith('END'), '처음은 옛 토큰');
  assert.ok(f.calls[2].auth.endsWith('END2'), '다시 읽은 토큰으로 재시도');
  assert.equal(c.current().five_hour.pct, 11);
  assert.equal(c.current().stale, false);
  now += 200e3;
  await c.poller.refresh();
  assert.equal(f.calls.length, 5, '재시도는 1회만');
  const L = c.current();
  assert.equal(L.five_hour.pct, 11, '마지막 값 유지');
  assert.equal(L.stale, true);
  assert.equal(L.error.kind, 'http');
  assert.equal(L.error.status, 401);
  // 만료된 자격증명: 호출 전에 파일을 다시 읽는다(그것이 재시도 1회)
  writeCred({ expiresAt: Date.now() - 1000 });
  const f2 = fakeFetch([{ status: 401 }, { status: 200, body: usageBody() }]);
  const p2 = mkPoller({ fetchImpl: f2 });
  await p2.refresh();
  assert.equal(f2.calls.length, 1);
  assert.match(p2.lastError.message, /expiresAt 지남/);
  writeCred();
});

test('빈 응답·HTML·JSON 아님·형식 다름·네트워크 오류는 원인 그대로 기록(권한 문제로 단정 안 함)', async () => {
  writeCred();
  const cases = [
    [{ status: 200, body: '' }, 'empty'],
    [{ status: 200, body: '<html><body>Gateway Timeout</body></html>' }, 'html'],
    [{ status: 200, body: 'not json' }, 'json'],
    [{ status: 200, body: '{"five_hour":null,"seven_day":null}' }, 'shape'],
    [{ status: 502, body: '<html>Bad gateway</html>' }, 'http'],
    [{ throws: new TypeError('fetch failed') }, 'network'],
  ];
  for (const [r, kind] of cases) {
    const p = mkPoller({ fetchImpl: fakeFetch([r]) });
    const s = await p.refresh();
    assert.equal(s.stale, true, kind);
    assert.equal(s.lastError.kind, kind);
    assert.ok(!/권한|permission|forbidden/i.test(s.lastError.message), `${kind}: ${s.lastError.message}`);
  }
  const p = mkPoller({ fetchImpl: fakeFetch([{ status: 502, body: '<html>Bad gateway</html>' }]) });
  await p.refresh();
  assert.match(p.lastError.message, /HTML: Bad gateway/);
  fs.rmSync(path.join(claude, '.credentials.json'));
  const s = await mkPoller({ fetchImpl: fakeFetch([{ status: 200, body: usageBody() }]) }).refresh();
  assert.equal(s.lastError.kind, 'no-credentials');
  writeCred();
});

test('합성 토큰 문자열이 Limits·로그·알림·오류 어디에도 나오지 않는다', async () => {
  writeCred();
  const f = fakeFetch([{ status: 200, body: usageBody(55, 66) }]);
  const c = mk({ fetchImpl: f, source: 'oauth' });
  const seen = [];
  c.onChange((L) => seen.push(L));
  const L = await c.get();
  const echo = fakeFetch([{ status: 400, body: `bad header Bearer ${FAKE_TOKEN}` }]);
  const p = mkPoller({ fetchImpl: echo });
  await p.refresh();
  const blob = JSON.stringify([L, seen, logs, p.snapshot()]);
  assert.ok(!blob.includes('FAKE'), '토큰 조각 노출');
  assert.ok(!/accessToken|refreshToken|Bearer [^*]/i.test(blob));
  assert.ok(logs.some((m) => /^limits usage status=200 ms=\d+$/.test(m)));
  assert.ok(f.calls[0].auth.startsWith('Bearer ')); // 요청에는 쓰였다
  for (const k of Object.keys(c)) if (k !== 'poller') assert.ok(!String(JSON.stringify(c[k] ?? null)).includes('FAKE'), `인스턴스 상태 ${k}`);
  for (const k of Object.keys(c.poller)) assert.ok(!String(JSON.stringify(c.poller[k] ?? null)).includes('FAKE'), `수집기 상태 ${k}`);
});

test('bin/limits.mjs --once: 서버 /limits 와 같은 모양 JSON, --text 한 줄', async () => {
  writeCred();
  const out = [];
  const code = await limitsCli(['--once'], { out: (s) => out.push(s), collectorOpts: { home, claudeHome: claude, fetchImpl: fakeFetch([{ status: 200, body: usageBody(42, 84) }]), useFileCache: false } });
  assert.equal(code, 0);
  const L = JSON.parse(out[0]);
  assert.equal(L.ok, true);
  assert.equal(L.source, 'oauth');
  assert.equal(L.five_hour.pct, 42);
  assert.equal(L.seven_day.pct, 84);
  assert.ok(L.five_hour.resetsAt && typeof L.five_hour.resetsInSec === 'number');
  const out2 = [];
  // --text 문구는 CLI 언어를 따른다(server/cli-i18n.mjs) — 이 검사는 한국어로 고정
  const prevLang = process.env.CCVIZ_LANG;
  process.env.CCVIZ_LANG = 'ko';
  try {
    const code2 = await limitsCli(['--once', '--text'], { out: (s) => out2.push(s), collectorOpts: { home, claudeHome: claude, fetchImpl: fakeFetch([{ status: 200, body: '' }]), useFileCache: false } });
    assert.equal(code2, 1);
    assert.match(out2[0], /오류 empty/);
    process.env.CCVIZ_LANG = 'en';
    const out3 = [];
    await limitsCli(['--once', '--text'], { out: (s) => out3.push(s), collectorOpts: { home, claudeHome: claude, fetchImpl: fakeFetch([{ status: 200, body: '' }]), useFileCache: false } });
    assert.match(out3[0], /error empty/);
  } finally {
    if (prevLang === undefined) delete process.env.CCVIZ_LANG; else process.env.CCVIZ_LANG = prevLang;
  }
});

test('demo: 고정 값(72%·93%, 12분 전 → stale)', async () => {
  const L = await mk({ demo: true }).get();
  assert.equal(L.five_hour.pct, 72);
  assert.equal(L.seven_day.pct, 93);
  assert.equal(L.stale, true);
  assert.ok(L.ageSec >= 700);
});
