// 실황 응답 원문 Markdown(md): 줄바꿈이 있는 응답만 싣고, 마스킹·3000자 상한(mdCut)·minimal 삭제. 라이브 = 재생.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Graph } from '../graph.mjs';
import { LIMITS } from '../parse.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';

test('§140.2 graph.emit: md 마스킹·상한·minimal 이면 뺌', () => {
  const g = new Graph({ rootSessionId: 'x' });
  const long = '| a | b |\n|---|---|\n' + '| 1 | 2 |\n'.repeat(600);
  const e1 = g.emit({ type: 'text', nodeId: 'n', role: 'assistant', text: 'x', md: long });
  assert.equal(e1.md.length, LIMITS.md);
  assert.equal(e1.mdCut, 1);
  const e2 = g.emit({ type: 'text', nodeId: 'n', role: 'assistant', text: 'x', md: '표\n\n키 sk-ant-api03-' + 'A'.repeat(40) });
  assert.ok(!e2.md.includes('A'.repeat(40)), '비밀값 마스킹');
  assert.equal(e2.mdCut, undefined);
  const e3 = g.emit({ type: 'text', nodeId: 'n', role: 'assistant', text: 'x', md: '' });
  assert.equal('md' in e3, false);
  const m = new Graph({ rootSessionId: 'x', privacy: 'minimal' });
  const e4 = m.emit({ type: 'text', nodeId: 'n', role: 'assistant', text: 'x', md: '- a\n- b' });
  assert.equal('md' in e4, false);
  assert.equal(LIMITS.text, 400); // 한 줄 text 상한은 그대로
});

test('§140.2 세션: 줄바꿈 있는 응답만 md(원문 줄 유지), 한 줄 응답은 text 만 — 라이브 = 재생', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-md-'));
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  try {
    const cwd = 'D:\\work\\livemd';
    const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
    const SID = 'cdcdcdcd-6666-4666-8666-cdcdcdcdcdcd';
    const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions'), tmpClaude = path.join(root, 'tmp', 'claude');
    const proj = path.join(projects, enc(cwd));
    for (const d of [proj, sessions, tmpClaude]) fs.mkdirSync(d, { recursive: true });
    process.env.CCVIZ_CLAUDE_TMP = tmpClaude;
    const P = Date.now() - 3 * 86400_000, T = (s) => new Date(P + s * 1000).toISOString();
    const base = { sessionId: SID, cwd, version: '2.1.318', entrypoint: 'cli' };
    const say = (s, text) => ({ type: 'assistant', timestamp: T(s), ...base, message: { model: 'm', role: 'assistant', content: [{ type: 'text', text }] } });
    const TABLE = '결과입니다.\r\n\r\n| 이름 | 값 |\r\n|---|--:|\r\n| a | 1 |\r\n\r\n- 하나\r\n- 둘<system-reminder>숨김</system-reminder>';
    const recs = [
      { type: 'user', timestamp: T(0), ...base, origin: { kind: 'human' }, promptSource: 'user', message: { role: 'user', content: '표로 보여 줘' } },
      say(1, '한 줄 응답 **굵게**'),
      say(2, TABLE),
      { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(3), ...base },
    ];
    fs.writeFileSync(path.join(proj, `${SID}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const old = (P + 60_000) / 1000;
    fs.utimesSync(path.join(proj, `${SID}.jsonl`), old, old);
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SID, index });
    await rt.start();
    rt.close();
    const data = await buildReplay({ sessionId: SID, index });
    for (const [name, evs] of [['live', rt.graph.ring], ['replay', data.events.map((x) => x.e || x)]]) {
      const texts = evs.filter((e) => e.type === 'text' && e.role === 'assistant');
      assert.equal(texts.length, 2, name);
      assert.equal('md' in texts[0], false, name + ': 한 줄 응답은 md 없음');
      assert.equal(texts[1].md, '결과입니다.\n\n| 이름 | 값 |\n|---|--:|\n| a | 1 |\n\n- 하나\n- 둘', name + ': 원문 줄 유지·system-reminder 뺌·CRLF 정리');
      assert.doesNotMatch(texts[1].text, /\n/, name + ': text 는 여전히 한 줄');
    }
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});
