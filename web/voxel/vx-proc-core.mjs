// 복셀 오피스 '분리 프로세스 = 생산 라인' 순수 규칙 — three·DOM 없음(node --test: web/test/vx-proc.test.mjs).
// 3D(vx-procs.js)와 2D 평면도(flat/vx2d-proc.js)가 같이 쓴다. 레인 보간·과열 단계·남은 시간·들여다보기 펄스는 공용 job-core 그대로.
//
// 은유: 서브에이전트가 떼어 띄운 프로세스(`meta.proc`)는 서버랙 대신 띄운 직원 사무실 뒤 오른쪽(서버랙 줄 앞) **생산 라인**이다.
//   · 기계(돌아가는 플라이휠·굴뚝·경광등) + 진행 레인마다 컨베이어 한 줄 + 끝에 팔레트. 진행 줄 하나가 오를 때마다 상자 하나가
//     컨베이어로 나와 팔레트에 쌓인다. 팔레트 = 레인 누적값을 두 자리(묶음 × 10U + 낱개 × U, U = 10 의 거듭제곱)로 압축해 쌓은 것.
//   · 기계 위 전광판(자동 진행 작업 `j:<프로세스>:progress` 노드 — 누르면 그 작업): 레인별 보간 숫자·처리율·최장 시간·진행 막대·ETA.
//   · 컨베이어 속도 = 처리율(로그 눈금), 과열(heat) = 굴뚝 김·경고등·기계 외벽 열기, 정체 = 멈칫 + 노란 경고등.
//   · 들여다보기(watch): 읽는 직원이 클립보드를 들고 기계 앞으로 걸어가 전광판을 보고(peek) 체크하고 돌아간다. wait 면 팔짱 끼고 기다림.
//     너무 잦으면(직전 방문 뒤 GAP 안의 peek)·재생 8배속 이상·다른 방이면 걷지 않고 자리에서 빛줄만(desk).
// 좌표: 방 지역(회전 전, 방 원점 기준). 돌린 방은 그리는 쪽이 roomFrame/roomPoint 로 옮긴다.
import { jobLanes, jobLaneValues, jobHeat, heatLevel, jobEtaMs, fmtRate, isJobEndedState, procState, procJobId, jobOf } from '../job-core.mjs';
import { roomPoint } from './office-core.mjs';
import { xfAngle } from './xf.mjs';

const PI = Math.PI;

/**
 * 생산 라인 치수(지역 좌표, 단위 1 ≈ 1m). 서버랙 줄(z −8.4) 앞, 팀장 책상 오른쪽(배치 장치 첫 자리 x 2.25 의 오른쪽).
 * 라인 0(뒤) = 기계 왼쪽 → 컨베이어가 +x 로, 라인 1(앞) = 기계 오른쪽 → −x 로 — 마주 보는 두 줄이라 앞 라인 기계·전광판이
 * 뒤 라인 기계·들여다보는 사람을 가리지 않는다(기본 카메라는 +x+z 쪽 위).
 */
export const BAY = {
  MAX: 2,                 // 사무실마다 생산 라인 수(넘으면 예전처럼 서버랙)
  RACK_MAX: 8,            // 서버랙(+넘친 프로세스)이 랙 한 줄보다 많으면(둘째 줄 z −7.0 이 라인과 겹침) 라인을 쓰지 않는다
  MX: [5.2, 9.15],        // 기계 중심 x
  DIR: [1, -1],           // 컨베이어 방향(+x · −x)
  ZC: [-7.05, -5.45],     // 라인 중심 z(라인 0 = 뒤, 1 = 앞)
  MW: 1.0, MH: 1.2,       // 기계 폭·몸통 높이
  BELT0: 0.62,            // 기계 중심 → 컨베이어 시작
  LEN: 2.93,              // 컨베이어 길이
  PALLET: 4.05,           // 기계 중심 → 팔레트 중심
  LANES: 3,               // 그리는 레인(컨베이어) 수 상한
  DZ: 0.5,                // 레인 간격
  BELT_W: 0.34,           // 벨트 폭
  BOARD_Y: [2.5, 2.05],   // 전광판 중심 높이
  BOARD_W: 1.7, BOARD_H: 0.8,
  SPOT_DX: -0.95, SPOT_DZ: 1.0, // 들여다보는 자리(기계 앞 왼쪽 — 통로 쪽)
};
/** 컨베이어 길이 */
export const BELT_LEN = BAY.LEN;

/** 레인 i(0..n−1) 의 지역 z 오프셋(라인 중심 기준) */
export const laneDZ = (i, n) => (i - (Math.max(1, n) - 1) / 2) * BAY.DZ;
/** 기계 깊이(레인 수에 맞춤) */
export const machineDepth = (n) => Math.max(0.9, Math.min(BAY.LANES, Math.max(1, n)) * BAY.DZ + 0.3);

const slotOf = (slot) => Math.max(0, Math.min(BAY.MAX - 1, slot | 0));
/** 라인 자리(지역): slot → 기계 중심 {x, z, dir} */
export function bayLocal(slot) {
  const s = slotOf(slot);
  return { x: BAY.MX[s], z: BAY.ZC[s], dir: BAY.DIR[s] };
}
/** 라인 모양(기계 중심 mx 기준 — 그리는 쪽이 지역·세계 어디서든): 컨베이어 시작·끝 x, 팔레트 x */
export function bayLine(mx, slot) {
  const d = BAY.DIR[slotOf(slot)];
  return { dir: d, x0: mx + d * BAY.BELT0, x1: mx + d * (BAY.BELT0 + BAY.LEN), px: mx + d * BAY.PALLET };
}

/**
 * 들여다보는 자리(지역): 기계 앞 왼쪽, 전광판 쪽을 본다. 같은 프로세스를 여럿이 보면 i 번째는 왼쪽으로 0.6씩.
 * @returns {{x, z, face}}
 */
export function watchLocal(slot, i = 0) {
  const b = bayLocal(slot);
  const x = b.x + BAY.SPOT_DX - 0.6 * i, z = b.z + BAY.SPOT_DZ;
  return { x, z, face: Math.atan2(b.x - x, b.z - z) };
}

// ───────────── 배치(layout.js computeOffice 가 부름) ─────────────

/**
 * 사무실 기계 자리 나누기 — 분리 프로세스(isProc)는 라인(슬롯 0..MAX−1)을, 나머지·넘치는 것은 서버랙.
 * 이전 자리(prev machine)가 라인이면 그 라인을 지킨다(라인이 튀지 않게).
 * @param procs 이 사무실의 분리 프로세스 노드들
 * @param prevOf (id) → 이전 machine 자리(같은 방) 또는 null
 * @param rackCount 이 사무실의 서버랙 수(라인 아닌 bash-bg) — 랙과 넘친 프로세스가 랙 한 줄(RACK_MAX)을 넘기면 라인 끔(둘째 랙 줄이 라인과 겹침)
 * @returns {{ kind: Map id → 'proc'|'rack', slot: Map id → 라인 번호 }}
 */
export function assignBays(procs, prevOf, rackCount = 0) {
  const kind = new Map(), slot = new Map();
  if (!procs.length) return { kind, slot };
  if (rackCount + Math.max(0, procs.length - BAY.MAX) > BAY.RACK_MAX) { for (const n of procs) kind.set(n.id, 'rack'); return { kind, slot }; }
  const used = new Set(), rest = [];
  // 끝나지 않은 것이 먼저 라인을 받는다(끝난 것은 곧 반납)
  const live = (n) => !(n.status === 'done' || n.status === 'error' || n.status === 'stopped');
  const order = procs.slice().sort((a, b) => (live(b) - live(a)));
  for (const n of order) {
    const pm = prevOf(n.id);
    if (pm && pm.type === 'proc' && Number.isFinite(pm.slot) && pm.slot < BAY.MAX && !used.has(pm.slot)) { used.add(pm.slot); slot.set(n.id, pm.slot); kind.set(n.id, 'proc'); }
    else rest.push(n);
  }
  for (const n of rest) {
    let s = 0; while (used.has(s)) s++;
    if (s < BAY.MAX) { used.add(s); slot.set(n.id, s); kind.set(n.id, 'proc'); } else kind.set(n.id, 'rack');
  }
  return { kind, slot };
}

/** 프로세스 자동 진행 작업(`j:<프로세스>:progress`)인가 — 전광판 자리로 간다 */
export const isProcAutoJob = (n, ownerId) => !!(n && n.meta && n.meta.job && n.meta.job.src === 'auto' && n.id === `j:${ownerId}:progress`);

/** 라인 기계 자리(owner) → 전광판 기준점(세계 = 방 지역 + 원점, rotateOffice 가 나중에 돌림) */
export function boardPos(owner) {
  return { x: owner.x, y: BAY.BOARD_Y[slotOf(owner.slot)], z: owner.z };
}

// ───────────── 컨베이어·팔레트 ─────────────

/** 컨베이어 속도(단위/초): 처리율의 로그 눈금 — 8/s 면 느릿, 1만/s 면 빠름. 모르면 느린 기본 */
export function beltSpeed(rate) {
  const r = Number(rate);
  if (!(r > 0)) return 0.22;
  return Math.max(0.16, Math.min(1.1, 0.16 + 0.22 * Math.log10(1 + r)));
}

/**
 * 팔레트 압축: 누적값 n 을 두 자리로 — U = 10^max(0, ⌊log10 n⌋ − 1), q = ⌊n / U⌋(10..99) → 묶음(×10U) q/10 개 + 낱개(×U) q%10 개.
 * 68,000 → U 1,000 · 묶음 6 · 낱개 8(= '×1000 상자 8개 + ×10000 묶음 6개'), 2,000 → U 100 · 묶음 2 · 낱개 0.
 */
export function palletDigits(n) {
  const v = Math.floor(Number(n) || 0);
  if (v <= 0) return { big: 0, small: 0, unit: 1 };
  const U = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
  const q = Math.floor(v / U);
  return { big: Math.floor(q / 10), small: q % 10, unit: U };
}

/** 팔레트 크기(정사각) · 높이 */
export const PALLET = { W: 0.46, H: 0.1 };
/** 팔레트 위 상자 자리(지역, 팔레트 중심·바닥 기준): 묶음 0.2 상자 2×2 단 → 위에 낱개 0.12 상자 3×3 단. [{dx, dy, dz, s, big}] */
export function palletBoxes(d, out = []) {
  out.length = 0;
  const B = 0.2, S = 0.12;
  let top = PALLET.H + 0.02;
  for (let i = 0; i < d.big; i++) {
    const layer = Math.floor(i / 4), c = i % 4;
    out.push({ dx: (c % 2 ? 0.106 : -0.106), dy: top + layer * (B + 0.008) + B / 2, dz: (c < 2 ? -0.106 : 0.106), s: B, big: true });
  }
  if (d.big) top += Math.ceil(d.big / 4) * (B + 0.008);
  for (let i = 0; i < d.small; i++) {
    const layer = Math.floor(i / 9), c = i % 9;
    out.push({ dx: ((c % 3) - 1) * 0.138, dy: top + layer * (S + 0.006) + S / 2, dz: (Math.floor(c / 3) - 1) * 0.138, s: S, big: false });
  }
  return out;
}

/** 지게차 반출 길이(초)와 모양(t = 시작 뒤 초): 들어옴 → 들어 올림 → 뒤로 빠져 나감. {dx(팔레트 중심 → 지게차 몸통 +x), lift, alpha, carry} */
export const FORK_DUR = 3.4;
export function forkPose(t) {
  // 지게차는 팔레트 오른쪽(+x)에서 포크를 −x 로 향하고 들어와, 들어 올린 뒤 뒤로 빠져 나가며 사라진다(라인 앞 통로를 가로지르지 않게)
  const u = Math.max(0, Math.min(1, t / FORK_DUR));
  const ease = (k) => k * k * (3 - 2 * k);
  if (u < 0.32) { const k = u / 0.32; return { dx: 0.5 + 1.3 * (1 - ease(k)), lift: 0, alpha: Math.min(1, k * 3), carry: false }; }
  if (u < 0.46) { const k = (u - 0.32) / 0.14; return { dx: 0.5, lift: 0.2 * k, alpha: 1, carry: true }; }
  const k = (u - 0.46) / 0.54;
  return { dx: 0.5 + 1.4 * ease(k), lift: 0.2, alpha: k > 0.62 ? Math.max(0, 1 - (k - 0.62) / 0.38) : 1, carry: true };
}

/**
 * 라인 장부(프로세스마다 하나): 레인 값이 오를 때마다 상자를 컨베이어에 올리고, 다 오면 팔레트 값을 올린다.
 * 회차(pass)가 바뀌거나 값이 줄면 · 작업이 끝나면 지게차가 팔레트를 실어 간다. 시각은 벽시계 초(now), 재생 배속은 sync 의 speed.
 */
export class BayFeed {
  constructor() {
    this.lanes = new Map();  // key → {key, ord, n, pass, step, pallet, crates:[{t0, T, value}], off(벨트 무늬 위치), speed}
    this.forks = [];         // [{key, ord, t0, value}]
    this.ended = null;       // 작업이 끝난 벽시계(지게차 한 번)
    this.endState = null;
  }
  clear() { this.lanes.clear(); this.forks = []; this.ended = null; this.endState = null; }

  /**
   * @param job meta.job(없으면 null) · run = 지금 돌아가는가(정체·끝 아님) · now 벽시계 초 · speed 재생 배속 · reduced 움직임 줄이기
   */
  sync(job, run, now, { speed = 1, reduced = false } = {}) {
    const lanes = jobLanes(job).slice(0, BAY.LANES);
    const k = Math.max(1, Math.sqrt(speed || 1));
    lanes.forEach((L, ord) => {
      let r = this.lanes.get(L.key);
      if (!r) { // 처음 보는 레인(스냅샷·첫 관측): 지금 값이 이미 팔레트에
        r = { key: L.key, ord, n: L.n, pass: L.pass || 1, step: null, pallet: L.n, crates: [], off: 0, speed: 0 };
        this.lanes.set(L.key, r);
        return;
      }
      r.ord = ord;
      const pass = L.pass || 1;
      if (pass > r.pass || L.n < r.n) { // 새 회차: 쌓인 팔레트 반출, 새 팔레트에 새 값
        if (r.pallet > 0) this.forks.push({ key: r.key, ord, t0: now, value: r.pallet });
        r.crates.length = 0; r.pallet = 0; r.pass = pass; r.n = L.n; r.step = null;
        if (L.n > 0) this._push(r, L.n, now, L.rate, k, reduced, 0);
        return;
      }
      if (L.n > r.n) {
        const dn = L.n - r.n;
        r.step = r.step ? Math.min(r.step, dn) : dn;
        const m = Math.max(1, Math.min(4, Math.round(dn / r.step)));
        for (let j = 0; j < m; j++) this._push(r, r.n + (dn * (j + 1)) / m, now, L.rate, k, reduced, j * 0.18 / k);
        r.n = L.n;
      }
    });
    // 끝: 컨베이어 위 상자가 다 오면 지게차가 팔레트를 실어 간다(한 번)
    const st = job ? job.state : null;
    if (job && isJobEndedState(st) && this.ended == null) { this.ended = now; this.endState = st; }
    if (job && !isJobEndedState(st)) { this.ended = null; this.endState = null; }
    void run;
  }
  _push(r, value, now, rate, k, reduced, delay) {
    if (reduced) { r.pallet = Math.max(r.pallet, value); return; }
    const T = BELT_LEN / beltSpeed(rate) / k;
    const gap = Math.min(0.9, (0.3 / beltSpeed(rate)) / k);
    const last = r.crates[r.crates.length - 1];
    let t0 = now + delay;
    if (last && t0 < last.t0 + gap) t0 = last.t0 + gap;
    if (r.crates.length >= 12) { if (last) last.value = Math.max(last.value, value); return; } // 넘치면 마지막 상자에 합침
    r.crates.push({ t0, T, value });
  }

  /**
   * 한 프레임: 다 온 상자를 팔레트로, 벨트 무늬 위치를 처리율 속도로, 끝난 작업은 상자가 다 오면 지게차.
   * @param jobLaneRates key → rate(없으면 느린 기본) · run = 벨트가 도는가 · stale = 멈칫(1초에 한 번 살짝)
   */
  step(now, dt, { run = true, stale = false, rates = null, speed = 1, reduced = false } = {}) {
    const k = Math.max(1, Math.sqrt(speed || 1));
    for (const r of this.lanes.values()) {
      while (r.crates.length && now >= r.crates[0].t0 + r.crates[0].T) { r.pallet = Math.max(r.pallet, r.crates[0].value); r.crates.shift(); }
      let v = 0;
      if (!reduced) {
        if (run) v = beltSpeed(rates ? rates.get(r.key) : null) * k;
        else if (stale) { const ph = now % 2.4; v = ph < 0.22 ? 0.5 * Math.sin((ph / 0.22) * PI) : 0; } // 정체: 2.4초마다 멈칫
      }
      r.speed = v;
      r.off += v * dt;
    }
    if (this.ended != null && !this._forked) {
      let busy = false;
      for (const r of this.lanes.values()) if (r.crates.length) busy = true;
      if (!busy && now >= this.ended + 1.2 / k) {
        this._forked = true;
        if (this.endState === 'done') for (const r of this.lanes.values()) if (r.pallet > 0) { this.forks.push({ key: r.key, ord: r.ord, t0: now, value: r.pallet }); r.pallet = 0; }
      }
    }
    if (this.ended == null) this._forked = false;
    if (this.forks.length) this.forks = this.forks.filter((f) => now - f.t0 < FORK_DUR);
  }

  /** 상자 위치 0..1(컨베이어 시작 → 끝), 아직 안 나온 상자는 빼고 */
  cratesOf(key, now, out = []) {
    out.length = 0;
    const r = this.lanes.get(key);
    if (!r) return out;
    for (const c of r.crates) { const u = (now - c.t0) / c.T; if (u >= 0 && u < 1) out.push(u); }
    return out;
  }
  /** 지금 움직이는 것이 있나(2D 다시 그리기) */
  animating(now) {
    if (this.forks.length) return true;
    for (const r of this.lanes.values()) if (r.crates.length || r.speed > 0) return true;
    return this.ended != null && !this._forked && now - this.ended < 4;
  }
}

// ───────────── 기계 표시 모델(3D·2D 공통) ─────────────

/**
 * 라인 기계 상태: procState(running|stale|done|failed|stopped) + 작업(meta.job) → 그림 모델
 * @returns {{ state, run, stale, heat, level, beacon:'off'|'amber'|'red'|'green'|'grey', beaconBlink:number(Hz, 0 = 늘), steam:0..1, glow:0..1, lanes:[…] }}
 */
export function bayModel(pstate, job, nowMs) {
  const st = pstate || 'running';
  const jobEnded = job && isJobEndedState(job.state);
  const ended = st === 'done' || st === 'failed' || st === 'stopped';
  const stale = st === 'stale';
  const run = !ended && !stale;
  const heat = job ? jobHeat(job) : 0;
  const level = heatLevel(heat);
  let beacon = 'off', beaconBlink = 0;
  if (st === 'failed' || (job && job.state === 'failed')) { beacon = 'red'; beaconBlink = 2.2; }
  else if (st === 'stopped') beacon = 'grey';
  else if (st === 'done' || jobEnded) beacon = 'green';
  else if (stale) { beacon = 'amber'; beaconBlink = 1.0; }
  else if (level === 'hot') { beacon = 'red'; beaconBlink = 1.4; }
  else if (level === 'warm') { beacon = 'amber'; beaconBlink = 0.7; }
  return { state: st, run, stale, ended, heat, level, beacon, beaconBlink,
    steam: run ? Math.max(0.15, heat) : 0, glow: run ? heat : 0, lanes: job ? jobLaneValues(job, nowMs) : [] };
}

/** 정수 천 단위 구분 */
export const fmtInt = (v) => (Number.isFinite(v) ? Math.floor(v).toLocaleString('en-US') : '');

/** 남은 시간 짧은 글자(분·시간) — ETA 줄 */
export function etaShort(ms) {
  if (!(ms > 0)) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/**
 * 전광판 내용(3D 캔버스·2D 같은 글): 제목 · 레인 줄(이름 · 보간 값 · 단위 · 처리율, 진행 막대 비율) · 구석(최장 시간) · ETA · 과열
 * @returns {{ title, rows:[{key, value, text, unit, rate, ratio, heat, pass}], corner, eta, heat, level, sig }}
 *   sig = 다시 그릴지 비교할 열쇠(정수 값·처리율·상태가 바뀔 때만 달라짐)
 */
export function boardModel(title, job, pstate, nowMs) {
  const rows = [];
  let corner = '';
  const lanes = job ? jobLaneValues(job, nowMs) : [];
  for (const l of lanes.slice(0, BAY.LANES)) {
    rows.push({ key: l.key, value: l.value, text: fmtInt(l.value) + (l.total ? ' / ' + fmtInt(l.total) : ''), unit: l.unit || '', rate: fmtRate(l.rate), ratio: l.ratio, heat: l.heat, pass: l.pass });
    if (l.last && Number.isFinite(l.last.v) && !corner) corner = `${l.last.k || 'max'} ${l.last.v}${l.last.u || ''}`;
  }
  const etaMs = job ? jobEtaMs(job, nowMs) : null;
  const eta = etaMs != null && etaMs > 0 && !(job && isJobEndedState(job.state)) ? etaShort(etaMs) : '';
  const heat = job ? jobHeat(job) : 0;
  const st = pstate || 'running';
  const sig = [title, st, job ? job.state : '', eta, corner, heat.toFixed(2), ...rows.map((r) => r.key + r.text + r.rate + (r.ratio != null ? Math.round(r.ratio * 200) : '') + r.pass)].join('|');
  return { title, rows, corner, eta, heat, level: heatLevel(heat), state: st, extra: Math.max(0, lanes.length - BAY.LANES), sig };
}

// ───────────── 들여다보기(watch) → 직원 심부름 ─────────────

/** 시간(벽시계 초 — 재생 배속이면 √배속으로 줄임) */
export const WATCHW = {
  GAP: 20,        // 직전 방문이 끝난 뒤 이 안에 온 peek 는 걷지 않고 자리에서(desk)
  LOOK: 2.6,      // 도착 뒤 전광판을 보는 최소 시간(peek)
  LINGER: 2.4,    // 들여다보기가 끝난 뒤 기계 앞에 남는 시간(체크 표시) — 다음 wait 가 곧 오면 그대로 이어진다
  GIVEUP: 14,     // 걸어가다 이만큼 지나도 도착 못 하면 그만
  DESK_HOLD: 1.2, // 자리에서 보기(desk) 끝난 뒤 빛줄 남김
  MAX_TS: 8,      // 이 배속 이상이면 걷지 않음(탕비실과 같은 생각)
  CHECK: 0.9,     // 끝나기 전 체크 손짓 길이
};

/**
 * 들여다보기 계획: WatchTracker.pulses(가상 시계) → 읽는 직원마다 {peer, kind, mode:'walk'|'desk', …}.
 * 걷기(walk)면 렌더러가 직원에게 심부름(errand)을 주고, 도착하면 arrive(from, now) 로 알려 준다.
 */
export class WatchPlanner {
  constructor() {
    this.plans = new Map();   // from → plan
    this.lastEnd = new Map(); // from → 마지막 걷기 방문이 끝난 벽시계
    this._seen = new Set();   // 열림을 못 보고 끝만 본 짧은 peek(재생 빨리 감기) 중복 막기
  }
  clear() { this.plans.clear(); this.lastEnd.clear(); this._seen.clear(); }
  /** 도착 알림(렌더러: 심부름 목표에 서 있음) */
  arrive(from, now) { const p = this.plans.get(from); if (p && p.arrivedAt == null) p.arrivedAt = now; }

  /**
   * @param pulses WatchTracker.pulses(clockMs)
   * @param now 벽시계 초 · clockMs 가상 시계(ms, 짧은 peek 중복 열쇠)
   * @param opts.canWalk(from, peer) → true(같은 방 직원 — 걸어갈 수 있음) | false(직원이지만 못 감) | null(직원 아님 — 계획 없음)
   * @param opts.ts 재생 배속
   * @returns Map from → plan {from, peer, kind, mode, t0, closedAt, arrivedAt, until, progress, open}
   */
  step(pulses, now, clockMs, { canWalk = () => null, ts = 1 } = {}) {
    const k = Math.max(1, Math.sqrt(ts || 1));
    const openBy = new Map();
    for (const p of pulses || []) { // 직원마다 가장 최근에 열린 들여다보기의 프로세스, 그 프로세스에 열린 wait 가 하나라도 있으면 wait
      if (!p.open) continue;
      const cur = openBy.get(p.from);
      if (!cur || p.ageMs < cur.ageMs) openBy.set(p.from, { to: p.to, ageMs: p.ageMs, kind: p.kind });
    }
    for (const p of pulses || []) if (p.open && p.kind === 'wait') { const c = openBy.get(p.from); if (c && c.to === p.to) c.kind = 'wait'; }
    for (const [from, p] of openBy) {
      const cw = canWalk(from, p.to);
      if (cw == null) continue;
      let pl = this.plans.get(from);
      if (pl && pl.peer !== p.to) { this._finish(pl, now); pl = null; }
      if (!pl) {
        const since = now - (this.lastEnd.has(from) ? this.lastEnd.get(from) : -1e9);
        const walk = cw === true && (ts || 1) < WATCHW.MAX_TS && (p.kind === 'wait' || since >= WATCHW.GAP / k);
        pl = { from, peer: p.to, kind: p.kind, mode: walk ? 'walk' : 'desk', t0: now, closedAt: null, arrivedAt: null, until: Infinity, progress: false, open: true };
        this.plans.set(from, pl);
      }
      if (p.kind === 'wait') pl.kind = 'wait';
      if (cw !== true && pl.mode === 'walk') pl.mode = 'desk'; // 방이 바뀜 등
      pl.closedAt = null; pl.open = true; pl.until = Infinity;
    }
    // 열림을 못 본 짧은 peek(끝만 들어옴): 막 끝난 펄스로 닫힌 계획을 하나 만든다
    for (const p of pulses || []) {
      if (p.open || p.ageMs > 400 || this.plans.has(p.from)) continue;
      const key = `${p.from}|${p.to}|${Math.round((clockMs - p.ageMs) / 100)}`;
      if (this._seen.has(key)) continue;
      this._seen.add(key);
      if (this._seen.size > 64) this._seen.clear();
      const cw = canWalk(p.from, p.to);
      if (cw == null) continue;
      const since = now - (this.lastEnd.has(p.from) ? this.lastEnd.get(p.from) : -1e9);
      const walk = cw === true && (ts || 1) < WATCHW.MAX_TS && since >= WATCHW.GAP / k;
      this.plans.set(p.from, { from: p.from, peer: p.to, kind: p.kind, mode: walk ? 'walk' : 'desk', t0: now, closedAt: now, arrivedAt: null, until: Infinity, progress: !!p.progress, open: false });
    }
    // 닫힘·끝
    for (const pl of [...this.plans.values()]) {
      if (openBy.has(pl.from) && openBy.get(pl.from).to === pl.peer && canWalk(pl.from, pl.peer) != null) continue;
      if (pl.open) { pl.open = false; pl.closedAt = now; }
      for (const p of pulses || []) if (!p.open && p.from === pl.from && p.to === pl.peer && p.progress) pl.progress = true;
      if (pl.mode === 'walk') {
        const look = pl.arrivedAt != null ? pl.arrivedAt + WATCHW.LOOK / k : Infinity;
        pl.until = Math.max(pl.closedAt + WATCHW.LINGER / k, look);
        if (pl.arrivedAt == null && now - pl.t0 > WATCHW.GIVEUP) pl.until = now;
      } else pl.until = pl.closedAt + WATCHW.DESK_HOLD;
      if (now >= pl.until) this._finish(pl, now);
    }
    return this.plans;
  }
  _finish(pl, now) {
    this.plans.delete(pl.from);
    if (pl.mode === 'walk') this.lastEnd.set(pl.from, now);
  }
}

/**
 * 심부름 자세 단계(3D·2D 같은 규칙): 걷는 중 'walk' · 기다림(wait 열림) 'wait' · 전광판 보기 'look' · 끝나기 직전 체크 'check'
 */
export function watchPhase(plan, now, arrived) {
  if (!plan) return null;
  if (!arrived) return 'walk';
  if (plan.open && plan.kind === 'wait') return 'wait';
  if (Number.isFinite(plan.until) && plan.until - now < WATCHW.CHECK) return 'check';
  return 'look';
}

/** 전광판 방향: 기준 face(라인 앞 = +z)에서 카메라 쪽으로 ±60° 안. 뒤쪽이면 뒤로 돌린 면(양면 판)을 맞춘다 → {yaw, back} */
export function boardYaw(face, camYaw, lim = PI / 3) {
  const wrap = (a) => ((a + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;
  if (!Number.isFinite(camYaw)) return { yaw: face, back: false };
  let d = wrap(camYaw - face), back = false;
  if (Math.abs(d) > PI / 2) { d = wrap(d - PI); back = true; }
  return { yaw: face + (back ? PI : 0) + Math.max(-lim, Math.min(lim, d)), back };
}

// ───────────── 3D·2D 공통 프레임 단계(렌더러 모양만 같으면 됨) ─────────────
// view = { chars: Map, machines: Map(m.pos·m.node·m.released), roomsById: Map, ts }, nodeOf(id) → 노드

/** 라인 자리 기계(없으면 null) */
export const bayMachine = (view, id) => { const m = view.machines.get(id); return m && m.pos && !m.released && m.pos.type === 'proc' ? m : null; };

/**
 * 들여다보기 → 직원 심부름: 같은 방 직원만 걸어감(라인 자리여야), 그 밖(다른 방·서버랙 자리·백그라운드 셸·Monitor)은 빛줄만(desk).
 * 의뢰인 창구 심부름이 걸려 있으면 그쪽이 먼저. @returns 심부름 준 직원 수
 */
export function watchErrands(view, plan, pulses, now, clockMs) {
  const canWalk = (from, peer) => {
    const ch = view.chars.get(from);
    if (!ch) return null;
    if (ch.state === 'gone' || ch.state === 'leave' || !ch.room || ch.offstage || ch.endAt != null) return false;
    const m = bayMachine(view, peer);
    return !!(m && m.pos.roomId === ch.room.id);
  };
  const plans = plan.step(pulses, now, clockMs, { canWalk, ts: view.ts });
  let er = 0;
  const idx = new Map();
  for (const pl of plans.values()) {
    const ch = view.chars.get(pl.from);
    if (!ch || pl.mode !== 'walk') continue;
    if (ch.errand && ch.errand.kind !== 'watch' && ch.errand.until > now) continue;
    const m = bayMachine(view, pl.peer);
    if (!m) continue;
    const room = view.roomsById.get(m.pos.roomId);
    if (!room) continue;
    const i = idx.get(pl.peer) || 0; idx.set(pl.peer, i + 1);
    const L = watchLocal(m.pos.slot, i);
    const sp = ch._watchSpot || (ch._watchSpot = {});
    roomPoint(room, L.x, L.z, false, sp);
    sp.face = L.face + xfAngle(room.xf && room.local ? room.xf : null);
    ch.errand = { spot: sp, until: now + 0.4, kind: 'watch', w: pl };
    const arrived = ch.target && ch.target.type === 'errand' && (ch.state === 'seated' || ch.state === 'work') && Math.hypot(ch.pos.x - sp.x, ch.pos.z - sp.z) < 0.05;
    if (arrived) plan.arrive(pl.from, now);
    er++;
  }
  return er;
}

/** 라인 장부 한 프레임(모든 라인 기계): 레인 값 → 상자·팔레트·지게차. @returns {bays, crates} */
export function stepFeeds(view, feeds, nodeOf, now, dt, reduced = false) {
  let nb = 0, nc = 0;
  const rates = new Map();
  for (const m of view.machines.values()) {
    if (!m.pos || m.pos.type !== 'proc' || m.released) continue;
    nb++;
    let f = feeds.get(m.id);
    if (!f) { f = new BayFeed(); feeds.set(m.id, f); }
    const jn = nodeOf(procJobId(m.node));
    const job = jn ? jobOf(jn) : null;
    const ps = procState(m.node);
    f.sync(job, ps === 'running', now, { speed: view.ts, reduced });
    rates.clear();
    if (job && Array.isArray(job.lanes)) for (const l of job.lanes) rates.set(l.key, l.rate);
    f.step(now, dt, { run: ps === 'running' && !!job && job.state === 'running', stale: ps === 'stale', rates, speed: view.ts, reduced });
    for (const r of f.lanes.values()) nc += r.crates.length;
  }
  for (const id of [...feeds.keys()]) if (!bayMachine(view, id)) feeds.delete(id);
  return { bays: nb, crates: nc };
}
