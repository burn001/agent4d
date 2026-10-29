// 2D(저사양) 표현 공용 그리기. Flow 2D·Planet 2D·복셀 2D 가 같이 쓴다(three 없음).
//   도구 카드(홀로그램 패널 2D판,: 방향 슬롯·펼침/접힘 미끄러짐·섬광·실제 출력 줄·자물쇠) · 퍼지는 고리 효과 ·
//   말풍선(DOM .flow-bubble, BubbleBook) · 배치 장치 칩(진행 막대·표시등·상태 띠 5칸).
// 1단계에서 flow2d.js 안에 있던 코드를 그대로 옮겼다 — 표현마다 다른 것은 기준점(anchorOf: 노드 자리 대신 책상 등)뿐.
import { HOLO, PANEL, panelRows, textRows, fallbackPanel, markStyle } from '../holo-core.mjs';
import { runRing } from '../run-core.mjs'; // 셸 머리 띠 진행 링

/** 꼬리 작은 상태: 마지막(비지 않은) 줄 하나 → [{text, mark}] (holo-text.js lastRow 와 같음) */
function lastRow(p) {
  for (let i = p.lines.length - 1; i >= 0; i--) if (String(p.lines[i]).trim()) return [{ text: p.lines[i], mark: p.marks[i] || 'o' }];
  return [];
}
import { foldSlide, easeOut } from '../exit-core.mjs';
import { catColor } from '../flow-core.mjs';
import { cycleProgress } from '../batch-core.mjs';
import { BubbleBook, BUBBLE } from '../flowview/flow-style.mjs';
import { islandStyle, PULSE_AMP, islandOutline, zoneRayLen } from '../overview/pick-core.mjs';
import { toScreen, cardOffset, cardPx } from './flat-core.mjs';
import { dodgeBox } from '../label-place.mjs';
import { DEG, degOf, glitchAt, seedOf } from '../degrade-core.mjs';
import { t } from '../i18n.mjs';

export const MONO = 'ui-monospace, "Cascadia Mono", Consolas, "D2Coding", "Malgun Gothic", monospace';
const ROLE_KEYS = new Set(['text', 'user', 'result', 'error', 'tool']);
const roleLabel = (r) => (ROLE_KEYS.has(r) ? t('flat.role.' + r) : '');

export function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
/** 글자 폭 대략(한글·CJK 2칸) 으로 잘라 넘치지 않게 — measureText 를 줄마다 부르지 않으려고 */
export function fitChars(s, maxCols) {
  s = String(s ?? '');
  let cols = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    cols += c > 0x2e80 ? 2 : 1;
    if (cols > maxCols) return s.slice(0, Math.max(0, i - 1)) + '…';
  }
  return s;
}
/** ctx.font 는 대입할 때마다 글꼴 문자열을 해석하므로 바뀔 때만 넣는다 */
export function setFont(view, ctx, f) { if (view._font !== f) { ctx.font = f; view._font = f; } }

/** 카드 방향에 노드 라벨이 있으면 라벨 높이만큼 더 띄운다(labelPush): 라벨 아래 = 아래쪽(agent), 라벨 위 = 위쪽(search·say) */
function labelPushPx(view, e, v, chipPx) {
  if (!v.labelOn) return 0;
  const up = view.labelUp ? view.labelUp(v) : false;
  const hit = up ? e.dir === 'search' || e.dir === 'say' : e.dir === 'agent' && view.labelBelow;
  return hit ? (v._labelH || 34) + Math.min(90, chipPx * 1.25 + 4) - chipPx : 0;
}

// ---------- 도구 카드(홀로그램 패널 2D판) ----------
/** anchorOf(v) → {x, y, R}(화면 px 기준점·칩 반지름) — 없으면 노드 자리(v._sp, v._R) */
export function drawCards(view, ctx, now, s, anchorOf = null, onlyTop = false) {
  const book = view.holo.book;
  const rects = view._cardRects || (view._cardRects = []);
  rects.length = 0;
  const hits = view._cardHits || (view._cardHits = []); hits.length = 0; // 카드 집기(사각형·노드·도구 호출) // 이번에 그린 카드 사각형 — 노드 라벨이 피한다
  const L = view.tokens.isLight;
  const cards = [];
  for (const [nid, arr] of book.byNode) {
    const v = view.vis.get(nid);
    if (!v || v.hidden || v.gone || !v._on || (v.scopeD ?? v.scopeK ?? 1) < 0.5) continue; // 페이드 중엔 흐리게(alpha 가 scopeK 를 곱함)
    const foc = nid === view.focusId || nid === view.hoverId;
    const shot = nid === view.camShotId;
    const top = foc || shot || view._topActive.has(nid);
    if (onlyTop && !top) continue; // 복셀 평면도: 책상이 촘촘해 상위 활동·포커스 카드만
    const boost = foc ? 1.3 : shot ? 1.5 : 1;
    for (const e of arr) {
      if (e.slot < 0) continue;
      const ph = book.phaseOf(e, now);
      if (!ph || ph.phase === 'gone') continue;
      const hPx = cardPx(1.25 + 0.3 * v.r, s, { boost, minPx: top ? HOLO.MIN_PX_ACTIVE : 0 }) * (e.mini ? HOLO.MINI_K : 1); // 백그라운드 셸 꼬리 작은 상태
      if (hPx < HOLO.LOD_HIDE_PX) continue;
      const score = (foc ? 1e6 : 0) + (shot ? 5e5 : 0) + (top ? 1e5 : 0) + hPx + (e.endAt == null ? 50 : 0) + (e.panel ? 25 : 0) + (e._txt ? 1.2e5 : 0);
      cards.push({ e, v, ph, hPx, score });
    }
  }
  if (!cards.length) return;
  // 본문 글은 점수 높은 PANEL.TEXT_MAX 장만(그 밖은 머리줄만)
  cards.sort((a, b) => b.score - a.score);
  for (let i = 0; i < cards.length; i++) cards[i].e._txt = i < PANEL.TEXT_MAX;
  // 먼 것부터(점수 낮은 것) 그려 가까운·중요한 카드가 위에
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (let i = cards.length - 1; i >= 0; i--) drawCard(view, ctx, cards[i], now, L, anchorOf);
  ctx.globalAlpha = 1;
}

function drawCard(view, ctx, { e, v, ph, hPx }, now, L, anchorOf) {
  const P = view.P;
  const wPx = Math.min(420, hPx * (e.asp || 1.4));
  const A = anchorOf ? anchorOf(v) : null;
  const chipPx = A && A.R != null ? A.R : v._R;
  const off = cardOffset(e.dir, chipPx, wPx, hPx, e.slot, labelPushPx(view, e, v, chipPx));
  let slide = 1;
  if (ph.phase === 'open') slide = easeOut(Math.min(1, (now - e.t0) / (HOLO.OPEN * 1.3)));
  else if (ph.phase === 'fold') slide = foldSlide(ph.fk || 0);
  const nx = A ? A.x : v._sp.x, ny = A ? A.y : v._sp.y;
  const cx = nx + off.dx * slide, cy = ny + off.dy * slide;
  const w = wPx * Math.min(1.1, ph.sx), h = hPx * Math.min(1.1, ph.sy);
  const alpha = ph.alpha * (v.exitF ?? 1) * Math.min(1, (v.scopeK ?? 1) * 1.3);
  if (alpha < 0.02 || w < 1 || h < 1) return;
  const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  if (x0 > view.W || y0 > view.H || x0 + w < 0 || y0 + h < 0) return; // 화면 밖
  if (alpha > 0.15 && h >= 6 && ph.phase !== 'fold' && view._cardRects) view._cardRects.push([x0, y0, x0 + w, y0 + h]);
  if (alpha > 0.15 && ph.phase !== 'fold' && view._cardHits) view._cardHits.push({ x0, y0, x1: x0 + w, y1: y0 + h, id: v.id, e, ax: nx, ay: ny }); // ax·ay = 카드 기준점(px, 복셀은 책상) — 맞춤
  const cat = e.cat;
  const ink = cat === 'skill' ? view.tokens.skill : cat === 'say' ? P.text : catColor(cat, L);
  const resCol = e.res === 'error' ? P.error : e.res === 'stopped' ? P.stopped : P.done;
  // 노드 → 카드 도구 빔 — 아주 작은 카드는 생략. Planet(A.proj): 위성에서 카드 가까운 변으로 펼쳐지는 투사 빔(두 선 + 옅은 삼각)
  if (h >= 44 && A && A.proj) drawProjector(ctx, A.proj(cx, cy) || { x: nx, y: ny }, x0, y0, w, h, ink, alpha);
  else if (h >= 8) { ctx.globalAlpha = alpha * 0.32; ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(cx, cy); ctx.stroke(); }
  const small = h < 14;
  if (small) {
    // 먼 카드: 사각 하나(경로·자르기 없음)
    ctx.globalAlpha = alpha * (L ? 0.93 : 0.88); ctx.fillStyle = L ? '#ffffff' : P.interior; ctx.fillRect(x0, y0, w, h);
    ctx.globalAlpha = alpha; ctx.strokeStyle = ph.flash > 0.3 ? resCol : ink; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    ctx.globalAlpha = 1;
    return;
  }
  const rad = Math.min(8, h * 0.14);
  rrect(ctx, x0, y0, w, h, rad);
  ctx.globalAlpha = alpha * (L ? 0.93 : 0.88);
  ctx.fillStyle = L ? '#ffffff' : P.interior;
  ctx.fill();
  if (ph.flash > 0.01) { ctx.globalAlpha = alpha * Math.min(0.35, ph.flash * 0.35); ctx.fillStyle = resCol; ctx.fill(); } // 결과 물들임(섬광·남김)
  if (A && A.scan && h >= 18) drawScan(ctx, x0, y0, w, h, rad, ink, alpha, now, L);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = ph.flash > 0.3 ? resCol : ink;
  ctx.lineWidth = ph.flash > 0.3 ? 2 : 1.2;
  ctx.stroke();
  if (cat === 'say') { ctx.beginPath(); ctx.moveTo(cx - 5, y0 + h); ctx.lineTo(cx, y0 + h + 6); ctx.lineTo(cx + 5, y0 + h); ctx.stroke(); } // 말: 아래 꼬리
  if ((ph.phase === 'open' && ph.sy < 0.6) || ph.phase === 'fold') { ctx.globalAlpha = 1; return; }
  const panel = e.panel || fallbackPanel(e);
  const secret = panel.hidden === 'secret';
  const hh = Math.max(9, Math.min(18, h * 0.22));
  const fs = Math.round(Math.max(7, Math.min(12, hh * 0.72)));
  // 머리 띠: 도구명(종류 잉크 색) · 대상 — 사각 안이라 자르기 없이 글자 수로 맞춤
  ctx.globalAlpha = alpha * 0.16; ctx.fillStyle = ink; ctx.fillRect(x0 + 1, y0 + 1, w - 2, hh + 1);
  ctx.globalAlpha = alpha; ctx.fillStyle = ink;
  setFont(view, ctx, `700 ${fs}px ${MONO}`);
  const cols = Math.max(3, Math.floor((w - 10) / (fs * 0.62)));
  const title = secret ? (e.label && e.label.tool) || e.tool || '' : panel.title || ((e.label && e.label.tool) || e.tool || '') + (e.label && e.label.target ? ' · ' + e.label.target : '');
  // 신호 열화: 그 세션 카드 글이 가끔 ▒·? 로 깨졌다 돌아옴(표시만, 원문 그대로)
  const dg = DEG.on && !DEG.reduced ? degOf(e.node) : 0, gs = dg > 0 ? (e._gs ?? (e._gs = seedOf(e.id))) : 0;
  const gl = (str, i) => (dg > 0 ? glitchAt(str, dg, DEG.t, gs + i * 131) : str);
  let tcols = cols;
  if (e.runHead && !secret) { // 셸 경과: 머리 띠 오른쪽 [링] 3:42
    const rc = e.runStale ? (L ? '#c2410c' : '#fb923c') : ink;
    const rt = e.runHead, rw = Math.ceil(rt.length * fs * 0.62) + 4;
    ctx.textAlign = 'right'; ctx.fillStyle = rc;
    ctx.fillText(rt, x0 + w - 5, y0 + hh / 2 + 1);
    let used = rw;
    if (e.runLong && w > 90) {
      const r = fs * 0.36, cx = x0 + w - 5 - rw - r - 1, cy = y0 + hh / 2 + 1;
      ctx.lineWidth = Math.max(1, fs * 0.14); ctx.strokeStyle = rc;
      ctx.globalAlpha = alpha * 0.3; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.04, view.reduced ? 1 : runRing(e.runMs))); ctx.stroke();
      used += r * 2 + 3;
    }
    ctx.textAlign = 'left'; ctx.fillStyle = ink;
    tcols = Math.max(3, cols - Math.ceil(used / (fs * 0.62)));
  }
  ctx.fillText(gl(fitChars((secret ? '🔒 ' : '') + title, tcols), 0), x0 + 5, y0 + hh / 2 + 1);
  // 본문: 가까우면(카드 높이 ≥ PANEL.TITLE_PX) 실제 출력 줄, 멀면 머리줄만. 글 칸은 점수 높은 TEXT_MAX 장만
  if ((h < PANEL.TITLE_PX && !(e.mini && h >= 22)) || !e._txt) { ctx.globalAlpha = 1; return; } // 작은 상태는 낮아도 한 줄
  const bodyY = y0 + hh + 4, bodyH = h - hh - 7, bodyW = w - 12;
  if (secret) {
    ctx.fillStyle = L ? '#3a4558' : '#b9c7da';
    setFont(view, ctx, `600 ${Math.round(Math.max(8, Math.min(12, bodyH * 0.25)))}px ${MONO}`);
    ctx.fillText(t('flat.card.secret'), x0 + 6, bodyY + bodyH / 2);
    ctx.globalAlpha = 1;
    return;
  }
  const rows = e._rows = e.mini ? 1 : textRows(h, e._rows ?? null); // 꼬리 작은 상태 = 마지막 줄 하나
  if (rows === 0) {
    // 제목만 단계: 대상을 본문 자리에 크게
    const f2 = Math.round(Math.max(8, Math.min(13, bodyH * 0.32)));
    ctx.fillStyle = L ? '#1b2433' : '#d6e2ef';
    setFont(view, ctx, `600 ${f2}px ${MONO}`);
    const t2 = (e.label && e.label.target) || (panel.lines && panel.lines[0]) || '';
    ctx.fillText(gl(fitChars(t2, Math.floor(bodyW / (f2 * 0.62))), 1), x0 + 6, bodyY + bodyH / 2);
    ctx.globalAlpha = 1;
    return;
  }
  const lines = e.mini ? lastRow(panel) : panelRows(panel, rows);
  const lh = Math.max(7, Math.min(13, bodyH / Math.max(1, Math.max(rows, lines.length))));
  const lf = Math.round(Math.max(7, lh * 0.82));
  const fN = `500 ${lf}px ${MONO}`, fB = `700 ${lf}px ${MONO}`;
  const lcols = Math.max(4, Math.floor(bodyW / (lf * 0.62)));
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i], ms = markStyle(ln.mark, L);
    const ly = bodyY + i * lh;
    if (ly + lh > y0 + h) break;
    if (ms.bg) { ctx.globalAlpha = alpha; ctx.fillStyle = ms.bg; ctx.fillRect(x0 + 2, ly, w - 4, lh); }
    ctx.globalAlpha = alpha * (ms.dim ? 0.8 : 1);
    ctx.fillStyle = ms.color || ink;
    setFont(view, ctx, ms.bold ? fB : fN);
    ctx.fillText(gl(fitChars((ln.mark === '$' ? '$ ' : '') + ln.text, lcols), i + 2), x0 + 6, ly + lh / 2);
  }
  ctx.globalAlpha = 1;
}

/** Planet 투사 빔: 시작점(위성) → 카드에서 그 점을 마주한 변의 두 끝 */
function drawProjector(ctx, src, x0, y0, w, h, ink, alpha) {
  const cx = x0 + w / 2, cy = y0 + h / 2;
  let ax, ay, bx, by;
  if (Math.abs(src.y - cy) / h > Math.abs(src.x - cx) / w) { const yy = src.y > cy ? y0 + h : y0; ax = x0 + w * 0.12; bx = x0 + w * 0.88; ay = by = yy; }
  else { const xx = src.x > cx ? x0 + w : x0; ay = y0 + h * 0.15; by = y0 + h * 0.85; ax = bx = xx; }
  ctx.globalAlpha = alpha * 0.07; ctx.fillStyle = ink;
  ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(ax, ay); ctx.lineTo(bx, by); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = alpha * 0.3; ctx.strokeStyle = ink; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(ax, ay); ctx.moveTo(src.x, src.y); ctx.lineTo(bx, by); ctx.stroke();
  ctx.globalAlpha = alpha * 0.8; ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(src.x, src.y, 1.6, 0, Math.PI * 2); ctx.fill();
}
/** Planet 카드 스캔라인: 가는 가로줄 + 천천히 내려가는 밝은 띠(카드 안만) */
function drawScan(ctx, x0, y0, w, h, rad, ink, alpha, now, L) {
  ctx.save();
  rrect(ctx, x0, y0, w, h, rad); ctx.clip();
  ctx.globalAlpha = alpha * (L ? 0.035 : 0.05); ctx.fillStyle = ink;
  ctx.beginPath();
  for (let yy = y0 + 2; yy < y0 + h; yy += 3) ctx.rect(x0, yy, w, 1);
  ctx.fill();
  const by = y0 + ((now * 0.22) % 1) * (h + 16) - 8;
  ctx.globalAlpha = alpha * (L ? 0.05 : 0.08); ctx.fillRect(x0, by, w, 6);
  ctx.restore();
  rrect(ctx, x0, y0, w, h, rad); // 경로는 save/restore 대상이 아님 — 뒤따르는 테두리 stroke 가 카드 틀을 쓰게 되돌림
}

// ---------- 효과: 퍼지는 고리 하나(ripple·wave·beam) ----------
export function drawRings(view, ctx, now, s, anchorOf = null) {
  const p = {};
  for (const e of view.effects) {
    const v = view.vis.get(e.id);
    if (!v || v.hidden || v.gone) continue;
    const k = Math.min(1, (now - e.t0) / e.dur);
    if (anchorOf) { const A = anchorOf(v, true); p.x = A.x; p.y = A.y; } else toScreen(view.cam, view.W, view.H, v.pos.x, v.pos.z, p);
    ctx.globalAlpha = e.a * (1 - k) * (1 - k * 0.3);
    ctx.strokeStyle = typeof e.color === 'string' ? e.color : view.tokens.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, v.r * s * (e.k0 + (e.k1 - e.k0) * k)), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---------- 배치 장치 칩: 진행 막대·표시등·상태 띠 5칸 ----------
/** 장치 안 표시(막대·표시등·띠)만 — 바깥 실루엣은 표현마다(Flow 둥근 칩·Planet 상자·복셀 복합기). 상자 (x, y) 가운데, w×h px */
export function drawDeviceFace(view, ctx, v, x, y, w, h, R, alpha, now) {
  const P = view.P;
  const info = v.devInfo;
  if (!info || R <= 4) return;
  // 진행 막대(경과/평균, 평균 모르면 꽉 참)
  const cur = info.running > 0 && info.currentId ? view.vis.get(info.currentId) : null;
  const pr = info.running > 0 ? (cur ? cycleProgress(info, cur.node, view.clock()) ?? 1 : 1) : 0;
  const bx = x - w * 0.4, by = y - h * 0.3, bw = w * 0.8, bh = Math.max(1.5, h * 0.09);
  ctx.globalAlpha = alpha * 0.3; ctx.fillStyle = P.textDim; ctx.fillRect(bx, by, bw, bh);
  if (pr > 0) { ctx.globalAlpha = alpha; ctx.fillStyle = P.tool; ctx.fillRect(bx, by, bw * Math.min(1, pr), bh); }
  // 표시등
  const run = info.running > 0 && v.node.status !== 'done' && v.node.status !== 'stopped';
  const blink = run && !view.reduced ? (Math.sin(now * 6 + v.seed) > 0 ? 1 : 0.25) : 0.6;
  ctx.globalAlpha = alpha * blink; ctx.fillStyle = run ? P.tool : P.done;
  ctx.beginPath(); ctx.arc(x + w * 0.4, y - h * 0.3, Math.max(1.5, R * 0.1), 0, Math.PI * 2); ctx.fill();
  // 상태 띠 5칸(진행 호박·완료 초록·중지 회색·오류 빨강·빈 칸 흐림)
  const band = info.band || [], N = 5, off = N - band.length;
  const cw = (w * 0.8) / N;
  for (let i = 0; i < N; i++) {
    const b = i < off ? 0 : band[i - off];
    ctx.globalAlpha = alpha * (b ? 0.95 : 0.25);
    ctx.fillStyle = b === 1 ? P.tool : b === 2 ? P.done : b === 3 ? P.stopped : b === 4 ? P.error : P.textDim;
    ctx.fillRect(x - w * 0.4 + i * cw + 1, y + h * 0.18, cw - 2, Math.max(1.5, h * 0.16));
  }
  ctx.globalAlpha = 1;
}

// ---------- 전체 보기 섬: 둥근 사각형 판·고리(바쁜 섬 맥동)·안쪽 고리, 공전 고리·파이 구역선 ----------
function islandPath(ctx, p, c, s, k = 1) {
  const pts = islandOutline(c.box, k, 6);
  ctx.beginPath();
  pts.forEach(([x, z], i) => { const X = p.x + x * s, Y = p.y + z * s; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
  ctx.closePath();
}
export function drawIslands(view, ctx, now, s) {
  const L = view.tokens.isLight;
  const p = {};
  for (const c of view._clusterV.values()) {
    toScreen(view.cam, view.W, view.H, c.center.x, c.center.z, p);
    const r = c.r * s;
    if (r < 2 || p.x + r < 0 || p.x - r > view.W || p.y + r < 0 || p.y - r > view.H) continue;
    const fa = view.projAlpha ? view.projAlpha(c.projectId) : 1; // 다른 프로젝트 섬은 페이드 아웃 → 안 그림
    if (fa <= 0) continue;
    const st = islandStyle({ inactive: c.inactive, hot: c.busy, dimmed: false, light: L });
    for (const k of ['disc', 'ring', 'inner']) st[k] *= fa;
    // 채움 = 가운데 투명 → 가장자리로 아주 옅은 비네트, 외곽선 = 얇고 옅은 링크색(바쁜 섬도 강조색·맥동 없음)
    if (c.box) islandPath(ctx, p, c, s); else { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); }
    const rr = c.box ? Math.max(c.box.hw, c.box.hd) * s : r;
    const gr = ctx.createRadialGradient(p.x, p.y, rr * 0.35, p.x, p.y, rr * 1.05);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, view.tokens.grid);
    ctx.globalAlpha = Math.min(1, st.disc * 1.6);
    ctx.fillStyle = gr;
    ctx.fill();
    const pulse = st.hot && !view.reduced && PULSE_AMP ? 1 - PULSE_AMP + PULSE_AMP * (0.5 + 0.5 * Math.sin(now * 2.2)) : 1;
    ctx.globalAlpha = Math.min(1, st.ring * pulse * 1.3);
    ctx.strokeStyle = view.tokens.link;
    ctx.lineWidth = 1;
    ctx.stroke();
    const big = c.box ? Math.max(c.box.hw, c.box.hd) : c.r;
    if (c.orbit) {
      ctx.globalAlpha = (L ? 0.14 : 0.11) * fa; ctx.lineWidth = 1; ctx.strokeStyle = view.tokens.link;
      ctx.beginPath(); ctx.arc(p.x + (c.orbit.cx || 0) * s, p.y + (c.orbit.cz || 0) * s, c.orbit.r * s, 0, Math.PI * 2); ctx.stroke();
    } else if (c.zones && c.box) {
      ctx.globalAlpha = (L ? 0.15 : 0.12) * fa; ctx.lineWidth = 1; ctx.strokeStyle = view.tokens.link;
      ctx.beginPath();
      const zx = p.x + (c.zones.cx || 0) * s, zy = p.y + (c.zones.cz || 0) * s;
      for (const a of c.zones.dirs) {
        const ux = Math.cos(a), uz = Math.sin(a);
        const Lm = zoneRayLen(c.box, c.zones.cx || 0, c.zones.cz || 0, a);
        ctx.moveTo(zx + ux * c.zones.r0 * s, zy + uz * c.zones.r0 * s); ctx.lineTo(zx + ux * Lm * s, zy + uz * Lm * s);
      }
      ctx.stroke();
    } else if (!c.inactive && big > 14) {
      ctx.globalAlpha = st.inner; ctx.lineWidth = 1;
      if (c.box) islandPath(ctx, p, c, s, 0.62); else { ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.62, 0, Math.PI * 2); }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- 말풍선(DOM, flowview.css .flow-bubble) ----------
export class BubbleLayer {
  constructor(view, max = BUBBLE.MAX) {
    this.view = view;
    this.book = new BubbleBook(max);
    this.els = [];
    this.shown = new Set();
    this._n = 0;
  }
  push(id, role, text, hold, pri, fade) { return this.book.push(id, role, text, performance.now() / 1000, hold, pri, fade); }
  drop(id) { this.book.drop(id); }
  clear() { this.book.clear(); }
  /** 흐려지는 중이면 2(30fps), 개수가 바뀌면 다시 그리기 요청 */
  level(now) {
    const live = this.book.live(now);
    let lv = live.some((b) => b.alpha < 1) ? 2 : 0;
    if (live.length !== this._n) { this._n = live.length; this.view.invalidate(); }
    return lv;
  }
  /**
   * 말풍선 자리: 기준점 오른쪽(오른쪽에 셸 카드가 있으면 그 바깥). anchorOf(v) → {x, y, R} 없으면 노드 자리.
   * 라벨의 작업 한 줄은 말풍선이 보이는 동안 숨긴다(view._labelText 다시)
   */
  place(now, anchorOf = null) {
    const view = this.view;
    const live = this.book.live(now);
    const shown = new Set();
    let k = 0;
    // 복셀 생각·말풍선(role q-think·q-say): 포커스 > 중요도 > 최근 순으로 자리를 먼저 잡고, 서로 겹치면 한 칸 비켜 보고 그래도 겹치면 숨김
    const quip = live.some((it) => it.role === 'q-think' || it.role === 'q-say');
    if (quip) live.sort((a, b) => ((b.nodeId === view.focusId) - (a.nodeId === view.focusId)) || ((b.pri ?? 1) - (a.pri ?? 1)) || (b.at - a.at));
    const taken = quip ? (this._taken || (this._taken = [])) : null;
    if (taken) taken.length = 0;
    for (const it of live) {
      const v = view.vis.get(it.nodeId);
      if (!v || v.hidden || v.gone || !v._on || (v.scopeD ?? v.scopeK ?? 1) < 0.5) continue;
      const vip = it.nodeId === view.focusId || it.nodeId === view.camShotId || it.nodeId === view.hoverId;
      const A = anchorOf ? anchorOf(v) : null;
      const R = A && A.R != null ? A.R : v._R;
      const npx = R * 2;
      if (!vip && npx < 16) continue;
      let b = this.els[k];
      if (!b) {
        const el = document.createElement('div');
        el.className = 'flow-bubble';
        el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0';
        const h = document.createElement('b'), p = document.createElement('p');
        el.append(h, p);
        b = this.els[k] = { el, h, p, key: null, tf: '' };
      }
      k++;
      if (!b.el.isConnected) view.labelContainer.appendChild(b.el);
      if (b.key !== it.at + it.nodeId) { b.key = it.at + it.nodeId; b.id = it.nodeId; b.h.textContent = roleLabel(it.role); b.p.textContent = it.text; b.el.dataset.role = it.role; b.w = 0; }
      const hasRight = view.holo.book.list(it.nodeId).some((e) => e.slot >= 0 && e.dir === 'shell');
      const gap = Math.round(Math.min(80, R * 1.6 + 8) + (hasRight ? Math.min(320, cardPx(1.25 + 0.3 * v.r, view._s, { minPx: HOLO.MIN_PX_ACTIVE }) * 1.85 + 12) : 0));
      const ax = A ? A.x : v._sp.x, ay = A ? A.y : v._sp.y;
      if (!b.w) { b.w = b.el.offsetWidth || 0; b.hh = b.el.offsetHeight || 0; }
      b.base = b.w ? [ax + gap, ay - b.hh / 2, ax + gap + b.w, ay + b.hh / 2] : null; // 제자리(라벨이 피함)
      // 비키지 못한 라벨(고정·포커스)에 걸치면 위아래로 비킴
      let dy = 0;
      if (b.base && view.labelScreenBoxes) { const labs = view.labelScreenBoxes(this._labs || (this._labs = [])); dy = dodgeBox(b.base, labs) ?? 0; labs.length = 0; }
      if (taken && b.base) {
        const hit = (y) => taken.some((r) => b.base[0] < r[2] && b.base[2] > r[0] && b.base[1] + y < r[3] && b.base[3] + y > r[1]);
        if (hit(dy)) { const h = b.hh + 4; dy = !hit(dy - h) ? dy - h : !hit(dy + h) ? dy + h : null; }
        if (dy == null) { k--; b.el.remove(); b.key = null; b.base = null; continue; }
        taken.push([b.base[0], b.base[1] + dy, b.base[2], b.base[3] + dy]);
      }
      const tf = `translate(0, -50%) translate(${Math.round(ax + gap)}px, ${Math.round(ay + dy)}px)`;
      if (b.tf !== tf) { b.el.style.transform = tf; b.tf = tf; }
      const al = it.alpha * (v.projA ?? 1); // 프로젝트 페이드
      const op = al < 1 ? String(Math.max(0, Math.round(al * 20) / 20)) : '';
      if (b.el.style.opacity !== op) b.el.style.opacity = op;
      shown.add(it.nodeId);
    }
    for (let i = k; i < this.els.length; i++) { if (this.els[i].el.isConnected) { this.els[i].el.remove(); this.els[i].key = null; } this.els[i].base = null; }
    const prev = this.shown;
    this.shown = shown;
    for (const id of shown) if (!prev.has(id)) { const v = view.vis.get(id); if (v) view._labelText(v); }
    for (const id of prev) if (!shown.has(id)) { const v = view.vis.get(id); if (v) view._labelText(v); }
  }
  /** 말풍선 제자리 사각형(px) — 노드 라벨이 피한다 */
  baseRects(out = []) { for (const b of this.els) if (b.base && b.el.isConnected) out.push(b.base); return out; }
  dispose() { for (const b of this.els) b.el.remove(); this.els = []; }
}
