// 【모듈 규격 · 평면도(flat2d) 담당 — 플랫폼 담당과 계약 공유】 연구소 2D 플랫폼(위에서 본 원·구역 부채꼴·블록 칸). three 0.
//
// 입력: ctx(CanvasRenderingContext2D) · view(Lab2DView: _X·_Y·배율 _s·tokens·pal·_now·reduced·labPid()) · room(type 'lab', room.lab) ·
//       plan = web/lab/lab-platform-core.mjs labSectorPlan 결과(3D 와 같은 계획, 좌표는 중심 기준) · book(ArtBook) · fx(ArtFx) · now(초)
// 출력(export):
//   drawPlatformStatic2D(ctx, view, room, plan)  정적 층: 플랫폼 원·테두리 띠·구역 옅은 채움·방사선·이름·코어 원
//   drawPlatformDynamic2D(ctx, view, room, plan, book, fx, now) → 연출이 그려졌으면 true(다음 프레임 필요), 없으면 false
//     블록 = 칸 사각(labBlockShape 상자를 위에서 본 판 + 앞면 기울임 0.3 — 2D 와 같음, 가까우면 종류 글리프),
//     연출: 프린트(rise·build) = 사각이 차오름 · 파쇄(collapse·shatter) = 점 흩어짐 · 파도(radar·wave) = 구역 위 호 띠 ·
//           경보(alarm·warn) = 붉은 동심원 · 점등(lit·pulse·edit) = 밝은 테두리. 동시 점등 ≤ LAB_PERF.PLATFORM_LIT, 연출 ≤ PLATFORM_ACTS
//     계획 추가 필드(플랫폼 담당 구현 메모)도 그린다: 테두리 장치 plan.rim · 접힌 묶음 블록 sectors[].bundle('+n') ·
//     plan.agg(블록 300 넘음) = 구역 판(대상 수만큼 채움 세기 + 수). posOfId(plan, id) = 칸·장치·묶음 자리(연출·집기 공용)
//   집기: view._labHits 에 [{pid, id, x, y(화면 px), wx, wz}] 를 채운다(Lab2DView.pickArtifact·artPos 가 읽음)
import { LAB, LAB_PERF } from '../lab/lab-const.mjs';
import { labBlockShape, labAlarmSectors, bulkNote, newBulkMem, LP } from '../lab/lab-platform-core.mjs';
import { ART_KEYS, ART_GLYPH, artKeyColor } from '../artifact-core.mjs';
import { canvasAng, quadXZ } from '../lab/lab2d-core.mjs';
import { t as tr } from '../i18n.mjs';

const FONT = '"Pretendard", "Segoe UI", "Malgun Gothic", system-ui, sans-serif';
const TILT = 0.3; // 높이 → 화면 아래 앞면
const _q = new Array(8);
const ALARM_COL = { dark: '#ef4444', light: '#dc2626' };

function quad(ctx, view, x, z, w, d, th, dy = 0) {
  quadXZ(x, z, w, d, th, _q);
  ctx.beginPath();
  ctx.moveTo(view._X(_q[0]), view._Y(_q[1]) + dy);
  for (let i = 2; i < 8; i += 2) ctx.lineTo(view._X(_q[i]), view._Y(_q[i + 1]) + dy);
  ctx.closePath();
}

/** 정적: 단·테두리·구역·코어(층을 꺼도 단·코어는 그림 — 3D buildPlatformStatic 과 같음) */
export function drawPlatformStatic2D(ctx, view, room, plan) {
  const lab = room && room.lab;
  if (!lab) return;
  const s = view._s, pal = view.pal, tok = view.tokens || {}, P = LAB.PLATFORM;
  const A = room._alpha ?? 1;
  const X = view._X(lab.cx), Y = view._Y(lab.cz), rP = lab.rP * s;
  // 단 그림자(높이 0.35 → 앞면) · 테두리 · 윗면
  ctx.globalAlpha = A;
  ctx.fillStyle = pal.metalDark; ctx.beginPath(); ctx.arc(X, Y + P.H * TILT * s, rP, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.metal; ctx.beginPath(); ctx.arc(X, Y, rP, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.floorAlt; ctx.beginPath(); ctx.arc(X, Y, Math.max(0, (lab.rP - P.RIM_BAND * 0.25)) * s, 0, Math.PI * 2); ctx.fill();
  // 구역(부채꼴): 번갈아 옅은 채움 + 경계 방사선
  const secs = plan && plan.sectors ? plan.sectors : [];
  const rIn = P.CORE_R + 0.3, rOut = lab.rP - P.RIM_BAND * 0.25;
  ctx.lineWidth = Math.max(0.6, 0.05 * s);
  secs.forEach((sc, i) => {
    const a0 = canvasAng(sc.th0), a1 = canvasAng(sc.th1);
    ctx.globalAlpha = A * (i % 2 ? 0.05 : 0.1);
    ctx.fillStyle = tok.text || '#ccc';
    ctx.beginPath(); ctx.arc(X, Y, rOut * s, a0, a1, sc.th1 > sc.th0); ctx.arc(X, Y, rIn * s, a1, a0, sc.th1 <= sc.th0); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = A * 0.35; ctx.strokeStyle = pal.trim;
    ctx.beginPath(); ctx.moveTo(X + Math.cos(a0) * rIn * s, Y + Math.sin(a0) * rIn * s); ctx.lineTo(X + Math.cos(a0) * rOut * s, Y + Math.sin(a0) * rOut * s); ctx.stroke();
  });
  // 구역 이름(가장자리 안쪽, 상한 PLATFORM_LABELS)
  if (s > 4 && secs.length) {
    ctx.globalAlpha = A * 0.85; ctx.fillStyle = tok.muted || '#999';
    ctx.font = `600 ${Math.round(Math.max(9, Math.min(12, s * 0.38)))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const rr = (lab.rP - P.RIM_BAND * 0.6) * s;
    for (const sc of secs.slice(0, LAB_PERF.PLATFORM_LABELS)) {
      const a = canvasAng((sc.th0 + sc.th1) / 2);
      const nm = String(sc.name || sc.key || '').slice(0, 14);
      ctx.fillText(sc.over ? `${nm} +${sc.over}` : nm, X + Math.cos(a) * rr, Y + Math.sin(a) * rr);
    }
  }
  // 코어(가운데 기둥 — 위에서 본 원 두 겹)
  ctx.globalAlpha = A;
  ctx.fillStyle = pal.metalDark; ctx.beginPath(); ctx.arc(X, Y, P.CORE_R * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.portalCore || pal.screenDim; ctx.globalAlpha = A * 0.7; ctx.beginPath(); ctx.arc(X, Y, P.CORE_R * 0.55 * s, 0, Math.PI * 2); ctx.fill();
  // 빈 플랫폼 안내(층이 켜져 있는데 대상 없음)
  if (view._labArt && !secs.length && s > 5) {
    ctx.globalAlpha = A * 0.7; ctx.fillStyle = tok.muted || '#999';
    ctx.font = `500 ${Math.round(Math.max(9, Math.min(12, s * 0.36)))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tr('lab.platform.empty'), X, Y + (P.CORE_R + 1.2) * s);
  }
  ctx.globalAlpha = 1;
}

/** 대상 열쇠 → 장부 항목(장부 version 별 캐시) */
const _itemsCache = new WeakMap();
function itemsOf(book, pid) {
  if (!book || !book.layoutItems) return null;
  // 장부마다 pid 별 한 칸(2D 전체 보기는 연구동마다 다른 pid 로 부름 — 한 칸이면 매 프레임 서로 밀어내 Map 을 다시 만든다)
  let P = _itemsCache.get(book);
  if (!P) { P = new Map(); _itemsCache.set(book, P); }
  let c = P.get(pid);
  if (!c || c.ver !== book.version) {
    if (c == null && P.size > 64) P.clear(); // 사라진 프로젝트가 쌓이지 않게
    const lst = (book.layoutItems(pid) || {}).items || [];
    c = { ver: book.version, pid, map: new Map(lst.map((it) => [it.id, it])), shapes: new Map() }; // shapes: 대상 → labBlockShape(장부 version 안에서 재사용)
    P.set(pid, c);
  }
  return c;
}

const PRINT = new Set(['rise', 'build', 'new', 'print']);
const SHATTER = new Set(['collapse', 'shatter', 'del']);
const WAVE = new Set(['radar', 'wave']);
const ALARM = new Set(['alarm', 'warn', 'fail', 'stop']);
const LIT = new Set(['lit', 'pulse', 'edit', 'dbw', 'read', 'packet', 'absorb', 'stamp', 'flash']);

/** 대상 열쇠 → 계획 위 자리(칸 · 테두리 장치 · 접힌 묶음 블록) — 중심 기준 {x, z, theta} | null */
export function posOfId(plan, id) {
  if (!plan) return null;
  const c = plan.cellOf instanceof Map ? plan.cellOf.get(id) : null;
  if (c) return c;
  const r = plan.rim instanceof Map ? plan.rim.get(id) : null;
  if (r) return r;
  const sk = plan.bundleOf instanceof Map ? plan.bundleOf.get(id) : null;
  if (sk != null) { const sc = plan.sectors.find((q) => q.key === sk); if (sc && sc.bundle) return sc.bundle; }
  return null;
}

/** 계획 → 대상 id → 구역 열쇠(계획이 바뀔 때만 다시) — cellOf 에 sector 가 없는 계획도 sectors[].cells 로 */
const _secOf = new WeakMap();
function secOfMap(plan) {
  let m = _secOf.get(plan);
  if (!m) {
    m = new Map();
    for (const sc of plan.sectors) { for (const c of sc.cells || []) if (c.key != null) m.set(c.key, sc.key); if (sc.bundle && sc.bundle.ids) for (const id of sc.bundle.ids) m.set(id, sc.key); }
    _secOf.set(plan, m);
  }
  return m;
}
/** 경보 구역(최근 10분 파괴적) — 장부 version·items·10초마다 다시. 캐시는 계획(plan)마다 한 칸(WeakMap) —
 *  2D 전체 보기는 연구동마다 다른 계획으로 부르므로 view 하나에 한 칸이면 매 프레임 서로 밀어내 전체 스캔이 반복된다 */
export function alarm2D(view, plan, items, ver, nowMs) {
  const t10 = Math.floor(nowMs / 10_000), W = view._labAlarmW || (view._labAlarmW = new WeakMap());
  const c = W.get(plan);
  if (c && c.ver === ver && c.t10 === t10 && c.items === items) return c.r;
  const r = labAlarmSectors(plan, (id) => (items ? items.get(id) : null), nowMs);
  if (c) { c.ver = ver; c.t10 = t10; c.items = items; c.r = r; } else W.set(plan, { ver, t10, items, r });
  return r;
}
/** 구역 부채꼴 [r0, r1](화면 px) 경로 */
function wedge(ctx, X, Y, r0, r1, sc) {
  const a0 = canvasAng(sc.th0), a1 = canvasAng(sc.th1);
  ctx.beginPath(); ctx.arc(X, Y, r1, a0, a1, sc.th1 > sc.th0); ctx.arc(X, Y, r0, a1, a0, sc.th1 <= sc.th0); ctx.closePath();
}

/** 동적: 블록 칸 + 연출. 반환 true = 연출 중(다음 프레임 필요) */
export function drawPlatformDynamic2D(ctx, view, room, plan, book, fx, now) {
  const hits = view._labHits || (view._labHits = []);
  hits.length = 0;
  const lab = room && room.lab;
  if (!lab || !plan || !plan.sectors || !plan.sectors.length) return false;
  const s = view._s, tok = view.tokens || {}, isLight = !!tok.isLight, A = room._alpha ?? 1;
  const pid = view.labPid ? view.labPid() : book ? book.defaultProject : '_';
  const IC = itemsOf(book, pid), items = IC ? IC.map : null;
  const cols = view._labCols && view._labColsL === isLight ? view._labCols : (view._labColsL = isLight, view._labCols = ART_KEYS.map((k) => artKeyColor(k, isLight)));
  const cx = lab.cx, cz = lab.cz;
  const glyph = s > 14;
  if (glyph) { ctx.font = `600 ${Math.round(Math.min(14, s * 0.5))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
  // 가시성: 선 폭 max(2, 0.12·s) · 알파 0.55 이상
  const W2 = Math.max(2, 0.12 * s), RED = ALARM_COL[isLight ? 'light' : 'dark'];
  const PX = view._X(cx), PY = view._Y(cz);
  const rIn2 = (plan.rIn || LAB.PLATFORM.CORE_R + 1) * s, rOut2 = (plan.rOut || lab.rP - 1) * s;
  // 경보 구역(최근 10분 파괴적): 옅은 붉은 채움 + 굵은 빗금 — 블록 아래
  const AS = alarm2D(view, plan, items, book ? book.version : 0, view.clock ? view.clock() : Date.now());
  if (AS.set.size) {
    ctx.lineWidth = W2; ctx.strokeStyle = RED; ctx.fillStyle = RED;
    for (const sc of plan.sectors) {
      if (!AS.set.has(sc.key)) continue;
      ctx.globalAlpha = A * 0.14; wedge(ctx, PX, PY, rIn2, rOut2, sc); ctx.fill();
      const span = sc.th1 - sc.th0, n = Math.min(12, Math.max(3, Math.round(Math.abs(span) / 8)));
      ctx.globalAlpha = A * 0.6; ctx.beginPath();
      for (let q = 0; q < n; q++) {
        const a = canvasAng(sc.th0 + ((q + 0.5) * span) / n), b = canvasAng(sc.th0 + ((q + 0.5) * span) / n + (span / n) * 0.8);
        ctx.moveTo(PX + Math.cos(a) * rIn2, PY + Math.sin(a) * rIn2); ctx.lineTo(PX + Math.cos(b) * rOut2, PY + Math.sin(b) * rOut2);
      }
      ctx.stroke();
    }
  }
  let nBlocks = 0;
  const shapeOf =(id, it) => { let sh = IC.shapes.get(id); if (!sh) { sh = labBlockShape(it); IC.shapes.set(id, sh); } return sh; };
  /** 블록 하나(위에서 본 판 + 높이 기울임) — 그렸으면 true */
  const block = (id, it, wx, wz, th, extra = null) => {
    const shapes = it ? shapeOf(id, it) : null;
    if (!shapes || !shapes.length) return false;
    for (const b of shapes) {
      const col = cols[b.c] || cols[0];
      const bx = wx + (b.dx || 0), bz = wz + (b.dz || 0), lift = ((b.dy || 0) + (b.sy || 0) / 2) * TILT * s;
      ctx.globalAlpha = A * Math.min(1, (b.a ?? 0.6) * 0.8);
      ctx.fillStyle = col; quad(ctx, view, bx, bz, b.sx, b.sz, th); ctx.fill(); // 앞면(바닥)
      ctx.globalAlpha = A * Math.min(1, (b.a ?? 0.6) + 0.25);
      quad(ctx, view, bx, bz, b.sx, b.sz, th, -lift); ctx.fill(); // 윗면(높이만큼 위로)
    }
    const X = view._X(wx), Y = view._Y(wz);
    hits.push({ pid, id, x: X, y: Y, wx, wz });
    if (glyph) { ctx.globalAlpha = A * 0.85; ctx.fillStyle = tok.text || '#eee'; ctx.fillText(extra || ART_GLYPH[it.k] || '·', X, Y - 0.2 * s); }
    return true;
  };
  if (plan.agg) {
    // 블록 300 넘음(플랫폼 담당 LOD): 구역 판 = 구역마다 채움 세기(대상 수) + 수 글자
    let nMax = 1; for (const sc of plan.sectors) nMax = Math.max(nMax, sc.n || 0);
    const X = view._X(cx), Y = view._Y(cz), r0 = (plan.rIn || LAB.PLATFORM.CORE_R + 1) * s, r1 = (plan.rOut || lab.rP - 1) * s;
    ctx.font = `600 ${Math.round(Math.max(9, Math.min(13, s * 0.45)))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const sc of plan.sectors) {
      const a0 = canvasAng(sc.th0), a1 = canvasAng(sc.th1), k = Math.sqrt((sc.n || 0) / nMax);
      ctx.globalAlpha = A * (0.15 + 0.45 * k); ctx.fillStyle = cols[0];
      ctx.beginPath(); ctx.arc(X, Y, r1, a0, a1, sc.th1 > sc.th0); ctx.arc(X, Y, r0, a1, a0, sc.th1 <= sc.th0); ctx.closePath(); ctx.fill();
      const am = canvasAng((sc.th0 + sc.th1) / 2), rm = (r0 + r1) / 2;
      ctx.globalAlpha = A * 0.9; ctx.fillStyle = tok.text || '#eee'; ctx.fillText(String(sc.n || 0), X + Math.cos(am) * rm, Y + Math.sin(am) * rm);
    }
  } else {
    for (const sc of plan.sectors) {
      for (const c of sc.cells || []) {
        if (nBlocks >= LAB_PERF.PLATFORM_BLOCKS) break;
        if (c.key == null) continue;
        const it = items ? items.get(c.key) : null;
        if (block(c.key, it, cx + c.x, cz + c.z, c.theta ?? 0)) nBlocks++;
      }
      // 묶음 블록(구역 칸이 모자라 접힌 대상) — 쌓인 상자 + '+n'
      const bd = sc.bundle;
      if (bd && bd.n > 0 && items) {
        const it = items.get(bd.ids[0]);
        if (block(bd.ids[0], it, cx + bd.x, cz + bd.z, bd.theta ?? 0, '+' + bd.n)) nBlocks++;
      }
    }
  }
  // 테두리 장치(산출물 반출대·DB 탱크·원격 안테나·서비스 위성·저장소 코어)
  if (plan.rim instanceof Map && items) for (const [id, q] of plan.rim) {
    const it = items.get(id);
    if (it) block(id, it, cx + q.x, cz + q.z, q.theta ?? 0);
  }
  // ---- 연출 ----
  if (!fx) { ctx.globalAlpha = 1; return false; }
  const cellOf = plan.cellOf instanceof Map ? plan.cellOf : null;
  const list = [];
  for (const e of fx.list || []) list.push(e);
  if (fx.acts && fx.acts.list) for (const e of fx.acts.list) list.push(e);
  let drawn = false, nLit = 0, nAct = 0;
  const reduced = !!view.reduced;
  // 대량 변경(같은 구역 10초 안 쓰기 6개 이상 — 3D 와 같은 bulkNote): 구역 위 굵은 호 띠 3줄 + ×N 알약
  const bulk = view._labBulk || (view._labBulk = newBulkMem());
  const secOf = secOfMap(plan);
  for (const e of fx.list || []) {
    if (e.kind !== 'lit' || (e.amp || 1) < 1 || (e.pid != null && e.pid !== pid)) continue;
    const key = pid + '|' + e.id + '|' + e.t0;
    if (bulk.seen.has(key)) continue;
    bulk.seen.add(key); if (bulk.seen.size > 400) bulk.seen.delete(bulk.seen.values().next().value);
    const sk = secOf.get(e.id);
    if (sk != null) bulkNote(bulk, pid + '|' + sk, e.t0, now);
  }
  if (bulk.wave.size) for (const sc of plan.sectors) {
    const w = bulk.wave.get(pid + '|' + sc.key); if (!w) continue;
    const k = (now - w.t0) / LP.WAVE_S; if (k < 0 || k >= 1) continue;
    const a0 = canvasAng(sc.th0), a1 = canvasAng(sc.th1), ccw = sc.th1 > sc.th0;
    const rr = reduced ? rOut2 : rIn2 + (rOut2 - rIn2) * k;
    ctx.strokeStyle = cols[ART_KEYS.indexOf('write')] || tok.warn || '#fa0'; ctx.lineWidth = W2 * 1.3;
    for (let q = 0; q < 3; q++) {
      const r = rr - q * LP.WAVE_GAP * s; if (r < rIn2) break;
      ctx.globalAlpha = A * (0.55 + 0.4 * (1 - k) * (1 - 0.3 * q));
      ctx.beginPath(); ctx.arc(PX, PY, r, a0, a1, ccw); ctx.stroke();
    }
    // ×N: 굵은 글자 + 바탕 알약(구역 가운데)
    const am = canvasAng((sc.th0 + sc.th1) / 2), rm = (rIn2 + rOut2) / 2, tx = PX + Math.cos(am) * rm, ty = PY + Math.sin(am) * rm;
    const fs = Math.round(Math.max(11, Math.min(18, s * 0.6))), txt = '×' + w.n;
    ctx.font = `800 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText ? ctx.measureText(txt).width : fs * txt.length * 0.6, ph = fs + 6, pw = tw + fs;
    ctx.globalAlpha = A * (k < 0.85 ? 1 : (1 - k) / 0.15);
    ctx.fillStyle = isLight ? '#fff7ed' : '#1f1308';
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(tx - pw / 2, ty - ph / 2, pw, ph, ph / 2); else ctx.rect(tx - pw / 2, ty - ph / 2, pw, ph); ctx.fill();
    ctx.lineWidth = Math.max(1.5, W2 * 0.6); ctx.stroke();
    ctx.fillStyle = cols[ART_KEYS.indexOf('write')] || tok.text; ctx.fillText(txt, tx, ty);
    nAct++; drawn = true;
  }
  for (const e of list) {
    if (nAct >= LAB_PERF.PLATFORM_ACTS) break;
    if (e.pid != null && e.pid !== pid) continue;
    const kind = e.a || e.kind;
    const u = Math.max(0, Math.min(1, (now - e.t0) / Math.max(0.05, e.dur || 1)));
    if (now < e.t0 || u >= 1) continue;
    if (WAVE.has(kind)) {
      // 구역 위 호 띠(그 대상의 구역, 없으면 전체 링)
      const c = cellOf && e.id != null ? cellOf.get(e.id) : null;
      const sk = e.id != null && plan.bundleOf instanceof Map ? plan.bundleOf.get(e.id) : null;
      const sec = c ? plan.sectors.find((q) => q.cells && q.cells.includes(c)) : sk != null ? plan.sectors.find((q) => q.key === sk) : null;
      const rr = (LAB.PLATFORM.CORE_R + (lab.rP - LAB.PLATFORM.CORE_R) * (reduced ? 0.6 : u)) * s;
      ctx.globalAlpha = A * (0.55 + 0.4 * (1 - u)); ctx.strokeStyle = tok.link || '#5b8fd6'; ctx.lineWidth = Math.max(W2, 0.25 * s);
      ctx.beginPath();
      if (sec) ctx.arc(view._X(cx), view._Y(cz), rr, canvasAng(sec.th0), canvasAng(sec.th1), sec.th1 > sec.th0);
      else ctx.arc(view._X(cx), view._Y(cz), rr, 0, Math.PI * 2);
      ctx.stroke();
      nAct++; drawn = true; continue;
    }
    const c = e.id != null ? posOfId(plan, e.id) : null;
    if (!c) continue;
    const wx = cx + c.x, wz = cz + c.z, X = view._X(wx), Y = view._Y(wz), th = c.theta ?? 0;
    if (PRINT.has(kind)) {
      const k = reduced ? 1 : u;
      ctx.globalAlpha = A * 0.9; ctx.fillStyle = tok.ok || '#34d399';
      quad(ctx, view, wx, wz, 0.95, 0.95 * k, th); ctx.fill();
    } else if (SHATTER.has(kind)) {
      ctx.fillStyle = tok.muted || '#aaa'; ctx.globalAlpha = A * (1 - u);
      for (let i = 0; i < 8; i++) {
        const a = i * 0.785 + (e.id ? e.id.length : 0), d = (reduced ? 0.4 : 0.2 + u * 1.2) * s;
        ctx.beginPath(); ctx.arc(X + Math.cos(a) * d, Y + Math.sin(a) * d, Math.max(1, 0.08 * s), 0, Math.PI * 2); ctx.fill();
      }
    } else if (ALARM.has(kind)) {
      ctx.strokeStyle = RED; ctx.lineWidth = Math.max(W2, 0.15 * s);
      for (let i = 0; i < 3; i++) {
        const uu = reduced ? i / 3 : (u * 2 + i / 3) % 1;
        ctx.globalAlpha = A * (0.55 + 0.4 * (1 - uu));
        ctx.beginPath(); ctx.arc(X, Y, (0.4 + uu * 2.2) * s, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (LIT.has(kind)) {
      if (nLit >= LAB_PERF.PLATFORM_LIT) continue;
      nLit++;
      ctx.globalAlpha = A * (reduced ? 0.9 : 0.4 + 0.6 * (1 - u)); ctx.strokeStyle = cols[ART_KEYS.indexOf(kind === 'read' ? 'read' : 'write')] || tok.text;
      ctx.lineWidth = Math.max(1.2, 0.12 * s);
      quad(ctx, view, wx, wz, 1.05, 1.05, th); ctx.stroke();
    } else continue;
    nAct++; drawn = true;
  }
  ctx.globalAlpha = 1;
  return drawn;
}
