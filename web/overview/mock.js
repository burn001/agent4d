// 서버 없이 쓰는 전체 보기 합성 스트림 (형식은)
//   const m = createOverviewMock({ projects: 3, mainsPerProject: [2, 1, 1], seed });
//   m.snapshot() → {scope:'all', root:null, seq, nodes, recent, projects, roots}
//   m.start(onEvent, onProjects); m.stop();
// 기존 MockGenerator 를 루트마다 하나씩 돌리고 id 앞붙이로 겹침을 막는다. projects 이벤트·node-remove 도 합성한다.
// 프로젝트: 활성 3개(+메인 여러 개) · recent 루트 1개(희미) · 루트 없는 recent 프로젝트 1개 · 독립 claude -p 만 있는 임시 프로젝트 1개.
// api-server(demo-beta) 메인은 기동기·배치 예시(서브에이전트 → '기동기 · relaunch.sh'(이어받음) → 회차 반복, 재무장 Monitor)를 돌리고,
// 같은 프로젝트에 추정 소속(likelyMain)만 있는 독립 claude -p 하나가 그 메인 사무실 대기석에 붙는다.
// DOM·three 에 의존하지 않는다.
import { MockGenerator } from '../mock.js';
import { ConflictTracker, conflictEvent, fileKey, baseOf, sessionMsgEvent } from '../conflict-core.mjs';

const PROJ = [
  { projectId: 'demo-alpha', name: 'acme-web', path: 'D:\\work\\acme-web', titles: ['Claude Code 세션 시각화 3차', '분기 보고서 표 검토', '보고서 초안 정리'] },
  { projectId: 'demo-beta', name: 'api-server', path: 'D:\\code\\api-server', titles: ['API 평가 모듈 보강', '검색 파서 수정'] },
  { projectId: 'demo-gamma', name: 'design-system', path: 'D:\\code\\design-system', titles: ['스킬 카탈로그 갱신'] },
  { projectId: 'demo-delta', name: 'docs-site', path: 'D:\\code\\docs-site', titles: ['피드백 집계'] },
  { projectId: 'demo-epsilon', name: 'data-cli', path: 'D:\\code\\data-cli', titles: ['지표 ID 정리'] },
];
const TMP = { projectId: 'demo-tmp', name: '(임시) sandbox', path: 'C:\\Users\\dev\\AppData\\Local\\Temp\\sandbox', temp: true };
const RECENT_ONLY = { projectId: 'demo-zeta', name: 'report-gen', path: 'D:\\code\\report-gen' };

const PRE = 25000;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** 'x:rest' → 'x:<px>-rest' */
const pfx = (id, px) => (typeof id === 'string' && /^[a-z]:/.test(id) ? id[0] + ':' + px + '-' + id.slice(2) : id);

export function createOverviewMock({ projects = 3, mainsPerProject = [2, 1, 1], seed = 2026, recent = true, orphan = true, launcher = true, matchAfterMs = 60000, flipEveryMs = [10000, 40000], now = () => Date.now(), sessions = true } = {}) {
  const R = rng(seed);
  const nP = Math.max(1, Math.min(PROJ.length, projects));
  const t0 = now() - PRE;
  const roots = [];        // {gen, px, projectId, nodeId, sessionId, title}
  let hseq = 0;
  const nodes = new Map(); // 합친 상태(snapshot 용)
  const recentEv = [];
  const pstate = new Map(); // projectId → {liveStatus per root…}

  for (let i = 0; i < nP; i++) {
    const P = PROJ[i];
    const n = Math.max(0, mainsPerProject[i] ?? 1);
    for (let j = 0; j < n; j++) {
      const px = `p${i}m${j}`;
      const gen = new MockGenerator({ seed: seed + i * 97 + j * 13, startMs: t0 - Math.floor(R() * 120000), launcher: launcher && i === 1 && j === 0 ? { adopted: true } : false });
      const title = P.titles[j % P.titles.length];
      roots.push({ gen, px, projectId: P.projectId, nodeId: pfx(gen.root, px), sessionId: px + '-' + gen.root.slice(2), title, role: '메인 · ' + P.name, liveStatus: 'busy', tier: 'live' });
    }
  }

  // ---- 이벤트 변환: id 앞붙이 + projectId·rootSessionId ----
  const owner = new Map(); // nodeId → root 항목
  // meta 안의 노드·세션 참조도 앞붙이(재무장 rearmOf, 배치 currentCycleId·recent[].nodeId)
  function tagMeta(meta, r) {
    if (!meta) return meta;
    const m = { ...meta };
    if (m.rearmOf) m.rearmOf = pfx(m.rearmOf, r.px);
    if (m.batch) m.batch = { ...m.batch, currentCycleId: m.batch.currentCycleId ? r.px + '-' + m.batch.currentCycleId : null,
      recent: (m.batch.recent || []).map((x) => ({ ...x, sessionId: r.px + '-' + x.sessionId, nodeId: x.nodeId ? pfx(x.nodeId, r.px) : null })) };
    return m;
  }
  function tagNode(node, r) {
    const c = { ...node, meta: tagMeta(node.meta || {}, r), openTools: (node.openTools || []).map((t) => ({ ...t, toolUseId: r.px + '-' + t.toolUseId })) };
    c.id = pfx(node.id, r.px);
    c.parentId = node.parentId ? pfx(node.parentId, r.px) : null;
    c.sessionId = r.sessionId;
    c.projectId = r.projectId;
    c.rootSessionId = r.sessionId;
    // 서버 규칙: 루트 label = 역할 표기 "메인 · <프로젝트>", 세션 제목은 meta.title(부제) — 목록 제목으로 label 을 덮지 않는다
    if (c.id === r.nodeId) { c.label = r.role; c.meta = { ...c.meta, title: r.title, live: true, liveStatus: r.liveStatus, tier: r.tier }; }
    return c;
  }
  function tagEv(ev, r) {
    const e = { ...ev, nodeId: pfx(ev.nodeId, r.px), rootSessionId: r.sessionId, projectId: r.projectId };
    if (e.toolUseId) e.toolUseId = r.px + '-' + e.toolUseId;
    if (e.type === 'tool-start') { const f = fileFor(e, r); if (f) e.file = f; }
    if (e.node) e.node = tagNode(e.node, r);
    if (e.type === 'node-update' && e.patch && e.patch.meta) e.patch = { ...e.patch, meta: tagMeta(e.patch.meta, r) };
    // 루트 이름 갱신은 서버처럼 label 이 아니라 meta.title 로(ai-title 은 label 을 바꾸지 않음)
    if (e.type === 'node-update' && e.patch && e.patch.label && e.nodeId === r.nodeId) { const { label, ...rest } = e.patch; e.patch = { ...rest, meta: { ...(rest.meta || {}), title: r.title } }; }
    return e;
  }
  function apply(e) {
    const n = nodes.get(e.nodeId);
    switch (e.type) {
      case 'node-add': nodes.set(e.node.id, JSON.parse(JSON.stringify(e.node))); break;
      case 'node-update': if (n) { const { meta, ...rest } = e.patch || {}; Object.assign(n, rest); if (meta) n.meta = { ...n.meta, ...meta }; } break;
      case 'node-remove': for (const id of e.ids || [e.nodeId]) nodes.delete(id); break;
      case 'tool-start': if (n && !n.openTools.some((t) => t.toolUseId === e.toolUseId)) n.openTools.push({ toolUseId: e.toolUseId, tool: e.tool, cat: e.cat, skill: e.skill, startedAt: e.ts, text: e.text }); break;
      case 'tool-end': if (n) n.openTools = n.openTools.filter((t) => t.toolUseId !== e.toolUseId); break;
    }
    if (n && e.ts && e.type !== 'node-remove') n.lastActivityAt = e.ts;
  }
  function emit(e, out) {
    e.seq = ++hseq;
    apply(e);
    recentEv.push(e);
    if (recentEv.length > 300) recentEv.shift();
    if (out) out(e);
    if (sessions && e.type === 'tool-start' && e.file) sessTouch(e, out);
    return e;
  }

  // ---- 같은 파일 충돌(서버 허브와 같은 규칙 — conflict-core 공용)·세션 간 메시지 ----
  const conf = new ConflictTracker();
  const liveConf = [];
  const rootBySid = new Map(roots.map((r) => [r.sessionId, r]));
  /** 파일 도구 → 정규화 경로. 같은 프로젝트 메인끼리 일부 파일을 같이 건드린다(공용 2개 중 하나 30%) */
  function fileFor(e, r) {
    if (!sessions || !/^(Read|Edit|Write|MultiEdit)$/.test(e.tool || '')) return null;
    const P = PROJ.find((x) => x.projectId === r.projectId);
    const shared = ['server/index.mjs', 'web/layout.mjs'];
    const h = (e.toolUseId || '').split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
    // 같은 프로젝트 안에서도 앞 두 메인(px …m0·m1)과 다섯째(m4)만 공용 파일을 건드린다 — 충돌이 몇 쌍에만 생기게
    const sharer = /m[014]$/.test(r.px);
    const name = sharer && h % 10 < 2 ? shared[h % 2] : `${r.px}/${String(e.text || 'notes.md').split(/[\\/]/).pop()}`;
    const k = fileKey(name, P ? P.path : 'D:\\demo');
    return k ? { k, n: baseOf(k), w: e.tool === 'Read' ? 0 : 1 } : null;
  }
  function sessTouch(e, out) {
    const r = rootBySid.get(e.rootSessionId);
    if (!r || r.tier !== 'live') return;
    const res = conf.touch(r.sessionId, e.file, Date.parse(e.ts) || now(), e.nodeId);
    const mainOf = (sid) => (rootBySid.get(sid) || {}).nodeId || 's:' + sid;
    for (const c of res.off) { const ev = conflictEvent(c, 'off', iso(now()), mainOf); ev.seq = ++hseq; if (out) out(ev); }
    for (const c of res.on) { const ev = conflictEvent(c, 'on', iso(now()), mainOf); ev.seq = ++hseq; if (out) out(ev); }
  }
  const iso = (ms) => new Date(ms).toISOString();

  // ---- recent 루트(희미): 정적 트리 하나 ----
  const extraRoots = [];
  if (recent) {
    const P = nP >= 3 ? PROJ[2] : PROJ[nP - 1];
    const sid = 'p-recent-0001';
    const id = 's:' + sid;
    const ended = iso(t0 - 40 * 60000);
    const base = { model: 'claude-opus-5-5', depth: 0, sessionId: sid, projectId: P.projectId, rootSessionId: sid, counts: { tools: 12, errors: 0, texts: 5 }, openTools: [], startedAt: iso(t0 - 90 * 60000), lastActivityAt: ended };
    const list = [
      { ...base, id, parentId: null, kind: 'main', label: '메인 · ' + P.name, status: 'idle', endedAt: null, meta: { title: '지난 작업 — 스킬 문서 정리', live: false, liveStatus: null, tier: 'recent' } },
      { ...base, id: 'a:recent-1', parentId: id, kind: 'subagent', label: 'SKILL.md 검토', status: 'done', depth: 1, endedAt: ended, meta: {} },
      { ...base, id: 'a:recent-2', parentId: id, kind: 'subagent', label: '카탈로그 표 갱신', status: 'done', depth: 1, endedAt: ended, meta: {} },
    ];
    for (const n of list) nodes.set(n.id, n);
    extraRoots.push({ projectId: P.projectId, nodeId: id, sessionId: sid, title: list[0].meta.title, liveStatus: null, tier: 'recent', live: false });
  }

  // ---- 독립 claude -p(임시 폴더 프로젝트) → 나중에 메인 아래로 매칭 ----
  let orphanRoot = null, matched = false;
  if (orphan) {
    const sid = 'orphan-sdk-0001';
    const id = 's:' + sid;
    const n = { id, parentId: null, kind: 'claude-p', label: 'claude -p · ' + TMP.name, model: 'claude-opus-5-5', status: 'active', startedAt: iso(t0 + 5000), endedAt: null, lastActivityAt: iso(t0 + 5000), depth: 0, sessionId: sid, projectId: TMP.projectId, rootSessionId: sid, meta: { orphanSdk: true, title: '통합 시험을 실행하고 결과를 JSON 으로 보고', live: true, liveStatus: 'busy', tier: 'live', cwd: TMP.path }, counts: { tools: 0, errors: 0, texts: 0 }, openTools: [] };
    nodes.set(id, n);
    orphanRoot = { projectId: TMP.projectId, nodeId: id, sessionId: sid, title: n.meta.title, liveStatus: 'busy', tier: 'live', live: true, orphan: true };
  }

  // ---- 추정 소속만 있는 독립 claude -p(likelyMain): api-server 메인 사무실 대기석으로 ----
  let guestRoot = null;
  if (orphan && launcher && nP >= 2) {
    const host = roots.find((r) => r.projectId === PROJ[1].projectId);
    const sid = 'orphan-sdk-0002';
    const id = 's:' + sid;
    const n = { id, parentId: null, kind: 'main', label: 'claude -p · ' + PROJ[1].name, model: 'claude-opus-5-5', status: 'active', startedAt: iso(t0 + 3000), endedAt: null, lastActivityAt: iso(t0 + 3000), depth: 0, sessionId: sid, projectId: PROJ[1].projectId, rootSessionId: sid,
      meta: { orphanSdk: true, likelyMain: host ? host.sessionId : null, unlinkedReason: 'ambiguous', title: '표준 입력 프롬프트 시험(STDIN_MARK)', live: true, liveStatus: 'busy', tier: 'live', cwd: PROJ[1].path }, counts: { tools: 0, errors: 0, texts: 0 }, openTools: [] };
    nodes.set(id, n);
    guestRoot = { projectId: PROJ[1].projectId, nodeId: id, sessionId: sid, title: n.meta.title, liveStatus: 'busy', tier: 'live', live: true, orphan: true };
  }

  // 미리 25초 돌림
  const pq = () => { let best = null; for (const r of roots) { const at = Math.min(...r.gen.q.map((x) => x.at)); if (!best || at + r.gen.t0 < best.at + best.r.gen.t0) best = { r, at }; } return best; };
  const pump = (untilWall, out, max = 600) => {
    let guard = 0;
    while (guard++ < max) {
      const b = pq();
      if (!b || b.r.gen.t0 + b.at > untilWall) break;
      for (const ev of b.r.gen.next().events) emit(tagEv(ev, b.r), out);
    }
  };
  pump(t0 + PRE, null, 1e6);

  // ---- 프로젝트 목록(모양) ----
  function projectsList() {
    const nowMs = now();
    const out = [];
    const all = [...roots, ...extraRoots, ...(orphanRoot && !matched ? [orphanRoot] : []), ...(guestRoot ? [guestRoot] : [])];
    const by = new Map();
    for (const r of all) { if (!by.has(r.projectId)) by.set(r.projectId, []); by.get(r.projectId).push(r); }
    const defs = [...PROJ.slice(0, nP), RECENT_ONLY, TMP];
    if (recent && !by.has(RECENT_ONLY.projectId)) by.set(RECENT_ONLY.projectId, []);
    for (const P of defs) {
      const rs = by.get(P.projectId);
      if (!rs && P !== TMP) continue;
      const live = (rs || []).filter((r) => r.tier === 'live');
      const act = (r) => { const n = nodes.get(r.nodeId); let t = n ? Date.parse(n.lastActivityAt) || 0 : 0; for (const m of nodes.values()) if (m.rootSessionId === r.sessionId) t = Math.max(t, Date.parse(m.lastActivityAt) || 0); return t; };
      const lastAct = Math.max(0, ...(rs || []).map(act), P === RECENT_ONLY ? nowMs - 75 * 60000 : 0);
      const recentList = [
        ...(rs || []).filter((r) => r.tier !== 'live').map((r) => ({ sessionId: r.sessionId, title: r.title, activityAt: iso(act(r)) })),
        ...(P === RECENT_ONLY ? [{ sessionId: 'zeta-0001', title: 'md 변환 양식 점검', activityAt: iso(nowMs - 75 * 60000) }] : []),
        { sessionId: P.projectId + '-old1', title: '지난 세션 예시', activityAt: iso(nowMs - 26 * 3600000) },
      ];
      out.push({
        projectId: P.projectId, name: P.name, path: P.path, nameGuessed: false, temp: !!P.temp,
        live: live.length > 0, liveSessions: live.length,
        activeSessions: live.filter((r) => r.liveStatus === 'busy' || nowMs - act(r) < 600000).length,
        busySessions: live.filter((r) => r.liveStatus === 'busy').length,
        sessions: 10 + P.projectId.length * 3, lastActivityAt: lastAct ? iso(lastAct) : null,
        liveList: live.map((r) => ({ sessionId: r.sessionId, title: r.title, liveStatus: r.liveStatus, tier: 'live', activityAt: iso(act(r)), entrypoint: r.orphan ? 'sdk-cli' : 'cli', inOverview: true })),
        recentList,
      });
    }
    return out;
  }
  const rootsList = () => [...roots, ...extraRoots, ...(orphanRoot && !matched ? [orphanRoot] : []), ...(guestRoot ? [guestRoot] : [])].map((r) => ({ sessionId: r.sessionId, projectId: r.projectId, nodeId: r.nodeId, ...(r.orphan ? { orphanSdk: true } : {}) }));

  function snapshot() {
    const mainOf = (sid) => (rootBySid.get(sid) || {}).nodeId || 's:' + sid;
    return { scope: 'all', root: null, seq: hseq, nodes: [...nodes.values()].map((n) => JSON.parse(JSON.stringify(n))), recent: recentEv.slice(), projects: projectsList(), roots: rootsList(),
      conflicts: conf.list().map((c) => conflictEvent(c, 'on', iso(now()), mainOf)) };
  }

  let timers = [], stopped = false;
  function later(ms, fn) { const t = setTimeout(() => { timers = timers.filter((x) => x !== t); if (!stopped) fn(); }, ms); timers.push(t); return t; }

  function start(onEvent, onProjects) {
    stopped = false;
    const wall0 = now() - PRE;
    const tick = () => {
      const due = now();
      pump(due - (wall0 - t0) - 0, onEvent);
      later(60, tick);
    };
    later(16, tick);
    // busy ↔ idle 토글(프로젝트 단위)
    const flip = () => {
      const r = roots[Math.floor(R() * roots.length)];
      r.liveStatus = r.liveStatus === 'busy' ? 'idle' : 'busy';
      onEvent(emit({ ts: iso(now()), type: 'node-update', nodeId: r.nodeId, patch: { meta: { liveStatus: r.liveStatus } } }));
      onProjects && onProjects({ projects: projectsList(), roots: rootsList() });
      later(flipEveryMs[0] + R() * (flipEveryMs[1] - flipEveryMs[0]), flip);
    };
    later(flipEveryMs[0], flip);
    // 충돌 창 정리(10분) + 같은 프로젝트 live 메인 사이 SendMessage(12～20초마다)
    const sweep = () => {
      const mainOf = (sid) => (rootBySid.get(sid) || {}).nodeId || 's:' + sid;
      const r = conf.evaluate(now());
      for (const c of r.off) onEvent(emit({ ...conflictEvent(c, 'off', iso(now()), mainOf) }));
      later(5000, sweep);
    };
    if (sessions) later(5000, sweep);
    const send = () => {
      const byP = new Map();
      for (const r of roots) if (r.tier === 'live') { if (!byP.has(r.projectId)) byP.set(r.projectId, []); byP.get(r.projectId).push(r); }
      const pairs = [...byP.values()].filter((a) => a.length >= 2);
      if (pairs.length) {
        const g = pairs[Math.floor(R() * pairs.length)];
        const a = g[Math.floor(R() * g.length)];
        let b = g[Math.floor(R() * g.length)]; if (b === a) b = g[(g.indexOf(a) + 1) % g.length];
        const target = [...nodes.values()].find((n) => n.rootSessionId === b.sessionId && n.kind === 'subagent' && n.status !== 'done') || nodes.get(b.nodeId);
        if (target) {
          const tu = 'toolu_send' + hseq;
          onEvent(emit({ ts: iso(now()), type: 'tool-start', nodeId: a.nodeId, toolUseId: tu, tool: 'SendMessage', cat: 'agent', skill: null, text: '진행 상황 공유', brief: '진행 상황 공유', to: target.id.replace(/^[a-z]:/, ''), rootSessionId: a.sessionId, projectId: a.projectId }));
          onEvent(emit({ ...sessionMsgEvent({ ts: iso(now()), fromMain: a.nodeId, toMain: b.nodeId, fromNode: a.nodeId, toNode: target.id, text: '진행 상황 공유' }), projectId: a.projectId, rootSessionId: a.sessionId }));
          later(900, () => onEvent(emit({ ts: iso(now()), type: 'tool-end', nodeId: a.nodeId, toolUseId: tu, tool: 'SendMessage', cat: 'agent', ok: true, durationMs: 900, text: '전달됨' })));
        }
      }
      later(12000 + R() * 8000, send);
    };
    if (sessions) later(6000, send);
    if (guestRoot) {
      let g = 0;
      const gact = () => {
        const tools = [['Read', 'read', 'prompt.md'], ['Bash', 'shell', 'pytest -q tests/test_stdin.py']];
        const [tool, cat, text] = tools[g++ % tools.length];
        const tu = 'toolu_guest' + g;
        onEvent(emit({ ts: iso(now()), type: 'tool-start', nodeId: guestRoot.nodeId, toolUseId: tu, tool, cat, skill: null, text }));
        later(1800, () => onEvent(emit({ ts: iso(now()), type: 'tool-end', nodeId: guestRoot.nodeId, toolUseId: tu, tool, cat, ok: true, durationMs: 1800, text: '완료' })));
        later(5000, gact);
      };
      later(2500, gact);
    }
    // 독립 claude -p: 활동 몇 개 → matchAfterMs 뒤 다른 메인 아래로(remove → add)
    if (orphanRoot) {
      let k = 0;
      const act = () => {
        if (matched) return;
        const tools = [['Bash', 'shell', '통합 시험 실행'], ['Read', 'read', 'CONTRACT.md'], ['Grep', 'search', 'node-remove']];
        const [tool, cat, text] = tools[k++ % tools.length];
        const tu = 'toolu_orphan' + k;
        onEvent(emit({ ts: iso(now()), type: 'tool-start', nodeId: orphanRoot.nodeId, toolUseId: tu, tool, cat, skill: null, text }));
        later(1500, () => onEvent(emit({ ts: iso(now()), type: 'tool-end', nodeId: orphanRoot.nodeId, toolUseId: tu, tool, cat, ok: true, durationMs: 1500, text: '완료' })));
        later(4000, act);
      };
      later(2000, act);
      later(matchAfterMs, () => {
        const parent = roots[0];
        const old = nodes.get(orphanRoot.nodeId);
        if (!old) return;
        matched = true;
        onEvent(emit({ ts: iso(now()), type: 'node-remove', nodeId: orphanRoot.nodeId, subtree: true, ids: [orphanRoot.nodeId] }));
        // 부모 아래 자식이 되면 서버처럼 label 은 "claude -p · <sid8>", 제목은 meta.title 그대로
        const node = { ...JSON.parse(JSON.stringify(old)), label: 'claude -p · ' + orphanRoot.sessionId.slice(0, 8), parentId: parent.nodeId, depth: 1, projectId: parent.projectId, rootSessionId: parent.sessionId, meta: { ...old.meta, orphanSdk: false, toolUseId: 'toolu_match' } };
        onEvent(emit({ ts: iso(now()), type: 'node-add', nodeId: node.id, node }));
        onProjects && onProjects({ projects: projectsList(), roots: rootsList() });
        later(20000, () => onEvent(emit({ ts: iso(now()), type: 'node-update', nodeId: node.id, patch: { status: 'done', endedAt: iso(now()) } })));
      });
    }
  }
  function stop() { stopped = true; for (const t of timers) clearTimeout(t); timers = []; }

  return { snapshot, start, stop, projects: projectsList, roots: rootsList, get seq() { return hseq; } };
}

/** 데모 한도 값(--demo 와 같은 모양): five_hour 72%(주의) · seven_day 93%(경고) · 12분 전 기준(오래됨) */
export function demoLimits(kind = 'demo', nowMs = Date.now()) {
  const H = 3600 * 1000;
  const mk = (pct, inMs, src = 'statusline', capAgo = 12 * 60000) => ({ pct, resetsAt: new Date(nowMs + inMs).toISOString(), resetsInSec: Math.round(inMs / 1000), source: src, capturedAt: new Date(nowMs - capAgo).toISOString(), expired: inMs <= 0 });
  const wrap = (five, seven, capAgo) => ({ ok: true, source: 'statusline', capturedAt: new Date(nowMs - capAgo).toISOString(), ageSec: Math.round(capAgo / 1000), stale: capAgo > 600000, five_hour: five, seven_day: seven, plan: 'max' });
  switch (kind) {
    case 'ok': return wrap(mk(7, 3 * H + 12 * 60000, 'statusline', 40000), mk(19, 22 * H, 'statusline', 40000), 40000);
    case 'warn': return wrap(mk(70, 50 * 60000, 'statusline', 60000), mk(69.9, 4 * 24 * H, 'statusline', 60000), 60000);
    case 'danger': return wrap(mk(90, 2 * H, 'oauth', 90000), mk(89.9, 30 * H, 'oauth', 90000), 90000);
    case 'expired': return wrap(mk(85, -60000, 'statusline', 20 * 60000), mk(41, 3 * 24 * H, 'statusline', 20 * 60000), 20 * 60000);
    case 'none': return { ok: true, source: null, five_hour: null, seven_day: null, disabled: true };
    default: return wrap(mk(72, 2 * H + 40 * 60000), mk(93, 2 * 24 * H + 5 * H), 12 * 60000);
  }
}
