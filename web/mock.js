// 서버 없이 쓰는 가짜 이벤트 원천.
//   ?mock=1            : 결정적 시뮬레이터를 실시간으로 돌린다(시작 시 25초 분량을 미리 돌려 snapshot 으로 보냄)
//   ?mock=1&stress=300 : 노드 수백 개·초당 수십 이벤트 부하 시험
//   ?demo=1            : demo-events.jsonl(녹화된 이벤트)을 시각 간격대로 재생, 끝나면 처음부터
// 이벤트 형식은 과 같다. DOM·three 에 의존하지 않아 Node 에서도 import 가능(tools/gen-demo.mjs).
import { ixMockScript } from './ix-mock.mjs';
import { jobMockScript, procMockScript } from './job-mock.mjs'; // 작업 노드 · 분리 프로세스
import { t as tr } from './i18n.mjs';

const TOOLS = [
  ['Bash', 'shell', ['npm test', 'git status --short', 'curl -s localhost:7788/healthz', 'node --test server/test']],
  ['Read', 'read', ['CONTRACT.md', 'scene.js', 'journal.jsonl', 'package.json']],
  ['Write', 'write', ['layout.js', 'README.md', 'bgm.json']],
  ['Edit', 'edit', ['app.js', 'theme.css', 'worker.js']],
  ['Grep', 'search', ['toolUseId', 'task-notification', 'CCVIZ_READY']],
  ['SendMessage', 'agent', ['검증 담당에게 결과 전달']],
  ['Workflow', 'workflow', ['빌드 단계 실행']],
  ['Skill', 'skill', ['frontend-design', 'cloudflare:cf-cli', 'style-guide', 'skill-creator']],
  ['WebFetch', 'web', ['developers.cloudflare.com', 'threejs.org']],
  ['Monitor', 'monitor', ['터널 로그 감시']],
  ['mcp__context7__query-docs', 'mcp', ['context7.query-docs']],
  ['Artifact', 'artifact', ['결과 보고 페이지 게시']],
  ['PushNotification', 'notify', ['작업 완료 알림']],
  ['TodoWrite', 'other', ['{"todos":[{"content":"검증"…']],
  ['Glob', 'search', ['web/**/*.js']],
  ['PowerShell', 'shell', ['Get-Process node']],
  ['WebSearch', 'web', ['three.js CSS2DRenderer']],
];
const TEXTS = [
  '계약서를 읽고 프런트엔드 구조를 잡겠습니다.', '노드 배치 규칙을 황금각 기준으로 구현했습니다.',
  '서버 SSE 형식을 확인했습니다. snapshot 다음 ev 가 이어집니다.', '테스트가 모두 통과했습니다.',
  '터널 주소를 KV 에 등록했습니다.', '카메라 자동 투어 점수를 계산합니다.', '빌드 결과를 검토하고 있습니다.',
  '이 부분은 계약과 다르므로 반환값에 적겠습니다.', '스크린샷으로 다크·라이트 테마를 확인했습니다.',
];
const OUTPUTS = [
  'GET /healthz 200 3ms', 'compiling… done in 412ms', '[watch] 2 files changed', '2026-10-23T01:12:04Z INF Registered tunnel connection',
  'ok 12 - layout golden angle\nok 13 - camera framing', 'event: ev  seq=1532', 'Server listening on 127.0.0.1:7788',
];
const AGENT_LABELS = ['서버 파서 구현', '3D 프런트엔드', '배경음악 합성', 'Cloudflare 워커', '통합 검증', '문서·스킬 정리',
  '계약 검토', '성능 측정', '보안 점검', '모바일 화면 확인'];
const PHASES = [['Design', '설계:계약'], ['Build', '빌드:서버'], ['Build', '빌드:프런트'], ['Verify', '검증:통합']];

// 작업 요약: 서버 brief.mjs 와 같은 모양. 난수 흐름을 바꾸지 않게 toolUseId 해시로 정한다
function hnum(s, n) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h % n; }
const BASH_DESC = { 'npm test': '단위시험 실행', 'git status --short': '변경 파일 확인', 'curl -s localhost:7788/healthz': '서버 상태 확인', 'node --test server/test': '서버 시험' };
export function mockBrief(tool, cat, text, id) {
  const k = hnum(id, 97);
  switch (tool) {
    case 'Bash': return { brief: text, detail: BASH_DESC[text] || '' };
    case 'Read': return { brief: 'web/' + text, detail: k % 3 ? '' : `${k * 7}줄부터 200줄` };
    case 'Edit': return { brief: `${text} +${1 + (k % 23)} −${k % 9}`, detail: 'agent4d/web/' + text };
    case 'Write': return { brief: `${text} ${20 + k * 3}줄`, detail: 'agent4d/web/' + text };
    case 'Grep': return { brief: `"${text}" · server`, detail: 'glob *.mjs · files_with_matches' };
    case 'Glob': return { brief: text, detail: '' };
    case 'WebFetch': return { brief: text + '/docs', detail: '렌더러 설정 방법 요약' };
    case 'SendMessage': return { brief: '→ 검증 담당', detail: text };
    default: return { brief: text, detail: '' };
  }
}
export function mockResult(cat, ok, id) {
  const k = hnum(id + '#r', 97);
  if (!ok) return cat === 'shell' ? `exit 1 · Error: ${k % 2 ? 'EADDRINUSE 127.0.0.1:7788' : 'test failed (2)'}` : '실패 · 파일을 찾을 수 없음';
  switch (cat) {
    case 'shell': return `exit 0 · ${['ok 71 tests', 'nothing to commit', '{"ok":true}', 'pass 96'][k % 4]}`;
    case 'read': return `${40 + k * 3}줄 읽음`;
    case 'search': return `${1 + (k % 12)}개 파일`;
    case 'edit': case 'write': return `+${1 + (k % 23)} −${k % 9}`;
    case 'web': return `HTTP 200 · ${10 + k}KB`;
    default: return '완료';
  }
}

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class MockGenerator {
  constructor({ seed = 2026, startMs = Date.now(), stress = 0, launcher = false, ix = false, jobs = false, procs = false } = {}) {
    this.r = rng(seed);
    this.t0 = startMs;
    this.t = 0;              // 가상 시각(ms)
    this.seq = 0;
    this.q = [];             // [{at, fn}]
    this.nodes = new Map();  // 생성기 자신의 상태(snapshot 용)
    this.recent = [];
    this.stress = stress;
    this.cnt = { a: 0, b: 0, m: 0, w: 0, s: 0, tu: 0, tool: 0 };
    this.root = 's:demo-main-0001';
    // 기동기·배치 예시: 켜면 메인 → 서브에이전트 → '기동기 · relaunch.sh' → 회차 반복 + 재무장 Monitor. 기본은 끔(시험·녹화 데모 그대로)
    this.launcher = launcher ? (launcher === true ? {} : launcher) : null;
    this._script();
    if (this.launcher) this._launcherScript();
    if (ix) ixMockScript(this); // 특별 상호작용 시나리오(따로 난수열 — 기존 순서 그대로)
    if (jobs && this.launcher) jobMockScript(this); // 작업 노드(난수 없음, 기동기·재무장 Monitor 를 주인으로 씀)
    if (procs) procMockScript(this); // 분리 프로세스·진행 레인·들여다보기(난수 없음)
  }

  // ---------- 도우미 ----------
  rand(a, b) { return a + (b - a) * this.r(); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  at(dtMs, fn) { this.q.push({ at: this.t + dtMs, fn }); }
  iso() { return new Date(this.t0 + this.t).toISOString(); }
  tuid() { return 'toolu_demo' + String(++this.cnt.tu).padStart(5, '0'); }

  emit(out, ev) {
    ev.seq = ++this.seq;
    ev.ts = this.iso();
    this.applyLocal(ev);
    out.push(ev);
    this.recent.push(ev);
    if (this.recent.length > 300) this.recent.shift();
    return ev;
  }

  applyLocal(ev) {
    const n = this.nodes.get(ev.nodeId);
    switch (ev.type) {
      case 'node-add': this.nodes.set(ev.nodeId, JSON.parse(JSON.stringify(ev.node))); break;
      case 'node-update':
        if (n) { const { meta, ...rest } = ev.patch; Object.assign(n, rest); if (meta) n.meta = { ...n.meta, ...meta }; }
        break;
      case 'tool-start': if (n) { n.openTools.push({ toolUseId: ev.toolUseId, tool: ev.tool, cat: ev.cat, skill: ev.skill, startedAt: ev.ts, text: ev.text, ...(ev.brief ? { brief: ev.brief } : {}) }); n.counts.tools++; } break;
      case 'tool-end': if (n) { n.openTools = n.openTools.filter((t) => t.toolUseId !== ev.toolUseId); if (!ev.ok) n.counts.errors++; } break;
      case 'text': if (n) n.counts.texts++; break;
    }
    if (n) n.lastActivityAt = ev.ts;
  }

  snapshot() {
    return { root: this.root, sessionId: this.root.slice(2), seq: this.seq, nodes: [...this.nodes.values()].map((n) => JSON.parse(JSON.stringify(n))), recent: this.recent.slice() };
  }

  /** 다음 예약 동작을 실행하고 {at, events} 반환 */
  next() {
    if (!this.q.length) this.at(1000, (o) => this.idleTick(o));
    let bi = 0;
    for (let i = 1; i < this.q.length; i++) if (this.q[i].at < this.q[bi].at) bi = i;
    const item = this.q.splice(bi, 1)[0];
    this.t = Math.max(this.t, item.at);
    const out = [];
    item.fn(out);
    return { at: this.t, events: out };
  }

  // ---------- 노드 ----------
  addNode(out, { id, parentId, kind, label, meta = {}, status = 'active' }) {
    const parent = this.nodes.get(parentId);
    const node = {
      id, parentId: parentId || null, kind, label, model: kind === 'bash-bg' || kind === 'monitor' ? null : 'claude-opus-5-5',
      status, startedAt: this.iso(), endedAt: null, lastActivityAt: this.iso(), depth: parent ? parent.depth + 1 : 0,
      sessionId: 'demo-main-0001',
      meta: { agentType: null, toolUseId: null, phase: null, cwd: null, command: null, skill: null, background: true, ...meta },
      counts: { tools: 0, errors: 0, texts: 0 }, openTools: [],
    };
    this.emit(out, { type: 'node-add', nodeId: id, node });
    return node;
  }
  setStatus(out, id, status, meta = null) {
    const n = this.nodes.get(id); if (!n || n.status === status) return;
    const patch = { status };
    if (status === 'done' || status === 'error' || status === 'stopped') patch.endedAt = this.iso();
    if (meta) patch.meta = meta;
    this.emit(out, { type: 'node-update', nodeId: id, patch });
  }
  alive(id) { const n = this.nodes.get(id); return n && (n.status === 'active' || n.status === 'idle'); }

  /** 도구 하나 시작 → 일정 시간 뒤 종료 예약 */
  tool(out, nodeId, spec, { durMs, ok, endText, onEnd } = {}) {
    const [tool, cat, texts] = spec;
    const toolUseId = this.tuid();
    const skill = cat === 'skill' ? this.pick(texts) : null;
    const text = cat === 'skill' ? skill : this.pick(texts);
    const bd = mockBrief(tool, cat, text, toolUseId);
    this.emit(out, { type: 'tool-start', nodeId, toolUseId, tool, cat, skill, text, brief: bd.brief, detail: bd.detail });
    if (skill) this.emit(out, { type: 'node-update', nodeId, patch: { meta: { skill } } });
    const started = this.t;
    const d = durMs ?? (cat === 'shell' ? this.rand(600, 7000) : cat === 'web' ? this.rand(800, 4000) : this.rand(150, 2200));
    const good = ok ?? this.r() > 0.08;
    this.at(d, (o) => {
      const nn = this.nodes.get(nodeId);
      if (!nn || !nn.openTools.some((x) => x.toolUseId === toolUseId)) return; // 이미 정리됨
      this.emit(o, { type: 'tool-end', nodeId, toolUseId, tool, cat, ok: good, durationMs: Math.round(this.t - started),
        text: endText || (good ? (cat === 'read' ? '120줄 읽음' : cat === 'shell' ? 'exit 0' : '완료') : '오류: 명령 실패 (exit 1)'),
        brief: endText || mockResult(cat, good, toolUseId) });
      if (onEnd) onEnd(o);
      if (skill) this.at(this.rand(3000, 9000), (o2) => { const n = this.nodes.get(nodeId); if (n && n.meta.skill === skill) this.emit(o2, { type: 'node-update', nodeId, patch: { meta: { skill: null } } }); });
    });
    return toolUseId;
  }

  nextToolSpec() {
    const c = this.cnt.tool++;
    if (c < 14) return TOOLS[c]; // 처음 14번은 모든 cat 을 한 번씩
    return this.pick(TOOLS);
  }

  // ---------- 시나리오 ----------
  _script() {
    const M = this.root;
    this.at(0, (o) => {
      this.addNode(o, { id: M, parentId: null, kind: 'main', label: '메인 · acme-web', meta: { title: 'Claude Code 세션 시각화 개발', cwd: 'D:\\work\\acme-web', background: false } });
      this.emit(o, { type: 'user', nodeId: M, origin: 'human', text: '클로드 코드 세션 동작을 시각화하는 도구를 만들어줘. 에이전트 팀을 꾸려서 진행해 줘.' });
    });
    this.at(400, (o) => this.emit(o, { type: 'thinking', nodeId: M, chars: 1840 }));
    this.at(900, (o) => this.tool(o, M, TOOLS[7], { durMs: 900 }));
    this.at(1500, (o) => this.emit(o, { type: 'text', nodeId: M, role: 'assistant', text: '팀을 꾸려 설계·빌드·검증 순서로 진행하겠습니다.' }));
    this.at(2000, (o) => this.spawnAgent(o, M, '서버 파서 구현'));
    this.at(2600, (o) => this.spawnAgent(o, M, '3D 프런트엔드'));
    this.at(3200, (o) => this.spawnWorkflow(o, M));
    this.at(4200, (o) => this.spawnBg(o, M, 'node server/index.mjs --demo'));
    this.at(5000, (o) => this.spawnMonitor(o, M, '서버 로그 감시'));
    this.at(1200, (o) => this.act(o, M));
    this.at(45000, (o) => this.mainTurn(o));
    this.at(15000, (o) => this.spawner(o));
    if (this.stress) this.at(1000, (o) => this.stressSpawn(o));
  }

  spawnAgent(out, parentId, label, { kind = 'subagent', life } = {}) {
    if (!this.alive(parentId)) return null;
    const id = 'a:demo' + String(++this.cnt.a).padStart(4, '0');
    const tu = this.tool(out, parentId, ['Agent', 'agent', [label]], { durMs: 300, endText: 'async_launched' });
    this.at(120, (o) => {
      this.addNode(o, { id, parentId, kind, label, meta: { agentType: 'general-purpose', toolUseId: tu } });
      this.at(this.rand(300, 900), (o2) => this.act(o2, id));
      const L = life ?? this.rand(18000, 60000) * (this.stress ? 3 : 1);
      this.at(L, (o2) => this.finishAgent(o2, id));
      // 일부 에이전트는 손자를 만든다
      if (this.r() < 0.35 && !this.stress) this.at(this.rand(4000, 9000), (o2) => this.spawnAgent(o2, id, this.pick(AGENT_LABELS) + ' 보조'));
    });
    return id;
  }

  finishAgent(out, id) {
    const n = this.nodes.get(id); if (!n || !this.alive(id)) return;
    for (const t of n.openTools.slice()) this.emit(out, { type: 'tool-end', nodeId: id, toolUseId: t.toolUseId, tool: t.tool, cat: t.cat, ok: true, durationMs: 500, text: '완료' });
    const bad = (this.cnt.fin = (this.cnt.fin || 0) + 1) === 2 || this.r() < 0.1; // 두 번째 종료는 항상 오류(시연용)
    this.emit(out, { type: 'result', nodeId: id, ok: !bad, text: bad ? '검증 실패: 테스트 2건 실패' : `${n.label} 완료 — 변경 파일 4개, 테스트 통과` });
    this.setStatus(out, id, bad ? 'error' : 'done');
    if (n.parentId) this.emit(out, { type: 'user', nodeId: n.parentId, origin: 'task-notification', text: `에이전트 "${n.label}" ${bad ? '실패' : '완료'}` });
  }

  spawnWorkflow(out, parentId) {
    if (!this.alive(parentId)) return;
    const runId = 'wf_demo' + String(++this.cnt.w).padStart(3, '0');
    const id = 'w:' + runId;
    this.tool(out, parentId, ['Workflow', 'workflow', ['agent4d 팀']], { durMs: 400, endText: 'async_launched' });
    this.at(150, (o) => {
      this.addNode(o, { id, parentId, kind: 'workflow', label: 'agent4d 팀 ' + this.cnt.w, meta: { background: true } });
      const agents = [];
      PHASES.slice(0, this.stress ? 4 : 3 + (this.cnt.w % 2)).forEach(([phase, label], i) => {
        this.at(600 + i * 1400, (o2) => {
          const aid = 'a:demowf' + String(++this.cnt.a).padStart(4, '0');
          agents.push(aid);
          this.addNode(o2, { id: aid, parentId: id, kind: 'workflow-agent', label, meta: { phase, agentType: 'workflow-subagent' } });
          this.at(300, (o3) => this.act(o3, aid));
          if (i === 1 && this.cnt.s < 3) this.at(3000, (o3) => this.spawnClaudeP(o3, aid));
          this.at(this.rand(20000, 45000), (o3) => {
            if (!this.alive(aid)) return;
            this.emit(o3, { type: 'result', nodeId: aid, ok: true, text: `{"phase":"${phase}","ok":true,"files":3}` });
            this.setStatus(o3, aid, 'done');
            if (agents.every((x) => !this.alive(x))) this.at(1500, (o4) => {
              this.setStatus(o4, id, 'done');
              this.emit(o4, { type: 'user', nodeId: parentId, origin: 'task-notification', text: `워크플로 ${runId} 완료` });
            });
          });
        });
      });
    });
  }

  spawnClaudeP(out, parentId) {
    if (!this.alive(parentId)) return;
    const sid = 'demo-child-' + String(++this.cnt.s).padStart(4, '0');
    const id = 's:' + sid;
    let childDone = false;
    this.tool(out, parentId, ['Bash', 'shell', [`claude -p --session-id ${sid} "통합 시험"`]], {
      durMs: 26000, endText: `{"session_id":"${sid}","result":"ok"}`,
      onEnd: (o) => this.at(2000, (o2) => { if (!childDone) { childDone = true; this.emit(o2, { type: 'result', nodeId: id, ok: true, text: '독립 세션 결과: 통합 시험 통과' }); this.setStatus(o2, id, 'done'); } }),
    });
    this.at(700, (o) => {
      this.addNode(o, { id, parentId, kind: 'claude-p', label: 'claude -p · ' + sid.slice(0, 8), meta: { title: '통합 시험을 실행하고 결과를 JSON 으로 보고하라.', cwd: 'C:\\Users\\dev\\AppData\\Local\\Temp\\sandbox' } });
      this.emit(o, { type: 'user', nodeId: id, origin: 'human', text: '통합 시험을 실행하고 결과를 JSON 으로 보고하라.' });
      this.at(500, (o2) => this.act(o2, id));
      this.at(2500, (o2) => this.spawnAgent(o2, id, 'claude -p 하위 에이전트', { life: 16000 }));
    });
  }

  spawnBg(out, parentId, label) {
    if (!this.alive(parentId)) return;
    const id = 'b:demo' + String(++this.cnt.b).padStart(3, '0');
    this.tool(out, parentId, ['Bash', 'shell', [label]], { durMs: 200, endText: '백그라운드로 실행' });
    this.at(80, (o) => {
      this.addNode(o, { id, parentId, kind: 'bash-bg', label, meta: { command: label } });
      const life = this.rand(25000, 70000);
      const t0 = this.t;
      const tick = (o2) => {
        if (!this.alive(id)) return;
        if (this.t - t0 > life) {
          const bad = this.r() < 0.15;
          // 홀수 번째 백그라운드 명령은 에이전트가 TaskStop 으로 끈다(시험 서버 끄기) → '중지됨'. 난수 순서는 그대로
          if (Number(id.slice(-3)) % 2 === 1 && this.alive(parentId)) {
            const tu = this.tuid();
            this.emit(o2, { type: 'tool-start', nodeId: parentId, toolUseId: tu, tool: 'TaskStop', cat: 'monitor', skill: null, text: label });
            this.emit(o2, { type: 'tool-end', nodeId: parentId, toolUseId: tu, tool: 'TaskStop', cat: 'monitor', ok: true, durationMs: 40, text: 'Successfully stopped task' });
            this.setStatus(o2, id, 'stopped', { killed: true, stopReason: 'taskstop' });
            return;
          }
          this.emit(o2, { type: 'output', nodeId: id, text: bad ? 'Error: EADDRINUSE 127.0.0.1:7788' : '[exit 0]' });
          this.setStatus(o2, id, bad ? 'error' : 'done');
          this.emit(o2, { type: 'user', nodeId: parentId, origin: 'task-notification', text: `Background command "${label}" ${bad ? 'failed' : 'completed'}` });
          return;
        }
        this.emit(o2, { type: 'output', nodeId: id, text: this.pick(OUTPUTS) });
        this.at(this.rand(700, 3200), tick);
      };
      this.at(500, tick);
    });
  }

  spawnMonitor(out, parentId, label) {
    if (!this.alive(parentId)) return;
    const id = 'm:demo' + String(++this.cnt.m).padStart(3, '0');
    this.tool(out, parentId, ['Monitor', 'monitor', [label]], { durMs: 250, endText: 'taskId 발급' });
    this.at(100, (o) => {
      this.addNode(o, { id, parentId, kind: 'monitor', label, meta: { timeoutMs: 1800000 } });
      const tick = (o2) => {
        if (!this.alive(id)) return;
        this.emit(o2, { type: 'output', nodeId: id, text: this.pick(['GET /events 200 (SSE)', 'tunnel ok', 'heartbeat', 'seq 1588 → 1612']) });
        this.at(this.rand(1800, 5000), tick);
      };
      this.at(800, tick);
    });
  }

  /** 노드 하나의 일상 활동(도구·텍스트·생각) — 살아 있는 동안 반복 */
  act(out, id) {
    const n = this.nodes.get(id);
    if (!n || !this.alive(id)) return;
    if (n.status === 'idle') { this.at(1500, (o) => this.act(o, id)); return; }
    const x = this.r();
    if (n.openTools.length < 3 && x < 0.55) this.tool(out, id, this.nextToolSpec());
    else if (x < 0.8) this.emit(out, { type: 'text', nodeId: id, role: 'assistant', text: this.pick(TEXTS) });
    else this.emit(out, { type: 'thinking', nodeId: id, chars: Math.floor(this.rand(80, 3200)) });
    const pace = this.stress ? this.rand(800, 5000) : this.rand(500, 2600);
    this.at(pace, (o) => this.act(o, id));
  }

  mainTurn(out) {
    const M = this.root;
    this.setStatus(out, M, 'idle');
    this.at(5000, (o) => {
      this.emit(o, { type: 'user', nodeId: M, origin: 'human', text: this.pick(['진행 상황 알려줘', '라이트 모드도 확인해 줘', '음악 볼륨 줄여 줘', '검증까지 끝내고 알림 보내 줘']) });
      this.setStatus(o, M, 'active');
    });
    this.at(this.rand(40000, 60000), (o) => this.mainTurn(o));
  }

  spawner(out) {
    const M = this.root;
    let active = 0;
    for (const n of this.nodes.values()) if (n.kind === 'subagent' && this.alive(n.id)) active++;
    const x = this.r();
    if (active < 5 && x < 0.5) this.spawnAgent(out, M, this.pick(AGENT_LABELS));
    else if (x < 0.65) this.spawnBg(out, M, this.pick(['npm run build', 'node --test', 'cloudflared tunnel --url http://127.0.0.1:7788']));
    else if (x < 0.8) {
      let wfLive = false; for (const n of this.nodes.values()) if (n.kind === 'workflow' && this.alive(n.id)) wfLive = true;
      if (!wfLive) this.spawnWorkflow(out, M);
    }
    this.at(this.rand(9000, 18000), (o) => this.spawner(o));
  }

  stressSpawn(out) {
    let alive = 0; for (const n of this.nodes.values()) if (n.kind !== 'main' && this.alive(n.id)) alive++;
    if (this.nodes.size < this.stress) {
      // 살아 있는 아무 노드 밑에 붙여 깊이도 만든다
      const pool = [...this.nodes.values()].filter((n) => this.alive(n.id) && (n.kind === 'main' || n.kind === 'subagent') && n.depth < 4);
      const parent = this.r() < 0.4 ? this.root : this.pick(pool).id;
      const k = this.r();
      if (k < 0.8) this.spawnAgent(out, parent, this.pick(AGENT_LABELS));
      else if (k < 0.92) this.spawnBg(out, parent, 'npm test');
      else this.spawnMonitor(out, parent, '로그 감시');
    }
    this.at(alive < this.stress ? 120 : 1500, (o) => this.stressSpawn(o));
  }

  idleTick() {}

  // ---------- 기동기(자율 실행 루프) 예시 ----------
  _launcherScript() {
    const M = this.root;
    const L = 'b:demo-launch';
    const opt = this.launcher;
    let agent = null;
    this.at(5200, (o) => { agent = this.spawnAgent(o, M, '루프 재기동', { life: 15000 }); });
    this.at(8400, (o) => {
      if (!agent || !this.alive(agent)) return;
      const tu = this.tuid();
      const cmd = 'cd /d/code/api-server && nohup bash .loop/relaunch.sh > .loop/relaunch.out 2>&1 < /dev/null & disown';
      this.emit(o, { type: 'tool-start', nodeId: agent, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: cmd, brief: 'relaunch.sh 분리 실행', detail: '새 축 둘 세우고 루프 재기동' });
      this.emit(o, { type: 'tool-end', nodeId: agent, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 240, text: '', brief: 'exit 0' });
      const t = this.t0 + this.t;
      // 이 기동기 이전 회차(집계로만 남은 것): 평균 13분 남짓
      this.lc = { n: 0, items: [] };
      const hist = ['done', 'done', 'stopped', 'done', 'done', 'done', 'done'];
      hist.forEach((st, i) => {
        const startMs = t - (hist.length - i) * 15 * 60000;
        this.lc.items.push({ sessionId: (0x3a7f00 + i + 1).toString(16).padStart(8, '0') + '-hist', nodeId: null, status: st, startMs, endMs: startMs + (12 + (i % 4)) * 60000 });
      });
      this.lc.n = hist.length;
      this.addNode(o, { id: L, parentId: agent, kind: 'bash-bg', label: '기동기 · relaunch.sh', meta: {
        title: '자율 루프 재기동', detached: true, background: true, toolUseId: tu, command: null,
        launcher: { script: 'relaunch.sh', via: ['relaunch.sh', 'pick-task.sh', 'loop.sh'] },
        ...(opt.adopted ? { adopted: { fromSession: 'd3e7a1c9-demo', launchedAt: this.iso() } } : {}),
        batch: this._batchMeta() } });
      this.at(1200, (o2) => this._startCycle(o2));
    });
    this.at(6000, (o) => this._rearmMonitor(o, null, 0));
  }

  _batchMeta() {
    const items = this.lc.items;
    let running = 0, done = 0, stopped = 0, failed = 0, durSum = 0, durN = 0, current = null, last = 0;
    for (const it of items) {
      if (it.status === 'done') done++; else if (it.status === 'stopped') stopped++; else if (it.status === 'error') failed++;
      else { running++; current = it.sessionId; }
      if (it.endMs) { durSum += it.endMs - it.startMs; durN++; }
      last = Math.max(last, it.startMs);
    }
    const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
    return { total: items.length, running, done, stopped, failed, collapsed: items.filter((x) => !x.nodeId).length,
      currentCycleId: current, lastCycleAt: iso(last), avgDurationMs: durN ? Math.round(durSum / durN) : null,
      recent: items.slice(-5).map((it) => ({ sessionId: it.sessionId, nodeId: it.nodeId, status: it.status, startedAt: iso(it.startMs), endedAt: iso(it.endMs) })) };
  }

  _startCycle(out) {
    const L = 'b:demo-launch';
    if (!this.alive(L)) return;
    const k = ++this.lc.n;
    const sid = (0x3a7f00 + k).toString(16).padStart(8, '0') + '-cycle-demo';
    const id = 's:' + sid;
    const it = { sessionId: sid, nodeId: id, status: 'active', startMs: this.t0 + this.t, endMs: null };
    this.lc.items.push(it);
    this.addNode(out, { id, parentId: L, kind: 'claude-p', label: 'claude -p · ' + sid.slice(0, 8), meta: {
      title: '자율 사이클이다. 진행 중인 축 하나를 골라 계약대로 한 단계 진행하고 결과를 JSON 으로 남겨라.',
      cwd: 'D:\\code\\api-server', cycle: k,
      link: { by: 'launcher', confidence: k % 3 === 0 ? 'medium' : 'high', evidence: k % 3 === 0 ? ['script-claude-p', 'cwd', 'time', 'earlier-same-launcher-open'] : ['script-claude-p', 'cwd', 'time', 'chain'] } } });
    this.emit(out, { type: 'node-update', nodeId: L, patch: { meta: { batch: this._batchMeta() } } });
    this.emit(out, { type: 'user', nodeId: id, origin: 'human', text: '자율 사이클이다. 진행 중인 축 하나를 골라 계약대로 한 단계 진행하라.' });
    this.at(400, (o) => this.act(o, id));
    this.at(2600, (o) => this.spawnAgent(o, id, '회차 하위 · 축 점검', { life: 9000 }));
    this.at(17000, (o) => {
      const n = this.nodes.get(id);
      if (!n || !this.alive(id)) return;
      for (const t of n.openTools.slice()) this.emit(o, { type: 'tool-end', nodeId: id, toolUseId: t.toolUseId, tool: t.tool, cat: t.cat, ok: true, durationMs: 300, text: '완료' });
      for (const c of this.nodes.values()) if (c.parentId === id && this.alive(c.id)) this.finishAgent(o, c.id);
      const stop = k % 5 === 0;
      this.emit(o, { type: 'result', nodeId: id, ok: true, text: stop ? '시간 초과로 중단' : `{"cycle":${k},"ok":true,"task":"search-index"}` });
      this.setStatus(o, id, stop ? 'stopped' : 'done');
      it.status = stop ? 'stopped' : 'done'; it.endMs = this.t0 + this.t;
      this.emit(o, { type: 'node-update', nodeId: L, patch: { meta: { batch: this._batchMeta() } } });
      this.at(1800, (o2) => this._startCycle(o2));
    });
  }

  /** 30분 시한 Monitor 를 흉내(여기선 24초): 만료되면 2초 뒤 같은 설명으로 다시 건다(meta.rearmOf·rearmCount) */
  _rearmMonitor(out, prevId, count) {
    const M = this.root;
    if (!this.alive(M) && this.nodes.get(M)?.status !== 'idle') return;
    const id = 'm:demo-rearm' + String(count + 1).padStart(2, '0');
    const tu = this.tuid();
    this.emit(out, { type: 'tool-start', nodeId: M, toolUseId: tu, tool: 'Monitor', cat: 'monitor', skill: null, text: '루프 상태 감시' });
    this.emit(out, { type: 'tool-end', nodeId: M, toolUseId: tu, tool: 'Monitor', cat: 'monitor', ok: true, durationMs: 60, text: 'taskId 발급' });
    this.addNode(out, { id, parentId: M, kind: 'monitor', label: '루프 상태 감시', meta: { timeoutMs: 24000, persistent: false, command: 'tail -f .loop/relaunch.log',
      ...(prevId ? { rearmOf: prevId, rearmCount: count } : {}) } });
    const tick = (o) => { if (!this.alive(id)) return; this.emit(o, { type: 'output', nodeId: id, text: ['cycle ok', 'task: search-index', 'heartbeat'][Math.floor(this.t / 1000) % 3] }); this.at(4000, tick); };
    this.at(1500, tick);
    this.at(24000, (o) => {
      if (!this.alive(id)) return;
      this.setStatus(o, id, 'done', { expired: true });
      this.emit(o, { type: 'user', nodeId: M, origin: 'task-notification', text: '[Monitor expired] 루프 상태 감시' });
      this.at(2200, (o2) => this._rearmMonitor(o2, id, count + 1));
    });
  }
}

/**
 * 브라우저용 가짜 원천. handlers = {onSnapshot, onEvent, onStatus}
 * 반환: {close()}
 */
export function createMockSource(handlers, { mode = 'mock', stress = 0, url = 'demo-events.jsonl' } = {}) {
  let closed = false;
  let timer = 0;
  if (mode === 'demo') {
    (async () => {
      let lines;
      try {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(String(r.status));
        lines = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch (e) {
        handlers.onStatus && handlers.onStatus('bad', tr('app.mock.demoFail'));
        return;
      }
      let seqBase = 0;
      const loop = () => {
        if (closed) return;
        const first = Date.parse(lines[0].ts);
        const shift = Date.now() - first;
        const root = (lines.find((e) => e.type === 'node-add' && e.node.kind === 'main') || {}).nodeId || null;
        handlers.onSnapshot({ root, sessionId: root ? root.slice(2) : 'demo', seq: seqBase, nodes: [], recent: [] });
        handlers.onStatus && handlers.onStatus('ok', tr('app.mock.demo'));
        let i = 0;
        const step = () => {
          if (closed) return;
          const ev = { ...lines[i], seq: seqBase + lines[i].seq, ts: new Date(Date.parse(lines[i].ts) + shift).toISOString() };
          handlers.onEvent(ev);
          i++;
          if (i >= lines.length) { seqBase = ev.seq; timer = setTimeout(loop, 4000); return; }
          const gap = Math.max(0, Math.min(3000, Date.parse(lines[i].ts) - Date.parse(lines[i - 1].ts)));
          timer = setTimeout(step, gap);
        };
        step();
      };
      loop();
    })();
    return { close() { closed = true; clearTimeout(timer); } };
  }

  // 실시간 시뮬레이터: 25초 미리 돌려 snapshot, 이후 실시간
  const PRE = 25000;
  const gen = new MockGenerator({ seed: 2026, startMs: Date.now() - PRE, stress, launcher: !stress, ix: !stress, jobs: !stress, procs: !stress });
  while (true) {
    const peekAt = Math.min(...gen.q.map((x) => x.at));
    if (peekAt > PRE) break;
    gen.next();
  }
  const wall0 = Date.now() - PRE;
  setTimeout(() => {
    if (closed) return;
    handlers.onSnapshot(gen.snapshot());
    handlers.onStatus && handlers.onStatus('ok', stress ? tr('app.mock.fakeStress', { n: stress }) : tr('app.mock.fake'));
    const pump = () => {
      if (closed) return;
      const due = Date.now() - wall0;
      let guard = 0;
      while (gen.q.length && Math.min(...gen.q.map((x) => x.at)) <= due && guard++ < 500) {
        for (const ev of gen.next().events) handlers.onEvent(ev);
      }
      const nextAt = gen.q.length ? Math.min(...gen.q.map((x) => x.at)) : due + 1000;
      timer = setTimeout(pump, Math.max(16, Math.min(1000, nextAt - (Date.now() - wall0))));
    };
    pump();
  }, 0);
  return { close() { closed = true; clearTimeout(timer); } };
}
