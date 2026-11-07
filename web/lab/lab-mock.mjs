// 【리드·QA】 연구소 mock 시나리오(설계 M1～M10 + M11 claude -p) — 순수(DOM·three 없음, 타이머만). 화면 확인 URL: ?mock=1&view=lab&labmock=<n>.
// 기본 ?mock=1&view=lab 은 mock.js 시나리오(메인 + 서브 + bg + Monitor …)를 연구동 배치로 그리고, 작업 대상 장면은 art-mock(ArtMockDriver).
// labmock=n 이면 LabMockDriver 가 그 장면을 더 낸다(결정적 난수 — 시드 4242 + n). app.js connect() mock 갈래가 start/stop 한다.
// 범위·표현이 필요한 장면(7 multi·8 campus·9 stress·10 replay)은 URL 매개변수로 고르고(see 열), 드라이버는 그 위에 확인용 사건만 더한다.
export const LAB_MOCK = [
  { n: 1, id: 'basic', see: '배치·기자재 종류 판정(10종 명령)·회차 책상', url: '' },
  { n: 2, id: 'platform-load', see: '구역 상한·…·묶음·LOD·플랫폼 크기(폴더 14 × 쓰기 연속)', url: '&artn=480' },
  { n: 3, id: 'danger', see: '붉은 파문·경광등·구역 빗금·현장 경보 걷기(rm -rf·DROP·force push)', url: '' },
  { n: 4, id: 'bulk', see: '같은 폴더 Edit 6～8회 1초 간격 → 바닥 파도·×N', url: '' },
  { n: 5, id: 'rig-states', see: '상태 6종(진행·대기·정체·끝·실패·중지)·퇴장 승강판·비운 자리 회색', url: '' },
  { n: 6, id: 'field-walk', see: '새 파일 현장 투입(동시 3명 상한)·TaskOutput 들여다보기·KillShell 끄기', url: '' },
  { n: 7, id: 'multi', see: '같은 프로젝트 live 메인 여럿 — 구역 각·브리지 여럿·출입문/라운지 틈', url: '&scope=all&multi=1' },
  { n: 8, id: 'campus', see: '전체 보기 캠퍼스 — 프로젝트마다 원형 연구동·비활성 돔 닫힘·표시 고르기', url: '&scope=all' },
  { n: 9, id: 'stress', see: '그리기 호출·프레임 시간(노드 60·300)', url: '&stress=60' },
  { n: 10, id: 'replay', see: '배속 8 이상 순간 이동·움직임 줄이기·라이트', url: '&theme=light' },
  { n: 11, id: 'claude-p', see: 'claude -p 회차(분리 기동기 → 러너 → 회차)·메인이 띄운 독립 claude -p 가 전경 Agent 로 띄운 서브에이전트 — 띄운 쪽은 자기 책상, 하위는 곁 책상·의뢰서·보고', url: '' },
];

/** M1: 10종 판정을 한눈에 보는 명령(lab-rig-core RIG_RULES 순) + Monitor */
export const LAB_MOCK_RIGS = [
  ['tests', 'npm test -- --watch=false'],
  ['reactor', 'npm run build'],
  ['oscillo', 'uvicorn app:api --port 8080'],
  ['tank', "psql -c 'VACUUM ANALYZE orders'"],
  ['antenna', 'rsync -az dist/ demo-server:/srv/www/'],
  ['dispenser', 'for f in data/*.csv; do python clean.py $f; done'],
  ['incubator', 'python train.py --epochs 40'],
  ['meter', 'python report.py'],
  ['scope', 'tail -f logs/app.log'],
];

const F = (id, v, o = {}) => { const i = id.lastIndexOf('/'); return { k: 'file', id: id.toLowerCase(), p: id, d: i < 0 ? '' : id.slice(0, i), n: i < 0 ? id : id.slice(i + 1), v, ...o }; };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * 연구소 mock 드라이버. nodes() → 지금 노드들, emit(ev) → 앱 onEvent. scenario = 1..10.
 * 사건은 모두 결정적 순서(시드)로, 시각만 setTimeout. start()·stop() 는 여러 번 불러도 안전.
 */
export class LabMockDriver {
  constructor({ nodes, emit, scenario = 1, seed = 4242, first = 1800 } = {}) {
    this.nodes = nodes; this.emit = emit; this.n = Math.max(1, Math.min(LAB_MOCK.length, scenario | 0 || 1));
    this.r = rng(seed + this.n); this.first = first; this.timers = new Set(); this.on = false; this.k = 0; this.bg = 0;
  }
  _at(ms, fn) { const t = setTimeout(() => { this.timers.delete(t); if (this.on) fn(); }, ms); this.timers.add(t); }
  start() { if (this.on) return; this.on = true; this._at(this.first, () => this._run()); }
  stop() { this.on = false; for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
  _ts() { return new Date().toISOString(); }
  _live(kinds = ['main', 'subagent', 'workflow-agent']) { return [...this.nodes()].filter((n) => kinds.includes(n.kind) && (n.status === 'active' || n.status === 'idle')); }
  _main() { const m = this._live(['main']); return m[0] || this._live()[0] || null; }
  _pick(a) { return a[Math.floor(this.r() * a.length)]; }
  /** 도구 한 번(tool-start → ms 뒤 tool-end), art 는 시작·끝 같게 */
  _tool(nodeId, tool, cat, text, art = null, ms = 700, extra = {}) {
    const tu = `tu_lab_mock_${this.n}_${this.k++}`;
    this.emit({ type: 'tool-start', ts: this._ts(), nodeId, toolUseId: tu, tool, cat, text, brief: text, ...(art ? { art: art.map((x) => ({ ...x })) } : {}), ...extra });
    this._at(ms, () => this.emit({ type: 'tool-end', ts: this._ts(), nodeId, toolUseId: tu, tool, cat, ok: true, durationMs: ms, text: '완료', brief: '완료', ...(art ? { art: art.map((x) => ({ ...x, v: x.v === 'write' ? 'create' : x.v })) } : {}) }));
    return tu;
  }
  /** 백그라운드 기자재 하나(node-add) → 출력 틱 → 끝(state: done|error|stopped|stale(조용)) */
  _bg(parentId, command, { life = 20000, end = 'done', kind = 'bash-bg', rc = null, quiet = false, art = null } = {}) {
    const id = `b:labmock${this.n}_${String(++this.bg).padStart(3, '0')}`;
    const tu = `tu_lab_bg_${this.n}_${this.bg}`; // B 기자재 → 플랫폼 운반: 띄운 Bash 의 toolUseId(실제 세션은 서버가 meta.toolUseId 로 넣음)
    const node = { id, parentId, kind, label: command, status: 'active', startedAt: this._ts(), lastActivityAt: this._ts(), meta: { command, background: true, toolUseId: tu } };
    this.emit({ type: 'node-add', ts: this._ts(), nodeId: id, node });
    if (art) { // 그 명령이 쓰는 산출 파일(같은 tu 의 art) — 기자재 꼭대기에서 플랫폼 블록으로 캡슐이 감
      const fire = () => {
        this.emit({ type: 'tool-start', ts: this._ts(), nodeId: parentId, toolUseId: tu, tool: 'Bash', cat: 'shell', text: command, brief: command, art: art.map((x) => ({ ...x })) });
        this._at(500, () => this.emit({ type: 'tool-end', ts: this._ts(), nodeId: parentId, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 500, text: '완료', brief: '완료', art: art.map((x) => ({ ...x, v: x.v === 'write' ? 'create' : x.v })) }));
      };
      this._at(2500, fire); // 한 번만 — 같은 tu 를 다시 보내면 ArtBook 이 tu|id 로 거르고(장부·운반 0) 주인 캐릭터에 끝난 도구가 다시 쌓임. 실제 세션도 띄운 Bash 호출은 한 번
    }
    const t0 = Date.now();
    const tick = () => {
      if (Date.now() - t0 > life) {
        const patch = { status: end, endedAt: this._ts() };
        if (rc != null) patch.meta = { rc };
        if (end === 'stopped') patch.meta = { killed: true, stopReason: 'taskstop' };
        this.emit({ type: 'node-update', ts: this._ts(), nodeId: id, patch });
        return;
      }
      if (!quiet) this.emit({ type: 'output', ts: this._ts(), nodeId: id, text: `[${Math.round((Date.now() - t0) / 1000)}s] ok` });
      this._at(900 + this.r() * 1500, tick);
    };
    this._at(600, tick);
    return id;
  }
  _run() {
    const m = this._main();
    if (!m) { this._at(1000, () => this._run()); return; }
    const S = this['_m' + this.n];
    if (S) S.call(this, m);
  }
  // M1 기본: 기자재 10종(명령 판정) — 오래 살아 있게
  _m1(m) { LAB_MOCK_RIGS.forEach(([k, cmd], i) => this._at(i * 350, () => this._bg(m.id, cmd, { life: 120000, kind: cmd.startsWith('tail') ? 'monitor' : 'bash-bg', art: k === 'reactor' ? [F('dist/bundle.js', 'write', { sz: 6 })] : null }))); }
  // M2 부하: 폴더 14 × 파일 쓰기 연속(구역 상한 12 → '…')
  _m2(m) {
    let i = 0;
    const step = () => { const who = this._pick(this._live()) || m; const d = `pkg${i % 14}/sub${(i >> 3) % 3}`; this._tool(who.id, 'Write', 'edit', `${d}/f${i}.ts`, [F(`${d}/f${i}.ts`, 'write', { sz: 4 })], 300); i++; if (i < 220) this._at(180, step); };
    step();
  }
  // M3 위험 동작: rm -rf · DROP · force push 를 돌아가며
  _m3(m) {
    const D = [
      ['Bash', 'rm -rf build/old', [F('build/old', 'delete', { est: 1, x: 'rm' })]],
      ['Bash', "psql -c 'DROP TABLE tmp_import'", [{ k: 'db', id: 'db:postgres/shop', n: 'shop', v: 'write', coll: ['tmp_import'], x: 'drop', imp: 'db' }]],
      ['Bash', 'git push --force origin feat-x', [{ k: 'repo', id: 'repo:viz', n: 'viz', v: 'push', x: 'force' }]],
    ];
    let i = 0;
    const step = () => { const who = this._pick(this._live()) || m; const [tool, text, art] = D[i % D.length]; this._tool(who.id, tool, 'shell', text, art, 900); i++; this._at(6000, step); };
    step();
  }
  // M4 대량 변경: 같은 폴더 Edit 6～8회 1초 간격(같은 구역 10초 안 6개 → 파도·×N), 20초마다 되풀이
  _m4(m) {
    const round = (r) => {
      const n = 6 + (r % 3), who = this._pick(this._live()) || m;
      for (let i = 0; i < n; i++) this._at(i * 1000, () => this._tool(who.id, 'Edit', 'edit', `src/ui/panel${i}.js`, [F(`src/ui/panel${i}.js`, 'modify', { sz: 2 })], 500));
      this._at(20000, () => round(r + 1));
    };
    round(0);
  }
  // M5 상태 6종: 진행(출력) · 대기(Monitor 조용) · 정체(조용한 셸) · 끝 · 실패(rc 2) · 중지
  _m5(m) {
    this._bg(m.id, 'npm test', { life: 9000, end: 'done', art: [F('reports/junit.xml', 'write', { sz: 2 })] });
    this._bg(m.id, 'npm run build', { life: 12000, end: 'error', rc: 2 });
    this._bg(m.id, 'python train.py --epochs 40', { life: 600000, quiet: true });   // 조용 → 정체
    this._bg(m.id, 'uvicorn app:api --port 8080', { life: 15000, end: 'stopped' });
    this._bg(m.id, 'tail -f logs/app.log', { life: 600000, kind: 'monitor', quiet: true }); // 대기
    this._bg(m.id, 'rsync -az dist/ demo-server:/srv/www/', { life: 600000 });     // 진행
    this._at(30000, () => this._m5(m)); // 퇴장(승강판)·비운 자리를 다시 보게
  }
  // M6 현장 걷기: 여러 사람이 동시에 새 파일(가장자리 3명 상한) · TaskOutput · KillShell
  _m6(m) {
    const bg = this._bg(m.id, 'python bench.py --sweep', { life: 600000 });
    const round = () => {
      const live = this._live(['subagent', 'workflow-agent']);
      live.slice(0, 5).forEach((n, i) => this._at(i * 120, () => this._tool(n.id, 'Write', 'edit', `docs/field${this.k}.md`, [F(`docs/field${this.k}.md`, 'write', { sz: 2 })], 600)));
      const w = live[0] || m;
      this._at(2500, () => this._tool(w.id, 'TaskOutput', 'monitor', bg, null, 800, { input: { task_id: bg } }));
      this._at(9000, () => this._tool(w.id, 'KillShell', 'monitor', bg, null, 300, { input: { shell_id: bg } }));
      this._at(22000, round);
    };
    round();
  }
  // M7·M8: 범위 장면(URL) — 쓰기 몇 번만 더함
  _m7(m) { this._m2s(m); }
  _m8(m) { this._m2s(m); }
  _m2s(m) { const step = () => { const who = this._pick(this._live()) || m; this._tool(who.id, 'Write', 'edit', `src/m${this.k}.js`, [F(`src/m${this.k}.js`, 'write', { sz: 3 })], 500); this._at(4000, step); }; step(); }
  _m9() {}
  _m10(m) { this._m4(m); }
  // M11 claude -p(11.02. 사용자 지적 "claude -p 가 혼자 동떨어진 곳에서 허우적댄다 — 자기가 띄운 서브에이전트와 연결도 안 됨"):
  //   실제 자율 루프(분리 기동) 모양 그대로 — 분리 기동기(parentId 없음 · meta.spawnedBy = 메인) → 러너 → 회차 claude -p(link.by launcher).
  //   claude -p 는 서브에이전트를 전경 Agent 로 띄워 하위가 끝날 때까지 도구가 열려 있다(mock.js spawnAgent 는 비동기 300ms라 재현 안 됨).
  //   메인이 Bash 로 띄운 독립 claude -p(회차 아님)도 같은 모양으로 하나 더.
  _m11(m) {
    const L = 'b:labmock11_launch', R = L + '-r1';
    this._add({ id: L, parentId: null, kind: 'bash-bg', label: '기동기 · relaunch.sh', meta: { detached: true, background: true, spawnedBy: m.id, command: null, launcher: { script: 'relaunch.sh', via: ['relaunch.sh'] } } });
    this._add({ id: R, parentId: L, kind: 'bash-bg', label: '러너 · autopilot.sh', meta: { background: true, command: null, runner: { script: 'autopilot.sh', instance: 1, launcher: L } } });
    let k = 0;
    const cycle = () => {
      const id = `s:labmock11-cycle-${++k}`;
      this._add({ id, parentId: R, kind: 'claude-p', label: 'claude -p · cycle-' + k, meta: { cycle: k, cwd: 'D:/code/api-server', link: { by: 'launcher', confidence: 'high', evidence: ['script-claude-p', 'cwd', 'time', 'chain'] } } });
      this._at(700, () => this._pAgent(id, `회차 ${k} 하위 · 축 점검`, 16000, () => this._at(1200, () => { this._end(id); this._at(2500, cycle); })));
    };
    cycle();
    this._at(4000, () => { // 메인 Bash(전경) → 독립 claude -p
      const tu = `tu_lab_mock_${this.n}_${this.k++}`, cmd = 'claude -p --output-format json "통합 시험"';
      this.emit({ type: 'tool-start', ts: this._ts(), nodeId: m.id, toolUseId: tu, tool: 'Bash', cat: 'shell', text: cmd, brief: cmd });
      const id = 's:labmock11-probe';
      this._add({ id, parentId: m.id, kind: 'claude-p', label: 'claude -p · probe', meta: { toolUseId: tu, cwd: 'D:/code/api-server', command: cmd } });
      this._at(800, () => this._pAgent(id, '독립 세션 하위 · 시험 분석', 22000, () => this._at(1000, () => {
        this._end(id);
        this.emit({ type: 'tool-end', ts: this._ts(), nodeId: m.id, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 25000, text: '{"result":"ok"}', brief: 'exit 0' });
      })));
    });
  }
  _add(node) { const t = this._ts(); this.emit({ type: 'node-add', ts: t, nodeId: node.id, node: { status: 'active', startedAt: t, lastActivityAt: t, ...node } }); }
  _end(id, ok = true) {
    this.emit({ type: 'result', ts: this._ts(), nodeId: id, ok, text: ok ? '완료' : '실패' });
    this.emit({ type: 'node-update', ts: this._ts(), nodeId: id, patch: { status: ok ? 'done' : 'error', endedAt: this._ts() } });
  }
  /** 전경 Agent: 띄운 쪽(pid)의 Agent 도구가 하위가 끝날 때까지 열려 있음 → 하위 node-add · 몇 번 일 · 끝(보고) → Agent 도구 끝 → done() */
  _pAgent(pid, label, life, done) {
    const tu = `tu_lab_mock_${this.n}_${this.k++}`;
    this.emit({ type: 'tool-start', ts: this._ts(), nodeId: pid, toolUseId: tu, tool: 'Agent', cat: 'agent', text: label, brief: label });
    this._at(400, () => {
      const id = `a:labmock${this.n}_${String(++this.bg).padStart(3, '0')}`;
      this._add({ id, parentId: pid, kind: 'subagent', label, meta: { agentType: 'general-purpose', toolUseId: tu } });
      for (let i = 0; i * 2600 + 900 < life - 1000; i++) this._at(900 + i * 2600, () => this._tool(id, i % 2 ? 'Edit' : 'Read', i % 2 ? 'edit' : 'read', `src/axis${i}.js`, null, 1400));
      this._at(life, () => {
        this._end(id);
        this.emit({ type: 'tool-end', ts: this._ts(), nodeId: pid, toolUseId: tu, tool: 'Agent', cat: 'agent', ok: true, durationMs: life, text: '완료', brief: '완료' });
        if (done) done();
      });
    });
  }
}
