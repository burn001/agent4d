// 화면 원격 조작(웹): 명령 정규화·CLI 인자 해석·이름 매칭·자동 이름·디스패처(각 명령 → 기존 설정 함수)·--temp 저장값 되돌림·
// 받는 쪽(control.js): ack 보내기·원격 조작 끔·중복 무시·페이지를 떠나는 명령은 답한 뒤·데이터 SSE 없을 때 전용 SSE
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCmd, parseCtl, parseTarget, parseAt, matchProject, matchSession, matchClients, autoName, applyControl, snapshotStore, restoreStore, CTL_COMMANDS, cleanName } from '../control-core.mjs';

class MemStore {
  constructor(o = {}) { this.m = new Map(Object.entries(o)); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

test('정규화: 값 목록·별칭·켬/끔 동의어·범위 밖', () => {
  assert.deepEqual(normalizeCmd('Theme', { value: 'LIGHT' }), { ok: true, cmd: 'theme', args: { value: 'light' } });
  assert.equal(normalizeCmd('theme', { value: 'pink' }).error, 'bad_value');
  assert.equal(normalizeCmd('nope', {}).error, 'unknown_command');
  assert.deepEqual(normalizeCmd('view', { value: 'office' }).args, { value: 'voxel' });
  assert.deepEqual(normalizeCmd('dim', { value: '2' }).args, { value: '2d' });
  assert.deepEqual(normalizeCmd('sound', { value: 'true' }).args, { value: 'on' });
  assert.deepEqual(normalizeCmd('grid', { value: 'no' }).args, { value: 'off' });
  assert.deepEqual(normalizeCmd('panel', { value: 'collapse' }).args, { value: 'close' });
  assert.deepEqual(normalizeCmd('panel', { value: 'on' }).args, { value: 'open' });
  assert.deepEqual(normalizeCmd('timeline', { value: 'off' }).args, { value: 'hide' });
  assert.deepEqual(normalizeCmd('music', { value: '40%' }).args, { value: 40 });
  assert.equal(normalizeCmd('sfx', { value: 140 }).error, 'bad_value');
  // 부분 토글: 낱말 on|off|toggle 은 켬/끔, 숫자 0·1 은 그대로 음량
  assert.deepEqual(normalizeCmd('music', { value: 'off' }).args, { power: 'off' });
  assert.deepEqual(normalizeCmd('sfx', { value: 'ON' }).args, { power: 'on' });
  assert.deepEqual(normalizeCmd('vol', { value: 'toggle' }).args, { power: 'toggle' });
  assert.deepEqual(normalizeCmd('sfx', { value: '0' }).args, { value: 0 });
  assert.deepEqual(normalizeCmd('music', { value: 1 }).args, { value: 1 });
  assert.equal(normalizeCmd('music', { value: 'loud' }).error, 'bad_value');
  assert.deepEqual(parseCtl(['sfx', 'off']).args, { power: 'off' });
  assert.deepEqual(normalizeCmd('noise', { value: 'off' }).args, { on: false });
  assert.deepEqual(normalizeCmd('noise', { value: '70' }).args, { amount: 70 });
  assert.deepEqual(normalizeCmd('popup', {}), { ok: true, cmd: 'close', args: {} });
  assert.deepEqual(normalizeCmd('toast', { text: ' 빌드\n끝 ', sec: 99 }).args, { text: '빌드 끝', sec: 30 });
  assert.equal(normalizeCmd('replay', { session: 'abc', speed: 64 }).error, 'bad_value');
  assert.deepEqual(normalizeCmd('replay', { session: 'abc', at: '50%', speed: '4x' }).args, { session: 'abc', at: 0.5, speed: 4 });
  for (const k of Object.keys(CTL_COMMANDS)) assert.ok(CTL_COMMANDS[k].usage.startsWith(k), k);
});

test('CLI 인자 → 명령', () => {
  assert.deepEqual(parseCtl(['theme', 'light']), { ok: true, cmd: 'theme', args: { value: 'light' } });
  assert.deepEqual(parseCtl(['scope', 'project:atlas']).args, { target: { kind: 'project', q: 'atlas' } });
  assert.deepEqual(parseCtl(['scope', 'all']).args, { target: { kind: 'all', q: '' } });
  assert.deepEqual(parseCtl(['project', 'atlas']).args, { target: { kind: 'project', q: 'atlas' } }, '별칭 project → scope, 접두사 없으면 프로젝트');
  assert.deepEqual(parseCtl(['visible', 'hide', 'project:beta']).args, { action: 'hide', target: { kind: 'project', q: 'beta' } });
  assert.equal(parseCtl(['visible', 'only', 'session:abc']).error, 'bad_value', 'only 는 프로젝트만');
  assert.deepEqual(parseCtl(['visible', 'all']).args, { action: 'all' });
  assert.deepEqual(parseCtl(['toast', '빌드', '끝났어요'], { sec: '3' }).args, { text: '빌드 끝났어요', sec: 3 });
  assert.deepEqual(parseCtl(['replay', 'current'], { speed: '8' }).args, { session: 'current', at: null, speed: 8 });
  assert.equal(parseCtl([]).error, 'no_command');
  // CLI 가 푼 target 을 서버가 다시 정규화해도 같다
  assert.deepEqual(normalizeCmd('scope', parseCtl(['scope', 'project:x']).args).args, { target: { kind: 'project', q: 'x' } });
  assert.deepEqual(normalizeCmd('visible', parseCtl(['visible', 'show', 'session:s1']).args).args, { action: 'show', target: { kind: 'session', q: 's1' } });
  assert.deepEqual(parseTarget('s:abc'), { kind: 'session', q: 'abc' });
  assert.equal(parseAt('2026-10-26T10:00:00Z'), Date.parse('2026-10-26T10:00:00Z'));
  assert.ok(Number.isNaN(parseAt('언제')));
});

test('이름 매칭: 프로젝트(정확 > 부분, 모호하면 후보)·세션(id 앞부분·제목)·화면', () => {
  const P = [{ projectId: 'D--x-atlas', name: 'atlas' }, { projectId: 'D--x-atlas-old', name: 'atlas-old' }, { projectId: 'D--x-works', name: 'Works 2026', live: true }];
  assert.equal(matchProject(P, 'ATLAS').project.projectId, 'D--x-atlas', '정확한 이름이 이김');
  assert.equal(matchProject(P, 'works').project.name, 'Works 2026');
  const amb = matchProject(P, 'atl');
  assert.equal(amb.error, 'ambiguous');
  assert.deepEqual(amb.candidates.map((c) => c.name), ['atlas', 'atlas-old']);
  assert.equal(matchProject(P, 'zzz').error, 'not_found');
  const S = [{ sessionId: 'abcd1234-1', title: '화면 개편' }, { sessionId: 'abcd9999-2', title: '서버' }];
  assert.equal(matchSession(S, 'abcd1').session.sessionId, 'abcd1234-1');
  assert.equal(matchSession(S, 'abcd').error, 'ambiguous');
  assert.equal(matchSession(S, '개편').session.sessionId, 'abcd1234-1');
  assert.equal(matchSession(S, 'ab').error, 'not_found', '3자 이하 id 앞부분은 쓰지 않음');
  const C = [{ id: 'k3x9ab-q1', name: 'Edge · Windows · 1920×1080' }, { id: 'k3x9ab-z2', name: 'Phone' }, { id: 'm1-zz', name: 'Chrome · macOS' }];
  assert.equal(matchClients(C, null).length, 3);
  assert.deepEqual(matchClients(C, 'k3x9ab').map((c) => c.id), ['k3x9ab-q1', 'k3x9ab-z2']);
  assert.deepEqual(matchClients(C, 'phone').map((c) => c.id), ['k3x9ab-z2']);
  assert.deepEqual(matchClients(C, 'nope'), []);
});

test('자동 이름·이름 정리', () => {
  assert.equal(autoName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0', 1920, 1080), 'Edge · Windows · 1920×1080');
  assert.equal(autoName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 1512, 982), 'Safari · macOS · 1512×982');
  assert.equal(autoName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1', 393, 852), 'Safari · iOS · 393×852');
  assert.equal(autoName('x', 0, 0), 'Browser');
  assert.equal(cleanName(' <b>회의실</b>\n화면 '), 'b 회의실 /b 화면');
});

test('디스패처: 명령마다 같은 이름의 hook 을 정규화된 인자로 부름, 결과 모양', async () => {
  const calls = [];
  const hooks = new Proxy({}, { get: (_, k) => (a, o) => { calls.push([k, a, o.temp]); return k === 'view' ? false : k === 'sound' ? { pendingGesture: true } : k === 'reload' ? { after: () => 'x' } : undefined; } });
  const cases = [
    ['theme', { value: 'light' }, { value: 'light' }], ['dim', { value: '2d' }, { value: '2d' }],
    ['scope', { scope: 'project', projectId: 'p1', name: 'atlas' }, { scope: 'project', projectId: 'p1', name: 'atlas' }],
    ['visible', { action: 'hide', projectId: 'p2' }, { action: 'hide', projectId: 'p2', sessionId: null, name: null }],
    ['music', { value: 30 }, { value: 30 }], ['sfx', { value: 0 }, { value: 0 }], ['bgm', { value: 'lofi' }, { value: 'lofi' }],
    ['lang', { value: 'ko' }, { value: 'ko' }], ['camera', { value: 'follow' }, { value: 'follow' }], ['focus', { value: 'off' }, { value: 'off' }],
    ['pause', {}, {}], ['resume', {}, {}], ['live', {}, {}], ['replay', { session: 'current' }, { session: 'current', at: null, speed: null }],
    ['artifacts', { value: 'on' }, { value: 'on' }], ['plans', { value: 'off' }, { value: 'off' }], ['weather', { value: 'snow' }, { value: 'snow' }],
    ['grid', { value: 'off' }, { value: 'off' }], ['noise', { value: 50 }, { amount: 50 }], ['panel', { value: 'open' }, { value: 'open' }],
    ['timeline', { value: 'show' }, { value: 'show' }], ['done', { value: 'on' }, { value: 'on' }], ['close', {}, {}],
    ['toast', { text: 'hi' }, { text: 'hi', sec: 5 }],
  ];
  for (const [cmd, args, want] of cases) {
    const r = await applyControl({ cmd, args, temp: cmd === 'theme' }, hooks);
    assert.equal(r.ok, true, cmd);
    assert.deepEqual(calls.at(-1), [cmd, want, cmd === 'theme'], cmd);
  }
  assert.deepEqual(await applyControl({ cmd: 'view', args: { value: 'planet' } }, hooks), { ok: false, error: 'not_applied' });
  assert.equal((await applyControl({ cmd: 'sound', args: { value: 'on' } }, hooks)).pendingGesture, true);
  assert.equal(typeof (await applyControl({ cmd: 'reload', args: {} }, hooks)).after, 'function');
  assert.deepEqual(await applyControl({ cmd: 'theme', args: { value: 'x' } }, hooks), { ok: false, error: 'bad_value', detail: CTL_COMMANDS.theme.usage });
  assert.deepEqual(await applyControl({ cmd: 'theme', args: { value: 'dark' } }, {}), { ok: false, error: 'unsupported' });
  const boom = await applyControl({ cmd: 'grid', args: { value: 'on' } }, { grid: () => { throw new Error('no scene'); } });
  assert.deepEqual(boom, { ok: false, error: 'exception', detail: 'no scene' });
  assert.deepEqual(await applyControl({ cmd: 'grid', args: { value: 'on' } }, { grid: () => ({ ok: false, error: 'not_ready' }) }), { ok: false, error: 'not_ready' });
});

test('--temp: ccviz.* 저장값을 떠 두고 되돌림(남길 키 제외, 다른 키 무관)', () => {
  const s = new MemStore({ 'ccviz.theme': 'dark', 'ccviz.view2': 'flow', other: '1', 'ccviz.ctl.name': 'A' });
  const snap = snapshotStore(s);
  s.setItem('ccviz.theme', 'light'); s.setItem('ccviz.dim', '2d'); s.setItem('other', '2'); s.setItem('ccviz.ctl.name', 'B');
  restoreStore(s, snap, 'ccviz.', ['ccviz.ctl.name']);
  assert.equal(s.getItem('ccviz.theme'), 'dark');
  assert.equal(s.getItem('ccviz.dim'), null);
  assert.equal(s.getItem('other'), '2');
  assert.equal(s.getItem('ccviz.ctl.name'), 'B', '이름은 그대로');
});

// ───────── 받는 쪽(control.js) — 브라우저 전역을 흉내 ─────────
async function mountFake({ hooks, live = true } = {}) {
  globalThis.localStorage = new MemStore();
  globalThis.sessionStorage = new MemStore();
  globalThis.screen = { width: 1920, height: 1080 };
  globalThis.document = { getElementById: () => null };
  const posts = [];
  globalThis.fetch = async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  const opened = [];
  globalThis.EventSource = class { constructor(u) { this.url = u; this.h = {}; opened.push(this); } addEventListener(t, f) { this.h[t] = f; } close() { this.closed = true; } };
  const { mountControl } = await import('../control.js');
  const ctl = mountControl({ hooks, relApi: (p, q) => p + (q ? '?' + new URLSearchParams(q) : ''), getState: () => ({ view: 'flow' }), live });
  const src = { h: {}, addEventListener(t, f) { this.h[t] = f; } };
  ctl.bind(src);
  const fire = (msg) => src.h.control({ data: JSON.stringify(msg) });
  return { ctl, src, fire, posts, opened };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('받는 쪽: 적용 → ack(결과·상태·이름), 같은 명령 두 번은 한 번만, 원격 조작 끔이면 remote_off', async () => {
  let n = 0;
  const f = await mountFake({ hooks: { theme: () => { n++; }, sound: () => ({ pendingGesture: true }) } });
  assert.match(f.ctl.id, /^[a-z0-9]{6}-[a-z0-9]{3}$/);
  assert.deepEqual(Object.keys(f.ctl.query()), ['client', 'cname']);
  assert.match(f.ctl.query().cname, /1920×1080/);
  await f.fire({ id: 'c1', cmd: 'theme', args: { value: 'light' } });
  await f.fire({ id: 'c1', cmd: 'theme', args: { value: 'light' } });
  assert.equal(n, 1);
  const ack = f.posts.find((p) => p.body.cmdId === 'c1');
  assert.equal(ack.url, 'control/ack');
  assert.equal(ack.body.ok, true);
  assert.equal(ack.body.client, f.ctl.id);
  assert.deepEqual(ack.body.state, { view: 'flow', accept: true });
  await f.fire({ id: 'c2', cmd: 'sound', args: { value: 'on' } });
  assert.equal(f.posts.find((p) => p.body.cmdId === 'c2').body.pendingGesture, true);
  f.ctl.setAccept(false);
  await f.fire({ id: 'c3', cmd: 'theme', args: { value: 'dark' } });
  assert.equal(n, 1, '끄면 적용 안 함');
  assert.deepEqual([f.posts.at(-1).body.ok, f.posts.at(-1).body.error], [false, 'remote_off']);
  assert.equal(localStorage.getItem('ccviz.ctl.accept'), 'off');
});

test('받는 쪽: --temp 는 적용 뒤 저장값 되돌림, 페이지를 떠나는 명령은 ack 뒤에', async () => {
  const order = [];
  const f = await mountFake({ hooks: {
    theme: ({ value }) => { localStorage.setItem('ccviz.theme', value); },
    reload: () => ({ after: () => order.push('reload') }),
  } });
  localStorage.setItem('ccviz.theme', 'dark');
  await f.fire({ id: 't1', cmd: 'theme', args: { value: 'light' }, temp: true });
  assert.equal(localStorage.getItem('ccviz.theme'), 'dark');
  await f.fire({ id: 't2', cmd: 'theme', args: { value: 'light' } });
  assert.equal(localStorage.getItem('ccviz.theme'), 'light', 'temp 아니면 저장');
  await tick(450);
  assert.equal(localStorage.getItem('ccviz.theme'), 'light', '앞 --temp 의 늦은 되돌림이 뒤 저장을 덮지 않음');
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { order.push('ack'); return origFetch(u, init); };
  await f.fire({ id: 'r1', cmd: 'reload', args: {} });
  await tick(80);
  assert.deepEqual(order, ['ack', 'reload']);
});

test('받는 쪽: 데이터 SSE 가 끊기고 1.5초 지나도 없으면 명령 전용 SSE, 다시 붙으면 닫음', async () => {
  const f = await mountFake({ hooks: {} });
  f.ctl.unbind(f.src);
  await tick(50);
  f.ctl.bind(f.src); // 범위 전환처럼 곧바로 다시 붙으면 열지 않음
  await tick(1600);
  assert.equal(f.opened.length, 0);
  f.ctl.unbind(f.src);
  await tick(1600);
  assert.equal(f.opened.length, 1);
  assert.match(f.opened[0].url, /^control\/events\?client=/);
  assert.equal(typeof f.opened[0].h.control, 'function');
  f.ctl.bind(f.src);
  assert.equal(f.opened[0].closed, true);
});
