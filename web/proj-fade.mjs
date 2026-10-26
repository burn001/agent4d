// 단일 프로젝트 선택 페이드(순수 — three·DOM 없이 node --test 로 시험).
// 전체 보기에서 프로젝트를 고르면 다른 프로젝트에 속한 모든 것(노드·연결선·라벨·홀로그램·작업 대상 층·계획 보드·섬)이
// PROJ_FADE.DUR 초 동안 투명해지고, 다 사라지면 실제로 숨긴다(그리기·클릭·레이캐스트·라벨 충돌 계산에서 빠짐).
// 전체로 돌아오면 거꾸로 나타난다. 여섯 렌더러(흐름·Planet·복셀 × 3D·2D)가 이 상태 하나를 같은 규칙으로 읽는다.

export const PROJ_FADE = { DUR: 0.5 };

/** 0..1 → 0..1 부드러운 곡선(양끝 느리게) */
export const fadeEase = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class ProjFade {
  constructor(dur = PROJ_FADE.DUR) {
    this.dur = dur;
    this.focus = null;
    this.hide = new Set(); // 표시 고르기로 숨긴 키(프로젝트 id · 세션 루트 노드 id 's:<sid>')
    this.t = new Map(); // pid → 선형 진행 0(안 보임)..1(보임) — 목표에 닿은 '보임'은 지운다
    this.ver = 0;       // 값이 바뀔 때마다 +1(그리기 쪽이 다시 칠할지 판단)
  }
  /** 목표: 고른 프로젝트가 없으면 모두 보임, 있으면 그 프로젝트(또는 소속 없는 것)만 보임 */
  target(pid) {
    if (pid != null && this.hide.has(pid)) return 0;
    return !this.focus || pid == null || pid === this.focus || String(pid).startsWith('s:') ? 1 : 0;
  }
  /** 숨길 키 바꾸기(프로젝트 id·'s:<sid>'). 바뀐 키는 지금 자리 값에서 이어 움직인다 */
  setHidden(keys, { instant = false } = {}) {
    const nh = new Set(keys || []);
    if (nh.size === this.hide.size && [...nh].every((k) => this.hide.has(k))) return false;
    const touched = new Set([...this.hide, ...nh]);
    const cur = new Map([...touched].map((k) => [k, this.lin(k)]));
    this.hide = nh;
    for (const [k, x] of cur) {
      const g = this.target(k);
      if (instant || x === g) this.t.delete(k); else this.t.set(k, x);
    }
    this.ver++;
    return true;
  }
  /**
   * 고른 프로젝트 바꾸기. pids = 지금 화면에 있는 프로젝트들(그 자리에서 이어서 움직인다).
   * instant = 애니메이션 없이 바로(처음 열 때·표현 전환 직후)
   */
  setFocus(fp, pids = [], { instant = false } = {}) {
    fp = fp || null;
    if (fp === this.focus) return false;
    const cur = new Map();
    for (const p of [...pids, ...this.hide]) if (p != null) cur.set(p, this.lin(p));
    this.focus = fp;
    this.t.clear();
    if (!instant) for (const [p, x] of cur) if (x !== this.target(p)) this.t.set(p, x);
    this.ver++;
    return true;
  }
  /** 선형 진행(0..1) */
  lin(pid) { return pid == null ? 1 : this.t.has(pid) ? this.t.get(pid) : this.target(pid); }
  /** 투명도 배율 0..1(부드러운 곡선) */
  alpha(pid) { return fadeEase(this.lin(pid)); }
  /** 나가는 중이거나 이미 숨김 — 클릭·카메라 후보에서 바로 뺀다 */
  out(pid) { return this.target(pid) === 0; }
  /** 다 사라짐 — 실제로 숨긴다 */
  gone(pid) { return this.target(pid) === 0 && this.lin(pid) <= 0; }
  /** 프로젝트·세션 루트 둘 다 따진 투명도(둘 중 옅은 쪽) */
  alpha2(pid, rid) { const a = this.alpha(pid); return rid && this.hide.size ? Math.min(a, this.alpha(rid)) : a; }
  /** 움직이는 중인가 */
  get busy() { return this.t.size > 0 && [...this.t].some(([p, x]) => x !== this.target(p)); }
  /** dt 초 진행. 바뀐 값이 있으면 true */
  step(dt) {
    if (!this.t.size) return false;
    const d = this.dur > 0 ? Math.max(0, dt) / this.dur : 1;
    let ch = false;
    for (const [p, x] of [...this.t]) {
      const g = this.target(p);
      const nx = g > x ? Math.min(g, x + d) : Math.max(g, x - d);
      if (nx !== x) ch = true;
      if (nx === g && g === 1) this.t.delete(p); else this.t.set(p, nx);
    }
    if (ch) this.ver++;
    return ch;
  }
}

/**
 * 단일 프로젝트 모드에서 빈 곳 클릭의 뜻(순수). 풀리는 것은 그 프로젝트 영역 바깥 빈 곳뿐.
 * @param {{focus:string|null, area:string|null, popup:boolean}} s focus = 고른 프로젝트, area = 클릭 점이 든 프로젝트 영역(그 프로젝트만 판정)
 * @returns {'all'|'close'|'clear'} all = 전체 모드로, close = 열린 팝업만 닫기, clear = 노드 필터·포커스만 풀기
 */
export function blankClickAction({ focus = null, area = null, popup = false } = {}) {
  if (focus && area !== focus) return 'all';
  return popup ? 'close' : 'clear';
}

/**
 * 노드에 붙는 연출(충돌 곡선·상호작용 연출·띄움 점선·모니터 등)이 이 노드를 쓸 수 있나(순수).
 * 숨김·고정 희미(recent, scopeD < 0.5)·다 사라짐만 빼고, 페이드 중인 노드는 그대로 쓴다 — 투명도는 fxAlpha 를 곱해
 * 문턱(scopeK < 0.5)으로 페이드 중간에 한 번에 꺼지거나 켜지지 않게 한다.
 */
export function fxShown(v) {
  return !!v && !v.gone && !v.hidden && (v.scopeD ?? 1) >= 0.5 && (v.projA ?? 1) > 0;
}
/** 노드 여럿에 걸친 연출의 프로젝트 투명도 = 가장 옅은 쪽(projA, 없으면 1) */
export function fxAlpha(...vs) {
  let a = 1;
  for (const v of vs) { const p = v && v.projA != null ? v.projA : 1; if (p < a) a = p; }
  return a < 0 ? 0 : a;
}

/**
 * 영역 판정 시점: 누른 순간(pointerdown)에 잰 판정이 있고 같은 표현·같은 고른 프로젝트면 그것을 쓴다(자동 카메라가
 * 손 떼기 전까지 움직여도 누른 자리 기준). 없으면 undefined → 부르는 쪽이 지금 다시 잰다.
 * @param {{view?:any, fp?:string|null, area?:string|null}|null} down
 */
export function areaAtDown(down, view, fp) {
  if (!down || !('area' in down) || down.view !== view || (down.fp || null) !== (fp || null)) return undefined;
  return down.area;
}
