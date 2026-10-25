// 3차: statusLine 래퍼·ccviz statusline install/uninstall (임시 HOME 만. 실제 settings.json 은 읽지 않음)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTopLevelKey, scanTopLevel, formatLine, fmtRemain, extractRateLimits, recordRateLimits, isDuplicate, readJsonRetry } from '../../bin/statusline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CCVIZ = path.resolve(HERE, '..', '..', 'bin', 'ccviz.mjs');
let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-sl-')); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function env(name) {
  const home = path.join(dir, name, 'home'), claude = path.join(dir, name, 'claude');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(path.join(claude, 'sessions'), { recursive: true });
  return { home, claude, settings: path.join(claude, 'settings.json'), env: { ...process.env, CCVIZ_HOME: home, CLAUDE_CONFIG_DIR: claude, CCVIZ_LANG: 'ko' } }; // 문구 검사는 한국어로 고정
}
const ccviz = (e, ...args) => spawnSync(process.execPath, [CCVIZ, 'statusline', ...args], { env: e.env, encoding: 'utf8', timeout: 20_000 });
const wrap = (e, input, extraEnv = {}) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(e.home, 'statusline.mjs')], { env: { ...e.env, CCVIZ_HOME: '', ...extraEnv }, input, timeout: 20_000 });
  return { ...r, ms: Date.now() - t0, out: r.stdout.toString('utf8') };
};
const stdinJson = (extra = {}) => JSON.stringify({
  session_id: 'sess-1', version: '2.1.309', cwd: 'D:\\secret\\path', transcript_path: 'x.jsonl', model: { id: 'm' }, cost: { total_cost_usd: 1 },
  rate_limits: { five_hour: { used_percentage: 23.5, resets_at: Math.floor(Date.now() / 1000) + 3 * 3600 + 8 * 60 + 30 },
    seven_day: { used_percentage: 91, resets_at: Math.floor(Date.now() / 1000) + 4 * 86400 + 600 }, spend_limit: { x: 1 } },
  ...extra });

test('settings 편집: statusLine 키만 바꾸고 나머지 바이트·순서·들여쓰기·CRLF 유지', () => {
  const src = '{\r\n    "model": "opus",\r\n    "hooks": { "Stop": [ { "a": "}\\"{" } ] },\r\n    "statusLine": { "type": "command", "command": "old", "padding": 2 },\r\n    "z": [1, 2]\r\n}\r\n';
  const out = setTopLevelKey(src, 'statusLine', { type: 'command', command: 'new', padding: 2 });
  assert.equal(out.split('"statusLine"')[0], src.split('"statusLine"')[0]);
  assert.ok(out.endsWith(',\r\n    "z": [1, 2]\r\n}\r\n'));
  assert.deepEqual(Object.keys(JSON.parse(out)), ['model', 'hooks', 'statusLine', 'z']);
  assert.ok(out.includes('{\r\n        "type": "command",'));
  const del = setTopLevelKey(src, 'statusLine', undefined);
  assert.deepEqual(Object.keys(JSON.parse(del)), ['model', 'hooks', 'z']);
  const add = setTopLevelKey('{\n  "a": 1\n}\n', 'statusLine', { type: 'command', command: 'c' });
  assert.equal(add, '{\n  "a": 1,\n  "statusLine": {\n    "type": "command",\n    "command": "c"\n  }\n}\n');
  assert.equal(setTopLevelKey(add, 'statusLine', undefined), '{\n  "a": 1\n}\n');
  assert.throws(() => setTopLevelKey('{"a":', 'statusLine', {}));
  assert.equal(setTopLevelKey('{"model":"x"}', 'statusLine', { type: 'command' }), '{"model":"x","statusLine":{"type":"command"}}');
  assert.equal(setTopLevelKey('{"model":"x","statusLine":{"type":"command"}}', 'statusLine', undefined), '{"model":"x"}');
  assert.equal(scanTopLevel('{}').members.length, 0);
});

test('install(prev 없음) → --yes 없으면 계획만, --yes 면 키만 추가·백업·래퍼 복사, uninstall 은 바이트 그대로', () => {
  const e = env('noprev');
  const orig = '{\n  "env": { "X": "1" },\n  "hooks": {}\n}\n';
  fs.writeFileSync(e.settings, orig);
  const plan = ccviz(e, 'install');
  assert.equal(plan.status, 0);
  assert.match(plan.stdout, /--yes/);
  assert.equal(fs.readFileSync(e.settings, 'utf8'), orig);
  assert.ok(!fs.existsSync(path.join(e.home, 'statusline.json')));
  const r = ccviz(e, 'install', '--yes');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /설치됨/);
  const s = JSON.parse(fs.readFileSync(e.settings, 'utf8'));
  assert.deepEqual(Object.keys(s), ['env', 'hooks', 'statusLine']);
  assert.equal(s.statusLine.type, 'command');
  assert.equal(s.statusLine.command, `node "${path.join(e.home, 'statusline.mjs').replace(/\\/g, '/')}"`);
  const st = JSON.parse(fs.readFileSync(path.join(e.home, 'statusline.json'), 'utf8'));
  assert.equal(st.prev, null);
  assert.equal(st.mode, 'limits');
  assert.equal(fs.readFileSync(path.join(e.home, st.backup), 'utf8'), orig);
  assert.ok(fs.existsSync(path.join(e.home, 'statusline.mjs')));
  // 재실행 안전: 래퍼만 다시 복사, prev 를 덮지 않음
  const again = ccviz(e, 'install', '--yes');
  assert.match(again.stdout, /이미 설치/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(e.home, 'statusline.json'), 'utf8')).prev, null);
  const stat = ccviz(e, 'status');
  assert.match(stat.stdout, /statusLine : 설치됨/);
  const u = ccviz(e, 'uninstall');
  assert.equal(u.status, 0, u.stderr);
  assert.equal(fs.readFileSync(e.settings, 'utf8'), orig);
  assert.ok(!fs.existsSync(path.join(e.home, 'statusline.mjs')) && !fs.existsSync(path.join(e.home, 'statusline.json')));
  assert.ok(fs.readdirSync(path.join(e.home, 'backup')).length === 1);
});

test('install(prev 있음): 같은 stdin 으로 prev 실행·출력 그대로, padding 유지, uninstall 원복(키 순서·들여쓰기)', () => {
  const e = env('prev');
  const prevCmd = 'node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>process.stdout.write(\'PREV:\'+JSON.parse(d).session_id))"';
  const orig = JSON.stringify({ statusLine: { type: 'command', command: prevCmd, padding: 1 }, model: 'opus' }, null, 4) + '\n';
  fs.writeFileSync(e.settings, orig);
  assert.equal(ccviz(e, 'install', '--yes').status, 0);
  const s = JSON.parse(fs.readFileSync(e.settings, 'utf8'));
  assert.deepEqual(Object.keys(s), ['statusLine', 'model']);
  assert.equal(s.statusLine.padding, 1);
  assert.ok(fs.readFileSync(e.settings, 'utf8').startsWith('{\n    "statusLine": {\n        "type": "command"'));
  const w = wrap(e, stdinJson());
  assert.equal(w.status, 0);
  assert.equal(w.out, 'PREV:sess-1');
  assert.ok(fs.existsSync(path.join(e.home, 'ratelimits.json')), 'prev 가 있어도 값은 기록');
  // 그 사이 사용자가 다른 키를 바꿨으면 statusLine 만 prev 로 되돌리고 그 변경은 유지
  const cur = fs.readFileSync(e.settings, 'utf8').replace('"opus"', '"sonnet"');
  fs.writeFileSync(e.settings, cur);
  ccviz(e, 'uninstall');
  const back = JSON.parse(fs.readFileSync(e.settings, 'utf8'));
  assert.deepEqual(back, { statusLine: { type: 'command', command: prevCmd, padding: 1 }, model: 'sonnet' });
  assert.deepEqual(Object.keys(back), ['statusLine', 'model']);
});

test('settings.json 파싱 실패면 중단(아무것도 안 씀), 사용자가 statusLine 을 바꿨으면 uninstall 은 settings 그대로', () => {
  const e = env('bad');
  fs.writeFileSync(e.settings, '{ "a": 1, ');
  const r = ccviz(e, 'install', '--yes');
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(e.settings, 'utf8'), '{ "a": 1, ');
  assert.ok(!fs.existsSync(path.join(e.home, 'statusline.json')) && !fs.existsSync(path.join(e.home, 'backup')));
  const e2 = env('changed');
  fs.writeFileSync(e2.settings, '{\n  "a": 1\n}\n');
  ccviz(e2, 'install', '--yes');
  const mine = '{\n  "a": 1,\n  "statusLine": {\n    "type": "command",\n    "command": "my-own"\n  }\n}\n';
  fs.writeFileSync(e2.settings, mine);
  const u = ccviz(e2, 'uninstall');
  assert.match(u.stdout, /그대로 둡니다/);
  assert.equal(fs.readFileSync(e2.settings, 'utf8'), mine);
});

test('래퍼: 두 창만 원자적 기록, 기본 한 줄(ANSI), 20초 중복 생략, rate_limits 없음·깨진 JSON 에도 종료 0', () => {
  const e = env('wrap');
  fs.writeFileSync(e.settings, '{}\n');
  ccviz(e, 'install', '--yes');
  const same = stdinJson(); // resets_at 이 초 경계를 넘어 바뀌지 않도록 같은 문자열을 두 번 쓴다
  const w = wrap(e, same);
  assert.equal(w.status, 0);
  assert.match(w.out, /^5h 24% \(3시간 8분\) · \x1b\[31m7d 91% \(4일\)\x1b\[0m\n$/);
  const file = path.join(e.home, 'ratelimits.json');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(rec).sort(), ['capturedAt', 'ccVersion', 'five_hour', 'sessionId', 'seven_day', 'source', 'v']);
  assert.equal(rec.five_hour.used_percentage, 23.5);
  assert.ok(!JSON.stringify(rec).includes('secret') && !JSON.stringify(rec).includes('spend'));
  const cap = rec.capturedAt;
  // 두 번째 실행의 시계를 첫 기록 +1초로 고정(벽시계·프로세스 기동 시간에 기대지 않음. CCVIZ_SL_NOW_MS 는 시험 전용)
  const w2 = wrap(e, same, { CCVIZ_SL_NOW_MS: String(Date.parse(cap) + 1000) });
  assert.equal(w2.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).capturedAt, cap, '같은 값 20초 안 → 쓰지 않음');
  const w3 = wrap(e, same, { CCVIZ_SL_NOW_MS: String(Date.parse(cap) + 21_000) });
  assert.equal(w3.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).capturedAt, new Date(Date.parse(cap) + 21_000).toISOString(), '같은 값이라도 20초 지나면 다시 기록');
  const changed = JSON.parse(stdinJson()); changed.rate_limits.five_hour.used_percentage = 30;
  wrap(e, JSON.stringify(changed));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).five_hour.used_percentage, 30, '값이 바뀌면 바로 기록');
  const before = fs.readFileSync(file, 'utf8');
  const none = wrap(e, JSON.stringify({ session_id: 'x', version: '2' }));
  assert.equal(none.status, 0);
  assert.equal(none.out, '\n');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'rate_limits 없으면 파일 그대로');
  const broken = wrap(e, '{not json');
  assert.equal(broken.status, 0);
  assert.equal(broken.stderr.toString(), '');
  const empty = wrap(e, '');
  assert.equal(empty.status, 0);
  // blank 모드
  ccviz(e, 'install', '--yes', '--mode', 'blank');
  assert.equal(wrap(e, stdinJson()).out, '');
  assert.ok(w.ms < 3000, `실행 시간 ${w.ms}ms`);
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

test('래퍼: prev 가 손자 프로세스로 멈춰도 3초 시한에 끊고 출력은 그대로, 손자까지 실제로 종료(트리 종료)', async () => {
  const e = env('hang');
  // 셸 → node(손자) 가 자기 pid 를 남기고 출력 일부를 쓴 뒤 60초 매달림. 시한(3초) 안에 받은 출력은 내보낸다
  const pidFile = path.join(e.home, 'grandchild.pid').replace(/\\/g, '/');
  const prevCmd = `node -e "require('fs').writeFileSync('${pidFile}', String(process.pid));process.stdout.write('PART');setTimeout(()=>{},60000)"`;
  fs.writeFileSync(e.settings, JSON.stringify({ statusLine: { type: 'command', command: prevCmd } }) + '\n');
  assert.equal(ccviz(e, 'install', '--yes').status, 0);
  const w = wrap(e, stdinJson());
  assert.equal(w.status, 0);
  assert.equal(w.out, 'PART');
  // 시한이 안 먹던 예전 코드는 손자가 끝날 때(60초)까지 파이프가 안 닫혔다. 프로세스 생성·종료가 느린 PC(백신)도 감안해 12초 상한
  assert.ok(w.ms < 12_000, `실행 시간 ${w.ms}ms`);
  const gpid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(gpid > 0);
  // 래퍼가 끝난 시점에 손자는 이미 죽어 있어야 한다(예전: taskkill 을 띄워만 두고 바로 exit → 손자 종료 보장 없음)
  const dead = !alive(gpid);
  if (!dead) { try { process.kill(gpid); } catch {} }
  assert.ok(dead, `손자 pid ${gpid} 가 래퍼 종료 뒤에도 살아 있음`);
});

test('중복 판정: 같은 값 20초 안 생략·21초 뒤 기록·시계가 뒤로 가도 생략, 일시적 읽기 잠금(EBUSY)은 다시 읽어 판정', () => {
  const home = fs.mkdtempSync(path.join(dir, 'dedupe-'));
  const j = JSON.parse(stdinJson());
  const t0 = 1_800_000_000_000;
  assert.equal(recordRateLimits(home, j, t0), true, '처음엔 기록');
  assert.equal(recordRateLimits(home, j, t0 + 19_000), false, '19초 뒤 같은 값 → 생략');
  assert.equal(recordRateLimits(home, j, t0 - 5_000), false, '시계가 5초 뒤로 가도 같은 창');
  // 백신·색인기가 방금 바뀐 파일을 잡아 처음 두 번 EBUSY → 다시 읽어 같은 값으로 판정(예전: prev 를 못 읽어 다시 썼음)
  let n = 0;
  const flaky = (f, enc) => { if (n++ < 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return fs.readFileSync(f, enc); };
  assert.equal(recordRateLimits(home, j, t0 + 1_000, { readFile: flaky }), false);
  assert.equal(n, 3);
  assert.equal(recordRateLimits(home, j, t0 + 21_000), true, '21초 뒤 같은 값 → 기록');
  const changed = JSON.parse(stdinJson()); changed.rate_limits.five_hour.used_percentage = 40;
  assert.equal(recordRateLimits(home, changed, t0 + 21_500), true, '값이 바뀌면 바로');
  assert.equal(isDuplicate(null, { five_hour: { used_percentage: 1, resets_at: 1 } }, t0), false);
  assert.deepEqual(readJsonRetry(path.join(home, 'nope.json')), { missing: true });
  let m = 0;
  const always = () => { m++; throw Object.assign(new Error('locked'), { code: 'EPERM' }); };
  const r = readJsonRetry(path.join(home, 'x'), { readFile: always, waitMs: 1 });
  assert.equal(r.error.code, 'EPERM');
  assert.equal(m, 4, '최대 4번');
});

test('문구 함수', () => {
  assert.equal(fmtRemain(30 * 60), '30분');
  assert.equal(fmtRemain(3 * 3600 + 8 * 60), '3시간 8분');
  assert.equal(fmtRemain(26 * 3600), '1일 2시간');
  assert.equal(fmtRemain(4 * 86400 + 99), '4일');
  assert.equal(formatLine({ five_hour: { used_percentage: 72, resets_at: 3600 } }, 0), '\x1b[33m5h 72% (1시간)\x1b[0m');
  assert.equal(formatLine({ five_hour: { used_percentage: 5, resets_at: 3600 } }, 0, { color: false }), '5h 5% (1시간)');
  assert.equal(extractRateLimits({ rate_limits: { five_hour: { used_percentage: 'x', resets_at: 1 } } }), null);
});
