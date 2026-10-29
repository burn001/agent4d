// 복셀 바닥 스텐실 — 프로젝트 이름을 사무실 바닥에 페인트 글씨로. 순수 부분(three·DOM 없음, node --test 대상).
//   자리 = 동의 첫(현재 메인) 사무실 앞쪽 빈 바닥: 마지막 책상 줄 앞 ~ 앞 벽, 포털 대기 줄과 알림 벨 대기 줄 사이(가구·서는 자리 없음).
//   손님 대기석(앞 벽 벤치)이 있으면 그 앞(책상 쪽)만 쓴다. 돌린 방은 지역 좌표로 정하고 xf 로 세계에 옮기며,
//   글 읽는 방향은 화면에서 거꾸로 서지 않게(지역 +x 가 세계 −x 면 뒤집음, 세로 방향이면 −z 로 = 아래에서 위로 읽음).
//   크기 = 구역에 맞춰(긴 이름은 두 줄 → 그래도 길면 줄임표), 3D·2D 같은 결과.
import { toWorld, quarter } from './xf.mjs';
import { DESK_Z0, ROW_STEP, BASE_ROWS, WAIT_Z } from './layout.js';

export const STENCIL = {
  X0: -5.35, X1: 2.95,      // 지역 x: 포털 대기 줄(−7.9～−6.1) 오른쪽 ~ 벨 대기 줄(3.55～) 왼쪽
  DESK_CLEAR: 0.95,         // 마지막 책상 줄 중심에서 이만큼 앞부터(책상 앞 끝 0.4 + 모니터·발 여유)
  WALL_CLEAR: 0.3,          // 앞 벽 안쪽 여유
  WAIT_CLEAR: 0.45,         // 대기석이 있으면 벤치 중심에서 이만큼 뒤까지만
  ONE_LINE_MAX: 14,         // 이보다 길면 두 줄을 먼저 고려
  LINE_MAX: 18,             // 한 줄 최대 글자(넘으면 줄임표)
  CHAR_ASPECT: 0.66,        // 글자 폭 / 글자 높이(굵은 스텐실 글꼴 대략값 — 실제 그리기는 측정한 폭 비율을 씀)
  LINE_GAP: 0.18,           // 두 줄 사이(글자 높이 비율)
  H_MIN: 0.45, H_MAX: 1.7,  // 글자 높이(세계 단위) 상·하한
  FILL: 0.92,               // 구역을 다 채우지 않음(가장자리 여유)
  // 색: 다크 = 바랜 노란 페인트, 라이트 = 진한 회색 잉크. 기본 불투명도 · 고른 프로젝트 배율
  COLOR: { dark: '#c9b06a', light: '#2c3036' },
  ALPHA: { dark: 0.42, light: 0.55 },
  FOCUS_K: 1.3,
};

/** 프로젝트 표시 이름 → 스텐실 글(앞뒤 공백 정리). 비면 '' */
export function stencilText(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

const SEP = /[\s_\-./\\:·]/;
const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);

/**
 * 글 → 줄 배열(1～2줄). 짧으면 한 줄, 길면 가운데에 가까운 구분자(공백·_·-·.)에서 두 줄, 구분자가 없으면 가운데에서 자름.
 * 각 줄은 LINE_MAX 자를 넘으면 줄임표. opts.oneLineMax·lineMax 로 바꿀 수 있다.
 */
export function stencilLines(text, opts = {}) {
  const s = stencilText(text);
  if (!s) return [];
  const one = opts.oneLineMax || STENCIL.ONE_LINE_MAX, lmax = opts.lineMax || STENCIL.LINE_MAX;
  const chars = [...s];
  if (chars.length <= one) return [s];
  // 가운데에 가장 가까운 구분자
  const mid = chars.length / 2;
  let best = -1, bd = Infinity;
  for (let i = 1; i < chars.length - 1; i++) {
    if (!SEP.test(chars[i])) continue;
    const d = Math.abs(i - mid);
    if (d < bd) { bd = d; best = i; }
  }
  let a, b;
  if (best > 0 && bd <= chars.length * 0.3) {
    const keep = chars[best] === ' ' ? '' : chars[best]; // 공백은 버리고 _·- 등은 첫 줄 끝에 남김
    a = chars.slice(0, best).join('') + keep; b = chars.slice(best + 1).join('');
  } else {
    const k = Math.ceil(mid);
    a = chars.slice(0, k).join(''); b = chars.slice(k).join('');
  }
  return [clip(a.trim(), lmax), clip(b.trim(), lmax)].filter(Boolean);
}

/** 줄 배열의 글자 높이 1 기준 폭·높이(대략값: CHAR_ASPECT). 실제 그리기는 측정한 비율(aspect)을 넘긴다 */
export function linesAspect(lines, charAspect = STENCIL.CHAR_ASPECT) {
  if (!lines.length) return 0;
  const w = Math.max(...lines.map((l) => [...l].length)) * charAspect;
  const h = lines.length + (lines.length - 1) * STENCIL.LINE_GAP;
  return w / h;
}

/**
 * 방의 스텐실 구역(지역 = 돌리기 전 좌표). 사무실이 아니거나 구역이 너무 얕으면 null.
 * 반환 { x0, x1, z0, z1 } — 지역 좌표(방 원점 포함).
 */
export function stencilZone(room) {
  if (!room || room.type !== 'office') return null;
  const L = room.local || room;
  const o = L.origin, ext = L.ext || 0, rows = L.rows || BASE_ROWS;
  const lastDesk = DESK_Z0 + (rows - 1) * ROW_STEP;
  let z0 = lastDesk + STENCIL.DESK_CLEAR;
  let z1 = (L.bounds ? L.bounds.maxZ - o.z : 9 + ext) - STENCIL.WALL_CLEAR;
  const wait = (L.stools || []).some((t) => t && t.kind === 'wait');
  if (wait) z1 = Math.min(z1, WAIT_Z + ext - STENCIL.WAIT_CLEAR - 0.25);
  if (z1 - z0 < 0.8) return null;
  return { x0: o.x + STENCIL.X0, x1: o.x + STENCIL.X1, z0: o.z + z0, z1: o.z + z1 };
}

/**
 * 스텐실 놓기: 줄 배열 + 글 비율(aspect = 폭/높이, 없으면 대략값) → 세계 자리·크기·방향.
 * 반환 { x, z, w, h, angle, rx, rz, lines, charH } 또는 null
 *   w = 읽는 방향 길이, h = 글 덩어리 높이(세계 단위), (rx, rz) = 읽는 방향 단위 벡터(세계), angle = atan2(rz, rx)
 *   (2D 캔버스 회전각과 같음 — 캔버스 y = 세계 z. 3D 는 rotation.y = −angle)
 */
export function stencilPlace(room, lines, aspect = null) {
  const zone = stencilZone(room);
  if (!zone || !lines || !lines.length) return null;
  const asp = aspect > 0 ? aspect : linesAspect(lines);
  const zw = (zone.x1 - zone.x0) * STENCIL.FILL, zd = (zone.z1 - zone.z0) * STENCIL.FILL;
  let w = zw, h = zw / asp;
  if (h > zd) { h = zd; w = h * asp; }
  const rowsH = lines.length + (lines.length - 1) * STENCIL.LINE_GAP;
  let charH = h / rowsH;
  if (charH > STENCIL.H_MAX) { charH = STENCIL.H_MAX; h = charH * rowsH; w = h * asp; }
  if (charH < STENCIL.H_MIN) return null; // 너무 작으면 안 그림(읽을 수 없는 얼룩)
  const lx = (zone.x0 + zone.x1) / 2, lz = (zone.z0 + zone.z1) / 2;
  const xf = room.xf && room.local && quarter(room.xf.k) ? room.xf : null;
  const c = toWorld(xf, lx, lz), e = toWorld(xf, lx + 1, lz);
  let rx = Math.round(e.x - c.x), rz = Math.round(e.z - c.z);
  if (rx < 0) { rx = 1; rz = 0; }            // 거꾸로 선 글(180°)은 뒤집기
  else if (rx === 0) { rz = -1; }            // 세로 방향은 아래 → 위로 읽기
  return { x: c.x, z: c.z, w, h, charH, angle: Math.atan2(rz, rx), rx, rz, lines };
}

/** 동마다 스텐실을 놓을 사무실 하나: 동의 첫 사무실(현재 메인) 중 외부 작업 구역이 아닌 것 → 없으면 첫 사무실 */
export function buildingOffice(b, officeByMain) {
  if (!b || !b.offices || !b.offices.length || b.recent) return null;
  const cand = [];
  for (const o of b.offices) {
    const lay = (officeByMain && officeByMain.get(o.mainId)) || o.layout;
    const r = lay && lay.rooms ? lay.rooms.find((x) => x.type === 'office' && x.ownerId === o.mainId) : null;
    if (r) cand.push(r);
  }
  return cand.find((r) => !r.external && !r.past) || cand.find((r) => !r.external) || cand[0] || null;
}

const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
const normP = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();

/** 단일 세션 화면의 프로젝트 이름: 루트 cwd 가 프로젝트 목록에 있으면 그 이름, 아니면 cwd 끝 폴더(선택기 이름표 sessionHint 와 같은 규칙) */
export function sessionProjectName(root, projects) {
  const cwd = root && root.meta && root.meta.cwd;
  if (!cwd) return '';
  const p = (projects || []).find((x) => x && x.path && normP(x.path) === normP(cwd));
  return (p && p.name) || baseName(cwd);
}

/**
 * 지금 배치에서 스텐실 목록(그리기 전 순수 계산). 전체 보기 = 동마다 하나(이름 = 동 이름표와 같은 b.name), 단일 세션 = 루트 사무실 하나.
 * 반환 [{ key, projectId, roomId, text, room }] — 자리·크기는 stencilPlace(room, lines, aspect) 로.
 */
export function stencilTargets(lay, { mode = 'session', root = null, projects = null } = {}) {
  const out = [];
  if (!lay || !lay.rooms) return out;
  if (mode === 'all' && lay.buildings) {
    for (const b of lay.buildings) {
      const r = buildingOffice(b, lay.officeByMain);
      const text = stencilText(b.name || b.projectId);
      if (r && text) out.push({ key: 'b:' + b.projectId, projectId: b.projectId, roomId: r.id, text, room: r });
    }
    return out;
  }
  const rid = lay.rootId;
  const r = lay.rooms.find((x) => x.type === 'office' && x.ownerId === rid) || lay.rooms.find((x) => x.type === 'office');
  const text = stencilText(sessionProjectName(root, projects));
  if (r && text) out.push({ key: 's:' + r.id, projectId: null, roomId: r.id, text, room: r });
  return out;
}

/** 테마·페이드 → 색·불투명도. fade = 프로젝트 페이드 값, focus = 고른 프로젝트 */
export function stencilStyle(isLight, fade = 1, focus = false) {
  const k = isLight ? 'light' : 'dark';
  const a = Math.min(0.85, STENCIL.ALPHA[k] * (focus ? STENCIL.FOCUS_K : 1)) * Math.max(0, Math.min(1, fade));
  return { color: STENCIL.COLOR[k], alpha: a };
}

/** 결정적 난수(이름 시드) — 페인트 닳음 무늬가 새로고침·3D⇄2D 에서 같게 */
export function stencilSeed(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 스텐실 다리(브리지)를 넣을 글자: 속이 빈 칸(counter)이 떨어져 나가는 글자 — 가운데 세로 틈 */
export const BRIDGE_CHARS = new Set([...'ABDOPQRabdegopq04689@&']);
