// '띄움' 연결선 — 부모가 끊긴(nohup·& 등) 기동기(parentId null·meta.spawnedBy)와 그것을 띄운 노드 사이의
// 옅은 점선. 부모-자식 연결이 아니라 "이 노드가 저 기동기를 띄웠다"는 표시라 흐름 패킷은 흐르지 않는다. 순수 함수(three·DOM 없음).
import { isDetachedRoot } from './layout.js';
import { t as tr } from './i18n.mjs';

/**
 * 기동기 n 의 띄움 연결 상대: meta.spawnedBy 가 보이면 그 노드, 아니면(끝나 퇴장·접힘) 그 조상 중 처음 보이는 노드,
 * 그래도 없으면 같은 세션 메인(s:<rootSessionId>). 없으면 null.
 * @param byId  Map id → node
 * @param shown (id) => 지금 화면에 그려지는가
 */
export function spawnTarget(n, byId, shown, all = byId) {
  if (!isDetachedRoot(n)) return null;
  let id = n.meta.spawnedBy || null;
  for (let guard = 0; id && guard < 64; guard++) {
    if (id !== n.id && shown(id)) return id;
    const p = all.get(id) || byId.get(id); // 퇴장한(배치에서 빠진) 노드도 조상을 따라간다
    id = p ? p.parentId || null : null;
  }
  const s = n.rootSessionId ? 's:' + n.rootSessionId : null;
  return s && s !== n.id && shown(s) ? s : null;
}

/** 띄움 꼬리표(기동기 라벨): 부모가 끊긴 채 띄워진 기동기면 '띄움(nohup)' 같은 한 마디, 아니면 null */
export function spawnTag(n) {
  if (!isDetachedRoot(n)) return null;
  const cmd = JSON.stringify(n.meta.launcher || {}) + ' ' + String(n.meta.command || ''); // 기동 사슬(via)·명령에 남은 분리 표지
  const how = /\bsetsid\b/.test(cmd) ? 'setsid' : /\bdisown\b/.test(cmd) ? 'disown' : /Start-Process|\bsaps\b/i.test(cmd) ? 'Start-Process' : 'nohup';
  return tr('cards.tag.spawn', { how });
}

/** 화면의 띄움 연결 목록 [[기동기 id, 띄운 노드 id]…]. all = 퇴장한 노드까지 든 전체(조상 따라가기용) */
export function spawnLinks(byId, shown, all = byId) {
  const out = [];
  for (const n of byId.values()) {
    if (!shown(n.id)) continue;
    const t = spawnTarget(n, byId, shown, all);
    if (t) out.push([n.id, t]);
  }
  return out;
}

/** 점선 토막: 두 점 사이를 n 칸으로 나눠 칸마다 앞 fill 비율만 그린다 → [[u0, u1]…] */
export function dashSpans(n = 10, fill = 0.55) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([i / n, (i + fill) / n]);
  return out;
}
