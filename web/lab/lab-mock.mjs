// 【리드·QA】 연구소 mock 시나리오(설계 M1～M10) — 순수(DOM·three 없음, 타이머만). 화면 확인 URL: ?mock=1&view=lab&labmock=<n>.
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
    this.nodes = nodes; this.emit = emit; this.n = Math.max(1, Math.min(10, scenario | 0 || 1));
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
  _bg(parentId, command, { life = 20000, end = 'done', kind = 'bash-bg', rc = null, quiet = false } = {}) {
    const id = `b:labmock${this.n}_${String(++this.bg).padStart(3, '0')}`;
    const node = { id, parentId, kind, label: command, status: 'active', startedAt: this._ts(), lastActivityAt: this._ts(), meta: { command, background: true } };
    this.emit({ type: 'node-add', ts: this._ts(), nodeId: id, node });
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
  _m1(m) { LAB_MOCK_RIGS.forEach(([, cmd], i) => this._at(i * 350, () => this._bg(m.id, cmd, { life: 120000, kind: cmd.startsWith('tail') ? 'monitor' : 'bash-bg' }))); }
  // M2 부하: 폴더 14 × 파일 쓰기 연속(구역 상한 12 → '…')
  _m2(m) {
    let i = 0;
    const step = () => { const who = this._pick(this._live()) || m; const d = `pkg${i % 14}/sub${(i >> 3) % 3}`; this._tool(who.id, 'Write', 'edit', `${d}/f${i}.ts`, [F(`${d}/f${i}.ts`, 'write', { sz: 4 })], 300); i++; if (i < 220) this._at(180, step); };
    step();
  }
  // M3 위험 동작: rm -rf · DROP · force push 를 돌아가며
  _m3(m) {
    const D = [
      ['Bash', 'rm -rf build/cache', [F('build/cache', 'delete', { est: 1, x: 'rm' })]],
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
    this._bg(m.id, 'npm test', { life: 9000, end: 'done' });
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
}
