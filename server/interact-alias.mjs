// Interactive 기기 별칭: 형용사 + 명사 + '의' + 명사 — 예 '푸른하늘의고양이' / 영어 'blue-sky-cat'.
// 세 목록은 한·영이 같은 자리끼리 짝이다(같은 번호 세 개 = 같은 별칭). 기기마다 번호 세 개를 한 번 뽑아 저장하고(서버 등록 때),
// 화면·CLI 는 로케일에 맞는 꼴을 보여 준다. 사람 이름·민감어 없이 무난한 자연·사물·동물 낱말만. 조합 수 = A × B × C.
import crypto from 'node:crypto';

/** [ko, en] — 형용사(관형형) */
export const ADJ = [
  ['푸른', 'blue'], ['맑은', 'clear'], ['고요한', 'calm'], ['따뜻한', 'warm'], ['작은', 'small'], ['커다란', 'big'],
  ['밝은', 'bright'], ['둥근', 'round'], ['빠른', 'swift'], ['느린', 'slow'], ['부드러운', 'soft'], ['하얀', 'white'],
  ['은빛', 'silver'], ['붉은', 'red'], ['노란', 'yellow'], ['시원한', 'cool'], ['은은한', 'gentle'], ['새로운', 'new'],
  ['깊은', 'deep'], ['높은', 'tall'], ['넓은', 'wide'], ['조용한', 'quiet'], ['반짝이는', 'sparkling'], ['단단한', 'sturdy'],
  ['가벼운', 'light'], ['상쾌한', 'fresh'], ['포근한', 'cozy'], ['싱그러운', 'lush'], ['향긋한', 'fragrant'], ['투명한', 'crystal'],
  ['신비한', 'mystic'], ['용감한', 'brave'], ['슬기로운', 'wise'], ['씩씩한', 'bold'], ['느긋한', 'easy'], ['재빠른', 'nimble'],
  ['너그러운', 'kind'], ['잔잔한', 'still'], ['환한', 'radiant'], ['촉촉한', 'dewy'], ['초록', 'green'], ['보랏빛', 'violet'],
];

/** [ko, en] — 첫 명사(자연·장소·계절, '의' 앞) */
export const NOUN1 = [
  ['하늘', 'sky'], ['바다', 'sea'], ['숲', 'forest'], ['강', 'river'], ['산', 'mountain'], ['들판', 'meadow'],
  ['호수', 'lake'], ['구름', 'cloud'], ['바람', 'wind'], ['달', 'moon'], ['별', 'star'], ['해', 'sun'],
  ['눈', 'snow'], ['비', 'rain'], ['섬', 'island'], ['계곡', 'valley'], ['언덕', 'hill'], ['바위', 'rock'],
  ['모래', 'sand'], ['이슬', 'dew'], ['안개', 'mist'], ['노을', 'sunset'], ['새벽', 'dawn'], ['봄', 'spring'],
  ['여름', 'summer'], ['가을', 'autumn'], ['겨울', 'winter'], ['정원', 'garden'], ['들꽃', 'wildflower'], ['단풍', 'maple'],
  ['소나무', 'pine'], ['대나무', 'bamboo'], ['연못', 'pond'], ['폭포', 'waterfall'], ['동굴', 'cave'], ['초원', 'prairie'],
  ['해변', 'beach'], ['등대', 'lighthouse'], ['오솔길', 'trail'], ['개울', 'brook'], ['무지개', 'rainbow'], ['은하', 'galaxy'],
  ['파도', 'wave'], ['얼음', 'ice'], ['꽃', 'flower'], ['밤', 'night'],
];

/** [ko, en] — 끝 명사(동물·사물) */
export const NOUN2 = [
  ['고양이', 'cat'], ['강아지', 'puppy'], ['여우', 'fox'], ['토끼', 'rabbit'], ['사슴', 'deer'], ['곰', 'bear'],
  ['늑대', 'wolf'], ['다람쥐', 'squirrel'], ['고래', 'whale'], ['돌고래', 'dolphin'], ['거북', 'turtle'], ['부엉이', 'owl'],
  ['참새', 'sparrow'], ['두루미', 'crane'], ['펭귄', 'penguin'], ['수달', 'otter'], ['판다', 'panda'], ['코끼리', 'elephant'],
  ['기린', 'giraffe'], ['사자', 'lion'], ['호랑이', 'tiger'], ['나비', 'butterfly'], ['꿀벌', 'bee'], ['개구리', 'frog'],
  ['물개', 'seal'], ['오리', 'duck'], ['백조', 'swan'], ['너구리', 'raccoon'], ['고슴도치', 'hedgehog'], ['햄스터', 'hamster'],
  ['조랑말', 'pony'], ['양', 'sheep'], ['염소', 'goat'], ['매', 'hawk'], ['독수리', 'eagle'], ['갈매기', 'seagull'],
  ['앵무새', 'parrot'], ['문어', 'octopus'], ['해파리', 'jellyfish'], ['종달새', 'lark'], ['등불', 'lantern'], ['조약돌', 'pebble'],
  ['풍경', 'windchime'], ['연', 'kite'], ['나침반', 'compass'], ['피리', 'flute'], ['종', 'bell'], ['씨앗', 'seed'],
  ['열매', 'berry'], ['깃털', 'feather'],
];

export const ALIAS_SPACE = ADJ.length * NOUN1.length * NOUN2.length;

/** 번호 세 개 → { ko, en } (범위 밖이면 null) */
export function aliasOf(ix) {
  if (!Array.isArray(ix) || ix.length !== 3) return null;
  const [a, b, c] = ix.map(Number);
  const A = ADJ[a], B = NOUN1[b], C = NOUN2[c];
  if (!A || !B || !C) return null;
  return { ko: `${A[0]}${B[0]}의${C[0]}`, en: `${A[1]}-${B[1]}-${C[1]}` };
}

const rnd = (n) => crypto.randomInt(n);

/**
 * 쓰지 않은 별칭 하나 뽑기. taken = 이미 쓰는 번호 키('a.b.c') 또는 한·영 별칭 문자열 Set.
 * 충돌하면 다시 뽑는다(64번) — 그래도 겹치면(거의 불가능) 순서대로 첫 빈 칸.
 * @returns {{ix:number[], ko:string, en:string}}
 */
export function pickAlias(taken = new Set(), rand = rnd) {
  const free = (ix) => { const al = aliasOf(ix); return al && !taken.has(ix.join('.')) && !taken.has(al.ko) && !taken.has(al.en) ? al : null; };
  for (let i = 0; i < 64; i++) {
    const ix = [rand(ADJ.length), rand(NOUN1.length), rand(NOUN2.length)];
    const al = free(ix);
    if (al) return { ix, ...al };
  }
  for (let a = 0; a < ADJ.length; a++) for (let b = 0; b < NOUN1.length; b++) for (let c = 0; c < NOUN2.length; c++) {
    const al = free([a, b, c]);
    if (al) return { ix: [a, b, c], ...al };
  }
  throw new Error('alias space exhausted');
}

/** CLI·검색용 비교 꼴: 공백·'-'·'_' 를 빼고 소문자 */
export const aliasKey = (s) => String(s || '').normalize('NFC').replace(/[\s_\-]+/g, '').toLowerCase();
