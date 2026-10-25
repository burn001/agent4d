// 서버 없는 화면(?mock=1 · ?demo=1 · 그 재생)에 홀로그램 패널 내용(panel·parentPanel)을 붙이는 가짜 원천.
// mock.js(MockGenerator)·demo-events.jsonl 은 panel 없이 만들어지므로, app.js 가 이벤트 흐름에 이 장식을 한 번 끼운다
// (MockCtx 와 같은 방식: seed(snapshot) · apply(ev) · inject(events)). 내용은 모두 지어낸 것 — 실제 비밀·메일·경로 없음.
// toolUseId 해시로 정해 같은 이벤트 흐름이면 늘 같은 글(난수 흐름을 건드리지 않음). DOM·three 없음(node --test).

function hnum(s, n) { let h = 2166136261; s = String(s || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h % n; }
const P = (mode, part, title, rows, extra = {}) => ({ v: 1, mode, part, title, lines: rows.map((r) => r[1]), marks: rows.map((r) => r[0]).join(''), ...extra });

const SHELL_OUT = {
  'npm test': [['o', '> agent4d@0.1.0 test'], ['o', '> node --test server/test && node --test "web/test/*.test.mjs"'], ['o', 'ok 68 - panel: 셸 꼬리·exit'], ['o', 'ok 69 - panel: 마스킹(가짜 값 13가지)'],
    ['o', 'ok 70 - holo: 줄 표시·말줄임'], ['o', 'ok 71 - holo: 말·꼬리 패널'], ['o', '# tests 71'], ['o', '# pass 71'], ['o', '# fail 0']],
  'git status --short': [['o', ' M web/holo.js'], ['o', ' M web/holo-core.mjs'], ['o', '?? web/holo-text.js'], ['o', '?? web/mock-panel.mjs']],
  'curl -s localhost:7788/healthz': [['o', '{"ok":true,"uptime":812,"sessions":3,"clients":1}']],
  'node --test server/test': [['o', '▶ graph.emit'], ['o', '  ✔ 정리·minimal 삭제 (3.1ms)'], ['o', '  ✔ 폭주 솎기 (1.2ms)'], ['o', '▶ replay'], ['o', '  ✔ 라이브·재생 같은 패널 (41ms)'], ['o', 'ℹ tests 214'], ['o', 'ℹ pass 214']],
  'Get-Process node': [['o', 'Handles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id ProcessName'], ['o', '-------  ------    -----      -----     ------     -- -----------'], ['o', '    412      38    61236      84120       9.42  14208 node'], ['o', '    233      21    30512      41980       1.05  20416 node']],
};
const SHELL_ERR = [['o', '> node --test web/test'], ['e', 'not ok 12 - layout golden angle'], ['e', '  AssertionError: 0.62 !== 0.618'], ['e', '# fail 1']];
const READ_BODY = {
  'CONTRACT.md': ['# Agent4D 계약', '', '## 3. 이벤트 형식', '모든 이벤트는 `seq` 순서로 온다.', '| type | 필드 |', '|---|---|', '| tool-start | nodeId · toolUseId · tool · cat |', '| tool-end | ok · durationMs · brief |', '| output | nodeId · text |', '', '## 50. 홀로그램 패널 내용'],
  'scene.js': ['import * as THREE from \'three\';', 'import { HoloLayer } from \'./holo.js\';', '', 'export class SceneView {', '  constructor(container, opts = {}) {', '    this.vis = new Map();', '    this.focusId = null;', '    this.holo = new HoloLayer(this.scene, this);', '  }', '', '  toolStart(nodeId, ev, quiet = false) {'],
  'journal.jsonl': ['{"t":"2026-10-24T01:02:03Z","kind":"start","task":"panel"}', '{"t":"2026-10-24T01:04:11Z","kind":"step","ok":true}', '{"t":"2026-10-24T01:09:40Z","kind":"step","ok":true}', '{"t":"2026-10-24T01:12:02Z","kind":"done"}'],
  'package.json': ['{', '  "name": "agent4d",', '  "version": "0.1.0",', '  "private": true,', '  "type": "module",', '  "scripts": {', '    "start": "node bin/ccviz.mjs start",', '    "test": "node --test server/test"', '  }', '}'],
};
const CODE = {
  js: ['export function holoRows(p, rows) {', '  if (!p || rows <= 0) return [];', '  const keep = Math.max(1, rows - 1);', '  return p.lines.slice(0, keep);', '}'],
  css: ['.holo-label {', '  font: 600 10.5px/1.25 ui-monospace, monospace;', '  color: var(--text);', '}'],
  md: ['# Agent4D', '', '세션 동작을 3D 로 보여 준다.', '', '## 실행', '`ccviz start --watch`'],
  json: ['{', '  "tempo": 92,', '  "key": "D minor",', '  "sections": ["intro", "build", "peak", "outro"]', '}'],
};
const ext = (f) => { const m = /\.(\w+)$/.exec(f || ''); const e = m ? m[1] : 'js'; return CODE[e] ? e : e === 'mjs' ? 'js' : 'js'; };
const GREP = ['server/graph.mjs:88:    toolUseId: ev.toolUseId,', 'server/session.mjs:795:  // 스냅샷 openTools 에도 같은 마스킹', 'server/replay.mjs:412:  const tu = ev.toolUseId;', 'web/app.js:381:  n.openTools.push({ toolUseId: ev.toolUseId,'];
const GLOB = ['web/app.js', 'web/scene.js', 'web/holo.js', 'web/holo-core.mjs', 'web/holo-text.js', 'web/flowview/flow-view.js'];
const WEB_BODY = ['CSS2DRenderer', 'CSS2DRenderer 는 HTML 요소를 3D 장면 위치에 맞춰 띄운다.', '렌더 루프에서 renderer.render(scene, camera) 다음에 부른다.', 'pointer-events 는 기본 none 으로 두는 편이 좋다.'];
const TODO = [['d', '[x] 계약서 읽기'], ['d', '[x] 패널 틀만 남기기'], ['h', '[>] 실제 글 그리기'], ['o', '[ ] mock 패널'], ['o', '[ ] 스크린샷 확인']];
const SAYS = ['계약서를 읽고 패널 내용 형식을 확인했습니다.', '가짜 화면을 걷어 내고 실제 줄을 캔버스에 그립니다.', '꼬리 갱신은 줄이 위로 밀려 올라가게 했습니다.', '라이트 테마에서도 글이 읽히는지 확인하겠습니다.'];

function inputPanel(ev) {
  const t = ev.tool, x = ev.text || '', id = ev.toolUseId || '';
  switch (t) {
    case 'Bash': case 'PowerShell': return P('shell', 'input', '$ ' + x, ev.detail ? [['d', ev.detail]] : []);
    case 'Monitor': return P('monitor', 'input', '$ tail -f logs/server.log', [['d', x]]);
    case 'Read':
      if (hnum(id, 5) === 0) return P('read', 'input', '~/.config/demo/credentials.json', [['d', '[비밀 경로 — 내용 생략]']], { hidden: 'secret' });
      return P('read', 'input', 'agent4d/web/' + x, [['d', ev.detail || '처음부터 200줄']]);
    case 'Write': return P('diff', 'input', 'agent4d/web/' + x, CODE[ext(x)].map((l) => ['+', l]));
    case 'Edit': return P('diff', 'input', 'agent4d/web/' + x, [['-', '  const H = 0.85 + 0.22 * v.r;'], ['+', '  let H = (1.25 + 0.3 * v.r) * (isShot ? 1.5 : 1);'], ['+', '  const W = H * HOLO.ASPECT;']]);
    case 'Grep': return P('search', 'input', `"${x}" · server`, [['d', 'glob *.mjs · files_with_matches']]);
    case 'Glob': return P('search', 'input', x, []);
    case 'WebFetch': return P('web', 'input', x + '/docs', [['d', '렌더러 설정 방법 요약']]);
    case 'WebSearch': return P('web', 'input', x, [['d', 'allowed_domains: threejs.org']]);
    case 'Agent': case 'Task': return P('agent', 'input', x, [['d', 'general-purpose · 백그라운드'], ['o', x + ' 작업을 맡아 계약대로 진행하고'], ['o', '바뀐 파일과 시험 결과를 짧게 보고하라.']]);
    case 'SendMessage': return P('agent', 'input', '→ 검증 담당', [['o', x]]);
    case 'Workflow': return P('agent', 'input', x, [['d', 'phases: 설계 → 빌드 → 검증']]);
    case 'Skill': return P('generic', 'input', ev.skill || x, [['d', '(인자 없음)']]);
    case 'TodoWrite': return P('generic', 'input', '할 일 2/5', TODO);
    case 'TaskStop': return P('generic', 'input', '■ ' + x, []);
    default:
      if (String(t).startsWith('mcp__')) return P('generic', 'input', 'context7.query-docs', [['d', 'libraryId: /mrdoob/three.js'], ['d', 'query: CSS2DRenderer pointer events']]);
      return P('generic', 'input', x || t, [['d', 'message: ' + (x || t)]]);
  }
}
function resultPanel(st, ev) {
  const t = st.tool, x = st.text || '', ok = ev.ok !== false, id = ev.toolUseId || '';
  const input = st.panel;
  if (input && input.hidden === 'secret') return { ...input, part: 'result' };
  const end = String(ev.text || '');
  switch (t) {
    case 'Bash': case 'PowerShell': {
      if (/백그라운드/.test(end)) return P('shell', 'result', input.title, [['d', `백그라운드 b${hnum(id, 900) + 100} 시작 — 출력은 갱신으로`]]);
      if (!ok) return P('shell', 'result', input.title, [...SHELL_ERR, ['e', 'exit 1']]);
      const out = SHELL_OUT[x] || (x.startsWith('claude -p') ? [['o', end || '{"result":"ok"}']] : [['o', 'done in ' + (200 + hnum(id, 800)) + 'ms']]);
      return P('shell', 'result', input.title, [...out, ['d', 'exit 0']]);
    }
    case 'Monitor': return P('monitor', 'result', input.title, [['d', `백그라운드 m${hnum(id, 900) + 100} 시작 — 출력은 갱신으로`]]);
    case 'Read': {
      if (!ok) return P('read', 'result', input.title, [['e', '파일을 찾을 수 없음']]);
      const body = READ_BODY[x] || CODE[ext(x)];
      const total = 120 + hnum(id, 400);
      return P('read', 'result', input.title, [...body.slice(0, 11).map((l) => ['o', l]), ['d', `1～${Math.min(11, body.length)}줄 / ${total}`]]);
    }
    case 'Edit': {
      const a = 40 + hnum(id, 300);
      return P('diff', 'result', input.title, ok ? [['@', `@@ -${a},3 +${a},4 @@`], ['d', '  const o = v.group.position;'], ['-', '  const H = 0.85 + 0.22 * v.r;'], ['+', '  let H = (1.25 + 0.3 * v.r) * (isShot ? 1.5 : 1);'], ['+', '  const W = H * HOLO.ASPECT;']] : [['e', 'old_string 을 찾지 못함']]);
    }
    case 'Write': return { ...input, part: 'result' };
    case 'Grep': { const n = 1 + hnum(id, 4); return P('search', 'result', input.title, [...GREP.slice(0, n).map((l) => ['h', l]), ['d', `${n}줄 일치`]]); }
    case 'Glob': { const n = 2 + hnum(id, 5); return P('search', 'result', input.title, [...GLOB.slice(0, n).map((l) => ['h', l]), ['d', `${n}개 파일`]]); }
    case 'WebFetch': return P('web', 'result', input.title, ok ? [...WEB_BODY.map((l) => ['o', l]), ['d', `HTTP 200 · ${10 + hnum(id, 90)}KB`]] : [['e', 'HTTP 404']]);
    case 'WebSearch': return P('web', 'result', input.title, [['h', '• CSS2DRenderer – three.js docs — threejs.org'], ['h', '• three.js examples: css2d_label — threejs.org'], ['h', '• Labels in three.js scenes — discourse.threejs.org']]);
    case 'Agent': case 'Task': return P('agent', 'result', input.title, [...input.lines.map((l, i) => [input.marks[i], l]), ['d', '백그라운드로 시작 — 진행은 갱신으로']]);
    case 'SendMessage': return P('agent', 'result', input.title, [['o', '전달함 — 검증 담당이 받음']]);
    case 'Workflow': return P('agent', 'result', input.title, [['d', `runId wf_${hnum(id, 9000)} · 시작됨`]]);
    case 'Skill': return P('generic', 'result', input.title, [['d', '(인자 없음)'], ['o', `Launching skill: ${input.title}`]]);
    case 'TaskStop': return P('generic', 'result', input.title, [['o', 'Successfully stopped task']]);
    default: return { ...input, part: 'result', ...(ok ? {} : { lines: [...input.lines, '실패: 연결 시간 초과'], marks: input.marks + 'e' }) };
  }
}

export class MockPanels {
  constructor() {
    this.tools = new Map();  // toolUseId → {nodeId, tool, text, panel}
    this.nodes = new Map();  // nodeId → {parentId, kind, toolUseId, label}
    this.launch = new Map(); // 노드 → 가장 최근 Bash/PowerShell/Monitor toolUseId(백그라운드 노드 ref)
    this.tails = new Map();  // 작업 노드(b:·m:) → {ref, title, mode, lines[], total}
    this.says = new Map();   // 노드 → 최근 말 줄
    this.prog = new Map();   // 서브에이전트 → {tools, says, recent[]}
  }
  _node(n) {
    if (!n || !n.id) return;
    const meta = n.meta || {};
    this.nodes.set(n.id, { parentId: n.parentId || null, kind: n.kind, toolUseId: meta.toolUseId || null, label: n.label || '' });
    if ((n.kind === 'bash-bg' || n.kind === 'monitor') && !this.tails.has(n.id)) {
      const tu = meta.toolUseId || this.launch.get(n.parentId) || null;
      const st = tu && this.tools.get(tu);
      this.tails.set(n.id, { ref: { nodeId: st ? st.nodeId : n.parentId, toolUseId: tu }, title: n.kind === 'monitor' ? '$ tail -f logs/server.log' : '$ ' + (meta.command || n.label || ''), mode: n.kind === 'monitor' ? 'monitor' : 'shell', lines: [], total: 0 });
    }
  }
  _progress(nodeId, part = 'progress', result = null) {
    const n = this.nodes.get(nodeId);
    if (!n || !n.toolUseId || !n.parentId) return null;
    const st = this.tools.get(n.toolUseId);
    if (!st || (st.tool !== 'Agent' && st.tool !== 'Task')) return null;
    const g = this.prog.get(nodeId) || { tools: 0, says: 0, recent: [] };
    const prompt = st.text + ' 작업을 맡아 계약대로 진행하고';
    const rows = result ? [['d', prompt], ...result.map((l) => ['o', l])]
      : [['d', prompt], ['d', `진행 · 도구 ${g.tools}회 · 말 ${g.says}`], ...g.recent.slice(-4).map((l) => ['h', l])];
    return P('agent', part, st.text, rows, { ref: { nodeId: n.parentId, toolUseId: n.toolUseId } });
  }
  /** 이벤트에 panel·parentPanel 을 붙여 그대로 돌려준다(이미 있으면 손대지 않음) */
  apply(ev) {
    if (!ev || typeof ev !== 'object') return ev;
    const id = ev.toolUseId;
    switch (ev.type) {
      case 'node-add': this._node(ev.node); break;
      case 'tool-start': {
        const panel = ev.panel || inputPanel(ev);
        if (!ev.panel) ev.panel = panel;
        if (id) this.tools.set(id, { nodeId: ev.nodeId, tool: ev.tool, text: ev.text || ev.skill || '', panel });
        if (ev.tool === 'Bash' || ev.tool === 'PowerShell' || ev.tool === 'Monitor') this.launch.set(ev.nodeId, id);
        const g = this.prog.get(ev.nodeId) || { tools: 0, says: 0, recent: [] };
        g.tools++; g.recent.push(`› ${ev.tool} ${ev.brief || ev.text || ''}`.trim()); if (g.recent.length > 4) g.recent.shift();
        this.prog.set(ev.nodeId, g);
        if (!ev.parentPanel) { const pp = this._progress(ev.nodeId); if (pp) ev.parentPanel = pp; }
        break;
      }
      case 'tool-end': {
        const st = id && this.tools.get(id);
        if (st && !ev.panel) ev.panel = resultPanel(st, ev);
        break;
      }
      case 'output': {
        const tl = this.tails.get(ev.nodeId);
        if (!tl || ev.panel) break;
        for (const l of String(ev.text || '').split('\n')) { tl.lines.push(l); tl.total++; }
        if (tl.lines.length > 40) tl.lines.splice(0, tl.lines.length - 40);
        const last = tl.lines.slice(-12);
        const more = tl.total - last.length;
        ev.panel = P(tl.mode, 'tail', tl.title, last.map((l) => [/error|fail/i.test(l) ? 'e' : 'o', l]), { ref: tl.ref, ...(more > 0 ? { more } : {}), ...(tl.total % 17 === 0 ? { thin: true } : {}) });
        break;
      }
      case 'text': {
        if (ev.role !== 'assistant' || !ev.text) break;
        const arr = this.says.get(ev.nodeId) || [];
        arr.push(...String(ev.text).split('\n').filter((l) => l.trim()));
        if (hnum(ev.nodeId + ':' + arr.length, 3) === 0) arr.push(SAYS[hnum(ev.nodeId + arr.length, SAYS.length)]);
        if (arr.length > 8) arr.splice(0, arr.length - 8);
        this.says.set(ev.nodeId, arr);
        if (!ev.panel) ev.panel = P('say', 'say', '', arr.map((l) => ['o', l]));
        const g = this.prog.get(ev.nodeId) || { tools: 0, says: 0, recent: [] };
        g.says++; this.prog.set(ev.nodeId, g);
        if (!ev.parentPanel) { const pp = this._progress(ev.nodeId); if (pp) ev.parentPanel = pp; }
        break;
      }
      case 'result': {
        if (!ev.parentPanel && ev.text) { const pp = this._progress(ev.nodeId, 'result', [String(ev.text).slice(0, 100)]); if (pp) ev.parentPanel = pp; }
        break;
      }
    }
    return ev;
  }
  /** 스냅샷: 노드·최근 이벤트로 상태를 배우고, 열린 도구에 입력 패널을 붙인다 */
  seed(snap) {
    if (!snap) return snap;
    for (const n of snap.nodes || []) this._node(n);
    for (const ev of snap.recent || []) this.apply(ev);
    for (const n of snap.nodes || []) for (const t of n.openTools || []) {
      if (t.panel) continue;
      const st = this.tools.get(t.toolUseId);
      t.panel = st ? st.panel : inputPanel({ ...t });
      if (!st && t.toolUseId) this.tools.set(t.toolUseId, { nodeId: n.id, tool: t.tool, text: t.text || t.skill || '', panel: t.panel });
    }
    return snap;
  }
  /** 재생용: 이벤트 배열 전체에 붙인다 */
  inject(events) { for (const ev of events) this.apply(ev); return events; }
}
