// node --test "web/test/quips.test.mjs"   복셀 생각·말풍선: 대사 데이터·셔플 백·상황 판정·빈도
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITUATIONS, FREQUENT, PLACEHOLDERS, QUIP, QuipPicker, QuipDirector, situationOf, thoughtOf, valsOf, fillLine, placeholdersOf,
  fileOfBrief, cmdOfBrief, queryOfBrief, quipRole, enterKey, leaveKey, rankQuips, quipDur } from '../voxel/quip-core.mjs';
import ko from '../voxel/quips/ko.mjs';
import en from '../voxel/quips/en.mjs';

const MIN = 20, MIN_FREQ = 40;
const LEN = { ko: { aim: 18, max: 24 }, en: { aim: 28, max: 36 } };
const PH_LEN = 8; // 자리표시자는 8자로 셈
const len = (s) => Array.from(s.replace(/\{\w+\}/g, 'x'.repeat(PH_LEN))).length;
const HANGUL = /[\uAC00-\uD7A3\u3131-\u318E]/;
// 번역투·기피 표현(사용자 문체 규칙) · 욕설 · 정치 — 낱말 경계가 없는 한국어는 붙어 쓰는 꼴로
const BANNED_KO = [/(?<![압단건수저구증])축(?![하복제])/, /회수/, /도약/, /격차/, /단조성/, /지지하/, /젠장/, /빌어/, /씨[발바]/, /개새/, /병신/, /좆/, /존나/, /대통령/, /국회/, /선거/, /정당/];
const BANNED_EN = [/\bdamn\b/i, /\bhell\b/i, /\bshit/i, /\bfuck/i, /\bcrap\b/i, /\bwtf\b/i, /\bgod\b/i, /\bpresident\b/i, /\belection\b/i, /\bcongress\b/i, /\bstupid\b/i, /\bidiot/i];

for (const [L, data] of [['ko', ko], ['en', en]]) {
  test(`대사(${L}): 상황 키 = SITUATIONS, 상황당 최소 줄 수(자주 나오는 상황 ${MIN_FREQ})`, () => {
    assert.deepEqual(Object.keys(data).sort(), Object.keys(SITUATIONS).sort());
    for (const [k, arr] of Object.entries(data)) {
      assert.ok(Array.isArray(arr) && arr.every((s) => typeof s === 'string' && s.trim() === s && s.length > 0), `${L} ${k}: 문자열 배열`);
      const min = FREQUENT.includes(k) ? MIN_FREQ : MIN;
      assert.ok(arr.length >= min, `${L} ${k}: ${arr.length} < ${min}`);
    }
  });
  test(`대사(${L}): 길이 상한·대부분 짧게, 중복 없음`, () => {
    let n = 0, short = 0;
    const seen = new Map();
    for (const [k, arr] of Object.entries(data)) {
      for (const s of arr) {
        n++;
        const l = len(s);
        assert.ok(l <= LEN[L].max, `${L} ${k}: 너무 김(${l}) ${s}`);
        if (l <= LEN[L].aim) short++;
        const key = s.toLowerCase();
        assert.ok(!seen.has(key), `${L}: 중복 "${s}" (${seen.get(key)} · ${k})`);
        seen.set(key, k);
      }
    }
    assert.ok(short / n >= 0.85, `${L}: 짧은 줄 비율 ${(short / n).toFixed(2)}`);
  });
  test(`대사(${L}): 금지 표현·언어 섞임 없음, 자리표시자는 상황별 허용 목록 안·상황의 30% 이하`, () => {
    const banned = L === 'ko' ? BANNED_KO : BANNED_EN;
    for (const [k, arr] of Object.entries(data)) {
      let ph = 0;
      for (const s of arr) {
        for (const re of banned) assert.doesNotMatch(s, re, `${L} ${k}: 금지 표현 ${s}`);
        if (L === 'en') assert.doesNotMatch(s, HANGUL, `en 에 한글: ${s}`);
        else assert.match(s, HANGUL, `ko 에 한글 없음: ${s}`);
        assert.doesNotMatch(s, /～/, '전각 물결 금지');
        const p = placeholdersOf(s);
        if (p.length) {
          ph++;
          for (const x of p) assert.ok((PLACEHOLDERS[k] || []).includes(x), `${L} ${k}: 허용 안 된 자리표시자 {${x}} — ${s}`);
        }
      }
      assert.ok(ph <= Math.ceil(arr.length * 0.3), `${L} ${k}: 자리표시자 줄 ${ph}/${arr.length}`);
      assert.ok(arr.length - ph >= MIN, `${L} ${k}: 값 없이 쓸 줄이 ${MIN} 미만`);
    }
  });
}

test('규모: 언어마다 1,500줄 이상', () => {
  const total = (d) => Object.values(d).reduce((a, b) => a + b.length, 0);
  assert.ok(total(ko) >= 1500, 'ko ' + total(ko));
  assert.ok(total(en) >= 1500, 'en ' + total(en));
});

test('셔플 백: 한 바퀴 다 쓰기 전엔 같은 줄 없음, 라운드 경계에서도 연속 반복 없음', () => {
  const lines = { a: Array.from({ length: 12 }, (_, i) => 'line ' + i) };
  const p = new QuipPicker(lines, { recent: 0 });
  const got = [];
  for (let i = 0; i < 12; i++) got.push(p.pick('n1', 'a', { seed: 7 }));
  assert.equal(new Set(got).size, 12);
  const next = p.pick('n1', 'a', { seed: 7 });
  assert.notEqual(next, got[11], '새 라운드 첫 줄 ≠ 앞 라운드 끝 줄');
  // 캐릭터마다 백이 따로(순서가 다름)
  const q = new QuipPicker(lines, { recent: 0 });
  const a = [], b = [];
  for (let i = 0; i < 6; i++) { a.push(q.pick('n1', 'a', { seed: 7 })); b.push(q.pick('n2', 'a', { seed: 7 })); }
  assert.notDeepEqual(a, b);
});

test('전역 최근 회피 + 화면에 떠 있는 글 회피', () => {
  const lines = { a: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'] };
  const p = new QuipPicker(lines, { recent: 4 });
  const seq = [];
  for (let i = 0; i < 30; i++) seq.push(p.pick('n' + (i % 5), 'a', { seed: i }));
  for (let i = 1; i < seq.length; i++) for (let j = Math.max(0, i - 4); j < i; j++) assert.notEqual(seq[i], seq[j], `최근 4줄 안에 반복: ${i}`);
  const avoid = new Set(['x1', 'x2', 'x3', 'x4', 'x5']);
  const p2 = new QuipPicker(lines, { recent: 0 });
  for (let i = 0; i < 5; i++) assert.equal(p2.pick('n9', 'a', { avoid }), 'x6');
});

test('자리표시자: 값이 있을 때만, 값 없으면(minimal) 일반 줄', () => {
  const lines = { 'tool.read': ['{file} 또 너야?', '책장으로', '읽어 보자', '훑어볼까'] };
  const p = new QuipPicker(lines, { recent: 0, tplP: 1 });
  assert.equal(p.pick('n', 'tool.read', { vals: { file: 'app.js' }, r: 0 }), 'app.js 또 너야?');
  for (let i = 0; i < 12; i++) assert.doesNotMatch(p.pick('n', 'tool.read', { vals: {} }), /\{|또 너야/);
  assert.equal(fillLine('{n}행 읽음', { n: 4821 }), '4,821행 읽음');
  assert.equal(fillLine('{host}로', {}), null);
});

test('brief → 값: 파일·명령·검색어, 가린 값(***)은 버림', () => {
  assert.equal(fileOfBrief('web/app.js'), 'app.js');
  assert.equal(fileOfBrief('quips.test.mjs +3 −1'), 'quips.test.mjs');
  assert.equal(fileOfBrief('README.md 12줄'), 'README.md');
  assert.equal(fileOfBrief(''), null);
  assert.equal(fileOfBrief('***'), null);
  assert.equal(cmdOfBrief('npm test'), 'npm');
  assert.equal(cmdOfBrief('C:\\Python312\\python.exe -m pytest'), 'python');
  assert.equal(cmdOfBrief('FOO=1 node x'), null);
  assert.equal(queryOfBrief('"TODO" · web/voxel'), 'TODO');
  const v = valsOf({ type: 'tool-start', cat: 'edit', brief: 'office.js +2 −1', ix: { cat: 'github', op: 'push', branch: 'main', commits: 3, host: '***' } });
  assert.deepEqual(v, { file: 'office.js', branch: 'main', commits: 3 });
  assert.deepEqual(valsOf({ type: 'tool-start', cat: 'shell', brief: '', text: '' }), {}, 'privacy minimal: brief 비어 있음');
});

test('상황 판정: 도구·특별 상호작용·사용자·결과·충돌·메시지', () => {
  const S = (ev, role = 'staff', r = 0) => { const x = situationOf(ev, { role }, r); return x && x.key; };
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'read' }), 'tool.read');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'read' }, 'staff', 0.99), null, '확률 거르기');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'zzz' }), 'tool.other');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'shell', ix: { cat: 'github', op: 'push' } }), 'git.push');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'shell', ix: { cat: 'github', op: 'pr-create' } }), 'git.pr');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'shell', ix: { cat: 'db', rw: 'r' } }), 'db.read');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'shell', ix: { cat: 'db', rw: 'w' } }), 'db.write');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'shell', ix: { cat: 'remote', op: 'ssh' } }), 'remote.ssh');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'shell', ix: { cat: 'remote', op: 'scp' } }), 'remote.transfer');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'shell', ix: { cat: 'tests', op: 'run' } }), 'tests.run');
  assert.equal(S({ type: 'tool-start', nodeId: 'a', cat: 'other', ix: { cat: 'user', op: 'ask' } }, 'lead'), 'user.ask');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: true, ix: { cat: 'tests', phase: 'end', pass: 10, fail: 0 } }), 'tests.pass');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: false, ix: { cat: 'tests', phase: 'end', pass: 9, fail: 1 } }), 'tests.fail');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: false, ix: { cat: 'github', op: 'push', rejected: true } }), 'git.pushRejected');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: true, ix: { cat: 'github', op: 'pr-checks', ci: { pass: 5, fail: 1 } } }), 'git.ciFail');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: true, ix: { cat: 'github', op: 'pr-checks', ci: { pass: 5, fail: 0, pending: 0 } } }), 'git.ciPass');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: false, ix: { cat: 'remote', op: 'ssh', connFail: 1 } }), 'remote.fail');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: false, ix: { cat: 'user', op: 'deny' } }, 'lead'), 'user.deny');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: true, ix: { cat: 'user', op: 'ask', pick: 1 } }, 'lead'), 'user.answer');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: false }), 'tool.fail');
  assert.equal(S({ type: 'tool-end', nodeId: 'a', ok: false, stopped: true }), 'tool.ok', '중지는 실패로 세지 않음');
  assert.equal(S({ type: 'user', nodeId: 'm', origin: 'human' }, 'lead'), 'user.prompt');
  assert.equal(S({ type: 'user', nodeId: 'm', origin: 'human', ix: { cat: 'user', op: 'midturn' } }, 'lead'), 'user.midturn');
  assert.equal(S({ type: 'user', nodeId: 'm', origin: 'human', ix: { cat: 'user', op: 'interrupt' } }, 'lead'), 'user.interrupt');
  assert.equal(S({ type: 'user', nodeId: 'm', origin: 'system' }, 'lead'), null);
  assert.equal(S({ type: 'node-update', nodeId: 'm', ix: { cat: 'user', op: 'reply' } }, 'lead'), 'user.reply');
  assert.equal(S({ type: 'result', nodeId: 'a', ok: true }), 'done.staff');
  assert.equal(S({ type: 'result', nodeId: 'a', ok: true }, 'op'), 'done.op');
  assert.equal(S({ type: 'result', nodeId: 'a', ok: false }), 'fail.result');
  assert.equal(S({ type: 'text', nodeId: 'a', role: 'assistant' }, 'lead'), 'talk.lead');
  const c = situationOf({ type: 'conflict', nodeId: 'm1', nodeA: 'a', nodeB: 'b', state: 'on' }, { role: 'staff' });
  assert.deepEqual([c.id, c.key, c.also], ['a', 'conflict', 'b']);
  assert.equal(S({ type: 'session-msg', nodeId: 'm1', fromNode: 'a' }), 'msg.peer');
  for (const k of ['tool.read', 'git.push', 'user.prompt', 'done.staff', 'conflict', 'msg.peer']) assert.ok(SITUATIONS[k]);
});

test('생각 풍선 상황: 역할·대기·커피·막힘·컨텍스트·밤샘·오래 도는 셸·감독', () => {
  const base = { role: 'staff', state: 'seated', status: 'active', toolCat: null, toolAge: 0, thinkFor: 3, fails: 0, ctxPct: 0, hour: 14 };
  assert.equal(thoughtOf(base, 0.1), 'think.staff');
  assert.equal(thoughtOf({ ...base, role: 'lead' }, 0.1), 'think.lead');
  assert.equal(thoughtOf({ ...base, role: 'op' }, 0.1), 'think.op');
  assert.equal(thoughtOf({ ...base, role: 'guest' }, 0.1), 'think.guest');
  assert.equal(thoughtOf({ ...base, thinkFor: 30 }, 0.1), 'think.long');
  assert.equal(thoughtOf({ ...base, status: 'idle' }, 0.1), 'idle.desk');
  assert.equal(thoughtOf({ ...base, status: 'idle', stretch: true }, 0.1), 'idle.stretch');
  assert.equal(thoughtOf({ ...base, status: 'idle', role: 'lead' }, 0.1), 'idle.lead');
  assert.equal(thoughtOf({ ...base, onBreak: true }, 0.1), 'idle.coffee');
  assert.equal(thoughtOf({ ...base, onBreak: true, state: 'walk' }, 0.1), null, '걸어가는 중엔 없음');
  assert.equal(thoughtOf({ ...base, fails: 2 }, 0.9), 'stuck');
  assert.equal(thoughtOf({ ...base, ctxPct: 92 }, 0.1), 'ctx.90');
  assert.equal(thoughtOf({ ...base, ctxPct: 75 }, 0.1), 'ctx.70');
  assert.equal(thoughtOf({ ...base, ctxPct: 75 }, 0.9), 'think.staff');
  assert.equal(thoughtOf({ ...base, hour: 2 }, 0.9), 'night');
  assert.equal(thoughtOf({ ...base, hour: 2 }, 0.1), 'think.staff');
  assert.equal(thoughtOf({ ...base, toolCat: 'shell', toolAge: 30 }, 0.1), 'longrun');
  assert.equal(thoughtOf({ ...base, toolCat: 'shell', toolAge: 2 }, 0.1), null, '일하는 중엔 이벤트 말풍선만');
  assert.equal(thoughtOf({ ...base, role: 'lead', toolCat: 'agent', toolAge: 10 }, 0.1), 'wait.child');
  assert.equal(thoughtOf({ ...base, oversee: true, role: 'lead' }, 0.1), 'oversee');
  assert.equal(thoughtOf({ ...base, state: 'leave' }, 0.1), null);
  assert.equal(quipRole('operator'), 'op'); assert.equal(quipRole('annex'), 'guest'); assert.equal(quipRole('wf'), 'staff');
  assert.equal(enterKey('op'), 'enter.op'); assert.equal(enterKey('lead'), null);
  assert.equal(leaveKey('error'), 'leave.error'); assert.equal(leaveKey('done'), 'leave.done');
});

test('빈도: 캐릭터당 최소 간격·중요 이벤트 덮어씀·전역 버킷·고배속 솎기', () => {
  const d = new QuipDirector();
  assert.ok(d.allow('a', 100, 1)); d.commit('a', 100, 1, 'say');
  assert.ok(!d.allow('a', 102, 1), '간격 안');
  assert.ok(!d.allow('a', 101, 2), '중요도 높아도 GAP_URGENT 안');
  assert.ok(d.allow('a', 100 + QUIP.GAP_URGENT + 0.1, 2), '중요 이벤트는 짧은 간격 뒤 덮어씀');
  assert.ok(d.allow('a', 100 + QUIP.GAP + 0.1, 1));
  // 전역 버킷: 같은 순간 여러 캐릭터 → BURST 개까지만
  const e = new QuipDirector();
  let n = 0;
  for (let i = 0; i < 20; i++) if (e.allow('c' + i, 50, 1)) { e.commit('c' + i, 50, 1, 'say'); n++; }
  assert.equal(n, QUIP.BURST);
  // 고배속
  const f = new QuipDirector();
  assert.ok(!f.allow('x', 10, 1, { speed: 8 }));
  assert.ok(f.allow('x', 10, 2, { speed: 8 }));
  assert.ok(!f.allow('y', 10, 2, { speed: 16 }));
  assert.ok(f.allow('z', 10, 0, { speed: 16, focus: true }));
  // 생각 주기: 말한 뒤 바로 생각 안 함, 생각은 THINK_MIN 이상 간격
  const g = new QuipDirector();
  g.allow('t', 0, 0); g.commit('t', 0, 0, 'think');
  assert.ok(!g.thinkDue('t', QUIP.THINK_MIN - 0.5));
  assert.ok(g.thinkDue('t', QUIP.THINK_MIN + QUIP.THINK_SPAN + 0.1));
  // 실패 누적 → stuck 판정 수
  g.noteFail('t', 10); g.noteFail('t', 20);
  assert.equal(g.fails('t', 30), 2);
  assert.equal(g.fails('t', 10 + QUIP.FAIL_WIN + 1), 1);
  // 표시 시간: 배속이면 짧게
  assert.ok(quipDur('say', 4) < quipDur('say', 1));
  assert.ok(quipDur('think', 1) > quipDur('say', 1));
});

test('화면 순서: 포커스 > 중요도 > 가까움 > 활동 > 최근', () => {
  const L = rankQuips([
    { id: 'far', pri: 1, dist: 90, born: 5 }, { id: 'near', pri: 1, dist: 20, born: 1 },
    { id: 'urgent', pri: 2, dist: 200, born: 0 }, { id: 'focus', pri: 0, dist: 300, born: 0, focus: true },
  ].map((x) => ({ focus: false, active: false, ...x })));
  assert.deepEqual(L.map((x) => x.id), ['focus', 'urgent', 'near', 'far']);
});

test('결정성: 같은 시드·같은 순서면 같은 대사(재생)', () => {
  const run = () => { const p = new QuipPicker(ko); const out = []; for (let i = 0; i < 20; i++) out.push(p.pick('s:abc', 'think.staff', { seed: 123 })); return out; };
  assert.deepEqual(run(), run());
});
