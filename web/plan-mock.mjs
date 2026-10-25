// ?mock=1 의 계획 보드 시나리오. 서버 PlanTracker 가 내는 meta.plans 와 같은 꼴을 node-update 로 넣는다.
// 메인 = 할 일(TodoWrite) · 서브에이전트 일부 = 작업 목록(Task) · 기동기/러너 = 단계 설계서(회차가 단계를 하나씩 닫음, 항목에 회차 번호) ·
// 워크플로 = 단계. 결정적(시드 8282), 첫 갱신 1.5초 뒤 2.2～3.4초마다 한 노드씩 한 걸음(시작·완료·추가·삭제).
const TODO = ['transcript 계획 출처 조사', '서버 모델 정규화', '라이브·재생 같은 이벤트', '보드 그리기(3D·2D)', '상세 팝업 목록', '⚙ 켬/끔', '시험·fps 측정', '계약·스킬 갱신'];
const TASKS = ['격자 배치 수리', '라벨 겹침 확인', '헤드리스 스크린샷', '성능 재기'];
const PHASES = ['단계 0 — 재측정', '단계 1 — ADR · 배선', '단계 2 — 재현(로컬)', '단계 3 — 배포 · 검증 회차', '단계 4 — 처분'];
const WF = ['Design', 'Build', 'Integrate', 'Verify', 'Package'];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

export class PlanMockDriver {
  constructor({ nodes, emit, seed = 8282, first = 1500 } = {}) {
    this.nodes = nodes; this.emit = emit; this.r = rng(seed); this.first = first;
    this.timers = new Set(); this.on = false; this.plans = new Map(); this.k = 0;
  }
  _at(ms, fn) { const t = setTimeout(() => { this.timers.delete(t); if (this.on) fn(); }, ms); this.timers.add(t); }
  start() { if (this.on) return; this.on = true; this._at(this.first, () => { this._seed(); this._tick(); }); }
  stop() { this.on = false; for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  _kindOf(n) {
    if (n.meta && (n.meta.launcher || n.meta.runner)) return 'phases';
    if (n.kind === 'workflow') return 'workflow';
    if (n.kind === 'main') return 'todo';
    if (n.kind === 'subagent' && parseInt(hash(n.id).slice(0, 2), 16) % 3 === 0) return 'tasks';
    return null;
  }
  _make(n, src, now) {
    const list = src === 'todo' ? TODO.slice(0, 5 + (parseInt(hash(n.id).slice(2, 4), 16) % 4)) : src === 'tasks' ? TASKS : src === 'phases' ? PHASES : WF;
    const items = list.map((t, i) => ({ k: hash(n.id + t).slice(0, 8), t, s: i === 0 && src !== 'phases' ? 'in_progress' : 'pending', at: now }));
    if (src === 'phases') items[items.length - 1].hold = 1; // 마지막 단계는 외부 대기(⏸)로 시작
    const title = src === 'todo' ? '할 일' : src === 'tasks' ? '작업 목록' : src === 'phases' ? '2026-10-24-plan-board-execution-design.md' : n.label || '워크플로';
    return { id: 'p' + hash(n.id + src), src, title, at: now, by: n.id, n: items.length, items };
  }
  _emit(n, p) {
    p.n = p.items.length;
    this.emit({ type: 'node-update', ts: new Date().toISOString(), nodeId: n.id, patch: { meta: { plans: [{ ...p, items: p.items.map((x) => ({ ...x })) }] } } });
  }
  _seed() {
    const now = Date.now();
    for (const n of this.nodes()) {
      if (this.plans.has(n.id)) continue;
      const src = this._kindOf(n);
      if (!src) continue;
      const p = this._make(n, src, now);
      this.plans.set(n.id, p);
      this._emit(n, p);
    }
  }
  _tick() {
    this._seed();
    const now = Date.now();
    const live = [...this.nodes()].filter((n) => this.plans.has(n.id) && n.status !== 'done' && n.status !== 'error' && n.status !== 'stopped');
    if (live.length) {
      const n = live[Math.floor(this.r() * live.length)];
      const p = this.plans.get(n.id);
      let by = n.id, cy;
      if (p.src === 'phases') { // 진행 중 회차가 다음 단계를 닫음
        const cyc = [...this.nodes()].filter((c) => c.parentId === n.id && c.kind === 'claude-p' && c.status === 'active').pop();
        if (cyc) { by = cyc.id; cy = cyc.meta && cyc.meta.cycle; }
      }
      const i = p.items.findIndex((x) => x.s !== 'done');
      const roll = this.r();
      if (i < 0) { // 다 끝남 → 처음부터 다시(보기용)
        for (const x of p.items) { x.s = 'pending'; delete x.cy; delete x.by; x.at = now; }
        if (p.src === 'phases') p.items[p.items.length - 1].hold = 1;
      } else if (p.src === 'todo' && roll < 0.12 && p.items.length < 10) {
        const t = `추가 확인 ${++this.k}`; p.items.push({ k: hash(n.id + t).slice(0, 8), t, s: 'pending', at: now });
      } else if (p.src === 'todo' && roll < 0.18 && p.items.length > 4) {
        p.items.splice(p.items.length - 1, 1);
      } else {
        const x = p.items[i];
        x.s = x.s === 'pending' ? 'in_progress' : 'done'; x.at = now; x.by = by; if (cy != null) x.cy = cy; delete x.hold; // 단계도 진행 → 완료 두 걸음
        if (x.s === 'done' && p.src !== 'phases' && p.items[i + 1]) { p.items[i + 1].s = 'in_progress'; p.items[i + 1].at = now; p.items[i + 1].by = by; }
      }
      p.at = now; p.by = by; if (cy != null) p.cy = cy;
      this._emit(n, p);
    }
    this._at(2200 + this.r() * 1200, () => this._tick());
  }
}
