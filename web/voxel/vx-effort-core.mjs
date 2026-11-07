// 복셀 오피스·연구소 추론 effort = 캐릭터 옷차림 + 자리 분위기 (복셀, 2026-11-06 사용자 결정 "옷차림이나 분위기로")
// 순수 규칙(three·DOM 없음, web/test/vx-effort.test.mjs). 공용 규칙(단계·확정/요청·보간)은 ../effort-core.mjs.
//   - 복셀 예외: 메인(팀장)도 하위 캐릭터와 같은 언어로 입는다(다른 표현의 '메인은 글만'과 다름). 팀장 이름표에는 effort 글이 없다.
//   - 시각 단계 4개(effort-core EFFORT_TIER): low · medium · high · xhigh·max(사용자 결정 2026-11-06 — xhigh 와 max 는 같은 차림·같은 책상).
//   - 옷 사다리(한 단계 = 한 겹). medium 은 지금 모습 그대로.
//       공통    low 목에 건 헤드폰 + 슬리퍼(맨 위의 '머리에 쓴 헤드셋'과 짝 — 내려놓음 ↔ 씀)
//       오피스  low 반팔·반바지(팀장은 재킷·넥타이를 벗은 셔츠 바람) · high 셔츠 + 조끼(팀장은 재킷을 벗은 조끼 바람)
//               · xhigh·max 조끼 위 재킷 + 넥타이, 같은 색 정장 한 벌 + 헤드셋(팀장 = 쓰리피스 + 헤드셋)
//       연구소  low 오피스와 같음 · high 실험복을 열어 걸침 · xhigh·max 실험복 잠금 + 고글(눈) + 장갑 + 마스크
//   - 자리 분위기(책상 소품 밀도·스탠드 색온도): low 캔 하나 · medium 지금(빈 책상) · high 머그 + 서류 한 묶음 + 따뜻한 스탠드
//       · xhigh·max 머그 둘 + 서류 세 더미 + 메모지 + 차가운 주광 스탠드
//   - 색: 단계 옷은 무채·저채도(차콜·네이비·흰 셔츠·실험복 흰색) — 상태색(hue)·과열(호박→빨강 물듦·김)과 겹치지 않는다.
//     종류 색은 로고·주머니 펜·조끼 핀으로 남긴다. 스탠드 색은 채도 낮은 백색 계열(과열 호박과 구별).
//   - 요청값만(응답 전) = 같은 차림을 옅게(옷 색을 배경 쪽으로 GHOST), 확정되면 0.4초에 걸쳐 진해짐(GHOST_STEPS 단계로 나눠 다시 만듦).
//   - 알 수 없음(미지정·모르는 단계 이름)·대상 아닌 종류 = null → 지금 모습.
import { effortOf, effortKindOf, effortInstant } from '../effort-core.mjs';
import { hash32 } from './appearance-core.mjs';

/** 옷·소품을 바꾸는 노드 종류(복셀 예외: 메인 포함) */
export const VX_EFF_KINDS = new Set(['main', 'subagent', 'workflow-agent', 'claude-p']);

export const VX_EFF = {
  GHOST: 0.4,          // 요청값만: 단계 옷·소품 색을 배경(옷)·상판(소품) 쪽으로 이만큼
  GHOST_STEPS: 4,      // 확정 보간(0.4초)을 이만큼 나눠 외형을 다시 만듦(매 프레임 색 객체를 만들지 않음)
  LAB_PROP_BOXES: 240, // 연구소 책상 소품 동적 상자 예산(넘으면 그 뒤 책상은 소품 생략 — 옷은 그대로)
};

/** 단계 옷 색(무채·저채도, 다크·라이트 공용 중간 명도) */
export const EFF_HEX = {
  jacket: ['#2f3642', '#2a3550', '#3a3b40', '#463f38'],  // 차콜·네이비·흑연·토프
  vest: ['#5a606c', '#6a5e52', '#4f5a58', '#5e5868'],    // 재킷보다 밝게(재킷 안에서도 보이게)
  shirt: ['#eef1f5', '#dde7f2', '#ebe6dc'],              // 흰색·연하늘·생지
  tie: ['#2a3550', '#5a3440', '#3d4a3e', '#4a4458', '#5c5346'], // 짙은 저채도(오류 빨강·상태색과 다름)
  oxford: ['#15171c', '#2a1d16', '#3a2a20'],
  coat: '#e7ebef', coatShade: '#c9d0d8',                // 실험복
  goggle: '#3a4048', lens: '#b9c6cf',                    // 고글 테·렌즈
  glove: '#c3ccd8', mask: '#e3e7eb',                     // 장갑(옅은 회청)·마스크
  headset: '#2a2d33', mic: '#5a606a',
  neckPhones: '#7d838e',                                 // 목에 건 헤드폰(중간 회색 — 다크·라이트 둘 다 머리색·옷과 구별)
  slide: '#3a3f48',                                      // 슬리퍼 바닥
  can: ['#8a9aa8', '#a89a8a', '#8aa09a'],                // 캔(옅은 저채도)
  lamp: { 3: '#ffe6c8', 4: '#e6eeff' },                 // 스탠드 색온도: high 3000K 따뜻 · xhigh·max 6500K 주광(채도 낮게)
};

/**
 * 노드의 복셀 effort 시각 단계 또는 null. { level 1～4(xhigh·max = 4), confirmed }.
 * 대상 종류(메인 포함)이고 단계를 알 때만. 요청값만이면 confirmed false.
 */
export function vxEffort(node) {
  if (!node || !VX_EFF_KINDS.has(effortKindOf(node))) return null;
  const e = effortOf(node);
  if (!e || e.level == null) return null;
  return { level: e.level, confirmed: e.confirmed };
}

/** 확정 정도(0 요청 → 1 확정) → 옅게 비율(GHOST_STEPS 로 끊음, 0 = 진함) */
export function ghostOf(conf) {
  const c = Math.max(0, Math.min(1, Number.isFinite(conf) ? conf : 1));
  const q = Math.round((1 - c) * VX_EFF.GHOST_STEPS) / VX_EFF.GHOST_STEPS;
  return Math.round(q * VX_EFF.GHOST * 1000) / 1000;
}

/**
 * 그릴 값(프레임마다). tw = EffortTween(노드 id 별), nowMs, opts = { reduced, rate }.
 * 반환 { level, ghost(0～GHOST, 끊은 값), busy } 또는 null(지금 모습).
 * 단계 바뀜은 옷을 바로 갈아입는다(옷이 섞이는 중간 모습은 없음). 확정 순간만 옅음 → 진함 보간.
 */
export function vxEffortState(node, tw, nowMs, { reduced = false, rate = 1 } = {}) {
  const e = vxEffort(node);
  const id = node && node.id;
  if (!e) { if (tw && id != null) tw.forget(id + '|vx'); return null; }
  const instant = effortInstant({ reduced, rate });
  const target = e.confirmed ? 1 : 0;
  const conf = tw ? tw.value(id + '|vx', target, nowMs, { instant }) : target;
  const busy = !!tw && tw.busy(id + '|vx', nowMs);
  return { level: e.level, ghost: ghostOf(conf), busy };
}

/** 외형 캐시 열쇠(같으면 다시 만들지 않음) */
export const effKey = (st, venue) => (st ? `${st.level}:${st.ghost}:${venue}` : '');

/**
 * 외형(appearance-core 결과 A) + 단계 → 갈아입은 외형(새 객체, A 는 그대로). medium·null·운영자·손님은 A 그대로.
 * venue = 'office' | 'lab'. 덧붙는 칸(그리는 쪽이 읽음):
 *   jacket: true(재킷을 입힘, topC = 재킷 색 · top2C = 셔츠) | false(재킷을 벗김, topC = 셔츠) | undefined(역할 기본)
 *   waist(조끼 색) · coat('open'|'closed') · coatC · goggle('brow'|'eyes') · glove · mask · headset · neckPhones(목에 건 헤드폰 색) — 없으면 null/false
 */
export function dress(A, level, { venue = 'office' } = {}) {
  if (!A || !level || level === 2) return A;
  if (A.cls !== 'formal' && A.cls !== 'casual') return A;
  const formal = A.cls === 'formal', F = A.sex === 'f';
  const h = hash32((A.sig || '') + '|' + A.skin + '|' + A.hair + '|eff');
  const pick = (arr, k = 0) => arr[(h >>> k) % arr.length];
  const D = { ...A, eff: level, venue, jacket: undefined, waist: null, coat: null, coatC: null, goggle: null, glove: false, mask: false, headset: false, neckPhones: null };
  const noDress = () => { if (D.bottom === 'dress') { D.bottom = 'skirt'; if (!D.legC) D.legC = A.skin; } };
  if (level === 1) { // 편한 차림 — 한 겹 벗고 슬리퍼, 헤드폰은 목에(머리에 쓴 헤드폰도 내려 걺)
    D.shoe = 'slide'; D.shoeC = A.shoeC; D.neckPhones = A.phones || EFF_HEX.neckPhones; D.phones = null;
    if (formal) { D.top = 'shirt'; D.topC = A.top2C; D.jacket = false; D.neck = null; D.neckC = null; }
    else {
      if (A.top !== 'dress') D.top = 'tee';
      if (A.bottom !== 'skirt' && A.bottom !== 'dress') D.bottom = 'shorts';
      D.pack = null;
    }
    return D;
  }
  if (venue === 'lab') { // 연구소: 실험복 사다리(안 옷은 그대로 — 열린 앞섶·깃 사이로 보임)
    D.coat = level === 3 ? 'open' : 'closed'; D.coatC = EFF_HEX.coat; D.pack = null;
    if (level >= 4) { D.hat = null; D.hatC = null; D.phones = null; D.goggle = 'eyes'; D.glove = true; D.mask = true; D.glasses = null; }
    return D;
  }
  // 오피스 high 이상
  const shirtC = formal ? A.top2C : pick(EFF_HEX.shirt);
  D.waist = pick(EFF_HEX.vest, 3);
  noDress();
  if (level === 3) { // 셔츠 + 조끼(팀장은 재킷을 벗은 조끼 바람, 넥타이는 그대로)
    D.top = 'shirt'; D.topC = shirtC; D.top2C = shirtC; D.jacket = false;
    if (!formal) { D.neck = null; D.neckC = null; }
    return D;
  }
  // xhigh·max(맨 위): 조끼 위 재킷 + 넥타이, 같은 색 정장 한 벌 + 헤드셋(팀장 = 쓰리피스 + 헤드셋)
  D.top = 'suit3'; D.headset = true;
  if (!formal) {
    D.jacket = true; D.topC = pick(EFF_HEX.jacket, 6); D.top2C = shirtC;
    D.neck = F ? 'bow' : 'tie'; D.neckC = pick(EFF_HEX.tie, 9);
    if (D.bottom !== 'skirt') D.bottom = 'slacks';
    D.bottomC = D.topC; D.shoe = F ? 'loafer' : 'oxford'; D.shoeC = pick(EFF_HEX.oxford, 12);
  }
  D.hat = null; D.hatC = null; D.phones = null; D.pack = null; D.hairAcc = A.hairAcc;
  return D;
}

/** 이 외형이 재킷(정장·외투)을 입었나 — 역할 기본(팀장·별관·손님)과 dress 의 jacket 칸 */
export function jacketOn(D, role) {
  if (!D) return false;
  if (D.jacket === true) return true;
  if (D.jacket === false) return false;
  return role === 'lead' || role === 'annex' || role === 'guest';
}

/** 2D 위에서 본 어깨 원 색: 실험복 > 재킷 > 조끼 > 윗옷 */
export function body2D(D, role) {
  if (!D) return null;
  if (D.coat) return D.coatC;
  if (jacketOn(D, role)) return D.topC;
  if (D.waist) return D.waist;
  return D.topC;
}

/**
 * 책상 소품(자리 분위기). 지역 좌표: u = 직원 기준 왼쪽(+)·오른쪽(−), v = 앞(모니터 쪽 +), y = 상판 위 높이(가운데).
 * 오른쪽 무리 = 스탠드(뒤)·머그(앞), 왼쪽 무리 = 서류 더미(앞·뒤). 가운데(손·홀로그램 모니터)와 뒤 가운데(발광대)는 비운다.
 * hw = 상판 반폭, lampAt = 이미 있는 정적 스탠드 자리 {u, v}(오피스 팀장 책상 — 기둥·갓 없이 전구만 켬, 소품은 안쪽으로).
 * 반환 { items: [{ u, v, y, sx, sy, sz, c, glow }], lamp: 색온도 hex | null, boxes }
 *   c = 팔레트 이름('mug'·'coffee'·'paper'·'metalDark') 또는 '#hex'. glow = 빛 묶음(bulb 켜진 갓·전구 · pool 상판 빛 웅덩이), pole = 스탠드 기둥.
 */
export function deskProps(level, { hw = 0.65, lampAt = null } = {}) {
  const items = [];
  if (!level || level === 2) return { items, lamp: null, boxes: 0 };
  const edge = lampAt ? Math.min(hw - 0.45, 0.55) : hw - 0.16; // 소품 무리 중심(양 끝)
  const R = -edge, Lf = edge;
  const mug = (u, v) => { items.push({ u, v, y: 0.055, sx: 0.1, sy: 0.11, sz: 0.1, c: 'mug' }, { u, v, y: 0.106, sx: 0.075, sy: 0.012, sz: 0.075, c: 'coffee' }); };
  const papers = (u, v, n) => { // n 겹 더미 — 위로 갈수록 조금 좁고 어긋남
    for (let i = 0; i < n; i++) items.push({ u: u + (i % 2 ? 0.015 : -0.01), v: v + (i % 2 ? -0.01 : 0.012), y: 0.02 + 0.04 * i, sx: 0.24 - 0.012 * i, sy: 0.04, sz: 0.18, c: 'paper' });
  };
  if (level === 1) { // 편한 자리: 캔 하나
    items.push({ u: R + 0.04, v: -0.04, y: 0.065, sx: 0.07, sy: 0.13, sz: 0.07, c: EFF_HEX.can[0] });
    return { items, lamp: null, boxes: items.length };
  }
  mug(R + 0.03, -0.06);
  papers(Lf - 0.08, -0.08, level === 3 ? 1 : 3);
  if (level >= 4) { papers(Lf - 0.1, 0.13, 2); mug(R + 0.17, -0.15); items.push({ u: Lf - 0.09, v: -0.07, y: 0.143, sx: 0.07, sy: 0.006, sz: 0.07, c: '#e8e2b0' }); } // 메모지
  const lamp = EFF_HEX.lamp[level] || null;
  if (lamp) {
    let bu, bv; // 불빛 자리
    if (lampAt) { // 정적 스탠드: 갓 아래 전구만
      bu = lampAt.u; bv = lampAt.v;
      items.push({ u: bu, v: bv, y: 0.37, sx: 0.12, sy: 0.012, sz: 0.08, c: lamp, glow: true, bulb: true });
    } else { // 기둥(오른쪽 뒤, 어두운 금속) + 켜진 갓(색온도 빛 — 멀리서도 스탠드 색이 읽히게)
      const pu = R + 0.02, pv = 0.18;
      items.push({ u: pu, v: pv, y: 0.2, sx: 0.035, sy: 0.4, sz: 0.035, c: 'metalDark', pole: true });
      bu = pu + 0.07; bv = pv - 0.03;
      items.push({ u: bu, v: bv, y: 0.41, sx: 0.18, sy: 0.07, sz: 0.13, c: lamp, glow: true, bulb: true });
    }
    const dir = bu < 0 ? 1 : -1; // 빛 웅덩이는 가운데 앞쪽으로
    items.push({ u: bu + dir * 0.1, v: bv - 0.14, y: 0.003, sx: 0.36, sy: 0.004, sz: 0.3, c: lamp, glow: true, pool: true });
  }
  return { items, lamp, boxes: items.length };
}

/** 연구소: 이번 책상 소품을 그려도 되나(지금까지 쓴 상자 used + 이번 n) */
export const labPropsOk = (used, n, budget = VX_EFF.LAB_PROP_BOXES) => used + n <= budget;

/** 왼쪽 축(세계 xz). fx·fz = 직원이 바라보는 방향. 오른쪽 = 앞 × 위 = (-fz, fx) → 왼쪽 = (fz, -fx) */
export const leftAxis = (fx, fz) => ({ x: fz, z: -fx });
/** 연구소 책상(BoxBatch ry = θ, 직원은 −(sinθ, cosθ) 쪽을 봄): 앞 = −(sinθ, cosθ) · 왼쪽 = 지역 −x = (−cosθ, sinθ) */
export const labFwd = (a) => ({ x: -Math.sin(a), z: -Math.cos(a) });
export const labLeftAxis = (a) => { const f = labFwd(a); return leftAxis(f.x, f.z); };
/** 지역 (u, v) → 세계 xz. (x, z) = 상판 가운데, f = 앞 방향 */
export function deskToWorld(x, z, f, u, v) {
  const L = leftAxis(f.x, f.z);
  return { x: x + L.x * u + f.x * v, z: z + L.z * u + f.z * v };
}
