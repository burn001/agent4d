// 이벤트 몰림 조절(웹) — 프레임 예산 큐 · 따라잡기(quiet) · 칩 · 숨긴 탭 · 순서
import test from 'node:test';
import assert from 'node:assert/strict';
import { EvQueue, EVQ } from '../ev-queue.mjs';
import { readFileSync } from 'node:fs';

/** 가짜 rAF·타이머·시계: apply 한 건이 cost ms 를 쓴다 */
function rig({ cost = 1, hidden = false } = {}) {
  const r = { t: 0, frames: [], timers: [], hidden, applied: [], chips: [] };
  r.q = new EvQueue({
    apply: (it, { quiet }) => { r.t += cost; r.applied.push([it.ev.seq, quiet]); },
    onCatchup: (n) => r.chips.push(n),
    raf: (fn) => r.frames.push(fn),
    setTimeout: (fn) => r.timers.push(fn),
    now: () => r.t,
    hidden: () => r.hidden,
  });
  r.frame = () => { const fs = r.frames.splice(0); for (const f of fs) f(); return fs.length; };
  r.timer = () => { const fs = r.timers.splice(0); for (const f of fs) f(); return fs.length; };
  r.push = (a, b) => { for (let i = a; i <= b; i++) r.q.push({ ev: { seq: i } }); };
  return r;
}

test('프레임마다 예산(6ms)만큼, 최소 1건 — 순서 그대로', () => {
  const r = rig({ cost: 1 });
  r.push(1, 20);
  assert.equal(r.applied.length, 0, 'push 는 바로 처리하지 않음');
  r.frame();
  assert.equal(r.applied.length, EVQ.BUDGET_MS, '6ms 예산(1ms × 6건)');
  while (r.frame());
  assert.deepEqual(r.applied.map((x) => x[0]), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(r.applied.every((x) => !x[1]), '200 아래면 모두 일반(연출 있음)');
  const slow = rig({ cost: 50 }); // 한 건이 예산보다 커도 프레임마다 1건은 처리
  slow.push(1, 3); slow.frame();
  assert.equal(slow.applied.length, 1);
});

test('200 넘으면 따라잡기: 넘친 앞부분 quiet · 칩 n 표시 · 50 아래에서 해제 · 순서 보존', () => {
  const r = rig({ cost: 0.01 });
  r.push(1, 1000);
  r.frame();
  const quiet = r.applied.filter((x) => x[1]).length;
  assert.ok(quiet >= 800 - 1, `앞 800건 가량은 quiet (${quiet})`);
  assert.ok(r.chips.length > 0, '칩 표시');
  while (r.frame());
  assert.deepEqual(r.applied.map((x) => x[0]), Array.from({ length: 1000 }, (_, i) => i + 1), '순서 그대로');
  // quiet 는 앞쪽에만 — 한 번 일반이 나오면 다시 quiet 가 나오지 않음(이 시나리오에서)
  const firstLoud = r.applied.findIndex((x) => !x[1]);
  assert.ok(r.applied.slice(firstLoud).every((x) => !x[1]));
  assert.equal(r.chips.at(-1), 0, '끝나면 칩 해제(0)');
  assert.equal(r.q.catching, false);
});

test('느린 처리: 따라잡기 동안 칩에 남은 건수가 줄어들고 LOW(50) 아래로 내려가야 해제', () => {
  const r = rig({ cost: 0.5 }); // quiet 12ms ≈ 24건, 일반 6ms ≈ 12건/프레임
  r.push(1, 300);
  r.frame();
  assert.equal(r.q.catching, true);
  const firstN = r.chips.at(-1);
  assert.ok(firstN > 200 && firstN < 300, `칩 ${firstN}`);
  let guard = 0;
  while (r.q.length >= EVQ.LOW && guard++ < 1000) { r.frame(); if (r.q.length >= EVQ.LOW) assert.equal(r.q.catching, true); }
  assert.equal(r.q.catching, false);
  assert.equal(r.chips.at(-1), 0);
  assert.ok(r.chips.slice(0, -1).every((n, i, a) => i === 0 || n <= a[i - 1]), '줄어들기만');
});

test('숨긴 탭: rAF 대신 타이머로 모두 quiet · 보이면 다시 프레임으로(wake)', () => {
  const r = rig({ cost: 1, hidden: true });
  r.push(1, 30);
  assert.equal(r.frames.length, 0);
  while (r.timer());
  assert.equal(r.applied.length, 30);
  assert.ok(r.applied.every((x) => x[1]), '숨김 동안은 quiet');
  // 보이는 동안 걸어 둔 rAF 가 숨김으로 멈추는 경우: wake 로 타이머 예약
  const v = rig({ cost: 1 });
  v.push(1, 5);
  assert.equal(v.frames.length, 1);
  v.hidden = true; v.q.wake();
  v.frame(); // 옛 rAF 가 늦게 와도 무시(gen)
  assert.equal(v.applied.length, 0);
  while (v.timer());
  assert.equal(v.applied.length, 5);
});

test('clear: 남은 것 버림 · 따라잡던 칩 해제 · 옛 예약 무시', () => {
  const r = rig({ cost: 0.01 });
  r.push(1, 500);
  r.q.catching = true;
  r.q.clear();
  assert.equal(r.q.length, 0);
  assert.equal(r.chips.at(-1), 0);
  r.frame();
  assert.equal(r.applied.length, 0);
  r.push(501, 502); r.frame();
  assert.deepEqual(r.applied.map((x) => x[0]), [501, 502]);
});

test('app.js 연결 경로: SSE ev·projects 는 큐로, snapshot·disconnect 는 큐를 비움 · i18n 칩 문구 en·ko', async () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(src, /addEventListener\('ev', \(e\) => \{[^\n]*evq\.push\(\{ ev: JSON\.parse/);
  assert.match(src, /addEventListener\('projects'[^\n]*evq\.push\(\{ fn:/);
  assert.match(src, /addEventListener\('snapshot'[\s\S]{0,80}evq\.clear\(\)/);
  assert.match(src, /function disconnect\(\) \{[\s\S]{0,80}evq\.clear\(\)/);
  const { STR } = await import('../i18n/app.mjs').catch(() => ({}));
  const raw = readFileSync(new URL('../i18n/app.mjs', import.meta.url), 'utf8');
  assert.match(raw, /'app\.conn\.catchup': 'Catching up \{n\}'/);
  assert.match(raw, /'app\.conn\.catchup': '따라잡는 중 \{n\}'/);
  void STR;
});
