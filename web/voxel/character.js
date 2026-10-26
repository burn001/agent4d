// 복셀 캐릭터 그리기 (개편) — 상태 머신은 순수 모듈(character-core.mjs).
// 스탠딩 데스크에 서서 일한다. 작업 중이면 두 손을 앞으로 뻗어 홀로그램 모니터를 두드리거나(셸·쓰기·편집) 옆으로 넘기고(읽기·검색·웹),
//        도구 없이 생각할 땐 턱을 괸다. 모니터가 접힌 대기 중에는 커피 마시기·기지개·둘러보기·생각을 돌아가며 하고, 팀장이 사람 입력을
//        오래(3분 이상) 기다리면 탕비실에서 커피를 든다(한 번 다녀오면 15분 쉼). 자율 루프 팀장은 가끔 책상 옆으로 나와
//        팀원 쪽을 가리키며 둘러본다. 퇴장(완료)은 가방을 들고 문으로 걸어 나간다.
//   복장 = 역할(office-core roleOf): 팀장 정장+넥타이 · 별관 팀장 보라 정장+모자 · 팀원 종류 색 셔츠 · 기동기 운영자 형광 조끼+모자 · 손님 외투.
//   세션 색은 사원증(목걸이 카드, 빛남)과 팀원 조끼 앞판.
// 그리기는 InstancedMesh 묶음(BoxBatch)에 상자를 밀어 넣는다(캐릭터당 draw call 0, 전체 1).
import * as THREE from 'three';
import { partBox } from './props.js';
import { Character } from './character-core.mjs';
import { idleAct } from './office-core.mjs';
import { watchPhase } from './vx-proc-core.mjs';

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

/**
 * 캐릭터 그리기. look = { role, shirt, jacket?, pants, tie?, vest?, stripe?, skin, hair, hat?, cap?, badge, sessVest?, markKind, mark? }
 * fx = { t, now, skill, error, ok, text, focus, hover, metaSkill, doneLead, idle, catColor, monK, mugC, coffeeC, bagC, shoeC }
 * 손 위치(세계)를 ch._hand[0..1] 에 남긴다(홀로그램 손끝 빛줄기용)
 */
export function drawCharacter(ch, look, fx, lit, glow) {
  const t = fx.t;
  const k = ch.scale(fx.now);
  if (k <= 0.002) return;
  const walking = ch.state === 'walk' || ch.state === 'leave' || ch.state === 'enter';
  const bob = walking ? Math.abs(Math.sin(ch.phase)) * 0.05 : 0;
  // 옆 오프셋(시설 앞에서만, 겹침 완화)
  const off = !walking && ch.target && ch.target.type === 'station' ? ch.side * 0.6 : 0;
  const px = ch.pos.x + Math.cos(ch.yaw) * off, pz = ch.pos.z - Math.sin(ch.yaw) * off;
  const rootY = bob;
  _q.setFromAxisAngle(_yAxis, ch.yaw + (ch.workCat === 'search' && ch.target && ch.target.type === 'station' ? 0.25 * Math.sin(t * 3) : 0));
  _p.set(px, rootY, pz);
  _B.compose(_p, _q, _one.set(k, k, k));
  const id = ch.id;
  const P = pose(ch, fx, t);

  // 색
  const role = look.role;
  const shirt = _cT.copy(look.shirt);
  const leaving = ch.state === 'leave' || ch.vanishT0 != null;
  if (leaving) shirt.lerp(GREY, 0.35);
  const errOn = ch.errUntil > fx.now || ch.errFlashUntil > fx.now || (fx.error && ch.node.status === 'error');
  if (errOn) shirt.lerp(fx.error, 0.55);
  const goldOn = (ch.state === 'work' && ch.workCat === 'skill') || fx.metaSkill;
  if (ch.state === 'work' && ch.workCat === 'skill') shirt.lerp(fx.skill, 0.35 + 0.15 * Math.sin(t * 6));
  const jacket = look.jacket ? _cJ.copy(look.jacket) : null;
  if (jacket && errOn) jacket.lerp(fx.error, 0.4);
  const sleeve = jacket || _cA.copy(shirt).multiplyScalar(0.9);
  const skin = look.skin;

  // 다리 + 신발
  for (const [sx, a] of [[-0.13, P.legL], [0.13, P.legR]]) {
    partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.3, 0, 0.2, 0.6, 0.22, look.pants, id);
    partBox(lit, _B, sx, HIP, 0, a, 0, 0, 0, -0.6, 0.05, 0.22, 0.08, 0.32, fx.shoeC, id);
  }
  // 몸통(허리 관절 기준 기울기) + 옷
  const breathe = 1 + 0.015 * Math.sin(t * 1.6 + ch.phase);
  partBox(lit, _B, 0, HIP, 0, P.lean, 0, 0, 0, TORSO / 2, 0, 0.54, TORSO * breathe, 0.3, shirt, id);
  if (jacket) {
    // 정장·외투: 몸통을 감싸고 앞가슴만 셔츠(+넥타이)가 보인다
    partBox(lit, _B, 0, HIP, 0, P.lean, 0, 0, 0, TORSO / 2 - 0.01, -0.005, 0.58, TORSO * 0.98, 0.32, jacket, id);
    partBox(lit, _B, 0, HIP, 0, P.lean, 0, 0, 0, TORSO - 0.16, 0.162, 0.16, 0.26, 0.012, look.shirtFront || look.shirt, id);
    if (look.tie) partBox(lit, _B, 0, HIP, 0, P.lean, 0, 0, 0, TORSO - 0.2, 0.17, 0.07, 0.32, 0.012, look.tie, id);
  }
  if (look.vest) {
    // 형광 조끼 + 반사띠 두 줄(기동기 운영자)
    partBox(lit, _B, 0, HIP, 0, P.lean, 0, 0, 0, TORSO / 2 + 0.03, 0, 0.58, TORSO * 0.82, 0.33, look.vest, id);
    for (const yy of [0.22, 0.4]) partBox(lit, _B, 0, HIP, 0, P.lean, 0, 0, 0, yy, 0, 0.59, 0.045, 0.335, look.stripe, id);
  } else if (look.sessVest) {
    // 세션 색 조끼 앞판(— 같은 프로젝트 여러 세션일 때 팀원)
    for (const s of [-1, 1]) partBox(lit, _B, 0, HIP, 0, P.lean, 0, 0, s * 0.16, TORSO / 2 + 0.02, 0.158, 0.17, TORSO * 0.78, 0.014, look.sessVest, id);
  }
  // 사원증(목걸이 카드) — 세션 색(없으면 종류 색), 빛남
  partBox(lit, _B, 0, HIP, 0, P.lean, 0, 0, 0, TORSO - 0.06, 0.165, 0.035, 0.2, 0.01, fx.shoeC);
  partBox(glow, _B, 0, HIP, 0, P.lean, 0, 0, look.vest ? 0.14 : 0, TORSO - 0.3, 0.18, 0.11, 0.14, 0.015, look.badge);
  if (look.markKind === 'necklace') partBox(lit, _B, 0, HIP, 0, P.lean, 0, 0, 0, TORSO - 0.04, 0, 0.4, 0.05, 0.36, look.mark, id);

  const sl = Math.sin(P.lean), cl = Math.cos(P.lean);
  const shY = HIP + (SHOULDER - HIP) * cl, shZ = (SHOULDER - HIP) * sl;
  // 팔 + 손
  const hands = ch._hand || (ch._hand = [new THREE.Vector3(), new THREE.Vector3()]);
  const arms = [[-0.36, P.armL, -P.rollL, 0], [0.36, P.armR, P.rollR * 0.9, 1]];
  for (const [sx, ax, rz, hi] of arms) {
    partBox(lit, _B, sx, shY, shZ, ax, 0, rz, 0, -0.26, 0, 0.16, 0.54, 0.16, sleeve, id);
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
  partBox(lit, _B, 0, nY, nZ, hp, hy, 0, 0, 0.22, 0, 0.44, 0.44, 0.44, skin, id);
  if (look.markKind === 'crown') {
    partBox(lit, _B, 0, nY, nZ, hp, hy, 0, 0, 0.46, 0, 0.64, 0.06, 0.64, look.hat, id);
    partBox(lit, _B, 0, nY, nZ, hp, hy, 0, 0, 0.56, 0, 0.42, 0.18, 0.42, look.hat, id);
  } else if (look.cap) {
    partBox(lit, _B, 0, nY, nZ, hp, hy, 0, 0, 0.47, -0.01, 0.47, 0.12, 0.47, look.cap, id);
    partBox(lit, _B, 0, nY, nZ, hp, hy, 0, 0, 0.42, 0.27, 0.4, 0.03, 0.16, look.cap, id);
  } else {
    partBox(lit, _B, 0, nY, nZ, hp, hy, 0, 0, 0.46, -0.03, 0.48, 0.1, 0.48, look.hair, id);
    partBox(lit, _B, 0, nY, nZ, hp, hy, 0, 0, 0.3, -0.2, 0.48, 0.24, 0.08, look.hair, id); // 뒷머리
  }
  // 눈(작은 점 둘) — 가까이서 사람처럼
  for (const s of [-1, 1]) partBox(lit, _B, 0, nY, nZ, hp, hy, 0, s * 0.1, 0.25, 0.222, 0.05, 0.06, 0.01, fx.shoeC, id);
  // 머리 위: 스킬 금색 큐브 / 제자리 작업 작은 상자 / 오류 !
  const topY = rootY + (nY + 0.75) * k;
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
  lit.box(ch.pos.x, 0.62 * k, ch.pos.z, 0.5 * k, 1.24 * k, 0.32 * k, look.jacket || look.vest || look.shirt, ch.yaw, id);
  lit.box(ch.pos.x, 1.5 * k, ch.pos.z, 0.42 * k, 0.42 * k, 0.42 * k, look.skin, ch.yaw, id);
}
