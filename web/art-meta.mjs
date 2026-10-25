// 작업 대상 층 — 표현별 은유. 순수 부분(three·DOM 없음, node --test 대상).
// 장부·배치·연출(ArtBook·ArtLayout·ArtFx·ArtState)은 artifact-core.mjs 그대로 쓰고, 여기서는 '무엇을 어떤 모양으로' 만 바꾼다.
// 결과는 흐름과 같은 ArtGeo 버퍼(상자·원기둥·선·점·라벨) — 3D·2D 그리기 객체(art-layer3d.js·flat/art-layer2d.js)가 그대로 그린다.
//  · Planet: 섬 원반(행성) 표면의 낮은 도시 블록 = 파일(폴더 = 구역), 호수 저장고 = DB(수위 고리), 궤도 위 원형 점프 게이트 = 저장소,
//            우주 정거장 + 점선 끈 = 원격, 작은 와이어 위성 = 외부 서비스, 발사대 + 로켓 = 산출물(만들 때 솟음).
//  · 복셀 오피스: voxel/vx-art-core.mjs(서가·금고실·우편함·택배 창구·안테나·결재함 — 사무실 벽 바깥 띠).
// 원칙(흐름 와 같음): 저휘도·선 위주, 손댈 때만 4초 점등(동시 8), 종류는 색이 아니라 실루엣·선 양식·움직임으로,
// 파괴적 작업 붉은 파문, 중요 표식 작은 방패, 에이전트 → 대상 빔은 점등·초점일 때만.
import { ART, ARTGEO, ART_KEYS, artXLabel, ART_STYLE_DEFAULT, freshness, edgeWeight, blockHeight, dbLevel, fileSub, zoneKeyOf } from './artifact-core.mjs';
import { ActPos, drawActs } from './art-act-core.mjs'; // 상호작용 연출

export const KI = Object.fromEntries(ART_KEYS.map((k, i) => [k, i]));
export const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(1 - k, 3));
export const extOf = (n) => { const m = /\.([a-z0-9]{1,6})$/i.exec(String(n || '')); return m ? m[1].toUpperCase() : ''; };

// ───────────── 공용 보조(Planet·복셀) ─────────────
/** 표시 양식(⚙) → 선·채움 기본 알파(흐름과 같은 식) */
export function styleAlpha(env) {
  const st = env.style || ART_STYLE_DEFAULT;
  const B0 = Math.max(0, Math.min(1, st.bright ?? 0.35));
  return {
    B0,
    LINE_A: (0.05 + 0.5 * B0) * (env.isLight ? 1.7 : 1),
    FILL_A: st.fill === 'line' || env.isLight ? 0 : 0.005 + 0.07 * B0,
    line: st.fill === 'line',
  };
}
/** 연출 큐 → 대상별 연출 목록·점등(동시 상한 ART.LIT_MAX, 밝은 순) */
export function litMap(fx, nowSec, out = { fxBy: new Map(), litBy: new Map() }) {
  out.fxBy.clear(); out.litBy.clear();
  for (const e of fx ? fx.list : []) {
    const key = e.pid + '|' + e.id;
    (out.fxBy.get(key) || out.fxBy.set(key, []).get(key)).push(e);
    if (e.kind === 'lit') { const l = Math.max(0, 1 - (nowSec - e.t0) / e.dur) * (e.amp || 1); if (l > (out.litBy.get(key) || 0)) out.litBy.set(key, l); }
  }
  if (out.litBy.size > ART.LIT_MAX) {
    const keep = new Set([...out.litBy].sort((a, b) => b[1] - a[1]).slice(0, ART.LIT_MAX).map((x) => x[0]));
    for (const k of [...out.litBy.keys()]) if (!keep.has(k)) out.litBy.delete(k);
  }
  return out;
}
/** 대상 하나의 연출 상태: 솟음(hk 0→1·rise 1→0)·맥동·무너짐·회전 */
export function fxState(fxs, nowSec, reduced, s = {}) {
  s.hk = 1; s.pulse = 0; s.gone = 0; s.spin = 0; s.rise = 0;
  if (fxs) for (const e of fxs) {
    const k = (nowSec - e.t0) / e.dur;
    if (e.kind === 'rise') { s.hk = Math.min(s.hk, ease(k)); s.rise = Math.max(s.rise, 1 - k); }
    else if (e.kind === 'pulse') s.pulse = Math.max(s.pulse, (reduced ? 0.3 : Math.sin(Math.min(1, k) * Math.PI)) * (0.35 + 0.65 * (e.amp || 0.3)));
    else if (e.kind === 'collapse') s.gone = Math.max(s.gone, ease(k));
    else if (e.kind === 'dbw' || e.kind === 'absorb') s.spin = Math.max(s.spin, 1 - k);
  }
  return s;
}
/** 선·채움 알파(흐름 artGeometry 와 같은 식) */
export function itemAlpha(A, fr, dim, lit, sel, isLight) {
  return {
    la: Math.min(1, A.LINE_A * (0.45 + 0.55 * fr) * dim + (0.85 - A.LINE_A) * Math.max(lit, sel ? 0.7 : 0)),
    fa: A.FILL_A * fr * dim + 0.3 * lit * (isLight ? 0 : 1),
  };
}
/** 중요 표식: 작은 방패(선) */
export function shield(geo, x, y, z, la, s = 0.24) {
  const c = KI.imp, A = Math.min(1, la + 0.1);
  geo.line(x - s, y + s, z, x + s, y + s, z, c, A); geo.line(x + s, y + s, z, x + s, y - s * 0.2, z, c, A); geo.line(x - s, y + s, z, x - s, y - s * 0.2, z, c, A);
  geo.line(x - s, y - s * 0.2, z, x, y - s * 1.2, z, c, A); geo.line(x + s, y - s * 0.2, z, x, y - s * 1.2, z, c, A);
}
/** 에이전트 → 대상 빔(점등 중이거나 초점 노드 것만, 늘 바닥층 선보다 밝게, 굵기 = 누적 수) */
export function beams(geo, it, env, foot, lit, nowMs, LINE_A, x, y, z) {
  if (!(lit > 0.05 || foot)) return;
  for (const w of it.who) {
    if (foot ? w.node !== env.foot.node : nowMs - w.last > ART.EDGE_RECENT_MS) continue;
    const np = env.nodePos(w.node); if (!np) continue;
    const ea = Math.max(LINE_A + 0.12, foot ? 0.5 : 0.65 * lit) * (w.v === 'read' ? 0.6 : 1);
    geo.line(np.x, np.y, np.z, x, y, z, w.v === 'read' ? KI.read : KI.write, ea, edgeWeight(w.c));
  }
}
/**
 * 공용 연출(패킷·읽기 선·새 대상 고리·수정 맥동 고리·경보 파문). 흡입(absorb)은 표현마다.
 * o = {x, y(대상 높이), z, Y0(바닥), C(칸), sk, paper(복셀: 패킷을 서류 상자로), ring(true: 원 파문, false: 사각)}
 */
export function commonFx(geo, fxs, env, nowSec, o) {
  if (!fxs) return;
  for (const e of fxs) {
    const k = Math.max(0, (nowSec - e.t0) / e.dur);
    if (k >= 1) continue;
    const { x, y, z, Y0, C } = o;
    if (o.acts && (e.kind === 'packet' || e.kind === 'read' || e.kind === 'rise' || e.kind === 'pulse')) continue; // 연출이 대신함
    if (e.kind === 'packet' || e.kind === 'read') {
      const np = e.node ? env.nodePos(e.node) : null;
      if (!np) continue;
      if (e.kind === 'read') { geo.line(np.x, np.y, np.z, x, y, z, KI.read, 0.5 * (1 - k)); continue; }
      geo.line(np.x, np.y, np.z, x, y, z, KI.write, 0.55 * (1 - k * 0.6));
      const n = e.amp || 2;
      for (let q = 0; q < n; q++) {
        const u = ease(Math.min(1, Math.max(0, k * 1.3 - q * 0.15)));
        if (u <= 0 || u >= 1) continue;
        const px = np.x + (x - np.x) * u, py = np.y + (y - np.y) * u + (o.paper ? Math.sin(u * Math.PI) * 0.6 : 0), pz = np.z + (z - np.z) * u;
        const c = e.v === 'query' ? KI.read : KI.write;
        if (o.paper) geo.box(px, py, pz, 0.3, 0.03, 0.22, c, 0.9, null); // 복셀: 서류 한 장이 날아감
        else geo.dot(px, py, pz, 0.38, c, 0.95);
      }
    } else if (e.kind === 'rise') {
      const r = C * (0.4 + k);
      if (o.ring) geo.ring(x, Y0 + 0.03, z, r, KI.new, 0.6 * (1 - k), 22); else geo.rect(x - r, Y0 + 0.03, z - r, x + r, z + r, KI.new, 0.6 * (1 - k));
    } else if (e.kind === 'pulse') {
      const r = C * (0.45 + 0.8 * k * (0.5 + (e.amp || 0.3)));
      if (o.ring) geo.ring(x, Y0 + 0.03, z, r, KI.write, 0.45 * (1 - k), 22); else geo.rect(x - r, Y0 + 0.03, z - r, x + r, z + r, KI.write, 0.45 * (1 - k));
    } else if (e.kind === 'alarm' || e.kind === 'warn') {
      const rings = e.kind === 'alarm' ? 3 : 1;
      for (let q = 0; q < rings; q++) {
        const kk = k * 1.25 - q * 0.18;
        if (kk <= 0 || kk >= 1) continue;
        geo.ring(x, Y0 + 0.05, z, 0.5 + kk * (e.kind === 'alarm' ? 6 : 3) * Math.max(0.5, o.sk || 1), e.kind === 'alarm' ? KI.alarm : KI.warn, 0.9 * (1 - kk), 28);
      }
      if (e.kind === 'alarm' && geo.labels.length < ARTGEO.LABELS) geo.label(x, Y0 + 2.6, z, '⚠ ' + artXLabel(e.x), 'art-alarm', 'alarm', 1 - k * 0.5);
    }
  }
}
/** 집기용 기준점(화면 투영으로 가장 가까운 것 — 떠 있는 위성·게이트도 집힘) */
const hit = (env, pid, id, x, y, z, r) => { if (env.hits) env.hits.push({ pid, id, x, y, z, r }); };

// ───────────── Planet ─────────────
/** Planet 높이(바닥 Y0 기준): 서비스 위성·원격 정거장·저장소 게이트(궤도) */
export const PLANET_H = { service: 2.4, remote: 3.4, repo: 4.4 };
/** 도시 블록 높이: 흐름 판 높이(0.08～0.9, 크기·접촉 수) → 0.35～2.1(낮은 도시) */
export const cityHeight = (it) => 0.25 + ((blockHeight(it) - 0.08) / 0.82) * 1.25;

/**
 * Planet 바닥층 도형. lay = ArtState.lay(섬 로컬 격자 — 흐름과 같은 배치·축척·섬 안 보장).
 * env = 흐름 artGeometry 의 env + yOf(pid)(바닥 높이: 전체 보기 섬 원판 위 ART.FLOOR_Y, 단일 세션 −6) · hits(집기 기준점 배열, 선택)
 */
export function planetArtGeometry(book, lay, fx, nowSec, env, geo) {
  geo.begin();
  if (env.hits) env.hits.length = 0;
  const nowMs = env.nowMs || Date.now();
  const A = styleAlpha(env);
  const M = litMap(fx, nowSec, env._lm || (env._lm = { fxBy: new Map(), litBy: new Map() }));
  const S = env._fs || (env._fs = {});
  const avoid = env.avoid || [];
  const near = (x, z) => { for (const a of avoid) { const dx = x - a.x, dz = z - a.z; if (dx * dx + dz * dz < a.r * a.r) return true; } return false; };
  let budget = env.labels === false ? 0 : ARTGEO.LABELS - 3;
  const t = env.reduced ? 0 : nowSec;
  const AC = fx && fx.acts && fx.acts.list.length ? fx.acts : null;
  const AP = env._ap || (env._ap = new ActPos()); AP.begin();
  const want = AC ? AC.keys(book, zoneKeyOf) : null;
  for (const [pid, L] of lay) {
    const a = env.anchor(pid);
    if (!a || !L.bounds || !geo.pidStart(env, pid)) continue;
    const Y0 = env.yOf ? env.yOf(pid) : ART.FLOOR_Y;
    const ax = a.x, az = a.z, sk = a.k || 1, C = ART.CELL * sk;
    if (AC) { const B = L.bounds; AP.areas.set(pid, { x: ax + ((B.x0 + B.x1) / 2) * sk, y: Y0, z: az + ((B.z0 + B.z1) / 2) * sk, r: Math.max(B.x1 - B.x0, B.z1 - B.z0) * 0.5 * sk + C }); }
    const px = env.cellPx ? env.cellPx(pid) : 20;
    const far = px < ART.LOD_PX, detail = px >= ART.DETAIL_PX;
    const foot = env.foot && env.foot.pid === pid ? env.foot.set : null;
    // 구역(폴더) = 도시 구획: 이중 외곽선(가로) — 흐름의 홑 외곽선과 다르게, 아주 옅게
    for (const z of L.zones) {
      const x0 = ax + z.x0 * sk, z0 = az + z.z0 * sk, x1 = ax + z.x1 * sk, z1 = az + z.z1 * sk, A0 = A.LINE_A * 0.4 * (foot ? 0.5 : 1);
      geo.rect(x0, Y0, z0, x1, z1, KI.zone, A0);
      if (!far && detail) { const g = C * 0.12; geo.rect(x0 + g, Y0, z0 + g, x1 - g, z1 - g, KI.zone, A0 * 0.6); }
    }
    if (!far) for (const z of [...L.zones].sort((p, q) => q.n - p.n).slice(0, 4)) if (budget > 0) { geo.label(ax + ((z.x0 + z.x1) / 2) * sk, Y0 + 0.1, az + z.z1 * sk + 0.25, z.label, 'art-zone', 'zone', 0.45); budget--; }
    for (const [id, p] of L.pos) {
      const zoneItem = id.startsWith('#zone:');
      const it = zoneItem ? L.agg && L.agg.get(id) : book.get(pid, id);
      if (!it) continue;
      const x = ax + p.x * sk, z = az + p.z * sk;
      const fr = freshness(nowMs - (it.last || 0));
      const key = pid + '|' + id;
      const lit = M.litBy.get(key) || 0;
      const sel = !!(env.hover && env.hover.pid === pid && env.hover.id === id);
      let dim = foot ? (foot.has(id) ? 1.6 : 0.3) : 1;
      if (near(x, z)) dim *= 0.35;
      const { la, fa } = itemAlpha(A, fr, dim, lit, sel, env.isLight);
      const ref = zoneItem ? null : { pid, id };
      const fxs = M.fxBy.get(key) || null;
      const s = fxState(fxs, nowSec, env.reduced, S);
      const col = it.del ? KI.del : KI[it.k] ?? KI.file;
      let top = Y0 + 1, ay = Y0 + 0.5; // 방패·라벨 높이, 빔 끝 높이
      const R = want && want.has(key) ? AP.put(key, x, Y0 + 0.5, z, Y0 + 0.4, Y0, C) : null; // 연출 기준점
      if (far) {
        if (lit > 0.05 || it.imp) geo.dot(x, Y0 + 0.3, z, 0.35 * sk + 0.2, it.imp ? KI.imp : col, Math.max(la, 0.5 * lit + 0.2));
        continue;
      }
      if (it.k === 'zone') { // 폴더 묶음: 작은 스카이라인(블록 3채) + 수
        const w = C * 0.3, n = Math.min(3, 1 + Math.floor(Math.log2(1 + it.count) / 2));
        for (let q = 0; q < n; q++) { const hh = 0.5 + 0.35 * Math.log2(1 + it.count) * (1 - q * 0.25), bx = x + (q - (n - 1) / 2) * w * 1.1; tower(geo, bx, Y0, z, w, hh, KI.file, la, detail); }
        if (fa > 0.01) geo.box(x, Y0 + 0.3, z, C * 0.9, 0.6, w, KI.file, fa, null);
        if (budget > 0 && px > 10) { geo.label(x, Y0 + 2.4, z, `${it.n} ${it.count}`, 'art-zone', 'zone', 0.55); budget--; }
        if (R) R.top = Y0 + 1.2;
        continue;
      }
      if (it.k === 'file') {
        // 도시 블록: 높이 = 크기, 지붕 모양 = 하위 종류(코드 평지붕+옥상 안테나 · 문서 박공 · 데이터 지붕 격자 · 이미지 돔 · 계획 점선 비계)
        const h0 = it.del ? 0.06 : cityHeight(it);
        const h = Math.max(0.06, (s.gone ? h0 * (1 - s.gone) : h0) * s.hk * (1 + 0.35 * s.pulse));
        const w = C * 0.56, w2 = w / 2, yt = Y0 + h, c = s.gone ? KI.del : col, Ln = la + s.pulse * 0.3;
        const sub = it.del ? 'del' : fileSub(it);
        geo.rect(x - w2, yt, z - w2, x + w2, z + w2, c, Ln);
        const dash = sub === 'plan', close = px >= 16;
        // 세로 모서리: 앞 두 개만(가까우면 넷), 옅게 — 블록이 많아도 화면이 밝아지지 않게
        for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) { if (!close && sz < 0) continue; vEdge(geo, x + sx * w2, Y0, z + sz * w2, yt, c, Ln * (close ? 0.55 : 0.4), dash); }
        if (detail) {
          const m = Ln * 0.65;
          if (sub === 'code') { geo.rect(x - w2 * 0.35, yt + 0.12, z - w2 * 0.35, x + w2 * 0.15, z + w2 * 0.15, c, m); geo.line(x + w2 * 0.5, yt, z - w2 * 0.5, x + w2 * 0.5, yt + 0.45, z - w2 * 0.5, c, m); }
          else if (sub === 'doc') { const rh = w * 0.35; geo.line(x - w2, yt + rh, z, x + w2, yt + rh, z, c, Ln); for (const sz of [-1, 1]) { geo.line(x - w2, yt + rh, z, x - w2, yt, z + sz * w2, c, m); geo.line(x + w2, yt + rh, z, x + w2, yt, z + sz * w2, c, m); } }
          else if (sub === 'data') { geo.line(x, yt, z - w2, x, yt, z + w2, c, m); geo.line(x - w2, yt, z, x + w2, yt, z, c, m); }
          else if (sub === 'image') { geo.ring(x, yt + 0.02, z, w2 * 0.7, c, m, 12); geo.vring(x, yt, z, w2 * 0.7, c, m * 0.8, 12, false, 0, 1); }
          else if (sub === 'plan') { geo.rect(x - w2 - 0.12, Y0 + 0.02, z - w2 - 0.12, x + w2 + 0.12, z + w2 + 0.12, c, m * 0.7); }
          // 창: 앞면 가로 띠(높을수록 여러 층)
          const fl = close ? Math.min(3, Math.floor(h / 0.45)) : 0;
          for (let q = 1; q <= fl; q++) geo.line(x - w2 * 0.7, Y0 + (h * q) / (fl + 1), z + w2, x + w2 * 0.7, Y0 + (h * q) / (fl + 1), z + w2, c, m * 0.55);
        }
        if (fa > 0.01) geo.box(x, Y0 + h / 2, z, w, h, w, c, fa, ref);
        if (s.gone && !env.reduced) for (let q = 0; q < 4; q++) geo.dot(x + (q - 1.5) * 0.3 * sk, Y0 + 0.9 * (1 - s.gone) + 0.1, z + ((q * 37) % 5 - 2) * 0.12, 0.16, KI.del, 0.7 * (1 - s.gone));
        top = yt + 0.45; ay = Y0 + h * 0.6;
        if (R) { R.y = ay; R.top = yt; }
      } else if (it.k === 'output') {
        // 발사대: 네모 패드 + 안쪽 원 + 비계 탑(가로대) + 로켓(뾰족한 윤곽). 만들 때 로켓이 솟았다가 내려앉고 끝에서 반짝
        const w = C * 0.72, H = 1.5 * Math.max(0.7, sk) + 0.4, lift = s.rise * 2.4, c = col;
        geo.rect(x - w / 2, Y0 + 0.03, z - w / 2, x + w / 2, z + w / 2, c, la * 0.8);
        geo.ring(x, Y0 + 0.04, z, w * 0.28, c, la * 0.6, 14);
        const tx = x - w * 0.36, tz = z - w * 0.36;
        geo.line(tx, Y0, tz, tx, Y0 + H * 1.05, tz, c, la * 0.8);
        for (let q = 1; q <= 3; q++) geo.line(tx, Y0 + (H * q) / 3.2, tz, x - 0.1, Y0 + (H * q) / 3.2, z - 0.1, c, la * 0.45);
        const yb = Y0 + 0.12 + lift, rw = Math.max(0.16, w * 0.13);
        geo.line(x - rw, yb, z, x - rw, yb + H * 0.7, z, c, la); geo.line(x + rw, yb, z, x + rw, yb + H * 0.7, z, c, la);
        geo.line(x - rw, yb + H * 0.7, z, x, yb + H, z, c, la); geo.line(x + rw, yb + H * 0.7, z, x, yb + H, z, c, la);
        geo.line(x - rw, yb, z, x - rw * 2, yb - 0.1, z, c, la * 0.8); geo.line(x + rw, yb, z, x + rw * 2, yb - 0.1, z, c, la * 0.8);
        if (s.rise > 0 && !env.reduced) { geo.dot(x, yb + H, z, 0.32, KI.new, s.rise); for (let q = 0; q < 3; q++) geo.dot(x + (q - 1) * 0.15, yb - 0.25 - q * 0.25 * s.rise, z, 0.18, KI.write, 0.6 * s.rise); }
        if (fa > 0.01) geo.box(x, Y0 + 0.02, z, w, 0.04, w, c, fa, ref);
        if ((lit > 0.05 || sel || px > 16) && budget > 0 && !String(id).startsWith('artifact:')) { geo.label(x, yb + H + 0.25, z, extOf(it.n || it.id) || 'OUT', 'art-ext', 'output', Math.max(0.45, la)); budget--; }
        top = yb + H + 0.6; ay = Y0 + 0.6;
        if (R) { R.y = Y0 + 0.6; R.top = yb + H; }
      } else if (it.k === 'db') {
        // 호수 저장고: 물결진 물가(점선 아님) + 수위 고리(쓰기 누적) + 컬렉션 수만큼 동심 고리. 쓰기 순간 물결이 돎
        const r = C * 0.62, ph = s.spin * 2.2 + t * 0.15, c = col, n = 18;
        for (let q = 0; q < n; q++) {
          const a0 = (q / n) * Math.PI * 2, a1 = ((q + 1) / n) * Math.PI * 2;
          const r0 = r * (1 + 0.12 * Math.sin(a0 * 3 + 1.3)), r1 = r * (1 + 0.12 * Math.sin(a1 * 3 + 1.3));
          geo.line(x + Math.cos(a0) * r0, Y0 + 0.03, z + Math.sin(a0) * r0, x + Math.cos(a1) * r1, Y0 + 0.03, z + Math.sin(a1) * r1, c, la);
        }
        const lv = dbLevel(it), nd = Math.max(1, Math.min(6, (it.coll || []).length || 1));
        for (let q = 0; q < nd; q++) geo.ring(x, Y0 + 0.04, z, r * (0.2 + (0.65 * (q + 1)) / nd) * (0.5 + 0.5 * lv), c, la * (0.35 + 0.3 * lv), 16, q % 2 === 1, ph * (q % 2 ? -1 : 1));
        geo.ring(x, Y0 + 0.05 + 0.12 * lv, z, r * 0.9 * lv, c, Math.min(1, la * 1.1 + s.pulse * 0.4), 18); // 수위
        for (let q = 0; q < 3; q++) { const aa = ph + q * 2.1; geo.line(x + Math.cos(aa) * r * 0.5, Y0 + 0.06, z + Math.sin(aa) * r * 0.5, x + Math.cos(aa + 0.4) * r * 0.62, Y0 + 0.06, z + Math.sin(aa + 0.4) * r * 0.62, c, la * 0.7); }
        if (fa > 0.01) geo.cyl(x, Y0 + 0.03, z, r * 0.95, 0.06, c, fa * 0.8, ref);
        top = Y0 + 0.9; ay = Y0 + 0.1;
        if (R) { R.y = Y0 + 0.1; R.top = Y0 + 0.15; R.C = C * 1.4; }
      } else if (it.k === 'repo') {
        // 궤도의 원형 점프 게이트(세로 고리 + 네 집게 + 커밋 눈금), 지표 착륙 고리에서 점선 줄. push 때 눈금 회전·흡입
        const r = C * 0.5 + 0.35, yc = Y0 + PLANET_H.repo + Math.sin(t * 0.7 + p.x) * 0.12, c = col, ph = s.spin * 3;
        geo.vring(x, yc, z, r, c, la, 24); geo.vring(x, yc, z, r * 0.8, c, la * 0.55, 24, true, t * 0.3);
        for (let q = 0; q < 4; q++) { const aa = Math.PI / 4 + (q * Math.PI) / 2; geo.line(x + Math.cos(aa) * r * 0.9, yc + Math.sin(aa) * r * 0.9, z, x + Math.cos(aa) * r * 1.22, yc + Math.sin(aa) * r * 1.22, z, c, la * 0.9); }
        const ticks = Math.min(16, Math.max(4, (it.cnt?.push || 0) * 2 + (it.cnt?.write || 0)));
        for (let q = 0; q < ticks; q++) { const aa = ph + (q / ticks) * Math.PI * 2; geo.line(x + Math.cos(aa) * r * 1.02, yc + Math.sin(aa) * r * 1.02, z, x + Math.cos(aa) * r * 1.12, yc + Math.sin(aa) * r * 1.12, z, c, la * 0.6); }
        geo.ring(x, Y0 + 0.03, z, r * 0.5, c, la * 0.5, 14);
        dashed(geo, x, Y0 + 0.05, z, x, yc - r, z, c, la * 0.3, 6);
        top = yc + r + 0.5; ay = yc;
        if (R) { R.y = yc; R.top = yc + r; }
      } else if (it.k === 'remote') {
        // 우주 정거장(가운데 고리 + 십자 트러스 + 끝 모듈) + 지표에서 올라간 점선 끈 + 섬 밖 방향으로 사라지는 점선
        const yc = Y0 + PLANET_H.remote, c = col, r = C * 0.3 + 0.15;
        const dl = Math.hypot(p.x, p.z) || 1, ux = p.x / dl, uz = p.z / dl, sp = t * 0.25;
        geo.ring(x, yc, z, r, c, la, 14);
        for (let q = 0; q < 2; q++) {
          const aa = sp + (q * Math.PI) / 2, cx = Math.cos(aa), cz = Math.sin(aa), Lt = r * 2.1;
          geo.line(x - cx * Lt, yc, z - cz * Lt, x + cx * Lt, yc, z + cz * Lt, c, la * 0.85);
          for (const sg of [-1, 1]) { const mx = x + cx * Lt * sg, mz = z + cz * Lt * sg, m = 0.14; geo.rect(mx - m, yc - 0.02, mz - m, mx + m, mz + m, c, la * 0.8); }
        }
        dashed(geo, x, Y0 + 0.05, z, x, yc, z, c, la * 0.45, 7);
        for (let q = 0; q < 6; q++) { const d0 = r * 2.4 + q * 0.75, d1 = d0 + 0.38; geo.line(x + ux * d0, yc, z + uz * d0, x + ux * d1, yc, z + uz * d1, c, la * (1 - q / 6) * 0.8); }
        top = yc + 0.6; ay = yc;
        if (R) { R.y = yc; R.top = yc + 0.2; R.ox = ux; R.oz = uz; }
      } else if (it.k === 'service') {
        // 작은 와이어 위성: 몸통 상자 윤곽 + 양쪽 태양 전지판(격자 한 줄) + 접시 막대, 천천히 흔들림. 호출 때 맥동(커짐)
        const k1 = 1 + 0.35 * s.pulse, b = (C * 0.12 + 0.12) * k1, yc = Y0 + PLANET_H.service + Math.sin(t * 0.9 + p.z) * 0.15, c = col;
        boxEdges(geo, x, yc, z, b, b, b, c, la);
        for (const sg of [-1, 1]) {
          const x0 = x + sg * b, x1 = x + sg * (b + b * 3.2), hz = b * 0.9;
          geo.line(x0, yc, z, x1 - sg * b * 0.2, yc, z, c, la * 0.6);
          geo.rect(Math.min(x1, x1 - sg * b * 2.2), yc, z - hz, Math.max(x1, x1 - sg * b * 2.2), z + hz, c, la * 0.85);
          geo.line(x1 - sg * b * 1.1, yc, z - hz, x1 - sg * b * 1.1, yc, z + hz, c, la * 0.5);
        }
        geo.line(x, yc + b, z, x, yc + b * 2.6, z, c, la * 0.7);
        geo.line(x, Y0 + 0.05, z, x, yc - b, z, c, la * 0.2);
        if ((px > 12 || lit > 0.05 || sel) && budget > 0) { geo.label(x, yc + b * 2.8 + 0.1, z, String(it.n || '?').slice(0, 1).toUpperCase(), 'art-glyph', 'service', Math.max(0.5, la)); budget--; }
        top = yc + b * 3.6; ay = yc;
        if (R) { R.y = yc; R.top = yc + b; }
      }
      if (it.imp) shield(geo, x, top, z, la);
      if (it.x && it.x !== 'overwrite' && nowMs - (it.xAt || 0) < ART.ALARM_MS) geo.ring(x, Y0 + 0.03, z, C * 0.62, KI.alarm, 0.45 + 0.4 * lit, 20);
      if ((sel || lit > 0.3) && budget > 0) { geo.label(x, top + 0.35, z, it.n || it.id, 'art-item', it.k, sel ? 1 : Math.min(1, lit + 0.2)); budget--; }
      beams(geo, it, env, foot, lit, nowMs, A.LINE_A, x, ay, z);
      commonFx(geo, fxs, env, nowSec, { x, y: ay, z, Y0, C, sk, ring: true, acts: !!(fx && fx.acts) });
      if (fxs) for (const e of fxs) if (e.kind === 'absorb') absorbTo(geo, book, pid, L, e, nowSec, ax, az, sk, Y0, x, ay, z);
      if (!zoneItem) hit(env, pid, id, x, ay, z, C * 0.6);
    }
  }
  geo.ka = 1;
  if (AC) drawActs(geo, AC, nowSec, { theme: 'planet', unitPx: env.cellPx ? (p) => { const a = env.anchor(p); return env.cellPx(p) / (ART.CELL * ((a && a.k) || 1)); } : null, KI, pos: AP, zoneOf: zoneKeyOf, book, nodePos: env.nodePos, reduced: env.reduced, isLight: env.isLight, pidAlpha: env.pidAlpha || null }); // 장면도 프로젝트 페이드
  return geo;
}
/** push 흡입: 최근 파일 블록에서 게이트로 점이 날아감(n = 커밋 수) */
function absorbTo(geo, book, pid, L, e, nowSec, ax, az, sk, Y0, x, y, z) {
  const k = Math.max(0, (nowSec - e.t0) / e.dur);
  if (k >= 1) return;
  const n = e.amp || 3;
  let q = 0;
  for (const [fid, fp] of L.pos) {
    if (q >= n) break;
    const fi = book.get(pid, fid);
    if (!fi || fi.k !== 'file' || fi.del) continue;
    const u = ease(Math.min(1, Math.max(0, k * 1.4 - q * 0.08)));
    q++;
    if (u <= 0 || u >= 1) continue;
    const sx = ax + fp.x * sk, sz = az + fp.z * sk;
    geo.dot(sx + (x - sx) * u, Y0 + 0.3 + (y - Y0 - 0.3) * u + Math.sin(u * Math.PI) * 0.8, sz + (z - sz) * u, 0.3, KI.repo, 0.9);
  }
}
/** 세로 모서리(점선이면 4토막) */
function vEdge(geo, x, y0, z, y1, c, a, dash) {
  if (!dash) { geo.line(x, y0, z, x, y1, z, c, a); return; }
  const n = 4, d = (y1 - y0) / (n * 2);
  for (let q = 0; q < n; q++) geo.line(x, y0 + d * q * 2, z, x, y0 + d * (q * 2 + 1), z, c, a);
}
/** 점선(n 토막) */
export function dashed(geo, x0, y0, z0, x1, y1, z1, c, a, n = 6) {
  for (let q = 0; q < n; q++) { const u0 = q / n, u1 = (q + 0.5) / n; geo.line(x0 + (x1 - x0) * u0, y0 + (y1 - y0) * u0, z0 + (z1 - z0) * u0, x0 + (x1 - x0) * u1, y0 + (y1 - y0) * u1, z0 + (z1 - z0) * u1, c, a); }
}
/** 상자 모서리 12개(가운데 x,y,z · 반폭) */
export function boxEdges(geo, x, y, z, hx, hy, hz, c, a) {
  for (const sy of [-1, 1]) geo.rect(x - hx, y + sy * hy, z - hz, x + hx, z + hz, c, a);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) geo.line(x + sx * hx, y - hy, z + sz * hz, x + sx * hx, y + hy, z + sz * hz, c, a);
}
/** 묶음 스카이라인 탑 하나 */
function tower(geo, x, Y0, z, w, h, c, a, detail) {
  geo.rect(x - w / 2, Y0 + h, z - w / 2, x + w / 2, z + w / 2, c, a);
  geo.line(x - w / 2, Y0, z + w / 2, x - w / 2, Y0 + h, z + w / 2, c, a * 0.7); geo.line(x + w / 2, Y0, z + w / 2, x + w / 2, Y0 + h, z + w / 2, c, a * 0.7);
  if (detail) { geo.line(x + w / 2, Y0, z - w / 2, x + w / 2, Y0 + h, z - w / 2, c, a * 0.5); }
}

/** 화면 투영 집기: hits(세계 기준점) 중 화면에서 가장 가까운 것. project(x,y,z) → {x,y}|null(화면 px), rpx(r) = 세계 반경 → px */
export function pickHits(hits, px, py, project, minPx = 12) {
  let best = null, bd = Infinity;
  for (const h of hits || []) {
    const q = project(h.x, h.y, h.z, h.r);
    if (!q) continue;
    const d = Math.hypot(q.x - px, q.y - py), lim = Math.max(minPx, q.r || 0);
    if (d < lim && d < bd) { bd = d; best = { pid: h.pid, id: h.id }; }
  }
  return best;
}
