// 복셀 오피스 직원 외형(옷차림·머리·소품·체형) — 순수 모듈(three 없음).
//   성별(sex m/f, 반반) × 역할 → 옷 계열(ROLE_CLASS): 팀장·별관 팀장 = formal(정장·셔츠·넥타이/나비넥타이/스카프·구두 — 여성은 블라우스+재킷,
//   스커트 정장·바지 정장, 스카프·리본·브로치·목걸이, 펌프스·로퍼, 차분한 색, 어깨 넓고 키 약간 큼)
//   · 팀원(서브에이전트)·워크플로 에이전트 = casual(티·긴팔·후디·맨투맨·카디건·폴로·체크셔츠 + 청바지·반바지·면바지·조거 + 운동화,
//   모자·비니·헤드폰·백팩 — 여성은 니트·원피스·스커트·레깅스, 헤어핀·헤어밴드). 민머리·삭발 없음 · 기동기 운영자 = 형광 조끼(안은 캐주얼) · 손님 = 긴 외투.
//   노드 id 를 시드로 결정적으로 고른다(새로고침·재생·3D⇄2D 같은 모습). 같은 방에서 눈에 띄는 조합(sig)이 겹치면 소금(salt)을 바꿔 최대 6번 다시 고른다.
//   종류 색(서브에이전트 종류)·세션 색은 여기서 다루지 않는다 — 그리는 쪽이 로고·소매 끝·모자(캐주얼)·포켓스퀘어(정장)·사원증에 입힌다.

/** 역할(office-core roleOf) → 옷 계열 */
export const ROLE_CLASS = { lead: 'formal', annex: 'formal', staff: 'casual', wf: 'casual', operator: 'operator', guest: 'guest' };
export const classOf = (role) => ROLE_CLASS[role] || 'casual';

// 색 표(어두운·밝은 테마 공용 — 둘 다에서 읽히는 중간 명도)
export const SKINS = ['#f6d7bd', '#eac39d', '#d6a77a', '#b98257', '#8e5b3a', '#5f3a24'];
export const HAIR_NATURAL = ['#1d1d24', '#2b2118', '#3e2a1c', '#5a3a22', '#8a6a3a', '#c9a45a', '#8c3b20', '#9a9a9e', '#e3e1dc'];
export const HAIR_DYED = ['#e76fa0', '#4f7fd8', '#33b3a0', '#8a5cd0', '#f08c3a'];
const SUIT = ['#26324d', '#33394a', '#1f2229', '#45526b', '#4a3a2e', '#2e4038', '#4a2a32', '#5a6170', '#2c3e5c'];
const SUIT_ANNEX = ['#353047', '#4a3f63', '#3b2f55', '#5a4f78', '#2f2a44'];
const SHIRT = ['#f2f4f8', '#cfe0f5', '#f3dede', '#ece6d6', '#dbe9dc', '#e6e0f0'];
const TIE = ['#b23a48', '#2f5bd3', '#c9a227', '#3f7d5a', '#6b4a8a', '#1e2a44', '#d0573a', '#2a8a8a', '#8a2a2a'];
const OXFORD = ['#15171c', '#4a2e1c', '#2a1d16'];
const CASUAL = ['#e4572e', '#f2a541', '#f3d34a', '#6cc551', '#3fa7d6', '#5b6ee1', '#9b5de5', '#f15bb5', '#00b8a9',
  '#f4f4f4', '#2b2d42', '#8d99ae', '#ff8fab', '#a3c4f3', '#c1121f', '#606c38', '#bc6c25', '#7a9e9f'];
const DENIM = ['#3a5a8c', '#2b3f63', '#5b7db1', '#23252b', '#4d6a8f'];
const KHAKI = ['#b59a6a', '#c2a878', '#6b705c', '#8a7a5a', '#3d4450', '#7d5a44'];
const JOGGER = ['#4a4e57', '#2f3542', '#5c5470', '#3d5a4a'];
const SNEAKER = ['#f2f2f2', '#23252b', '#d64045', '#3f72d8', '#f2c14e', '#2bb39a', '#9aa0a8'];
const COAT = ['#5a6476', '#b08a5a', '#3a4a64', '#5d6b4a', '#7a5a4a', '#8a8f99'];
const GLASSES = ['#1d1d24', '#5a3a22', '#9aa0a8', '#b23a48'];
const PACK = ['#2b2d42', '#d64045', '#3f72d8', '#606c38', '#f2a541', '#7a5a4a'];

// 머리 모양 — 민머리·삭발 없음(정수리가 비어 보이는 선택지는 두지 않는다). 성별(sex m/f)·옷 계열별 목록
export const HAIR_STYLES = {
  m: { formal: ['short', 'side', 'slick', 'crew', 'curly'], casual: ['short', 'crew', 'side', 'curly', 'mohawk', 'shaggy'] },
  f: { formal: ['long', 'bob', 'bun', 'pony', 'lob', 'bangs'], casual: ['long', 'pony', 'twin', 'braid', 'bob', 'bun', 'bangs', 'curlylong', 'pixie'] },
};
export const NO_HAIR = ['bald', 'buzz', 'shaved']; // 쓰지 않는 이름(시험용)
export const TOPS = {
  formal: ['suit', 'suit', 'suit3'],
  casual: ['tee', 'longtee', 'hoodie', 'sweat', 'cardigan', 'polo', 'flannel'],
  casualF: ['tee', 'longtee', 'hoodie', 'cardigan', 'knit', 'dress', 'sweat'],
  operator: ['tee', 'longtee'],
  guest: ['coat'],
};
export const BOTTOMS = {
  formal: ['slacks'], formalF: ['skirt', 'slacks'],
  casual: ['jeans', 'jeans', 'shorts', 'chinos', 'joggers'], casualF: ['jeans', 'skirt', 'leggings', 'jeans', 'shorts'],
  operator: ['jeans', 'chinos'], guest: ['slacks', 'jeans'],
};
export const NECKS = { formal: ['tie', 'tie', 'tie', 'bow', 'scarf', 'turtle'], formalF: ['scarf', 'bow', 'brooch', 'necklace', 'turtle', 'none'] };
const BLOUSE = ['#f2f4f8', '#f3dede', '#ece6d6', '#e6e0f0', '#dbe9dc', '#cfe0f5', '#f6e7c8'];
const SUIT_F = ['#26324d', '#33394a', '#1f2229', '#5a3a4a', '#4a2a32', '#2e4038', '#6b5a4a', '#3d4a6b', '#8a6a5a'];
const TIGHTS = ['#2b2d33', '#3a3036', '#5a4a44'];
const HAIR_ACC = ['#f15bb5', '#f3d34a', '#3fa7d6', '#f4f4f4', '#d64045', '#9b5de5'];

/** 32비트 FNV-1a (layout hashStr 와 같은 식) */
export function hash32(s) {
  let h = 2166136261 >>> 0;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/** mulberry32 — 시드 → 0..1 난수열 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * id·역할·소금 → 외형(색은 '#rrggbb'). 같은 입력이면 늘 같은 결과.
 * { cls, sex: 'm'|'f', skin, hair, hairStyle, hairAcc: null|'pin'|'band', hairAccC, hat: null|'cap'|'capBack'|'beanie', hatC, glasses: null|색,
 *   beard: null|'beard'|'mustache', phones: null|색, top, topC, top2C, neck: null|'tie'|'bow'|'scarf'|'turtle'|'brooch'|'necklace', neckC,
 *   bottom: 'slacks'|'jeans'|'shorts'|'chinos'|'joggers'|'skirt'|'leggings'|'dress', bottomC, legC(치마·원피스 아래 다리 = 스타킹·맨다리),
 *   shoe: 'oxford'|'pumps'|'loafer'|'sneaker'|'boot', shoeC, pack: null|색, h(키), w(어깨), sig }
 */
export function appearance(id, role, salt = 0) {
  const cls = classOf(role);
  const r = rng(hash32(String(id) + '#' + cls + '#' + salt));
  const pick = (a) => a[Math.floor(r() * a.length) % a.length];
  const chance = (p) => r() < p;
  const formal = cls === 'formal', casual = cls === 'casual';
  const A = { cls, role };
  A.sex = chance(0.5) ? 'f' : 'm';
  const F = A.sex === 'f';
  A.skin = pick(SKINS);
  A.hair = casual && chance(0.12) ? pick(HAIR_DYED) : pick(HAIR_NATURAL);
  A.hairStyle = pick(HAIR_STYLES[A.sex][formal ? 'formal' : 'casual']);
  A.glasses = chance(formal ? 0.35 : 0.28) ? pick(GLASSES) : null;
  A.beard = !F && chance(formal ? 0.25 : 0.2) ? (chance(0.55) ? 'beard' : 'mustache') : null;
  A.hat = null; A.hatC = null; A.phones = null; A.pack = null; A.neck = null; A.neckC = null; A.hairAcc = null; A.hairAccC = null; A.legC = null;
  if (formal) {
    A.top = pick(TOPS.formal);
    A.topC = pick(role === 'annex' ? SUIT_ANNEX : F ? SUIT_F : SUIT);
    A.top2C = pick(F ? BLOUSE : SHIRT);
    A.neck = pick(F ? NECKS.formalF : NECKS.formal);
    if (A.neck === 'none') A.neck = null;
    A.neckC = A.neck === 'turtle' ? pick(['#1f2229', '#33394a', '#ece6d6']) : A.neck === 'brooch' || A.neck === 'necklace' ? pick(['#e0b341', '#e8e4dc', '#c0c4cc']) : pick(TIE);
    A.bottom = F ? pick(BOTTOMS.formalF) : 'slacks';
    A.bottomC = chance(0.75) ? A.topC : pick(['#3a3f4a', '#5a6170', '#2b2d33']);
    if (A.bottom === 'skirt') A.legC = chance(0.6) ? pick(TIGHTS) : A.skin;
    A.shoe = F ? pick(['pumps', 'loafer']) : 'oxford'; A.shoeC = pick(OXFORD);
    if (F) { A.h = 0.99 + 0.05 * r(); A.w = 0.97 + 0.06 * r(); } else { A.h = 1.03 + 0.05 * r(); A.w = 1.05 + 0.06 * r(); }
  } else if (casual) {
    A.top = pick(F ? TOPS.casualF : TOPS.casual);
    A.topC = pick(CASUAL);
    do A.top2C = pick(CASUAL); while (A.top2C === A.topC);
    A.bottom = A.top === 'dress' ? 'dress' : pick(F ? BOTTOMS.casualF : BOTTOMS.casual);
    A.bottomC = A.bottom === 'dress' ? A.topC : A.bottom === 'jeans' ? pick(DENIM) : A.bottom === 'joggers' || A.bottom === 'leggings' ? pick(JOGGER) : A.bottom === 'skirt' ? pick([...CASUAL, ...DENIM]) : pick(KHAKI);
    if (A.bottom === 'skirt' || A.bottom === 'dress') A.legC = chance(0.45) ? pick(TIGHTS) : A.skin;
    A.shoe = 'sneaker'; A.shoeC = pick(SNEAKER);
    const hr = r();
    if (hr < (F ? 0.08 : 0.16)) A.hat = 'cap'; else if (hr < (F ? 0.12 : 0.24)) A.hat = 'capBack'; else if (hr < (F ? 0.2 : 0.34)) A.hat = 'beanie';
    if (A.hat === 'beanie') A.hatC = pick(CASUAL); // 캡은 종류 색(그리는 쪽)
    if (F && !A.hat && chance(0.35)) { A.hairAcc = chance(0.5) ? 'pin' : 'band'; A.hairAccC = pick(HAIR_ACC); }
    A.phones = chance(0.2) ? pick(['#23252b', '#f2f2f2', '#d64045', '#3f72d8']) : null;
    A.pack = chance(0.2) ? pick(PACK) : null;
    if (F) { A.h = 0.91 + 0.08 * r(); A.w = 0.91 + 0.06 * r(); } else { A.h = 0.94 + 0.08 * r(); A.w = 0.95 + 0.06 * r(); }
  } else if (cls === 'operator') {
    A.top = pick(TOPS.operator); A.topC = pick(CASUAL); A.top2C = A.topC;
    A.bottom = pick(BOTTOMS.operator); A.bottomC = A.bottom === 'jeans' ? pick(DENIM) : pick(KHAKI);
    A.shoe = chance(0.5) ? 'boot' : 'sneaker'; A.shoeC = A.shoe === 'boot' ? pick(['#5a3a22', '#3e2a1c', '#23252b']) : pick(SNEAKER);
    A.h = (F ? 0.93 : 0.96) + 0.08 * r(); A.w = (F ? 0.94 : 1.0) + 0.06 * r();
  } else { // guest
    A.top = 'coat'; A.topC = pick(COAT); A.top2C = pick(SHIRT);
    A.neck = chance(0.5) ? 'scarf' : null; A.neckC = pick(TIE);
    A.bottom = pick(BOTTOMS.guest); A.bottomC = A.bottom === 'jeans' ? pick(DENIM) : pick(['#3a3f4a', '#2b2d33', '#5a6170']);
    A.shoe = F ? 'loafer' : 'oxford'; A.shoeC = pick(OXFORD);
    if (chance(0.25)) { A.hat = 'beanie'; A.hatC = pick(COAT); }
    A.h = (F ? 0.94 : 0.97) + 0.07 * r(); A.w = (F ? 0.94 : 1.0) + 0.05 * r();
  }
  // 모자를 쓰면 정수리는 가려진다(묶음·말총·긴머리는 뒤로 보임) — 모히칸·번·곱슬은 모자와 안 맞으니 바꿈
  if (A.hat && (A.hairStyle === 'mohawk' || A.hairStyle === 'curly')) A.hairStyle = 'short';
  if (A.hat && (A.hairStyle === 'bun' || A.hairStyle === 'curlylong')) A.hairStyle = 'long';
  A.h = Math.round(A.h * 1000) / 1000; A.w = Math.round(A.w * 1000) / 1000;
  A.sig = sigOf(A);
  return A;
}

/** 멀리서도 눈에 띄는 조합(같은 방 겹침 판정): 머리 모양·머리색·윗옷·윗옷 색·모자 */
export function sigOf(A) { return [A.hairStyle, A.hair, A.top, A.topC, A.hat || '-'].join('|'); }

/** 머리 위 장식 높이(생각·말풍선 보정, 세계 단위 — 몸 크기 1 기준) */
export function headExtra(A) {
  if (!A) return 0;
  let e = (A.h - 1) * 1.74;
  if (A.hairStyle === 'bun' && !A.hat) e += 0.08;
  else if (A.hairStyle === 'curly' || A.hairStyle === 'mohawk' || A.hairStyle === 'curlylong') e += 0.08;
  else if (A.hairAcc === 'band') e += 0.02;
  else if (A.hat === 'beanie') e += 0.1;
  else if (A.phones) e += 0.05;
  return Math.round(e * 1000) / 1000;
}

/**
 * 옷장: id+역할마다 한 번 고른 외형을 기억하고, 같은 방(roomKey)에 이미 있는 사람과 sig 가 겹치면 소금을 바꿔 다시 고른다.
 * 3D·2D 가 같은 인스턴스(`wardrobe`)를 쓰므로 표현을 바꿔도 같은 모습. 크기 상한을 넘으면 오래된 것부터 버림.
 */
export class Wardrobe {
  constructor(cap = 4000) { this.cap = cap; this.map = new Map(); this.rooms = new Map(); }
  get(id, role, roomKey = '') {
    const key = role + '\u0000' + id;
    const hit = this.map.get(key);
    if (hit) return hit;
    const taken = this.rooms.get(roomKey);
    let A = appearance(id, role, 0);
    for (let s = 1; s < 6 && taken && taken.has(A.sig); s++) A = appearance(id, role, s);
    this.map.set(key, A);
    let set = taken;
    if (!set) { set = new Set(); this.rooms.set(roomKey, set); }
    set.add(A.sig);
    if (this.map.size > this.cap) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
    return A;
  }
  clear() { this.map.clear(); this.rooms.clear(); }
}
export const wardrobe = new Wardrobe();

/** 조합 수 추정(시험·문서용): 역할 계열별 독립 선택지 곱 */
export function comboCount(cls) {
  const hair = HAIR_NATURAL.length + (cls === 'casual' ? HAIR_DYED.length : 0);
  const base = SKINS.length * hair * 2 /*안경*/;
  if (cls === 'formal') {
    const m = HAIR_STYLES.m.formal.length * 3 /*수염*/ * SUIT.length * SHIRT.length * NECKS.formal.length * TIE.length * OXFORD.length;
    const f = HAIR_STYLES.f.formal.length * SUIT_F.length * BLOUSE.length * NECKS.formalF.length * TIE.length * BOTTOMS.formalF.length * 2 /*구두*/ * OXFORD.length;
    return base * (m + f);
  }
  if (cls === 'casual') {
    const acc = CASUAL.length * (CASUAL.length - 1) * SNEAKER.length * 4 /*모자*/ * 2 /*헤드폰*/ * 2 /*백팩*/;
    const m = HAIR_STYLES.m.casual.length * 3 * TOPS.casual.length * BOTTOMS.casual.length;
    const f = HAIR_STYLES.f.casual.length * 3 /*머리 장식*/ * TOPS.casualF.length * BOTTOMS.casualF.length;
    return base * acc * (m + f);
  }
  return base;
}
