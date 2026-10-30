// 복셀 캐릭터 그리기 (개편) — 상태 머신은 순수 모듈(character-core.mjs).
// 스탠딩 데스크에 서서 일한다. 작업 중이면 두 손을 앞으로 뻗어 홀로그램 모니터를 두드리거나(셸·쓰기·편집) 옆으로 넘기고(읽기·검색·웹),
//        도구 없이 생각할 땐 턱을 괸다. 모니터가 접힌 대기 중에는 커피 마시기·기지개·둘러보기·생각을 돌아가며 하고, 팀장이 사람 입력을
//        오래(3분 이상) 기다리면 탕비실에서 커피를 든다(한 번 다녀오면 15분 쉼). 자율 루프 팀장은 가끔 책상 옆으로 나와
//        팀원 쪽을 가리키며 둘러본다. 퇴장(완료)은 가방을 들고 문으로 걸어 나간다.
//   복장 = 역할 계열(appearance-core): 팀장·별관 팀장 formal(정장·넥타이/나비/스카프/터틀넥·구두, 포켓스퀘어 = 종류 색, 별관은 모자)
//   · 팀원 casual(티·후디·맨투맨·카디건·폴로·체크 + 청바지·반바지·면바지·조거·운동화, 로고·소매 끝·캡 = 종류 색, 백팩·헤드폰)
//   · 기동기 운영자 형광 조끼+모자 · 손님 긴 외투. 머리·피부·안경·수염·체형은 노드 id 시드. 세션 색은 사원증과 팀원 조끼 앞판.
// 그리기는 InstancedMesh 묶음(BoxBatch)에 상자를 밀어 넣는다(캐릭터당 draw call 0, 전체 1).
import * as THREE from 'three';
import { partBox } from './props.js';
import { Character } from './character-core.mjs';
import { idleAct } from './office-core.mjs';
import { watchPhase } from './vx-proc-core.mjs';
import { applyTired, tiredMode, flushOf, bodyTintOf, heatHueOf } from './vx-heat-core.mjs'; // 지친 직원

export { Character };

const PI = Math.PI;

const _B = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();
const _qa = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _cT = new THREE.Color(), _cA = new THREE.Color(), _cH = new THREE.Color(), _cG = new THREE.Color(), _cJ = new THREE.Color();
const GREY = new THREE.Color(0.5, 0.52, 0.56);
// 지친 직원 색(테마와 무관하게 피부·옷 위에서 읽히는 값)
const FLUSH = new THREE.Color(0.86, 0.22, 0.16), UNDER = new THREE.Color(0.32, 0.22, 0.3), DROP = new THREE.Color(0.62, 0.86, 1.0);
const _cS = new THREE.Color();
// 멀리서 읽히는 몸 색 물듦(2026-10-30): 옷이 호박(데움) → 주황(과열) → 빨강(위험)으로 물든다
const H_WARM = new THREE.Color(1.0, 0.66, 0.2), H_RED = new THREE.Color(1.0, 0.2, 0.14), _cHt = new THREE.Color(), _cPn = new THREE.Color(), _cVs = new THREE.Color();
/** 직원 과열 → 옷 물듦 색·비율(_cHt 에 색, 돌려주는 값 = 비율) */
function heatTint(hs) { const tn = hs ? bodyTintOf(hs) : 0; if (tn > 0) _cHt.copy(H_WARM).lerp(H_RED, heatHueOf(hs)); return tn; }

const HIP = 0.62, TORSO = 0.66, SHOULDER = 1.2, NECK = 1.3;

/** 부모 행렬 B 아래 관절(j)에서 회전(r) 후 오프셋(o) 만큼 간 점의 세계 좌표 → out(Vector3) */
function jointPoint(B, jx, jy, jz, rx, ry, rz, ox, oy, oz, out) {
  _e.set(rx, ry, rz, 'YXZ'); _qa.setFromEuler(_e);
  out.set(ox, oy, oz).applyQuaternion(_qa);
  out.x += jx; out.y += jy; out.z += jz;
  return out.applyMatrix4(B);
}

/**
 * 자세 계산(순수에 가깝게 — 그리기와 분리). 반환: {legL, legR, armL, armR, rollL, rollR, lean, headP, headY, mug, sip, bag}
 */
function pose(ch, fx, t) {
  const P = poseBase(ch, fx, t);
  const h = ch._heat; // 컨텍스트 과열: 구부정·몸짓(어깨 주무르기·목 돌리기·관자놀이·멈칫·땀 닦기·휘청·엎드리기 직전·식을 때 기지개)
  if (h && h.on) applyTired(P, h, tiredMode(ch), t, ch.phase);
  return P;
}
function poseBase(ch, fx, t) {
  const P = { legL: 0, legR: 0, armL: -0.06, armR: -0.06, rollL: 0, rollR: 0, lean: 0, headP: 0, headY: 0, mug: false, bag: false };
  const walking = ch.state === 'walk' || ch.state === 'leave' || ch.state === 'enter';
  const cat = ch.workCat;
  const tt = ch.target && ch.target.type;
  if (walking) {
    const s = Math.sin(ch.phase);
    P.legL = 0.55 * s; P.legR = -0.55 * s; P.armL = -0.45 * s; P.armR = 0.45 * s;
    if (ch.state === 'leave') { P.bag = true; P.armR = -0.12; }               // 퇴근: 가방
    else if (tt === 'errand' && ch.errand && ch.errand.kind === 'watch') { P.clip = true; P.armL = -0.95; P.rollL = 0.25; } // 클립보드 들고 기계로
    else if (tt === 'desk' && ch._fromBreak) { P.mug = true; P.armR = -1.0; } // 커피 들고 자리로
    return P;
  }
  // 탕비실: 커피 한 잔 — 3.2초마다 한 모금, 팀장은 왼손으로 가볍게 손짓(잡담)
  if (tt === 'break') {
    P.mug = true;
    const c = (t * 0.31 + (ch.hash % 10) / 10) % 1;
    const sip = c > 0.62 && c < 0.86;
    P.armR = sip ? -2.45 : -1.0; P.rollR = sip ? 0.32 : 0.12; P.headP = sip ? -0.22 : 0.02;
    P.armL = ch.lead ? -0.55 + 0.25 * Math.sin(t * 2.3 + ch.phase) : -0.08;
    P.rollL = ch.lead ? -0.25 + 0.2 * Math.sin(t * 1.7) : 0;
    P.headY = 0.25 * Math.sin(t * 0.45 + ch.phase);
    return P;
  }
  // 들여다보기: 생산 라인 앞 — 전광판 보기(클립보드) · 기다림(팔짱) · 끝나기 직전 체크
  if (tt === 'errand' && ch.errand && ch.errand.kind === 'watch') {
    const w = ch.errand.w, ph = watchPhase(w, t, !!(w && w.arrivedAt != null));
    if (ph === 'wait') {
      // 팔짱: 두 팔을 앞으로 접어 안쪽으로 감고, 고개는 전광판 쪽으로 조금 들고, 가끔 발끝 까딱
      P.armL = -1.32; P.rollL = 1.0; P.armR = -1.12; P.rollR = -1.05; P.headP = -0.16 + 0.04 * Math.sin(t * 0.7 + ch.phase);
      P.headY = 0.1 * Math.sin(t * 0.45 + ch.phase); P.lean = -0.03;
      const tap = (t + ch.phase) % 5.5; if (tap < 0.9) P.legR = -0.14 * Math.abs(Math.sin(tap * PI * 3.3));
    } else if (ph === 'check') {
      // 체크: 고개를 숙여 클립보드에 펜으로 ✓
      P.clip = true; P.armL = -1.1; P.rollL = 0.35; P.armR = -1.2 + 0.16 * Math.sin(t * 15); P.rollR = -0.55; P.headP = 0.3;
    } else {
      // 전광판 보기: 클립보드는 가슴 앞, 펜 든 오른손, 고개를 들어 숫자를 훑음
      P.clip = true; P.armL = -1.1; P.rollL = 0.35; P.armR = -0.95; P.rollR = -0.42; P.headP = -0.32; P.headY = 0.14 * Math.sin(t * 1.3 + ch.phase);
    }
    return P;
  }
  // 의뢰인 스크린 앞: 질문 = 손 들기, 보고 = 두 손으로 설명
  if (tt === 'errand') {
    if (ch.errand && ch.errand.kind === 'ask') { P.armR = -2.85 + 0.12 * Math.sin(t * 5); P.rollR = 0.12; P.armL = -0.3; P.headP = -0.18; }
    else { P.armL = -0.95 + 0.3 * Math.sin(t * 2.6); P.armR = -1.05 + 0.3 * Math.sin(t * 2.6 + 1.7); P.rollL = 0.25; P.rollR = -0.25; P.headP = -0.1; P.headY = 0.15 * Math.sin(t * 0.8); }
    return P;
  }
  // 지휘·감독(자율 루프 팀장): 책상 옆에 나와 팀원 쪽으로 오른팔을 뻗어 가리키고, 왼손은 허리, 고개는 천천히 둘러본다
  if (tt === 'oversee') {
    const k = ch.sup ? ch.sup.k : 0, w = Math.sin(Math.min(1, k) * PI);
    P.armR = -0.25 - 1.35 * Math.min(1, w * 1.8) + 0.06 * Math.sin(t * 2.2); P.rollR = 0.12;
    P.armL = -0.3; P.rollL = -0.6; P.lean = 0.04;
    P.headP = -0.05; P.headY = 0.4 * Math.sin(k * PI * 2);
    return P;
  }
  // 멈칫(권한 거부·인터럽트): 손이 올라가고 고개가 뒤로
  if (ch.flinchUntil > t) { const w = Math.sin(Math.min(1, (ch.flinchUntil - t) / 0.9) * PI); P.armL = P.armR = -0.2 - 0.9 * w; P.rollL = -0.3 * w; P.rollR = 0.3 * w; P.headP = -0.3 * w; P.lean = -0.08 * w; return P; }
  const atDesk = tt === 'desk' && (ch.state === 'seated' || ch.state === 'work');
  // 의뢰서 카드 읽기(팀장, 도구 없을 때)
  if (atDesk && ch.readUntil > t && !(ch.state === 'work' && cat)) { P.armL = P.armR = -1.15; P.rollL = 0.35; P.rollR = -0.35; P.headP = 0.22; P.card = true; return P; }
  if (atDesk && ch.state === 'work' && cat) {
    // 홀로그램 모니터 조작
    switch (cat) {
      case 'shell': case 'write':
        P.armL = -1.25 + 0.13 * Math.sin(t * 16); P.armR = -1.25 + 0.13 * Math.sin(t * 16 + PI); P.rollL = 0.22; P.rollR = -0.22; P.headP = 0.1; break;
      case 'edit':
        P.armR = -1.35 + 0.1 * Math.sin(t * 7); P.rollR = -0.15; P.armL = -1.0 + 0.06 * Math.sin(t * 3); P.rollL = 0.3; P.headP = 0.12; break;
      case 'read': case 'search': case 'web': {
        // 넘기기: 오른손이 홀로그램 앞을 옆으로 쓸고, 고개가 따라감
        const s = Math.sin(t * (cat === 'search' ? 2.8 : 2.0) + ch.phase);
        P.armR = -1.4; P.rollR = -0.15 - 0.55 * s; P.armL = -0.55; P.rollL = 0.15; P.headP = 0.05; P.headY = 0.18 * s; break;
      }
      default: P.armL = P.armR = -1.0; P.rollL = 0.2; P.rollR = -0.2; P.headP = 0.08;
    }
    return P;
  }
  if (ch.state === 'work' && cat && tt === 'station') {
    switch (cat) {
      case 'agent': case 'workflow': P.armL = P.armR = -1.5 + 0.08 * Math.sin(t * 5); P.headP = -0.05; break;
      case 'skill': P.armL = -0.95 + 0.12 * Math.sin(t * 4); P.armR = -0.95 + 0.12 * Math.sin(t * 4 + 1.5); P.headP = 0.32; break;
      case 'monitor': P.armR = -1.65 + 0.06 * Math.sin(t * 3); P.armL = -0.2; P.headP = -0.08; break;
      case 'mcp': P.armL = -1.05 + 0.1 * Math.sin(t * 9); P.armR = -1.05 + 0.1 * Math.sin(t * 9 + 2); break;
      case 'artifact': { const c = Math.sin(t * 2.2); P.armR = -1.9 - 0.3 * c; P.armL = -0.4; P.headP = -0.1; break; }
      case 'notify': P.armR = -2.0 + 0.4 * Math.sin(t * 14); P.armL = -0.2; P.headP = -0.15; break;
      default: P.armL = P.armR = -0.9;
    }
    return P;
  }
  if (ch.state === 'work' && cat) { P.armL = P.armR = -0.9; P.headP = 0.1; return P; } // 시설 없이 제자리
  // 자리에서 대기
  if (fx.doneLead) { P.armL = P.armR = -0.2; P.headP = 0.4; return P; }
  if (atDesk && (fx.monK || 0) > 0.5) { // 모니터는 떠 있는데 도구 없음 = 생각 중(턱 괴기)
    P.armR = -2.25; P.rollR = 0.55; P.armL = -1.0; P.rollL = -0.75; P.headP = -0.06 + 0.04 * Math.sin(t * 0.9); P.headY = 0.12 * Math.sin(t * 0.37 + ch.phase);
    return P;
  }
  const a = idleAct(ch.hash, t);
  switch (a.act) {
    case 'coffee': {
      P.mug = true;
      const c = (a.k * 3) % 1, sip = c > 0.55 && c < 0.8;
      P.armR = sip ? -2.45 : -1.0; P.rollR = sip ? 0.32 : 0.12; P.headP = sip ? -0.22 : 0.04; P.armL = -0.08; break;
    }
    case 'stretch': {
      const up = a.k > 0.15 && a.k < 0.55;
      if (up) { const w = Math.sin(((a.k - 0.15) / 0.4) * PI); P.armL = P.armR = -0.1 - 2.85 * w; P.rollL = -0.25 * w; P.rollR = 0.25 * w; P.lean = -0.1 * w; P.headP = -0.25 * w; }
      break;
    }
    case 'look': P.headY = 0.7 * Math.sin(a.k * PI * 2); P.headP = -0.05; P.armL = P.armR = -0.1; break;
    case 'think': P.armR = -2.25; P.rollR = 0.55; P.armL = -1.0; P.rollL = -0.75; P.headP = -0.1; P.headY = 0.25 * Math.sin(a.k * PI * 2); break;
    default: P.armL = P.armR = -0.06 + 0.03 * Math.sin(t * 1.6 + ch.phase);
  }
  if (fx.idle) P.headP += 0.04;
  return P;
}

// 부위 그리기 도우미(모듈 상태 — 프레임마다 클로저를 만들지 않는다)
let _L = null, _id = null, _lean = 0, _nY = 0, _nZ = 0, _hp = 0, _hy = 0;
const NOAP = { cls: 'casual', hairStyle: 'short', top: 'tee', bottom: 'jeans', shoe: 'sneaker', h: 1, w: 1 };
/** 몸통(허리 관절, 기울기 lean) 기준 상자 */
function T(ox, oy, oz, sx, sy, sz, c) { partBox(_L, _B, 0, HIP, 0, _lean, 0, 0, ox, oy, oz, sx, sy, sz, c, _id); }
/** 머리(목 관절, 끄덕 hp·도리 hy) 기준 상자 */
function Hd(ox, oy, oz, sx, sy, sz, c) { partBox(_L, _B, 0, _nY, _nZ, _hp, _hy, 0, ox, oy, oz, sx, sy, sz, c, _id); }

/** 머리 모양 — 민머리 없음. 모자를 쓰면 정수리는 가리고 뒷머리·묶음·긴 머리만 */
const LONGISH = new Set(['long', 'bangs', 'lob', 'bob', 'curlylong']);
function hairTails(st, c, det, tieC) {
  if (st === 'pony') Hd(0, 0.2, -0.29, 0.11, 0.3, 0.1, c);
  else if (st === 'braid') { Hd(0, 0.18, -0.27, 0.11, 0.12, 0.1, c); Hd(0, 0.06, -0.285, 0.1, 0.12, 0.09, c); if (det) Hd(0, -0.05, -0.295, 0.08, 0.1, 0.08, c); if (det) Hd(0, -0.12, -0.3, 0.09, 0.04, 0.09, tieC); }
  else if (st === 'twin') for (const s of [-1, 1]) { Hd(s * 0.27, 0.2, -0.12, 0.1, 0.34, 0.1, c); if (det) Hd(s * 0.27, 0.38, -0.12, 0.12, 0.05, 0.12, tieC); }
}
function longBack(st, c, det) {
  if (st === 'curlylong') { Hd(0, 0.15, -0.22, 0.58, 0.56, 0.14, c); for (const s of [-1, 1]) Hd(s * 0.27, 0.25, -0.02, 0.08, 0.34, 0.38, c); return; }
  if (st === 'bob') { Hd(0, 0.24, -0.22, 0.5, 0.36, 0.08, c); for (const s of [-1, 1]) Hd(s * 0.24, 0.24, 0, 0.05, 0.34, 0.44, c); return; }
  if (st === 'lob') { Hd(0, 0.2, -0.22, 0.5, 0.46, 0.08, c); for (const s of [-1, 1]) Hd(s * 0.24, 0.21, 0, 0.05, 0.42, 0.44, c); return; }
  Hd(0, 0.17, -0.215, 0.5, 0.52, 0.1, c); // long·bangs: 어깨까지(사원증·몸통 뒤)
  if (det) for (const s of [-1, 1]) Hd(s * 0.235, 0.28, -0.05, 0.05, 0.32, 0.34, c);
}
function drawHair(st, c, hatOn, det, tieC) {
  if (hatOn) {
    if (LONGISH.has(st)) longBack(st, c, det);
    else Hd(0, 0.3, -0.2, 0.48, 0.24, 0.08, c);
    hairTails(st, c, det, tieC);
    return;
  }
  switch (st) {
    case 'crew': // 짧은 스포츠머리 — 정수리까지 덮는다
      Hd(0, 0.455, -0.01, 0.47, 0.06, 0.47, c); Hd(0, 0.32, -0.215, 0.47, 0.24, 0.05, c);
      if (det) for (const s of [-1, 1]) Hd(s * 0.228, 0.36, -0.05, 0.02, 0.14, 0.26, c);
      return;
    case 'mohawk': Hd(0, 0.455, -0.01, 0.46, 0.05, 0.46, c); Hd(0, 0.53, -0.02, 0.1, 0.14, 0.46, c); Hd(0, 0.32, -0.215, 0.46, 0.22, 0.04, c); return;
    case 'slick': Hd(0, 0.455, -0.04, 0.47, 0.075, 0.44, c); Hd(0, 0.32, -0.215, 0.47, 0.24, 0.06, c); return;
    case 'curly':
      Hd(0, 0.48, -0.02, 0.56, 0.16, 0.56, c); Hd(0, 0.28, -0.21, 0.56, 0.32, 0.14, c);
      if (det) for (const s of [-1, 1]) Hd(s * 0.16, 0.57, 0.06, 0.16, 0.08, 0.16, c);
      return;
    case 'curlylong':
      Hd(0, 0.48, -0.02, 0.56, 0.16, 0.56, c); longBack(st, c, det);
      if (det) for (const s of [-1, 1]) Hd(s * 0.16, 0.57, 0.06, 0.16, 0.08, 0.16, c);
      return;
    case 'shaggy':
      Hd(0, 0.47, -0.02, 0.5, 0.12, 0.5, c); Hd(0, 0.28, -0.21, 0.5, 0.32, 0.1, c);
      for (const s of [-1, 1]) Hd(s * 0.24, 0.3, -0.02, 0.04, 0.22, 0.4, c);
      if (det) Hd(0, 0.41, 0.225, 0.44, 0.07, 0.04, c);
      return;
    case 'pixie':
      Hd(0, 0.465, -0.01, 0.48, 0.08, 0.48, c); Hd(0, 0.33, -0.215, 0.48, 0.2, 0.05, c); Hd(-0.08, 0.41, 0.222, 0.3, 0.07, 0.05, c);
      for (const s of [-1, 1]) Hd(s * 0.235, 0.29, 0.0, 0.04, 0.24, 0.3, c); // 귀를 덮는 옆머리(짧은 단발 느낌)
      Hd(0, 0.24, -0.22, 0.46, 0.14, 0.05, c);
      return;
    case 'bob': case 'lob':
      Hd(0, 0.46, -0.02, 0.5, 0.1, 0.5, c); longBack(st, c, det); if (det) Hd(0, 0.4, 0.225, 0.44, 0.06, 0.04, c);
      return;
  }
  Hd(0, 0.46, -0.03, 0.48, 0.1, 0.48, c); // 정수리(기본)
  if (LONGISH.has(st)) longBack(st, c, det); else Hd(0, 0.3, -0.2, 0.48, 0.24, 0.08, c);
  if (st === 'side') Hd(0.09, 0.4, 0.215, 0.28, 0.08, 0.05, c);
  else if (st === 'bangs' || st === 'twin') Hd(0, 0.4, 0.225, 0.44, 0.08, 0.04, c);
  else if (st === 'bun') Hd(0, 0.54, -0.17, 0.17, 0.15, 0.17, c); // 뒤통수 위 — 앞에서 모자처럼 보이지 않게
  hairTails(st, c, det, tieC);
}

/**
 * 캐릭터 그리기. look = { role, ap(appearance-core 외형), shirt, jacket?, top2, pants, pants2?, legC?, shoe, neck?, hatC?, glasses?, lens, lip, hairAcc?, phones?, pack?,
 *   accent(종류 색), vest?, stripe?, skin, hair, hat?(별관 왕관), cap?(운영자), badge, sessVest?, markKind, mark? }
 * fx = { t, now, skill, error, ok, text, focus, hover, metaSkill, doneLead, idle, catColor, monK, mugC, coffeeC, bagC, shoeC }
 * 손 위치(세계)를 ch._hand[0..1] 에 남긴다(홀로그램 손끝 빛줄기용)
 */
export function drawCharacter(ch, look, fx, lit, glow) {
  const t = fx.t;
  const k = ch.scale(fx.now);
  if (k <= 0.002) return;
  const A = look.ap || NOAP;
  const walking = ch.state === 'walk' || ch.state === 'leave' || ch.state === 'enter';
  const bob = walking ? Math.abs(Math.sin(ch.phase)) * 0.05 : 0;
  // 옆 오프셋(시설 앞에서만, 겹침 완화)
  const off = !walking && ch.target && ch.target.type === 'station' ? ch.side * 0.6 : 0;
  const px = ch.pos.x + Math.cos(ch.yaw) * off, pz = ch.pos.z - Math.sin(ch.yaw) * off;
  const rootY = bob;
  _q.setFromAxisAngle(_yAxis, ch.yaw + (ch.workCat === 'search' && ch.target && ch.target.type === 'station' ? 0.25 * Math.sin(t * 3) : 0));
  _p.set(px, rootY, pz);
  // 체형: 키 h·어깨 w — 정장은 조금 크고 반듯하게, 캐주얼은 조금 작고 다양하게
  const bw = A.w || 1, bh = A.h || 1;
  _B.compose(_p, _q, _one.set(k * bw, k * bh, k * bw));
  const id = ch.id;
  const P = pose(ch, fx, t);
  _L = lit; _id = id; _lean = P.lean;

  // 색
  const shirt = _cT.copy(look.shirt);
  const leaving = ch.state === 'leave' || ch.vanishT0 != null;
  if (leaving) shirt.lerp(GREY, 0.35);
  const errOn = ch.errUntil > fx.now || ch.errFlashUntil > fx.now || (fx.error && ch.node.status === 'error');
  if (errOn) shirt.lerp(fx.error, 0.55);
  const goldOn = (ch.state === 'work' && ch.workCat === 'skill') || fx.metaSkill;
  if (ch.state === 'work' && ch.workCat === 'skill') shirt.lerp(fx.skill, 0.35 + 0.15 * Math.sin(t * 6));
  const hs0 = ch._heat && ch._heat.on && !leaving ? ch._heat : null, tn = heatTint(hs0); // 옷 물듦(멀리서 단계가 읽히게)
  if (tn > 0) shirt.lerp(_cHt, tn);
  const jacket = look.jacket ? _cJ.copy(look.jacket) : null;
  if (jacket && tn > 0) jacket.lerp(_cHt, tn);
  const pants = tn > 0 && look.pants ? _cPn.copy(look.pants).lerp(_cHt, tn * 0.6) : look.pants;
  if (jacket && errOn) jacket.lerp(fx.error, 0.4);
  if (jacket && leaving) jacket.lerp(GREY, 0.25);
  const sleeve = jacket || _cA.copy(shirt).multiplyScalar(0.92);
  const skin = look.skin;
  const accent = look.accent || look.badge;
  const shoe = look.shoe || fx.shoeC;
  const top = A.top;
  const F = A.sex === 'f';
  const skirt = A.bottom === 'skirt' || A.bottom === 'dress';
  const det = fx.detail !== false; // 멀면 잔 장식 생략(상자 수 절약 — 색·실루엣·종류 색 로고는 그대로)

  // 다리 + 신발(반바지면 무릎 아래 맨다리, 청바지 밑단 접기·조거 발목 고무단)
  for (let li = 0; li < 2; li++) {
    const sx = li ? 0.13 : -0.13, a = li ? P.legR : P.legL;
    if (skirt) partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.3, 0, 0.19, 0.6, 0.2, look.legC || skin, id);
    else if (A.bottom === 'shorts') {
      partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.16, 0, 0.21, 0.32, 0.23, pants, id);
      partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.44, 0, 0.16, 0.28, 0.16, skin, id);
    } else {
      partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.3, 0, 0.2, 0.6, 0.22, pants, id);
      if (look.pants2 && det) partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.52, 0, 0.215, 0.05, 0.235, look.pants2, id);
    }
    if (A.shoe === 'sneaker' && det) {
      partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.585, 0.05, 0.22, 0.07, 0.32, shoe, id);
      partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.63, 0.05, 0.23, 0.03, 0.33, fx.cardC || fx.mugC, id);
    } else if (A.shoe === 'boot' && det) {
      partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.56, 0.04, 0.23, 0.14, 0.3, shoe, id);
      partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.63, 0.04, 0.24, 0.03, 0.31, fx.shoeC, id);
    } else if (A.shoe === 'pumps') {
      partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.6, 0.06, 0.18, 0.07, 0.28, shoe, id);
      if (det) partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.615, -0.07, 0.06, 0.07, 0.05, shoe, id);
    } else partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.6, 0.05, 0.22, 0.08, 0.32, shoe, id);
  }
  // 몸통 + 옷
  const breathe = 1 + 0.015 * Math.sin(t * 1.6 + ch.phase);
  const baseC = top === 'cardigan' ? look.top2 : shirt;
  if (F) { T(0, TORSO * 0.62, 0, 0.52, TORSO * 0.76 * breathe, 0.3, baseC); T(0, TORSO * 0.13, 0, 0.44, TORSO * 0.3, 0.27, baseC); }
  else T(0, TORSO / 2, 0, 0.54, TORSO * breathe, 0.3, baseC);
  // 치마·원피스: 엉덩이(허리 관절)에 붙은 블록 — 다리는 그대로 움직인다
  if (A.bottom === 'skirt' && A.cls === 'formal') T(0, -0.17, 0, 0.48, 0.38, 0.3, pants);
  else if (skirt) {
    const sc = A.bottom === 'dress' ? shirt : pants;
    T(0, -0.12, 0, 0.5, 0.3, 0.32, sc); T(0, -0.25, 0, 0.56, 0.07, 0.36, sc);
    if (A.bottom === 'dress') T(0, 0.03, 0, 0.46, 0.045, 0.29, accent); // 원피스 허리띠 = 종류 색
  }
  let wrap = false; // 앞판이 0.16 까지 나온 겉옷(정장·외투·카디건)
  if (jacket) {
    wrap = true;
    if (top === 'coat') {
      // 손님: 허벅지까지 내려오는 긴 외투 + 단추 두 줄, 앞가슴 = 안 셔츠(종류 색)
      T(0, TORSO / 2 - 0.1, -0.005, 0.6, TORSO + 0.22, 0.33, jacket);
      T(0, TORSO - 0.16, 0.167, 0.14, 0.26, 0.012, shirt);
      if (det) for (const yy of [0.12, 0.3]) for (const s of [-1, 1]) T(s * 0.1, yy, 0.168, 0.04, 0.04, 0.012, fx.shoeC);
    } else {
      // 정장: 몸통을 감싸고 앞가슴만 셔츠(+넥타이)가 보인다. 세 벌 정장이면 조끼 아랫단, 포켓스퀘어 = 종류 색
      if (F) { T(0, TORSO * 0.6, -0.005, 0.56, TORSO * 0.8 + 0.02, 0.32, jacket); T(0, TORSO * 0.12 - 0.02, -0.005, 0.5, TORSO * 0.3 + 0.04, 0.3, jacket); }
      else T(0, TORSO / 2 - 0.03, -0.005, 0.58, TORSO * 0.98 + 0.06, 0.32, jacket);
      T(0, TORSO - 0.16, 0.162, 0.16, 0.26, 0.012, A.neck === 'turtle' ? look.neck : shirt);
      if (top === 'suit3') T(0, TORSO * 0.42, 0.163, 0.17, 0.2, 0.012, pants);
      T(-0.17, TORSO - 0.22, 0.165, 0.08, 0.05, 0.012, accent);
    }
    const nc = look.neck || look.tie;
    if (nc && (A.neck === 'tie' || (!A.neck && look.tie))) { T(0, TORSO - 0.2, 0.17, 0.07, 0.32, 0.012, nc); T(0, TORSO - 0.05, 0.172, 0.09, 0.06, 0.014, nc); }
    else if (A.neck === 'bow') T(0, TORSO - 0.06, 0.172, 0.17, 0.07, 0.014, nc);
    else if (A.neck === 'turtle') T(0, TORSO + 0.03, 0, 0.32, 0.09, 0.26, nc);
    else if (A.neck === 'brooch') T(0.16, TORSO - 0.17, 0.168, 0.06, 0.06, 0.014, nc);
    else if (A.neck === 'necklace') { T(0, TORSO - 0.09, 0.166, 0.16, 0.025, 0.01, nc); T(0, TORSO - 0.12, 0.168, 0.04, 0.04, 0.012, nc); }
  } else {
    switch (top) {
      case 'hoodie':
        T(0, TORSO + 0.02, -0.16, 0.44, 0.17, 0.12, sleeve);
        T(0, 0.17, 0.153, 0.34, 0.15, 0.012, look.top2);
        if (det) for (const s of [-1, 1]) T(s * 0.06, TORSO - 0.14, 0.155, 0.025, 0.16, 0.01, fx.cardC || fx.mugC);
        break;
      case 'sweat':
        T(0, 0.035, 0, F ? 0.47 : 0.56, 0.07, F ? 0.29 : 0.32, look.top2);
        T(0, TORSO - 0.15, 0.152, 0.545, 0.06, 0.012, accent); // 가슴 띠 = 종류 색
        break;
      case 'cardigan':
        wrap = true;
        T(-0.17, TORSO / 2, -0.005, 0.24, TORSO * 0.98, 0.32, shirt); T(0.17, TORSO / 2, -0.005, 0.24, TORSO * 0.98, 0.32, shirt);
        T(0, TORSO / 2, -0.06, 0.2, TORSO * 0.98, 0.2, shirt);
        T(0, TORSO - 0.12, 0.155, 0.07, 0.07, 0.012, accent);
        break;
      case 'polo':
        T(0, TORSO - 0.01, 0.1, 0.3, 0.05, 0.13, look.top2);
        T(0, TORSO - 0.1, 0.152, 0.05, 0.12, 0.012, look.top2);
        T(-0.14, TORSO - 0.18, 0.152, 0.07, 0.07, 0.012, accent);
        break;
      case 'flannel':
        for (const yy of [0.17, 0.39]) T(0, yy, 0, 0.555, 0.045, 0.305, look.top2);
        if (det) for (const s of [-1, 1]) T(s * 0.13, TORSO / 2, 0, 0.045, TORSO * 0.98, 0.305, look.top2);
        T(0, TORSO - 0.01, 0.1, 0.28, 0.05, 0.12, shirt);
        break;
      case 'knit': // 니트: 가슴 무늬 띠(안 색) + 고무단, 로고 = 종류 색
        T(0, TORSO - 0.2, 0.152, F ? 0.5 : 0.54, 0.05, 0.012, look.top2);
        T(0, 0.035, 0, F ? 0.47 : 0.56, 0.07, F ? 0.29 : 0.32, look.top2);
        T(-0.14, TORSO - 0.3, 0.152, 0.08, 0.07, 0.012, accent);
        break;
      case 'dress': break; // 원피스: 허리띠(위)·반팔
      default: // tee·longtee: 가슴 로고 = 종류 색
        if (!look.vest) T(-0.14, TORSO - 0.2, 0.152, 0.11, 0.1, 0.012, accent); // 사원증과 안 겹치게 왼가슴
    }
  }
  if (look.vest) {
    // 형광 조끼 + 반사띠 두 줄(기동기 운영자)
    T(0, TORSO / 2 + 0.03, 0, 0.58, TORSO * 0.82, 0.33, tn > 0 ? _cVs.copy(look.vest).lerp(_cHt, tn) : look.vest);
    for (const yy of [0.22, 0.4]) T(0, yy, 0, 0.59, 0.045, 0.335, look.stripe);
  } else if (look.sessVest) {
    // 세션 색 조끼 앞판(— 같은 프로젝트 여러 세션일 때 팀원)
    for (const s of [-1, 1]) T(s * 0.16, TORSO / 2 + 0.02, wrap ? 0.168 : 0.158, 0.17, TORSO * 0.78, 0.014, look.sessVest);
  }
  if (A.neck === 'scarf') { T(0, TORSO, 0, 0.44, 0.1, 0.34, look.neck); T(0.1, TORSO - 0.2, 0.175, 0.08, 0.3, 0.014, look.neck); }
  if (look.pack && !look.vest) { // 백팩(캐주얼) + 앞 어깨끈
    T(0, TORSO / 2 + 0.04, -0.23, 0.4, 0.46, 0.16, look.pack);
    if (det) T(0, TORSO / 2 - 0.02, -0.315, 0.3, 0.18, 0.02, look.pack);
    if (det) for (const s of [-1, 1]) T(s * 0.17, TORSO - 0.14, 0.172, 0.06, 0.3, 0.012, look.pack);
  }
  // 사원증(목걸이 카드) — 세션 색(없으면 종류 색), 빛남
  T(0, TORSO - 0.06, 0.165, 0.035, 0.2, 0.01, fx.shoeC);
  partBox(glow, _B, 0, HIP, 0, P.lean, 0, 0, look.vest ? 0.14 : 0, TORSO - 0.3, 0.18, 0.11, 0.14, 0.015, look.badge);
  if (look.markKind === 'necklace') T(0, TORSO - 0.04, 0, 0.4, 0.05, 0.36, look.mark);

  const sl = Math.sin(P.lean), cl = Math.cos(P.lean);
  const shY = HIP + (SHOULDER - HIP) * cl, shZ = (SHOULDER - HIP) * sl;
  // 팔 + 손: 반팔(티·폴로)은 아래팔 맨살, 정장은 흰 셔츠 소맷부리, 캐주얼 긴팔은 소매 끝 = 종류 색
  const hands = ch._hand || (ch._hand = [new THREE.Vector3(), new THREE.Vector3()]);
  const short = !jacket && !look.vest && (top === 'tee' || top === 'polo' || top === 'dress');
  for (let hi = 0; hi < 2; hi++) {
    const sx = hi ? 0.36 : -0.36, ax = hi ? P.armR : P.armL, rz = hi ? P.rollR * 0.9 : -P.rollL;
    if (short) {
      partBox(lit, _B, sx, shY, shZ, ax, 0, rz, 0, -0.13, 0, 0.17, 0.27, 0.17, sleeve, id);
      partBox(lit, _B, sx, shY, shZ, ax, 0, rz, 0, -0.4, 0, 0.14, 0.28, 0.14, skin, id);
    } else {
      partBox(lit, _B, sx, shY, shZ, ax, 0, rz, 0, -0.26, 0, 0.16, 0.54, 0.16, look.vest ? shirt : sleeve, id);
      if (!det) { /* 소맷부리·소매 끝 생략 */ }
      else if (jacket && top !== 'coat') partBox(lit, _B, sx, shY, shZ, ax, 0, rz, 0, -0.515, 0, 0.165, 0.035, 0.165, shirt, id);
      else if (!jacket && !look.vest) partBox(lit, _B, sx, shY, shZ, ax, 0, rz, 0, -0.505, 0, 0.168, 0.05, 0.168, top === 'cardigan' || top === 'flannel' || top === 'knit' ? look.top2 : accent, id);
    }
    partBox(lit, _B, sx, shY, shZ, ax, 0, rz, 0, -0.58, 0, 0.13, 0.12, 0.13, skin, id);
    jointPoint(_B, sx, shY, shZ, ax, 0, rz, 0, -0.6, 0, hands[hi]);
  }
  // 손에 든 것: 커피 잔(오른손) · 가방(퇴근)
  if (P.mug) {
    partBox(lit, _B, 0.36, shY, shZ, P.armR, 0, P.rollR * 0.9, 0, -0.66, 0.06, 0.11, 0.13, 0.11, fx.mugC, id);
    partBox(lit, _B, 0.36, shY, shZ, P.armR, 0, P.rollR * 0.9, 0, -0.6, 0.06, 0.085, 0.012, 0.085, fx.coffeeC, id);
  }
  if (P.card) partBox(glow, _B, 0, shY - 0.2, shZ + 0.45, -0.6, 0, 0, 0, 0, 0, 0.36, 0.26, 0.012, fx.cardC || fx.mugC);
  if (P.bag) partBox(lit, _B, 0.36, shY, shZ, P.armR, 0, P.rollR * 0.9, 0, -0.78, 0, 0.12, 0.26, 0.34, fx.bagC, id);
  if (P.clip) { // 클립보드(왼손): 판·종이·집게 — 손끝에서 얼굴 쪽을 보는 판
    partBox(lit, _B, -0.36, shY, shZ, P.armL, 0, -P.rollL, 0.02, -0.64, 0.1, 0.27, 0.025, 0.34, fx.bagC, id);
    partBox(lit, _B, -0.36, shY, shZ, P.armL, 0, -P.rollL, 0.02, -0.625, 0.08, 0.23, 0.012, 0.26, fx.cardC || fx.mugC, id);
    partBox(lit, _B, -0.36, shY, shZ, P.armL, 0, -P.rollL, 0.02, -0.615, 0.25, 0.1, 0.03, 0.04, fx.shoeC, id);
  }
  // 머리
  const nY = HIP + (NECK - HIP) * cl, nZ = (NECK - HIP) * sl;
  const hp = P.headP + P.lean * 0.5;
  // 오류: 고개 젓기
  const hy = P.headY + (ch.errUntil > fx.now ? Math.sin(t * 16) * 0.4 : 0);
  _nY = nY; _nZ = nZ; _hp = hp; _hy = hy;
  const hs = ch._heat && ch._heat.on ? ch._heat : null;
  const fl = hs ? flushOf(hs) : 0;
  Hd(0, 0.22, 0, 0.44, 0.44, 0.44, fl > 0 ? _cS.copy(skin).lerp(FLUSH, fl) : skin);
  if (hs) { jointPoint(_B, 0, nY, nZ, hp, hy, 0, 0, 0.22, 0, ch._headW || (ch._headW = new THREE.Vector3())); ch._bh = bh; }
  const hatOn = look.markKind === 'crown' || !!look.cap || !!A.hat;
  drawHair(A.hairStyle, look.hair, hatOn, det, look.hairAcc || fx.shoeC);
  if (A.hairAcc === 'band' && !hatOn) Hd(0, 0.515, 0.05, 0.5, 0.04, 0.09, look.hairAcc);
  else if (A.hairAcc === 'pin' && !hatOn) Hd(0.15, 0.47, 0.13, 0.11, 0.035, 0.035, look.hairAcc);
  if (look.markKind === 'crown') {
    Hd(0, 0.46, 0, 0.64, 0.06, 0.64, look.hat);
    Hd(0, 0.56, 0, 0.42, 0.18, 0.42, look.hat);
  } else if (look.cap || A.hat === 'cap' || A.hat === 'capBack') {
    const cc = look.cap || look.hatC;
    Hd(0, 0.47, -0.01, 0.47, 0.12, 0.47, cc);
    Hd(0, 0.42, A.hat === 'capBack' && !look.cap ? -0.27 : 0.27, 0.4, 0.03, 0.16, cc);
  } else if (A.hat === 'beanie') {
    Hd(0, 0.5, -0.01, 0.5, 0.17, 0.5, look.hatC);
    Hd(0, 0.42, -0.01, 0.52, 0.07, 0.52, look.hatC);
    if (det) Hd(0, 0.62, -0.01, 0.11, 0.08, 0.11, look.hatC);
  }
  if (look.phones) { // 헤드폰: 머리띠 + 귀 덮개
    const by = hatOn ? 0.555 : 0.525;
    Hd(0, by, 0, 0.5, 0.05, 0.08, look.phones);
    for (const s of [-1, 1]) { if (det) Hd(s * 0.26, 0.4, 0, 0.04, 0.24, 0.07, look.phones); Hd(s * 0.27, 0.25, 0, 0.08, 0.17, 0.15, look.phones); }
  }
  // 수염 · 안경 · 눈(작은 점 둘)
  if (A.beard === 'beard') Hd(0, 0.07, 0.2, 0.46, 0.15, 0.07, look.hair);
  else if (A.beard === 'mustache') Hd(0, 0.15, 0.226, 0.18, 0.04, 0.012, look.hair);
  const ez = look.glasses ? (det ? 0.234 : 0.232) : 0.222;
  if (look.glasses && !det) Hd(0, 0.25, 0.226, 0.36, 0.08, 0.008, look.glasses); // 멀리서는 안경 한 줄
  else if (look.glasses) {
    for (const s of [-1, 1]) { Hd(s * 0.1, 0.25, 0.224, 0.15, 0.12, 0.008, look.glasses); Hd(s * 0.1, 0.25, 0.228, 0.11, 0.08, 0.006, look.lens); }
    Hd(0, 0.27, 0.224, 0.06, 0.02, 0.008, look.glasses);
  }
  // 눈: 과열 이상이면 반쯤 감김(낮고 납작) + 눈 밑 다크서클
  const tiredEye = hs && hs.stage >= 2;
  for (const s of [-1, 1]) Hd(s * 0.1, tiredEye ? 0.24 : 0.25, ez, 0.05, tiredEye ? 0.03 : 0.06, 0.01, fx.shoeC);
  if (tiredEye && det) for (const s of [-1, 1]) Hd(s * 0.1, 0.2, 0.221, 0.08, 0.025, 0.008, UNDER);
  // 이마 땀방울(데움 1개 · 과열↑ 2개, 움직임 줄이기면 제자리) — 흘러내림. 2026-10-30 데움이 잘 보이게 크게(0.04×0.06 → 0.065×0.095)
  if (hs && det) {
    const nd = hs.stage >= 2 ? 2 : 1;
    for (let i = 0; i < nd; i++) {
      const dy = fx.reduced ? 0 : 0.12 * (((t * 0.45 + i * 0.5 + (ch.hash % 7) / 7) % 1));
      Hd(i ? -0.13 : 0.14, 0.37 - dy, 0.228, 0.065, 0.095, 0.02, DROP);
    }
  }
  if (F && det) {
    for (const s of [-1, 1]) Hd(s * 0.125, 0.29, ez, 0.07, 0.015, 0.01, fx.shoeC);
    Hd(0, 0.12, 0.222, 0.1, 0.025, 0.01, look.lip);
  }
  // 머리 위: 스킬 금색 큐브 / 제자리 작업 작은 상자 / 오류 !
  const topY = rootY + (nY + 0.75 + (ch.headExtra || 0)) * k;
  if (goldOn || fx.metaSkill) {
    _cG.copy(fx.skill);
    glow.box(px, topY + 0.15 + 0.05 * Math.sin(t * 3), pz, 0.16, 0.16, 0.16, _cG, t * 2);
  }
  if (ch.inPlace && ch.state === 'work' && !(ch.target && ch.target.type === 'desk')) {
    glow.box(px + 0.32, topY + 0.05, pz, 0.14, 0.14, 0.14, fx.catColor || fx.skill, t * 3);
  }
  if (ch.errUntil > fx.now) {
    glow.box(px, topY + 0.35, pz, 0.08, 0.26, 0.08, fx.error);
    glow.box(px, topY + 0.12, pz, 0.08, 0.08, 0.08, fx.error);
  }
  // 포커스·호버: 발밑 고리
  if (fx.focus || fx.hover) {
    const r = 0.62, n = 12;
    _cH.copy(fx.focus ? look.badge : fx.text);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + t * 0.8;
      glow.box(px + Math.cos(a) * r, 0.03, pz + Math.sin(a) * r, 0.14, 0.03, 0.14, _cH, -a);
    }
  }
  if (goldOn && ch.state === 'work') {
    for (let i = 0; i < 3; i++) {
      const u = (t * 0.8 + i / 3) % 1;
      glow.box(px + Math.sin(i * 2 + t) * 0.4, rootY + 0.4 + u * 1.6, pz + Math.cos(i * 2 + t) * 0.3, 0.06, 0.06, 0.06, fx.skill);
    }
  }
}

/** 멀리서 본 캐릭터(LOD): 몸통·머리 두 상자만 */
export function drawCharacterFar(ch, look, fx, lit) {
  const k = ch.scale(fx.now);
  if (k <= 0.002) return;
  const id = ch.id;
  const hs = ch._heat && ch._heat.on ? ch._heat : null; // 멀리서는 몸(옷 물듦)·얼굴만 붉게
  const body = look.jacket || look.vest || look.shirt;
  const fl = hs ? flushOf(hs) : 0, tn = heatTint(hs); // 2026-10-30 멀리서는 옷 물듦을 조금 더 세게(두 상자뿐이라)
  lit.box(ch.pos.x, 0.62 * k, ch.pos.z, 0.5 * k, 1.24 * k, 0.32 * k, tn > 0 ? _cT.copy(body).lerp(_cHt, Math.min(0.8, tn * 1.2)) : body, ch.yaw, id);
  lit.box(ch.pos.x, 1.5 * k, ch.pos.z, 0.42 * k, 0.42 * k, 0.42 * k, fl > 0 ? _cS.copy(look.skin).lerp(FLUSH, fl) : look.skin, ch.yaw, id);
}
