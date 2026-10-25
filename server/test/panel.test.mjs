// 홀로그램 패널 내용(실제 출력 몇 줄). 모든 비밀값·메일 주소는 가짜다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  inputPanel, resultPanel, sanitizePanel, tailPanel, sayPanel, progressPanel, LineTail, isSecretPath, touchesSecret, maskPanelText, stripAnsi, PANEL_LIMITS,
} from '../panel.mjs';
import { Graph, latestPanelsOnly, PANEL_RATE } from '../graph.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';
import { makeReplayFixture, rmReplayFixture, ageIndex, RIDS } from './fixtures/replay-build.mjs';

const S = (p) => sanitizePanel(p);
const okShape = (p) => {
  assert.equal(p.v, 1);
  assert.equal(p.marks.length, p.lines.length, '표식 수 = 줄 수');
  assert.ok(p.lines.length <= PANEL_LIMITS.lines);
  assert.ok(p.lines.every((l) => l.length <= PANEL_LIMITS.line));
  assert.ok(Buffer.byteLength([p.title, ...p.lines].join('\n')) <= PANEL_LIMITS.bytes + 2);
};

test('도구별 내용 규칙: 셸·읽기·편집·쓰기·검색·웹·에이전트·그 밖', () => {
  // Bash: 제목 = $ 명령 첫 줄, 결과 = 출력 마지막 줄들 + exit
  const bi = inputPanel('Bash', { command: 'cd /d/x && npm test\nnpm run lint', description: '단위시험' });
  assert.equal(bi.title, '$ npm test');
  assert.deepEqual([bi.lines, bi.marks], [['단위시험', '  npm run lint'], 'd$']);
  const out = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const br = S(resultPanel('Bash', null, { stdout: out, stderr: '' }, '', null, true, bi));
  okShape(br);
  assert.equal(br.part, 'result');
  assert.equal(br.lines.at(-1), 'exit 0');
  assert.equal(br.lines.at(-2), 'line 30');
  assert.equal(br.more, 19);
  const bf = S(resultPanel('Bash', null, null, 'Exit code 2\nboom', null, false, bi));
  assert.deepEqual([bf.lines, bf.marks], [['Exit code 2', 'boom', 'exit 2'], 'eee']);
  assert.match(S(resultPanel('Bash', null, { backgroundTaskId: 'b9', stdout: '' }, '', null, true, bi)).lines[0], /백그라운드 b9/);

  // Read: 경로(마지막 세 조각) + 앞 줄들 + 범위
  const ri = inputPanel('Read', { file_path: 'D:\\git\\proj\\web\\app.js', offset: 10, limit: 5 });
  assert.equal(ri.title, 'proj/web/app.js');
  const rr = S(resultPanel('Read', null, { file: { content: 'a\nb\nc', numLines: 3, startLine: 10, totalLines: 99 } }, '', null, true, ri));
  assert.deepEqual(rr.lines, ['a', 'b', 'c', '10～12줄 / 99']);
  assert.equal(rr.marks, 'oood');
  // 본문만 있을 때 cat -n 접두 제거
  assert.deepEqual(S(resultPanel('Read', { file_path: '/a/b.md' }, null, '     1→첫 줄\n     2→둘째', null, true)).lines, ['첫 줄', '둘째']);
  // 그림은 내용 생략
  const img = S(resultPanel('Read', { file_path: '/a/b.png' }, { type: 'image' }, '', [{ type: 'image' }], true));
  assert.equal(img.hidden, 'image');

  // Edit: 입력 단계 diff(공통 줄 버림), 결과 단계 structuredPatch
  const ei = S(inputPanel('Edit', { file_path: '/x/y/z/app.js', old_string: 'keep\nold1\nend', new_string: 'keep\nnew1\nnew2\nend' }));
  assert.deepEqual([ei.lines, ei.marks], [['old1', 'new1', 'new2'], '-++']);
  const er = S(resultPanel('Edit', { file_path: '/x/app.js' }, { structuredPatch: [{ oldStart: 4, oldLines: 3, newStart: 4, newLines: 4, lines: [' ctx0', ' ctx', '-old', '+new', '+new2', ' tail'] }] }, '', null, true));
  assert.deepEqual([er.lines, er.marks], [['@@ -4,3 +4,4 @@', 'ctx', 'old', 'new', 'new2'], '@d-++']);
  // Write: 새 파일 앞 줄들(+)
  const wr = S(resultPanel('Write', { file_path: '/x/n.md', content: '1\n2\n3' }, { type: 'create', structuredPatch: [] }, '', null, true));
  assert.deepEqual([wr.lines, wr.marks], [['1', '2', '3'], '+++']);

  // Grep: 결과 줄(앞 경로 줄임) + 일치 수
  const gr = S(resultPanel('Grep', { pattern: 'TODO', path: 'C:\\r\\server' }, { mode: 'content', numLines: 2, content: 'C:\\r\\a\\b\\c\\d.js:3:// TODO x\nC:\\r\\a\\b\\c\\e.js:9:// TODO y' }, '', null, true));
  assert.equal(gr.title, '"TODO" · C:/r/server');
  assert.deepEqual(gr.lines, ['…/b/c/d.js:3:// TODO x', '…/b/c/e.js:9:// TODO y', '2줄 일치']);
  const gl = S(resultPanel('Glob', { pattern: '**/*.mjs' }, { filenames: ['/a/b/c/d/e.mjs'], numFiles: 1 }, '', null, true));
  assert.deepEqual(gl.lines, ['…/c/d/e.mjs', '1개 파일']);

  // WebFetch: 호스트/경로(쿼리 버림) + 결과 첫 줄들 + HTTP
  const wf = S(resultPanel('WebFetch', { url: 'https://example.org/docs/a?key=zz', prompt: '요약' }, { code: 200, bytes: 4096 }, '첫 줄\n둘째 줄', null, true));
  assert.equal(wf.title, 'example.org/docs/a');
  assert.deepEqual(wf.lines, ['첫 줄', '둘째 줄', 'HTTP 200 · 4KB']);
  const ws = S(resultPanel('WebSearch', { query: 'three.js' }, { results: [{ content: [{ title: '문서', url: 'https://threejs.org/docs' }] }] }, '', null, true));
  assert.deepEqual(ws.lines, ['• 문서 — threejs.org']);

  // Agent: 프롬프트 첫 줄 + 결과 + 통계
  const ai = inputPanel('Agent', { description: '조사', subagent_type: 'Explore', prompt: '\n첫 지시\n둘째 지시\n셋째' });
  assert.deepEqual(S(ai).lines, ['Explore', '첫 지시', '둘째 지시']);
  const ar = S(resultPanel('Agent', null, { content: [{ type: 'text', text: '결과 한 줄\nagentId: abc' }], totalToolUseCount: 3, totalDurationMs: 4000 }, '', null, true, ai));
  assert.deepEqual(ar.lines, ['결과 한 줄', '도구 3회 · 4초']);

  // 그 밖·mcp: 입력 요약(키: 값) + 결과 첫 줄들
  const mi = S(inputPanel('mcp__ctx7__query', { q: '질문', n: 3, obj: { x: 1 } }));
  assert.deepEqual([mi.title, mi.lines], ['ctx7.query', ['q: 질문', 'n: 3']]);
  const td = S(inputPanel('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', activeForm: 'b 중', status: 'in_progress' }] }));
  assert.deepEqual([td.title, td.lines, td.marks], ['할 일 1/2', ['[x] a', '[>] b 중'], 'dh']);
});

test('정리 규칙: ANSI·제어 문자 제거, 줄 100자·12줄·1.5KB 상한, 줄 단위 자르기, minimal', () => {
  assert.equal(stripAnsi('\x1b[1;32mok\x1b[0m'), 'ok');
  assert.equal(stripAnsi('a\r\nb'), 'a\nb');
  assert.equal(stripAnsi('50%\r100%'), '100%');
  const long = S({ mode: 'shell', part: 'tail', title: 't', lines: Array.from({ length: 40 }, (_, i) => `${i}:` + '가'.repeat(150)), marks: '' });
  okShape(long);
  assert.equal(long.lines.at(-1).slice(0, 3), '39:', '꼬리 패널은 앞을 버림(바이트 상한도 앞에서)');
  assert.ok(long.lines[0].endsWith('…'));
  assert.ok(long.more >= 28);
  const head = S({ mode: 'read', part: 'result', title: 't', lines: Array.from({ length: 40 }, (_, i) => `${i}`), marks: '' });
  assert.equal(head.lines[0], '0', '그 밖은 앞을 남김');
  assert.equal(head.lines.length, 12);
  assert.equal(sanitizePanel({ mode: 'shell', lines: ['x'] }, 'minimal'), null);
  assert.equal(S({ lines: ['a\u0000\u2028b', 'ab\ufffd\ufffd\ufffd\ufffdc'] }).lines.join('|'), 'ab|[바이너리 줄 생략]');
});

test('마스킹: 기존 redact + 헤더·쿠키·인자·환경 변수·JSON 키·메일(도메인까지)·PEM·홈 경로', () => {
  const FAKE = 'Zx9fakeFAKEfake0123';
  const cases = [
    `curl -H "Authorization: Basic ${FAKE}" https://x`,
    `Authorization: Bearer abc.def.${FAKE}`,
    `Cookie: sid=${FAKE}; other=1`,
    `curl -b "session=${FAKE}" -u admin:${FAKE} x`,
    `mysql --password ${FAKE}`,
    `tool --api-key=${FAKE}`,
    `export SURVEY_DB_PASS=${FAKE}`,
    `$env:MY_TOKEN = '${FAKE}'`,
    `{"sessionToken": "${FAKE}", "refresh_token":"${FAKE}"}`,
    `client_secret: ${FAKE}`,
    `X-Api-Key: ${FAKE}`,
    `mongodb://user:${FAKE}@host:27017/db`,
    `sk-ant-api03-${FAKE}${FAKE}`,
  ];
  for (const c of cases) {
    const m = maskPanelText(c);
    assert.ok(!m.includes(FAKE), `가려야 함: ${c} → ${m}`);
  }
  assert.equal(maskPanelText('메일 someone.fake@example.com 으로'), '메일 ***@*** 으로');
  assert.equal(maskPanelText('잘린 표 fakeuser@exam…'), '잘린 표 ***@***…');
  assert.equal(maskPanelText('앱 비밀번호 abcd efgh ijkl mnop'), '앱 비밀번호 ***');
  // 여러 줄 PEM: 합쳐서 가린다
  const pem = S({ mode: 'read', part: 'result', title: 'k', lines: ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEfakeFAKE0123fakeFAKE0123fakeFAKE0123fake', '-----END RSA PRIVATE KEY-----', 'after'], marks: 'oooo' }); // gitleaks:allow (시험용 가짜 값)
  assert.ok(!pem.lines.join('\n').includes('MIIEfake'));
  assert.equal(pem.lines.length, pem.marks.length);
  // 홈 경로는 ~
  const home = os.homedir();
  assert.equal(maskPanelText(path.join(home, 'proj', 'a.js')), path.join('~', 'proj', 'a.js'));
  // 평범한 글은 그대로
  assert.equal(maskPanelText('ok 71 tests · exit 0 · src/app.js:12'), 'ok 71 tests · exit 0 · src/app.js:12');
});

test('비밀 경로·비밀 명령은 내용 줄을 싣지 않음(제목만, hidden:secret)', () => {
  for (const p of ['D:\\Cloud\\me\\secrets\\survey-app', '/home/u/.ssh/id_ed25519', 'C:/x/.env.local', '/x/server.pem', '/x/gmail-token.json', '~/.claude/.credentials.json'])
    assert.ok(isSecretPath(p), p);
  for (const p of ['D:/git/web/app.js', '/x/secretary/notes.md', '/x/tokenizer.py', 'server/redact.mjs']) assert.ok(!isSecretPath(p), p);
  const rd = S(resultPanel('Read', { file_path: 'D:\\data\\secrets\\svc\\creds.txt' }, { file: { content: 'user=a\nvalue-fake-123' } }, '', null, true));
  assert.equal(rd.hidden, 'secret');
  assert.deepEqual(rd.lines, ['[비밀 경로 — 내용 생략]']);
  const bi = inputPanel('Bash', { command: 'cat D:/data/secrets/svc/creds.txt' });
  assert.ok(bi.secret);
  const br = S(resultPanel('Bash', null, { stdout: 'fake-secret-value' }, '', null, true, bi));
  assert.equal(br.hidden, 'secret');
  assert.ok(!JSON.stringify(br).includes('fake-secret-value'));
  for (const c of ['printenv', 'env | sort', 'Get-ChildItem env:', 'gh auth token', 'echo $env:GITHUB_TOKEN']) assert.ok(touchesSecret({ command: c }), c);
  assert.ok(!touchesSecret({ command: 'npm test' }));
  const ed = S(inputPanel('Edit', { file_path: '/x/.env', old_string: 'A=1', new_string: 'A=fakevalue' }));
  assert.equal(ed.hidden, 'secret');
  assert.ok(!JSON.stringify(ed).includes('fakevalue'));
  // 백그라운드 꼬리도 비밀 작업이면 생략
  assert.equal(S(tailPanel('$ cat secrets/x', ['v'], { nodeId: 's:x', toolUseId: 't' }, { secret: true })).hidden, 'secret');
});

test('LineTail·말 패널·진행 패널', () => {
  const lt = new LineTail(3);
  lt.push('a\nb\n'); lt.push('c\nd'); lt.push('e\n');
  assert.deepEqual(lt.view(), ['b', 'c', 'de']);
  assert.equal(lt.total, 4);
  const sp = S(sayPanel(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']));
  assert.equal(sp.mode, 'say');
  assert.deepEqual(sp.lines, ['3', '4', '5', '6', '7', '8', '9', '10']);
  const pp = S(progressPanel({ title: '조사', prompt: '첫 지시', tools: 2, texts: 1, recent: ['Read a.js', 'Grep x'] }, { nodeId: 's:m', toolUseId: 'tu' }));
  assert.deepEqual(pp.ref, { nodeId: 's:m', toolUseId: 'tu' });
  assert.deepEqual(pp.lines, ['첫 지시', '진행 · 도구 2회 · 말 1', '› Read a.js', '› Grep x']);
  assert.equal(pp.part, 'progress');
});

test('graph.emit: 패널 정리·minimal 삭제·폭주 솎기·스냅샷은 같은 패널 최신 것만', () => {
  const g = new Graph({ rootSessionId: 'x', localSeq: true });
  g.loading = false;
  const e = g.emit({ type: 'tool-end', nodeId: 's:x', toolUseId: 't1', panel: { mode: 'shell', part: 'result', title: 'T', lines: ['\x1b[32mok\x1b[0m', 'Authorization: Basic Zx9fakeFAKE0123'], marks: 'oo' } });
  assert.deepEqual(e.panel.lines, ['ok', 'Authorization: ***']);
  const gm = new Graph({ rootSessionId: 'x', privacy: 'minimal', localSeq: true });
  const em = gm.emit({ type: 'tool-start', nodeId: 's:x', toolUseId: 't', text: 'x', panel: { lines: ['a'] }, parentPanel: { ref: { nodeId: 's:x' }, lines: ['b'] } });
  assert.ok(!('panel' in em) && !('parentPanel' in em));
  // 폭주: 1초 안 같은 노드 PANEL_NODE_RATE 넘으면 줄을 3줄로
  const gs = new Graph({ rootSessionId: 'x', localSeq: true });
  gs.loading = false;
  let thin = 0;
  for (let i = 0; i < PANEL_RATE + 5; i++) {
    const ev = gs.emit({ type: 'output', nodeId: 'b:1', panel: { mode: 'shell', part: 'tail', title: 't', lines: Array.from({ length: 10 }, (_, k) => `${i}-${k}`), marks: '' } });
    if (ev.panel.thin) { thin++; assert.equal(ev.panel.lines.length, 3); assert.equal(ev.panel.lines[2], `${i}-9`, '꼬리는 마지막 줄을 남김'); }
  }
  assert.ok(thin >= PANEL_RATE - 8);
  // 재생 재구성(keepAll)·첫 적재는 솎지 않는다
  const gk = new Graph({ rootSessionId: 'x', localSeq: true, keepAll: true });
  for (let i = 0; i < 60; i++) assert.ok(!gk.emit({ type: 'output', nodeId: 'b:1', panel: { lines: ['a', 'b', 'c', 'd'] } }).panel.thin);
  // 스냅샷: 같은 패널(tool-start → tool-end, output 꼬리 여러 번)은 최신 이벤트에만 내용
  const evs = [
    { type: 'tool-start', nodeId: 'n', toolUseId: 't', panel: { lines: ['in'] } },
    { type: 'output', nodeId: 'b:1', panel: { ref: { nodeId: 'n', toolUseId: 'bg' }, lines: ['1'] } },
    { type: 'tool-end', nodeId: 'n', toolUseId: 't', panel: { lines: ['out'] } },
    { type: 'output', nodeId: 'b:1', panel: { ref: { nodeId: 'n', toolUseId: 'bg' }, lines: ['1', '2'] } },
    { type: 'text', nodeId: 'n', panel: { mode: 'say', lines: ['a'] } },
  ];
  const s = latestPanelsOnly(evs);
  assert.deepEqual(s.map((x) => !!x.panel), [false, false, true, true, true]);
  assert.ok(evs[0].panel, '원본은 그대로');
});

test('라이브·재생 같은 패널: tool-start/end·말·백그라운드 꼬리(ref)·백그라운드 에이전트 진행/결과', async () => {
  const fx = makeReplayFixture();
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  process.env.CCVIZ_CLAUDE_TMP = fx.tmpClaude;
  try {
    const index = new SessionIndex({ projectsDir: fx.projects, sessionsDir: fx.sessions });
    await index.refresh(); ageIndex(index);
    const rt = new RootRuntime({ sessionId: RIDS.main, index });
    await rt.start();
    rt.close();
    const live = rt.graph.ring;
    const data = await buildReplay({ sessionId: RIDS.main, index });
    const rep = data.events.map((x) => x.e || x);
    for (const evs of [live, rep]) {
      const end = evs.find((e) => e.type === 'tool-end' && e.toolUseId === 'toolu_rbg');
      assert.equal(end.panel.title, '$ node long.mjs');
      assert.match(end.panel.lines.join('\n'), /백그라운드 rbg001/);
      const outs = evs.filter((e) => e.type === 'output' && e.nodeId === 'b:rbg001' && e.panel);
      assert.ok(outs.length >= 1);
      const last = outs.at(-1).panel;
      assert.deepEqual(last.ref, { nodeId: `s:${RIDS.main}`, toolUseId: 'toolu_rbg' });
      assert.equal(last.part, 'tail');
      assert.equal(last.lines.at(-1), 'bg line 10');
      const mon = evs.filter((e) => e.type === 'output' && e.nodeId === 'm:rmon01' && e.panel).at(-1);
      assert.equal(mon.panel.mode, 'monitor');
      const say = evs.find((e) => e.type === 'text' && e.nodeId === `s:${RIDS.main}` && e.panel);
      assert.deepEqual(say.panel.lines, ['시작']);
      // 백그라운드 서브에이전트: 하위 도구 → 부모 Agent 패널 진행, 결과 알림 → 결과 패널
      const prog = evs.filter((e) => e.parentPanel && e.parentPanel.ref.toolUseId === 'toolu_ra1');
      assert.ok(prog.some((e) => e.parentPanel.part === 'progress' && e.parentPanel.lines.some((l) => /› Read/.test(l))));
      const res = prog.find((e) => e.type === 'result');
      assert.ok(res && res.parentPanel.part === 'result' && res.parentPanel.lines.includes('조사 끝'));
      for (const e of evs) for (const k of ['panel', 'parentPanel']) if (e[k]) okShape(e[k]);
    }
    // 같은 도구 호출의 tool-end 패널은 두 경로가 같다
    const pick = (evs) => evs.filter((e) => e.type === 'tool-end' && e.panel).map((e) => JSON.stringify([e.toolUseId, e.panel])).sort();
    assert.deepEqual(pick(rep), pick(live));
    // minimal: 어떤 이벤트에도 패널 없음
    const dm = await buildReplay({ sessionId: RIDS.main, index, privacy: 'minimal' });
    assert.ok(dm.events.every((x) => !(x.e || x).panel && !(x.e || x).parentPanel));
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    rmReplayFixture(fx);
  }
});
