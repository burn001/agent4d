// --demo: 실제 파일 없이 합성 트리·이벤트를 낸다. 엔드포인트·형식은 실제와 같다.
import { planDemoSeed, planDemoStep } from './plan-demo.mjs';
import { Graph } from './graph.mjs';
import { toolCategory } from './parse.mjs';
import { toolBrief } from './brief.mjs';
import { inputPanel, resultPanel, tailPanel } from './panel.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReplayFromEvents } from './replay.mjs';
import { OverviewHub } from './overview.mjs';
import { seedDemoCtx, stepDemoCtx } from './ctx.mjs';
import { toolFileRefs } from '../web/conflict-core.mjs';
import { ixDemoStep } from './ix-demo.mjs'; // 특별 상호작용 시나리오
import { artDemoStep, artDemoHistory } from './art-demo.mjs'; // 작업 대상 시나리오
import { MemoryArtifactSource } from './artifacts.mjs';

// 데모 패널 결과 본문(가짜 값)
const DEMO_BODY = {
  shell: 'npm test\n> node --test\nok 1 - 파서\nok 2 - 그래프\nok 3 - 패널\n# pass 3',
  read: 'import fs from "node:fs";\nexport function main() {\n  return 1;\n}',
  search: 'src/app.js:12:// TODO 정리\nsrc/scene.js:40:// TODO 성능',
  web: '페이지 요약: three.js CSS2DRenderer 사용법\n라벨을 DOM 으로 그린다',
  agent: '조사 결과: 관련 파일 3개, 수정 제안 2건',
};

export const DEMO_REPLAY = 'demo-replay';
const DEMO_EVENTS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'demo-events.jsonl');

export const DEMO_SESSION = '00000000-0000-4000-8000-00000000demo'.slice(0, 36);

const TOOLS = [
  ['Bash', { description: '테스트 실행', command: 'npm test' }], ['Read', { file_path: 'src/app.js' }], ['Write', { file_path: 'notes.md', content: '# 메모\n- 할 일\n' }],
  ['Edit', { file_path: 'server.mjs', old_string: 'a', new_string: 'a\nb\nc' }], ['Grep', { pattern: 'TODO', path: 'src' }], ['Agent', { description: '조사 위임', subagent_type: 'Explore' }],
  ['Workflow', { name: 'build' }], ['Skill', { skill: 'style-guide' }], ['WebFetch', { url: 'https://example.com/a' }],
  ['Monitor', { description: '로그 감시' }], ['mcp__demo__lookup', {}], ['Artifact', {}], ['PushNotification', {}],
  ['StructuredOutput', {}],
];

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit']);

const TEXTS = [
  '파일 구조를 먼저 확인하겠습니다.', '테스트가 통과했습니다.', '설정 값을 바꿔 다시 실행해 보겠습니다.',
  '결과를 정리하면 다음과 같습니다.', '오류 원인은 경로 구분자 차이입니다.',
];

class DemoRuntime {
  /**
   * @param {{privacy?:string, sid?:string, px?:string, title?:string, cwd?:string, autoplay?:boolean}} opts
   *  3차: sid·px(노드 id 앞붙이)로 전체 보기 데모의 여러 메인을 만든다. 기본값이면 1·2차 데모와 같다
   */
  constructor({ privacy, sid = DEMO_SESSION, px = '', title = '데모 세션: 시각화 도구 만들기', cwd = 'D:\\demo', autoplay = true, files = null, peers = [], git = null } = {}) {
    this.files = files;   // {own:[경로…], shared:[{path, w}]} — 같은 프로젝트 메인끼리 같은 파일(충돌) 재현
    this.peers = peers;   // 같은 프로젝트 다른 메인의 px(SendMessage 대상)
    this.git = git;
    this.sessionId = sid;
    this.px = px;
    this.title = title;
    this.cwd = cwd;
    this.graph = new Graph({ rootSessionId: sid, privacy });
    this.refs = 0;
    this.timer = null;
    this.tick = 0;
    this.openTools = new Map(); // nodeId → [toolUseId…]
    this.ready = Promise.resolve(this);
    this._build();
    this.graph.finishLoad();
    if (autoplay) this._schedule();
  }

  /** 노드 id 에 앞붙이(px)를 넣는다: 'a:demo-sub-1' → 'a:<px>demo-sub-1' */
  N(id) { return this.px ? id.replace(/^([a-z]):/, (m, k) => `${k}:${this.px}`) : id; }

  _build() {
    const g = this.graph;
    const t = () => new Date().toISOString();
    const M = `s:${this.sessionId}`;
    const N = (id) => this.N(id);
    const add = (id, parentId, kind, label, meta = {}) => g.addNode({ id, parentId, kind, label, sessionId: this.sessionId, model: kind === 'bash-bg' || kind === 'monitor' || kind === 'workflow' ? null : 'claude-opus-5-5', meta }, t());
    add(M, null, 'main', this.title, { cwd: this.cwd, ...(this.git ? { git: this.git } : {}) });
    add(N('a:demo-sub-1'), M, 'subagent', '자료 조사', { agentType: 'general-purpose', background: true });
    add(N('a:demo-sub-2'), M, 'subagent', '코드 리뷰', { agentType: 'general-purpose' });
    add(N('w:wf_demo-001'), M, 'workflow', 'agent4d 빌드', { runId: 'wf_demo-001', taskId: 'wdemo1' });
    add(N('a:demo-wf-1'), N('w:wf_demo-001'), 'workflow-agent', 'design:contract', { phase: 'Design' });
    add(N('a:demo-wf-2'), N('w:wf_demo-001'), 'workflow-agent', 'build:server', { phase: 'Build' });
    add(N('a:demo-wf-3'), N('w:wf_demo-001'), 'workflow-agent', 'build:web', { phase: 'Build' });
    add(N('s:11111111-2222-4333-8444-555555555555'), N('a:demo-wf-2'), 'claude-p', 'claude -p · probe · 11111111', { cwd: 'C:\\tmp\\probe', title: 'say hi' });
    add(N('a:demo-grand-1'), N('s:11111111-2222-4333-8444-555555555555'), 'subagent', '손자 에이전트', { agentType: 'Explore' });
    add(N('b:bdemo01'), M, 'bash-bg', 'npm run dev', { command: 'npm run dev', background: true, taskId: 'bdemo01' });
    add(N('m:mdemo01'), M, 'monitor', '알림 감시', { timeoutMs: 1800000, background: true, taskId: 'mdemo01' });
    add(N('b:bdemo02'), N('a:demo-sub-1'), 'bash-bg', '시험 서버 :8080', { command: 'node serve.mjs --port 8080', background: true, taskId: 'bdemo02' });
    seedDemoCtx(g, this.px, t()); // 컨텍스트 사용률 합성 값
    planDemoSeed(this, t()); // 계획 보드: 메인 할 일·워크플로 단계(실제 PlanTracker)
  }

  _schedule() {
    const wait = 2000 + Math.floor(Math.random() * 4000);
    this.timer = setTimeout(() => { try { this._step(); } catch {} this._schedule(); }, wait);
  }

  _step() {
    const g = this.graph;
    const ts = new Date().toISOString();
    const ids = [...g.nodes.keys()];
    const agentIds = ids.filter((id) => !id.startsWith('b:') && !id.startsWith('m:') && !id.startsWith('w:'));
    const N = (id) => this.N(id);
    const M = `s:${this.sessionId}`;
    const k = this.tick++;
    const pick = (arr) => arr[(k * 7 + Math.floor(Math.random() * arr.length)) % arr.length];
    const nodeId = pick(agentIds);
    const node = g.get(nodeId);
    if (node.status !== 'active') g.updateNode(nodeId, { status: 'active', endedAt: null }, ts);
    node.lastActivityAt = ts;
    stepDemoCtx(g, nodeId, ts);
    if (k % 3 === 1 && ixDemoStep(this, nodeId, k)) return; // 세 걸음에 한 번 github·tests·remote·db·batch 시나리오
    if (k % 5 === 2) planDemoStep(this, ts); // 다섯 걸음에 한 번 할 일 한 칸
    if (k % 4 === 3 && artDemoStep(this, nodeId, k)) return; // 네 걸음에 한 번 작업 대상(생성·수정·삭제·DB·push·파괴적)

    const kind = k % 9;
    if (kind === 0 || kind === 3 || kind === 6) {
      // 도구 시작 (모든 cat 순환)
      let [name, input] = TOOLS[(k / 3 | 0) % TOOLS.length];
      const toolUseId = `toolu_demo_${k}`;
      const ki = k / 3 | 0;
      if (this.files && (FILE_TOOLS.has(name) || ki % 2 === 0)) {
        // 도구 두 번에 한 번은 파일 도구 — 이 메인 몫 파일, 그중 세 번에 한 번은 같은 프로젝트 다른 메인과 같은 파일(쓰기면 Edit, 읽기면 Read)
        const sh = this.files.shared || [], own = this.files.own || ['notes.md'];
        const fi = ki / 2 | 0;
        if (sh.length && fi % 3 === 0) {
          const f = sh[(fi / 3 | 0) % sh.length];
          if (f.sh) { name = 'Bash'; input = { command: `sed -i 's/"v1"/"v2"/' ${f.path}`, description: '설정 값 일괄 치환' }; } // 셸로 고침(추정 쓰기)
          else { name = f.w ? 'Edit' : 'Read'; input = f.w ? { file_path: f.path, old_string: 'a', new_string: 'a\nb' } : { file_path: f.path }; }
        }
        else { if (!FILE_TOOLS.has(name)) name = fi % 2 ? 'Read' : 'Edit'; input = name === 'Edit' ? { file_path: own[fi % own.length], old_string: 'a', new_string: 'a\nb' } : { ...input, file_path: own[fi % own.length] }; }
      }
      if (this.peers.length && ki % 7 === 3) {
        // 같은 프로젝트 다른 메인의 서브에이전트에게 SendMessage(세션 간 메시지)
        const to = this.peers[(ki / 7 | 0) % this.peers.length] + 'demo-sub-1';
        name = 'SendMessage'; input = { to, summary: '진행 상황 공유', message: '같은 파일을 고치고 있으니 순서를 맞춥시다.' };
      }
      const cat = toolCategory(name);
      const text = input.description || input.file_path || input.pattern || input.skill || input.url || input.name || input.summary || name;
      node.openTools.push({ toolUseId, tool: name, cat, skill: input.skill || null, startedAt: ts, text });
      const refs = this.files ? toolFileRefs(name, input, this.cwd) : [];
      const file = refs[0] || null;
      g.emit({ ts, type: 'tool-start', nodeId, toolUseId, tool: name, cat, skill: input.skill || null, text, ...toolBrief(name, input), ...(file ? { file } : {}), ...(refs.length > 1 ? { files: refs } : {}), ...(name === 'SendMessage' ? { to: input.to } : {}), panel: inputPanel(name, input) });
      if (name === 'Skill') g.updateNode(nodeId, { meta: { skill: input.skill } }, ts);
      if (!this.openTools.has(nodeId)) this.openTools.set(nodeId, []);
      this.openTools.get(nodeId).push({ toolUseId, name, cat, input, start: Date.now() });
    } else if (kind === 1 || kind === 4 || kind === 7) {
      // 도구 끝 (아무 노드나 열린 것)
      for (const [nid, list] of this.openTools) {
        if (!list.length) continue;
        const t = list.shift();
        const n = g.get(nid);
        n.openTools = n.openTools.filter((x) => x.toolUseId !== t.toolUseId);
        const ok = Math.random() > 0.15;
        g.emit({ ts, type: 'tool-end', nodeId: nid, toolUseId: t.toolUseId, tool: t.name, cat: t.cat, ok, durationMs: Date.now() - t.start, text: ok ? '완료' : '오류: 파일을 찾을 수 없음',
          brief: ok ? (t.cat === 'shell' ? 'exit 0 · 완료' : '완료') : 'exit 1 · 파일을 찾을 수 없음',
          panel: resultPanel(t.name, t.input, null, ok ? (DEMO_BODY[t.cat] || '완료') : 'Exit code 1\n오류: 파일을 찾을 수 없음', null, ok) });
        break;
      }
    } else if (kind === 2) {
      { const tx = pick(TEXTS); g.emit({ ts, type: 'text', nodeId, role: 'assistant', text: tx, brief: tx }); }
    } else if (kind === 5) {
      g.emit({ ts, type: 'thinking', nodeId, chars: 200 + Math.floor(Math.random() * 1800) });
      { const line = `[dev] ${ts.slice(11, 19)} 요청 처리 200 OK`; const tl = (this._demoTail ||= []); tl.push(line); if (tl.length > 12) tl.shift();
        g.emit({ ts, type: 'output', nodeId: N('b:bdemo01'), text: line + '\n', panel: tailPanel('$ npm run dev', tl, { nodeId: M, toolUseId: null }) }); }
      g.get(N('b:bdemo01')).lastActivityAt = ts;
    } else if (kind === 8) {
      const r = (k / 9 | 0) % 5;
      if (r === 0) g.emit({ ts, type: 'user', nodeId: M, origin: 'human', text: '진행 상황 알려 주세요.' });
      else if (r === 1) {
        g.emit({ ts, type: 'output', nodeId: N('m:mdemo01'), text: '[메일] 새 알림 1건' });
        g.emit({ ts, type: 'user', nodeId: M, origin: 'task-notification', text: 'Monitor event: "알림 감시"' });
      } else if (r === 2) {
        const target = N('a:demo-sub-2');
        g.emit({ ts, type: 'result', nodeId: target, ok: true, text: '리뷰 완료: 문제 2건 발견' });
        g.updateNode(target, { status: 'done', endedAt: ts }, ts);
      } else if (r === 3) {
        g.updateNode(N('a:demo-grand-1'), { status: 'error', endedAt: ts }, ts);
        g.emit({ ts, type: 'result', nodeId: N('a:demo-grand-1'), ok: false, text: '실패: 시간 초과' });
      } else {
        g.updateNode(N('a:demo-sub-1'), { status: 'idle' }, ts);
        g.emit({ ts, type: 'text', nodeId: M, role: 'system', text: '요약: 빌드 단계 진행 중' });
        // 시험 서버: 켜져 있으면 TaskStop 으로 끄고('중지됨'), 꺼져 있으면 다시 띄운다
        const sv = g.get(N('b:bdemo02'));
        if (sv && sv.status === 'stopped') g.updateNode(sv.id, { status: 'active', endedAt: null }, ts);
        else if (sv) {
          const tu = `toolu_demo_stop_${k}`;
          g.emit({ ts, type: 'tool-start', nodeId: N('a:demo-sub-1'), toolUseId: tu, tool: 'TaskStop', cat: 'monitor', skill: null, text: '시험 서버 :8080' });
          g.emit({ ts, type: 'tool-end', nodeId: N('a:demo-sub-1'), toolUseId: tu, tool: 'TaskStop', cat: 'monitor', ok: true, durationMs: 40, text: 'Successfully stopped task: bdemo02' });
          g.updateNode(sv.id, { status: 'stopped', endedAt: ts, meta: { killed: true, stopReason: 'taskstop' } }, ts);
        }
      }
    }
  }

  close() { clearTimeout(this.timer); }
}

export class DemoManager {
  constructor({ privacy = 'summary', eventsFile = DEMO_EVENTS_FILE, overviewOptions = {} } = {}) {
    this.privacy = privacy;
    this.rt = new DemoRuntime({ privacy });
    this.eventsFile = eventsFile;
    this._replay = null;
    this._done = null;
    this.overviewOptions = overviewOptions;
    this.ov = null; // 3차 전체 보기 데모(처음 쓸 때 만든다)
    this.hub = null;
    // 작업 대상: 데모 그래프 이벤트를 기억 장부로 + 프로젝트마다 지난 며칠 대상(결정적)
    this.artifacts = new MemoryArtifactSource({ privacy });
    this.artifacts.attach(this.rt.graph, 'demo');
    this.artifacts.seed('demo', artDemoHistory('demo', Date.now(), { mainNode: `s:${this.rt.sessionId}` }));
  }
  /** 3차(--demo): 프로젝트 3개 합성 전체 보기 허브 */
  overview() {
    if (!this.hub) {
      this.ov = new DemoOverview({ privacy: this.privacy, ...this.overviewOptions });
      // 전체 보기 데모 메인들도 기억 장부로(프로젝트 = demo-alpha… , 지난 며칠 대상은 프로젝트마다 한 번)
      const rtOf = this.ov.runtime.bind(this.ov), arts = this.artifacts, seeded = new Set();
      this.ov.runtime = (sid) => {
        const had = this.ov.rts.has(sid);
        const rt = rtOf(sid);
        const m = DEMO_OVERVIEW.mains.find((x) => x.sid === sid);
        if (!had && m) {
          arts.attach(rt.graph, m.projectId);
          if (!seeded.has(m.projectId)) { seeded.add(m.projectId); arts.seed(m.projectId, artDemoHistory(m.projectId, Date.now(), { mainNode: `s:${sid}` })); }
        }
        return rt;
      };
      this.hub = new OverviewHub({ source: this.ov, orphanDelayMs: 3000, ...(this.overviewOptions.hub || {}) });
    }
    return this.hub;
  }
  async projectList({ inactive = false } = {}) {
    this.overview();
    return { generatedAt: new Date().toISOString(), projects: await this.ov.projects({ overview: this.hub.info(), inactive }) };
  }
  async resolve(param) {
    if (param === DEMO_REPLAY || isDemoHist(param)) return DEMO_REPLAY;
    if (param && this.ov && this.ov.has(String(param).toLowerCase())) return String(param).toLowerCase();
    return !param || param === 'auto' || param === DEMO_SESSION ? DEMO_SESSION : null;
  }
  /** web/demo-events.jsonl(ts 있음)을 재생 데이터로 만든다. sessionId 'demo-replay' */
  async replay(sid) {
    // ?replay=auto 는 라이브 데모 세션(DEMO_SESSION)으로 풀리는데 그 세션에는 재생 데이터가 없어 404 였다 → 데모 재생으로
    if (sid === DEMO_SESSION || isDemoHist(sid) || DEMO_OVERVIEW.mains.some((m) => m.sid === sid)) sid = DEMO_REPLAY; // 합성 지난 세션·전체 보기 메인도 데모 재생으로
    if (sid !== DEMO_REPLAY) throw Object.assign(new Error('not found'), { code: 'ENOSESSION' });
    if (!this._replay) {
      this._replay = (async () => {
        const text = await fs.promises.readFile(this.eventsFile, 'utf8');
        const events = [];
        for (const line of text.split('\n')) { if (!line.trim()) continue; try { events.push(JSON.parse(line)); } catch {} }
        const data = await buildReplayFromEvents({ sessionId: DEMO_REPLAY, events, title: '데모 재생: 세션 시각화 개발' });
        this._done = data;
        return data;
      })();
      this._replay.catch(() => { this._replay = null; });
    }
    return this._replay;
  }
  replayPeek(sid) { return sid === DEMO_REPLAY || sid === DEMO_SESSION || isDemoHist(sid) || DEMO_OVERVIEW.mains.some((m) => m.sid === sid) ? this._done : null; }
  async projectOf(sid) { return sid === DEMO_REPLAY || sid === DEMO_SESSION ? 'demo' : null; }
  async projects() { return [{ projectDir: 'demo', cwd: 'D:\\demo', sessions: 2, lastMtime: new Date().toISOString() }]; }
  async acquire(sid) {
    if (sid !== DEMO_SESSION && this.ov && this.ov.has(sid)) { const r = this.ov.runtime(sid); r.refs++; return r; }
    if (sid !== DEMO_SESSION) throw new Error('not found');
    this.rt.refs++; return this.rt;
  }
  release(rt) { const r = rt && rt !== this.rt && rt.refs != null ? rt : this.rt; r.refs = Math.max(0, r.refs - 1); }
  async peek(sid) { return this.acquire(sid).then((r) => { this.release(); return r; }); }
  onAuto() { return () => {}; }
  // extended: /sessions 에 limit·kind·project 질의가 있을 때(재생 고르기 화면). 질의 없는 기존 호출은 1차와 같이 1개만
  // 전체 보기 데모 프로젝트(demo-alpha·beta·gamma)를 고르면 매크로 타임라인용 합성 지난 세션(재생은 데모 재생으로 대신)
  async list(limit = 30, { project = null, extended = false, kind = 'all', sort = 'recent', since = null } = {}) {
    if (project && String(project).startsWith('demo-')) {
      const out = demoHistory(Date.now(), { project, kind, since });
      const key = sort === 'start' ? (x) => Date.parse(x.startedAt) : (x) => Date.parse(x.endedAt);
      return out.sort((a, b) => key(b) - key(a)).slice(0, Math.max(1, limit));
    }
    if (project && project !== 'demo') return [];
    const now = new Date().toISOString();
    const out = [{ sessionId: DEMO_SESSION, projectDir: 'demo', cwd: 'D:\\demo', title: '데모 세션', entrypoint: 'cli', isChild: false,
      mtime: now, sizeBytes: 0, live: true, running: true, liveStatus: 'busy',
      startedAt: now, endedAt: now, durationMs: 0, eventCount: null, eventCountEst: null, replayCached: false }];
    let rp = null;
    if (extended) { try { rp = await this.replay(DEMO_REPLAY); } catch {} }
    if (rp) {
      out.push({ sessionId: DEMO_REPLAY, projectDir: 'demo', cwd: 'D:\\demo', title: rp.title, entrypoint: 'cli', isChild: false,
        mtime: rp.endTs, sizeBytes: 0, live: false, liveStatus: null, startedAt: rp.startTs, endedAt: rp.endTs,
        durationMs: Date.parse(rp.endTs) - Date.parse(rp.startTs), eventCount: rp.events.length, eventCountEst: rp.events.length,
        replayCached: true });
    }
    if (!project && extended && sort === 'start') out.push(...demoHistory(Date.now(), { kind, since })); // 전체 보기 요약
    return out.slice(0, Math.max(1, limit));
  }
  stop() { this.rt.close(); this.hub?.stop(); this.ov?.stop(); }
}

// ───────────── 3차: 전체 보기 데모 (--demo) ─────────────

export const DEMO_OVERVIEW = {
  projects: [
    { projectId: 'demo-alpha', name: 'alpha', path: 'D:\\demo\\alpha' },
    { projectId: 'demo-beta', name: 'beta', path: 'D:\\demo\\beta' },
    { projectId: 'demo-gamma', name: 'gamma', path: 'D:\\demo\\gamma' },
    { projectId: 'demo-delta', name: 'delta', path: 'D:\\demo\\delta' },
  ],
  // 같은 프로젝트 live 메인 여럿 — alpha 3(삼각)·beta 2(좌우)·delta 5(파이 구역). files.shared = 같은 파일(w = 쓰기, sh = Bash sed -i 로 고침 → 추정 충돌)
  // 앞 네 항목의 순서는 그대로 둔다(matchNow 가 [0]·[2] 를 쓴다)
  mains: [
    { sid: 'aaaaaaaa-0000-4000-8000-00000000a001', projectId: 'demo-alpha', px: 'a1-', title: '알파: 화면 개편', git: 'main',
      files: { own: ['web/app.js', 'web/theme.css'], shared: [{ path: 'server/index.mjs', w: true }] } },
    { sid: 'aaaaaaaa-0000-4000-8000-00000000a002', projectId: 'demo-alpha', px: 'a2-', title: '알파: 서버 성능 측정', git: 'perf',
      files: { own: ['bench/run.mjs', 'bench/README.md'], shared: [{ path: 'server/index.mjs', w: true }] } },
    { sid: 'bbbbbbbb-0000-4000-8000-00000000b001', projectId: 'demo-beta', px: 'b1-', title: '베타: 보고서 정리', git: 'main',
      files: { own: ['docs/ch1.md', 'docs/ch2.md'], shared: [{ path: 'docs/report.md', w: true }] } },
    { sid: 'cccccccc-0000-4000-8000-00000000c001', projectId: 'demo-gamma', px: 'c1-', title: '감마: 지난 작업', recent: true },
    { sid: 'aaaaaaaa-0000-4000-8000-00000000a003', projectId: 'demo-alpha', px: 'a3-', title: '알파: 문서 갱신', git: 'docs',
      files: { own: ['CONTRACT.md'], shared: [{ path: 'server/index.mjs', w: false }] } },
    { sid: 'bbbbbbbb-0000-4000-8000-00000000b002', projectId: 'demo-beta', px: 'b2-', title: '베타: 표 검수', git: 'review',
      files: { own: ['data/table.csv'], shared: [{ path: 'docs/report.md', w: false }] } },
    ...[1, 2, 3, 4, 5].map((i) => ({ sid: `eeeeeeee-0000-4000-8000-00000000e00${i}`, projectId: 'demo-delta', px: `e${i}-`, title: `델타: 작업 ${i}`, git: `feat-${i}`,
      files: { own: [`src/part${i}.mjs`], shared: i <= 2 ? [{ path: 'src/layout.mjs', w: true }] : i === 4 ? [{ path: 'src/layout.mjs', w: false }] : [{ path: 'src/config.json', w: true, sh: true }] } })),
  ],
};
const isDemoHist = (sid) => /^demo-hist-/.test(String(sid || ''));

/**
 * 매크로 타임라인 데모용 합성 지난 세션(결정적). 프로젝트마다 지난 10일, 겹치는 세션·claude -p 자식(부모 안)·실행 중 메인 포함.
 * 시각은 10분 단위로 맞춰 30초마다 다시 받아도 자리가 그대로다.
 */
export function demoHistory(nowMs = Date.now(), { project = null, kind = 'all', since = null } = {}) {
  const now = Math.floor(nowMs / 600_000) * 600_000;
  const H = 3600_000, out = [];
  const iso = (t) => new Date(t).toISOString();
  const projs = DEMO_OVERVIEW.projects.filter((p) => !project || p.projectId === project);
  const TITLES = ['화면 배치 다듬기', '서버 색인 속도', '시험 보강', '문서 정리', '버그 수리: 정렬', '설정 마이그레이션', '성능 측정', '리팩터링', '배포 점검', '데이터 검증', '로그 분석', '검토 의견 반영'];
  for (const [pi, p] of projs.entries()) {
    let seed = 1234 + DEMO_OVERVIEW.projects.indexOf(p) * 97;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = p.projectId === 'demo-gamma' ? 5 : 18;
    let t = now - 10 * 24 * H + rnd() * 6 * H;
    for (let i = 0; i < n; i++) {
      const dur = (0.3 + rnd() * 4.5) * H;
      const start = t, end = Math.min(now - 40 * 60_000, start + dur);
      if (end <= start) break;
      const sid = `demo-hist-${p.projectId.slice(5)}-${String(i).padStart(2, '0')}`;
      const kids = Math.floor(rnd() * 3.2);
      out.push({ sessionId: sid, projectDir: p.projectId, cwd: p.path, title: `${p.name}: ${TITLES[(i + pi * 3) % TITLES.length]}`, entrypoint: 'cli', isChild: false,
        parentSessionId: null, mtime: iso(end), sizeBytes: 0, live: false, running: false, liveStatus: null, startedAt: iso(start), endedAt: iso(end),
        durationMs: end - start, eventCount: null, eventCountEst: Math.round(80 + rnd() * 3000), replayCached: false });
      for (let k = 0; k < kids && kind !== 'main'; k++) {
        const ks = start + rnd() * (end - start) * 0.8, ke = Math.min(end, ks + (2 + rnd() * 25) * 60_000);
        out.push({ sessionId: `${sid}-p${k}`, projectDir: p.projectId, cwd: p.path, title: `claude -p: 하위 작업 ${k + 1}`, entrypoint: 'sdk-cli', isChild: true,
          parentSessionId: sid, mtime: iso(ke), sizeBytes: 0, live: false, running: false, liveStatus: null, startedAt: iso(ks), endedAt: iso(ke),
          durationMs: ke - ks, eventCount: null, eventCountEst: Math.round(10 + rnd() * 200), replayCached: false });
      }
      // 가끔 겹치는(동시에 돈) 세션
      t = rnd() < 0.3 ? start + dur * (0.2 + rnd() * 0.5) : end + (0.5 + rnd() * 18) * H;
      if (t > now - 2 * H) break;
    }
    for (const m of DEMO_OVERVIEW.mains.filter((x) => x.projectId === p.projectId)) {
      const start = m.recent ? now - 3 * H : now - (m.sid.endsWith('2') ? 1.2 : 2.6) * H;
      const end = m.recent ? now - 45 * 60_000 : nowMs;
      out.push({ sessionId: m.sid, projectDir: p.projectId, cwd: p.path, title: m.title, entrypoint: 'cli', isChild: false, parentSessionId: null,
        mtime: iso(end), sizeBytes: 0, live: !m.recent, running: !m.recent, liveStatus: m.recent ? null : 'busy', startedAt: iso(start), endedAt: iso(end),
        durationMs: end - start, eventCount: null, eventCountEst: 400, replayCached: false });
    }
  }
  return since != null ? out.filter((x) => Date.parse(x.endedAt) >= since) : out;
}
const orphanSid = (n) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 독립 claude -p(매칭 전) 루트: 루트 + 서브에이전트 하나, 몇 초마다 text */
class DemoOrphanRuntime {
  constructor({ privacy, sid }) {
    this.sessionId = sid;
    this.graph = new Graph({ rootSessionId: sid, privacy });
    this.refs = 0;
    this.ready = Promise.resolve(this);
    const ts = new Date().toISOString();
    this.graph.addNode({ id: `s:${sid}`, parentId: null, kind: 'main', label: 'claude -p · beta', sessionId: sid, model: 'claude-opus-5-5', meta: { cwd: 'D:\\demo\\beta', title: '문서 요약' } }, ts);
    this.graph.addNode({ id: `a:${sid.slice(0, 8)}-${sid.slice(-4)}-sub`, parentId: `s:${sid}`, kind: 'subagent', label: '요약 보조', sessionId: sid, meta: { agentType: 'general-purpose' } }, ts);
    this.graph.finishLoad();
    this.timer = setInterval(() => {
      this.graph.emit({ ts: new Date().toISOString(), type: 'text', nodeId: `s:${sid}`, role: 'assistant', text: '문서를 요약하는 중입니다.' });
    }, 5000);
    this.timer.unref?.();
  }
  close() { clearInterval(this.timer); }
}

/**
 * 전체 보기 데모 공급자: demo-alpha 메인 2 · demo-beta 메인 1 + 독립 claude -p 1 · demo-gamma recent 1.
 * 10～40초마다 한 메인이 busy↔idle, matchEveryMs(기본 3분)마다 독립 claude -p 가 다른 메인에 매칭(node-remove → node-add).
 */
export class DemoOverview {
  constructor({ privacy = 'summary', matchEveryMs = 180_000, flipMinMs = 10_000, flipMaxMs = 40_000 } = {}) {
    this.privacy = privacy;
    this.rts = new Map();
    this.status = new Map(DEMO_OVERVIEW.mains.filter((m) => !m.recent).map((m, i) => [m.sid, i === 1 ? 'idle' : 'busy']));
    this.orphanN = 1;
    this.orphan = orphanSid(this.orphanN);
    this.claimed = new Set();
    this.matches = 0;
    this.timers = [];
    const flip = () => {
      const t = setTimeout(() => {
        const live = [...this.status.keys()];
        const sid = live[Math.floor(Math.random() * live.length)];
        this.status.set(sid, this.status.get(sid) === 'busy' ? 'idle' : 'busy');
        flip();
      }, flipMinMs + Math.floor(Math.random() * Math.max(1, flipMaxMs - flipMinMs)));
      t.unref?.();
      this.timers[0] = t;
    };
    flip();
    const m = setInterval(() => { try { this.matchNow(); } catch {} }, matchEveryMs);
    m.unref?.();
    this.timers.push(m);
  }
  has(sid) { return DEMO_OVERVIEW.mains.some((m) => m.sid === sid) || sid.startsWith('dddddddd-'); }
  runtime(sid) {
    let rt = this.rts.get(sid);
    if (rt) return rt;
    const m = DEMO_OVERVIEW.mains.find((x) => x.sid === sid);
    if (m) {
      const peers = DEMO_OVERVIEW.mains.filter((x) => x.projectId === m.projectId && x !== m && !x.recent).map((x) => x.px);
      rt = new DemoRuntime({ privacy: this.privacy, sid, px: m.px, title: m.title, cwd: DEMO_OVERVIEW.projects.find((p) => p.projectId === m.projectId).path, autoplay: !m.recent,
        files: m.files || null, peers, git: m.git || null });
    }
    else rt = new DemoOrphanRuntime({ privacy: this.privacy, sid });
    this.rts.set(sid, rt);
    return rt;
  }
  /** 지금 독립 claude -p 를 메인(베타 → 알파 번갈아) 아래 claude-p 로 붙이고, 다음 독립 세션을 만든다 */
  matchNow() {
    const sid = this.orphan;
    const parentSid = DEMO_OVERVIEW.mains[this.matches % 2 === 0 ? 2 : 0].sid;
    const prt = this.runtime(parentSid);
    const g = prt.graph;
    const ts = new Date().toISOString();
    this.claimed.add(sid);
    g.addNode({ id: `s:${sid}`, parentId: `s:${parentSid}`, kind: 'claude-p',
      // 부모(베타)와 같은 프로젝트면 sid8, 다르면(알파) 프로젝트 이름도
      label: this.matches % 2 === 0 ? `claude -p · ${sid.slice(0, 8)}` : `claude -p · beta · ${sid.slice(0, 8)}`,
      sessionId: sid, model: 'claude-opus-5-5', meta: { cwd: 'D:\\demo\\beta', title: '문서 요약' } }, ts);
    g.addNode({ id: `a:${sid.slice(0, 8)}-${sid.slice(-4)}-sub`, parentId: `s:${sid}`, kind: 'subagent', label: '요약 보조', sessionId: sid, meta: { agentType: 'general-purpose' } }, ts);
    g.updateNode(`s:${sid}`, { status: 'done', endedAt: ts }, ts);
    this.matches++;
    this.orphanN++;
    this.orphan = orphanSid(this.orphanN);
    return sid;
  }
  async desired() {
    const roots = [];
    for (const m of DEMO_OVERVIEW.mains) {
      if (m.recent) continue; // 비활성(recent) 메인은 장면에 싣지 않는다(목록에만)
      roots.push({ sessionId: m.sid, projectId: m.projectId, live: true, liveStatus: this.status.get(m.sid), tier: 'live', orphanSdk: false });
    }
    if (!this.claimed.has(this.orphan)) roots.push({ sessionId: this.orphan, projectId: 'demo-beta', live: true, liveStatus: 'busy', tier: 'live', orphanSdk: true });
    return { roots, overflow: new Set() };
  }
  async acquire(sid) { const rt = this.runtime(sid); rt.refs++; return rt; }
  release(sid) { const rt = this.rts.get(sid); if (rt) rt.refs = Math.max(0, rt.refs - 1); }
  async projects({ overview } = {}) {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    return DEMO_OVERVIEW.projects.map((p, pi) => {
      const mains = DEMO_OVERVIEW.mains.filter((m) => m.projectId === p.projectId);
      const live = mains.filter((m) => !m.recent);
      const liveList = live.map((m) => ({ sessionId: m.sid, title: m.title, liveStatus: this.status.get(m.sid), tier: 'live', activityAt: iso(now - 5000),
        entrypoint: 'cli', active: true, inOverview: overview ? overview.roots.has(m.sid) : true, rootSessionId: m.sid }));
      if (p.projectId === 'demo-beta' && !this.claimed.has(this.orphan)) {
        liveList.push({ sessionId: this.orphan, title: 'claude -p: 문서 요약', liveStatus: 'busy', tier: 'live', activityAt: iso(now - 3000),
          entrypoint: 'sdk-cli', active: true, inOverview: overview ? overview.roots.has(this.orphan) : false, rootSessionId: overview?.roots.has(this.orphan) ? this.orphan : null });
      }
      const recentList = mains.filter((m) => m.recent).map((m) => ({ sessionId: m.sid, title: m.title, activityAt: iso(now - 45 * 60_000), tier: 'recent' }));
      const busy = liveList.filter((x) => x.liveStatus === 'busy').length;
      return {
        projectId: p.projectId, name: p.name, path: p.path, nameGuessed: false, temp: false,
        live: liveList.length > 0, tier: liveList.length ? 'live' : 'recent', active: liveList.length > 0,
        liveSessions: liveList.length, activeSessions: liveList.length, busySessions: busy,
        sessions: mains.length + (pi === 1 ? 1 : 0), lastActivityAt: iso(liveList.length ? now - 3000 : now - 45 * 60_000),
        liveList, recentList,
      };
    });
  }
  stop() {
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    for (const rt of this.rts.values()) rt.close?.();
  }
}
