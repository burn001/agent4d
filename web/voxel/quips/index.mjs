// 복셀 생각·말풍선 대사 불러오기 — 지금 언어 묶음만, 처음 필요할 때 한 번(동적 import).
const cache = new Map();
/** lang 'ko' | 'en' → Promise<{상황: [줄…]}> */
export function loadQuips(lang) {
  const L = lang === 'ko' ? 'ko' : 'en';
  if (!cache.has(L)) cache.set(L, (L === 'ko' ? import('./ko.mjs') : import('./en.mjs')).then((m) => m.default).catch(() => ({})));
  return cache.get(L);
}
