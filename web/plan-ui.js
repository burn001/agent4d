// 계획 보드 — 앱 쪽 연결과 그리기. 세 표현(흐름·Planet·복셀) × 3D/2D 공용 DOM 덧층.
// 작은 판(일반 홀로그램 모니터의 약 2배) — 그 세션의 계획을 모아 가장 앞 계획의 제목·출처 노드·완료/전체·진행 막대·항목 칸 띠·
// 진행 중 항목 한두 줄(다른 계획 수), 누르면 상세 팝업 체계로 보드 전용 넓은 카드. 상태별 색·기호, 항목 추가·전이·삭제 때 칸 연출.
// 앵커 단일화: 러너 계획이 있으면 러너, 없으면 메인에 고정. 자리는 앵커 기준 **월드 고정 오프셋**(boardWorld) — 그 월드 점을 투영해
// 원근 배율로 그리므로 카메라를 돌리거나 옮겨도 다른 3D 객체처럼 제자리, 화면 밖이면 그냥 안 보임(화면 안으로 끌어오지 않음). 2D 도 지도 좌표.
// 선은 앵커 → 보드 한 줄뿐(회차선·주인선·기둥 없음 — 진행 중 회차는 보드 안 '회차 N 진행 중'·지금 칸 강조로). 보드는 라벨의 고정 장애물(PLAN_CAM.rects).
// ⚙ '계획' 줄 켬/끔(저장 ccviz.plans, URL ?plans=1|0 이 이번 접속에서 우선, 기본 끔). 끄면 덧층·rAF·연출 큐·카메라 맞춤 점 모두 없음.
// 읽기 전용(보드를 누르면 크게 보기 카드).
import { anchorOf } from './inspector.js';
import { isShown } from './camera-core.mjs';
import { toScreen, camScale } from './flat/flat-core.mjs';
import { escapeHtml as esc } from './html-util.mjs';
import { t } from './i18n.mjs';
import {
  PLAN_UI, PLAN_STORE_KEY, PLAN_ST_LABEL, planInitial, diffPlans, PlanFx, gatherPlans, boardWorld, boardScreen, boardCard, sheetInspectModel, PLAN_CAM,
  planInspectModel, boardAnchor, liveCycleOf, loopMerge, boardHoles, holesMask, countFit,
} from './plan-core.mjs';

let cssDone = false;
let occV = null; // 가림 노드 투영용 벡터 하나(프레임마다 만들지 않음)
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const href = new URL('./plan.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 화면에 실제로 그려진 노드인가(퇴장·숨김 노드는 vis 에 남아 옛 자리나 원점을 가리킨다 — 선 끝으로 쓰면 안 됨) */
const shownNode = (view, id) => !!(view && id && view.has && view.has(id) && fadeShown(view.vis && view.vis.get(id)));
/** isShown 과 같되 프로젝트 페이드 중(projOut, 아직 안 사라짐)인 노드는 흐리게 남긴다 */
const fadeShown = (v) => !!v && (v.projOut && !v.hidden ? isShown({ ...v, projOut: false, scopeK: v.scopeD ?? 1 }) : isShown(v));
/** 그 노드 프로젝트의 투명도 */
const projA = (view, id) => { const v = view && view.vis && view.vis.get(id); return v && v.projA != null ? v.projA : 1; };
const f1 = (v) => v.toFixed(1);

/**
 * 보드 왼쪽 아래 모서리의 월드 점 → 화면 투영. home = 앵커의 제자리(view.planHome — 복셀 캐릭터는 걸어 다녀도 자기 책상 자리, 없으면 nodePos = 노드 월드 자리).
 * 반환 {wp(월드 점), p(화면 px — 뷰포트), ppw(그 점에서 월드 1 단위 px), wb} 또는 null
 */
function boardProject(view, aid) {
  const home = view.planHome ? view.planHome(aid) : view.nodePos ? view.nodePos(aid) : null; // 노드와 함께 미끄러짐(재배치 때 앞질러 튀지 않게)
  if (!home) return null;
  const mode = view.constructor && view.constructor.modeId;
  const wb = boardWorld(view.nodeRadius ? view.nodeRadius(aid) : 1, mode, view.holoSize ? view.holoSize(aid) : null); // 표현이 낸 모니터 크기가 있으면 그것
  const dom = view.renderer && view.renderer.domElement;
  const rect = dom ? dom.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  if (view.flat) {
    if (!view.cam) return null;
    const wx = home.x + wb.off, wz = home.z + wb.drop; // 2D: 화면 아래 = +z
    const q = toScreen(view.cam, view.W, view.H, wx, wz, {});
    return { home: { x: home.x, y: 0, z: home.z }, wp: { x: wx, y: 0, z: wz }, p: { x: rect.left + q.x, y: rect.top + q.y }, ppw: camScale(view.cam, view.H), wb };
  }
  const cam = view.camera;
  if (!cam || !home.clone) return null;
  const w = home.clone(); w.x += wb.off; w.y -= wb.drop;
  const wp = { x: w.x, y: w.y, z: w.z };
  const d = cam.position.distanceTo(w) || 1;
  const v = w.project(cam);
  if (v.z > 1 || v.z < -1) return { wp, p: { behind: true }, ppw: 0, wb };
  const ppw = (rect.height / 2) / (d * Math.tan(((cam.fov || 50) * Math.PI) / 360));
  return { home: { x: home.x, y: home.y, z: home.z }, wp, p: { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height }, ppw, wb };
}

/**
 * @param {object} h 훅
 *  getView() · nodes() → Map(store.nodes) · focusId() · openPlan(mainId)(크게 보기) · openedPlan() → 크게 보기로 연 메인 id · params · lsGet/lsSet
 *  mock(bool: ?mock=1) · replay() → 재생 중이면 truthy · onEvent(ev)(mock 드라이버가 앱 경로로 넣음) · clock() → ms(재생이면 가상 시계)
 */
export function mountPlans(h) {
  ensureCss();
  const fx = new PlanFx();
  let on = planInitial(h.params.get('loopboard') ?? h.params.get('plans'), h.lsGet(PLAN_STORE_KEY)); // 기본 켬 · 옛 ccviz.plans 저장값은 읽지 않음
  let layer = null, svg = null, raf = 0;
  let openBox = null; // 크게 보기로 연 보드 자리(화면 원 {x, y, r}) — 카드 자리 앵커
  const boards = new Map(); // 메인 id → {el, sig, pos, side, w, h, rows:[[{x,y}]], secs:[{y}]}
  const links = []; // svg path 풀
  let hover = null;
  let groups = new Map(), groupsAt = 0, dirty = true;

  // ── ⚙ 메뉴 줄 ──
  const btn = document.createElement('button');
  btn.id = 'btn-plans'; btn.type = 'button'; btn.className = 'tb';
  btn.title = t('boards.plan.btnTitle');
  function label() { btn.textContent = t(on ? 'boards.plan.btnOn' : 'boards.plan.btnOff'); btn.setAttribute('aria-pressed', String(on)); }
  label();
  btn.addEventListener('click', () => setOn(!on, { save: true }));
  function mountRow() {
    const menu = document.getElementById('settings-menu');
    if (!menu || document.getElementById('btn-plans')) return !!document.getElementById('btn-plans');
    const r = document.createElement('div'); r.className = 'sm-row';
    const k = document.createElement('span'); k.className = 'sm-k'; k.textContent = t('boards.plan.row');
    const v = document.createElement('div'); v.className = 'sm-v'; v.append(btn);
    r.append(k, v);
    const hint = menu.querySelector('.sm-hint');
    menu.insertBefore(r, hint || null);
    return true;
  }
  if (!mountRow()) { let tries = 0; const tm = setInterval(() => { if (mountRow() || ++tries > 40) clearInterval(tm); }, 250); }
  function mountLegend() {
    const lg = document.getElementById('legend');
    if (!lg || lg.querySelector('.plan-legend')) return;
    const d = document.createElement('div'); d.className = 'plan-legend';
    d.innerHTML = `<h3>${t('boards.plan.lgTitle')}</h3><ul>` +
      `<li><i class="pl-m st-done">✓</i>${t('boards.plan.st.done')} <i class="pl-m st-in_progress">▶</i>${t('boards.plan.st.inProgress')} <i class="pl-m st-pending">○</i>${t('boards.plan.st.pending')} <i class="pl-m st-hold">⏸</i>${t('boards.plan.st.hold')}</li>` +
      `<li><span>${esc(t('boards.plan.lg1'))}</span></li>` +
      `<li><span>${esc(t('boards.plan.lg2'))}</span></li>` +
      `<li><span>${esc(t('boards.plan.lg3'))}</span></li></ul>`;
    lg.appendChild(d);
  }

  function ensureLayer() {
    if (layer) return;
    layer = document.createElement('div'); layer.id = 'plan-boards'; layer.setAttribute('aria-hidden', 'false');
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'plan-links'; svg.setAttribute('aria-hidden', 'true');
    attachLayer();
    layer.addEventListener('click', (e) => { const b = e.target.closest('.pb'); if (b && b.dataset.node && h.openPlan) h.openPlan(b.dataset.node); }); // 크게 보기(카드)
    layer.addEventListener('pointerover', (e) => { const b = e.target.closest('.pb'); hover = b ? b.dataset.node : null; });
    layer.addEventListener('pointerleave', () => { hover = null; });
  }
  /** v0.4.1 덧층 자리: 장면 무대(#stage — position:fixed 라 그 자체가 쌓임 맥락) 안, 라벨 그릇(#labels) **앞**.
   *  그래서 상단 바·실황 패널·타임라인·팝업·⚙ 메뉴 같은 UI 는 늘 보드 위, 노드 이름표·말풍선·섬 이름표(CSS2D)도 보드 위.
   *  예전엔 body 에 z 12 로 붙어 장면의 모든 DOM(이름표·말풍선) 위에 떴다. 무대가 없으면(시험 등) body */
  function attachLayer() {
    if (!layer) return;
    const stage = document.getElementById('stage'), lab = document.getElementById('labels');
    if (stage) {
      const before = lab && lab.parentNode === stage ? lab : stage.firstChild;
      if (svg.parentNode !== stage || layer.parentNode !== stage || layer.nextSibling !== before) { stage.insertBefore(svg, before); stage.insertBefore(layer, before); }
    } else if (layer.parentNode !== document.body) document.body.append(svg, layer);
  }
  /** 구멍 사각형 끄기(보드 끔·표현 바뀜) */
  function clearPunch() { if (punchView && punchView.setPlanPunch) { try { punchView.setPlanPunch([]); } catch (e) { /* 무시 */ } } punchView = null; }
  function dropLayer() {
    if (layer) layer.remove();
    if (svg) svg.remove();
    layer = null; svg = null; boards.clear(); links.length = 0; PLAN_CAM.rects = [];
  }

  function setOn(v, { save = false } = {}) {
    on = !!v;
    if (save) h.lsSet(PLAN_STORE_KEY, on ? '1' : '0');
    label();
    if (on) { ensureLayer(); mountLegend(); dirty = true; kick(); }
    else { fx.clear(); if (raf) cancelAnimationFrame(raf); raf = 0; dropLayer(); clearPunch(); const lg = document.querySelector('#legend .plan-legend'); if (lg) lg.remove(); }
    const v2 = h.getView(); if (v2 && v2.invalidate) v2.invalidate();
  }


  function kick() { if (on && !raf) raf = requestAnimationFrame(loop); }

  // ── 그리기 ──
  function boardEl(id) {
    let b = boards.get(id);
    if (b) return b;
    const el = document.createElement('div');
    el.className = 'pb'; el.dataset.node = id; el.setAttribute('role', 'button'); el.tabIndex = -1;
    el.setAttribute('aria-label', t('boards.plan.boardAria'));
    layer.appendChild(el);
    b = { el, sig: '', aid: null, dbg: null, bw: 0, bh: 0, lod: null };
    boards.set(id, b);
    return b;
  }

  function render(b, m) {
    const sig = JSON.stringify([m.pid, m.liveCy, m.owner, m.ownerLabel, m.title, m.count, m.prog, m.hot, m.more, m.hold, m.extra, m.dels.length,
      m.cells.map((c) => [c.st, c.cur, c.fx, c.cy]), m.lines.map((l) => [l.i, l.st, l.t, l.cy, l.note, l.steps && [l.steps.done, l.steps.total, l.steps.cur]]), m.before]);
    if (sig === b.sig) return;
    b.sig = sig;
    b.el.style.setProperty('--pk', `var(--k-${(h.nodes().get(m.owner) || {}).kind || 'main'}, var(--accent))`);
    b.el.classList.toggle('hot', m.hot);
    b.el.classList.toggle('all-done', m.allDone);
    const fit = countFit(m.done, m.total); // 자릿수로 완료/전체 크기 맞춤(측정 없음 — 글꼴·배율과 무관하게 같은 결과)
    b.el.classList.toggle('pb-long', fit.long);
    b.el.title = `${m.title} — ${m.srcLabel} · ${m.ownerLabel} · ${t('boards.plan.tipDone', { n: m.count })}${m.more ? ` · ${t('boards.plan.tipMore', { n: m.more })}` : ''} ${t('boards.plan.tipClick')}`;
    const cells = m.cells.map((c) => `<i class="pc st-${c.st}${c.cur ? ' cur' : ''}${c.live ? ' live' : ''}${c.fx ? ' fx-' + c.fx : ''}" title="${esc(c.st === 'hold' ? t('boards.plan.st.hold') : PLAN_ST_LABEL[c.s] || '')} · ${esc(c.t)}${c.cy != null ? ` · ${esc(t('boards.plan.cycle', { n: c.cy }))}` : ''}"></i>`).join('');
    const dels = m.dels.map(() => '<i class="pc st-pending fx-del"></i>').join('');
    const lines = m.lines.length
      ? m.lines.map((l) => `<div class="pb-l st-${l.st}${l.up ? ' up' : ''}"><i class="pl-m">${esc(l.mark)}</i><span class="pr-t">${l.next ? esc(t('boards.plan.next')) : ''}${esc(l.t)}</span>${l.note ? `<b class="pr-note">${esc(l.note)}</b>` : ''}${l.cy != null ? `<b class="pr-cy">${esc(t('boards.plan.cycle', { n: l.cy }))}</b>` : ''}</div>` +
        (l.steps ? `<div class="pb-sb" title="${esc(t('boards.plan.steps', { done: l.steps.done, total: l.steps.total }))}${l.steps.cur ? ' · ' + esc(l.steps.cur) : ''}"><span class="pb-sbar"><i style="width:${((l.steps.done / l.steps.total) * 100).toFixed(1)}%"></i></span><small>${esc(t('boards.plan.steps', { done: l.steps.done, total: l.steps.total }))}${l.steps.cur ? ' · ' + esc(l.steps.cur) : ''}</small></div>` : '')).join('')
      : `<div class="pb-l st-done"><i class="pl-m">✓</i><span class="pr-t">${m.allDone ? esc(t('boards.plan.allDone')) : '—'}</span></div>`;
    const chips = [m.liveCy != null ? `<span class="pb-chip live">${esc(t('boards.plan.liveChip', { n: m.liveCy }))}</span>` : '', m.hold ? `<span class="pb-chip hold">${esc(t('boards.plan.holdChip', { n: m.hold }))}</span>` : '', m.more ? `<span class="pb-chip">${esc(t('boards.plan.moreChip', { n: m.more }))}</span>` : ''].filter(Boolean).join('');
    b.el.innerHTML = `<header class="pb-h"><span class="pb-g" aria-hidden="true">${esc(m.glyph)}</span><span class="pb-ti"><span class="pb-t">${esc(m.title)}</span>` +
      `<span class="pb-o"><i class="pb-dot"></i>${esc(m.ownerLabel)} · ${esc(m.srcLabel)}</span></span>` +
      `<span class="pb-n" style="--pbn:${fit.k};--pbn-lod:${fit.kLod}" aria-label="${esc(t('boards.plan.countAria', { done: m.done, total: m.total }))}"><b>${m.done}</b><small>/${m.total}</small></span></header>` +
      `<div class="pb-bar"><i class="d" style="width:${(m.fracDone * 100).toFixed(1)}%"></i><i class="p" style="width:${(m.fracProg * 100).toFixed(1)}%"></i></div>` +
      `<div class="pb-cells">${m.before ? `<span class="pb-x pre" title="${esc(t('boards.plan.before', { n: m.before }))}">✓${m.before}</span>` : ''}${cells}${dels}${m.extra ? `<span class="pb-x">+${m.extra}</span>` : ''}</div>` +
      `<div class="pb-lines">${lines}</div>` + (chips ? `<div class="pb-chips">${chips}</div>` : '');
  }

  // 선 풀: 값이 바뀔 때만 DOM 을 고친다(카메라가 멈춰 있으면 SVG 를 다시 칠하지 않게)
  function linkPath(i) {
    while (links.length <= i) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const w = { el: p, d: '', cls: '', pk: '' };
      p.__w = w;
      svg.appendChild(p); links.push(p);
    }
    const el = links[i], o = curA < 1 ? (Math.round(curA * 20) / 20).toFixed(2) : ''; // 프로젝트 페이드
    if (el.__op !== o) { el.__op = o; el.style.opacity = o; }
    return linkProxy(links[i].__w);
  }
  let curA = 1; // 지금 그리는 보드의 프로젝트 투명도
  const SHEET_FOLD = 30; // 크게 보기: 이보다 많으면 지금 항목 앞 끝난 항목 접기
  let punchView = null; // 구멍 사각형을 그리는 3D 표현(흐름·Planet) — 판 DOM 은 캔버스 아래, 깊이는 WebGL 이 가린다
  const hitBoxes = []; // 캔버스 아래 판은 포인터를 못 받으므로 클릭 판정용 상자 [{id, x0,y0,x1,y1}]
  const linkProxy = (w) => ({
    setAttribute(k, v) {
      if (k === 'd') { const r = v.replace(/-?\d+\.\d+/g, (x) => String(Math.round(+x))); /* 정수 px — 노드가 조금 흔들릴 때마다 SVG 를 다시 칠하지 않게 */ if (r !== w.d) { w.d = r; w.el.setAttribute('d', r); } }
      else if (k === 'class') { if (v !== w.cls) { w.cls = v; w.el.setAttribute('class', v); } }
    },
    style: { setProperty(k, v) { if (v !== w.pk) { w.pk = v; w.el.style.setProperty(k, v); } } },
  });

  const stats = { ms: 0, max: 0, n: 0 }; // 점검용: 계획 루프 한 프레임 JS 시간(지수 평균·최대)
  let syncAt = -1e9;
  /** 표현의 프레임 훅(카메라 갱신 직후, 그리기 전)에서 부름 — 보드가 노드·지도와 같은 프레임에 움직임 */
  function sync() {
    if (!on || !layer) return;
    const wall = performance.now();
    syncAt = wall;
    try { frame(wall); } finally { const dt = performance.now() - wall; stats.ms = stats.ms * 0.95 + dt * 0.05; stats.max = Math.max(stats.max * 0.999, dt); stats.n++; }
  }
  function loop() {
    raf = 0;
    if (!on || !layer) return;
    const wall = performance.now();
    if (wall - syncAt < 12) { raf = requestAnimationFrame(loop); return; } // 이번 프레임은 표현 훅이 이미 그림
    try { frame(wall); } finally { const dt = performance.now() - wall; stats.ms = stats.ms * 0.95 + dt * 0.05; stats.max = Math.max(stats.max * 0.999, dt); stats.n++; }
    raf = requestAnimationFrame(loop);
  }
  function frame(wall) {
    const view = h.getView();
    if (view && view.camera && view.camera.updateMatrixWorld) view.camera.updateMatrixWorld(); // 표현 훅에서 부를 때 카메라 행렬이 이번 프레임 값이게
    const nodes = h.nodes();
    if (dirty || wall - groupsAt > 1000) { groups = gatherPlans(nodes); groupsAt = wall; dirty = false; }
    const focus = h.focusId ? h.focusId() : null;
    const opened = h.openedPlan ? h.openedPlan() : null; // 크게 보기로 연 보드는 그 카드가 대신함
    const W = innerWidth, H = innerHeight;
    if (layer) layer.classList.toggle('vx', !!(view && view.constructor && view.constructor.modeId === 'voxel')); // 복셀: 게시판 모양
    const punch = !!(view && !view.flat && typeof view.setPlanPunch === 'function'); // 흐름·Planet 3D
    if (punchView && punchView !== view) clearPunch();
    if (layer) layer.classList.toggle('under', punch);
    const punches = [];
    hitBoxes.length = 0;
    const cands = [];
    openBox = null;
    if (view) for (const [mid, entries] of groups) {
      // 크게 보기로 연 보드: 판은 숨기고(카드가 대신함) 그 월드 자리의 화면 상자만 잰다 — 카드가 그 자리 곁에 뜸(카메라는 안 움직임)
      if (mid === opened) {
        const an = boardAnchor(entries, mid, nodes, (id) => shownNode(view, id));
        const pj = shownNode(view, an.id) ? boardProject(view, an.id) : null;
        const sc = pj ? boardScreen(pj.p, pj.ppw, pj.wb, W, H) : null;
        if (sc && !sc.hidden && sc.box) openBox = { x: sc.box.x + sc.box.w / 2, y: sc.box.y + sc.box.h / 2, r: Math.min(480, Math.max(sc.box.w, sc.box.h) / 2) };
        const ob = boards.get(mid); if (ob && !ob.el.hidden) ob.el.hidden = true;
        continue;
      }
      // 앵커 = 러너 계획의 러너(없으면 메인) 하나 — 안 보이면(퇴장·페이드 끝·숨김) 보드도 숨김, 다른 노드로 옮기지 않음
      const an = boardAnchor(entries, mid, nodes, (id) => shownNode(view, id));
      if (!shownNode(view, an.id)) continue;
      const live = entries.some((e) => e.plan.items.some((x) => x.s === 'in_progress'));
      const at = Math.max(...entries.map((e) => e.plan.at || 0));
      cands.push({ id: mid, aid: an.id, entries: an.entries, rank: (mid === focus || mid === hover ? 4 : 0) + (live ? 2 : 0), at });
    }
    cands.sort((p, q) => q.rank - p.rank || q.at - p.at || (p.id < q.id ? -1 : 1));
    const pick = cands.slice(0, PLAN_UI.MAX_BOARDS);
    const keep = new Set();
    let li = 0;
    const lowMotion = reduced();
    const labelOf = (id) => { const n = nodes.get(id); return n ? n.label || id : ''; };
    const dom = view && view.renderer && view.renderer.domElement;
    const cr = dom ? dom.getBoundingClientRect() : { left: 0, top: 0 };
    const rects = [];
    attachLayer(); // 표현 전환으로 무대가 바뀌어도 자리 유지
    // v0.4.1 3D 앞뒤: 보드보다 카메라에 가까운 노드는 판에 구멍을 내 앞에 보이게(DOM 덧층이라 깊이 판정이 없어 늘 위에 그려졌다)
    const occ3d = !!(view && !view.flat && view.camera && view.nodePos && view.camera.position);
    let occ = null;
    const occluders = () => {
      if (occ) return occ;
      occ = [];
      const cam = view.camera, crect = dom ? dom.getBoundingClientRect() : { left: 0, top: 0, width: W, height: H };
      const th = Math.tan(((cam.fov || 50) * Math.PI) / 360), vox = !!(view.constructor && view.constructor.modeId === 'voxel');
      for (const id of nodes.keys()) {
        if (!shownNode(view, id)) continue;
        const p = view.nodePos(id);
        if (!p || !p.clone) continue;
        const q = (occV || (occV = p.clone())).copy(p).project(cam);
        if (q.z > 1 || q.z < -1) continue;
        const d = cam.position.distanceTo(p) || 1;
        const wr = (view.nodeRadius ? view.nodeRadius(id) : 1) * (vox ? 0.9 : 1); // 화면 원 = 노드 몸체(복셀 반지름은 자리 몫이라 조금 줄임)
        occ.push({ id, x: crect.left + ((q.x + 1) / 2) * crect.width, y: crect.top + ((1 - q.y) / 2) * crect.height, r: (wr / (d * th)) * (crect.height / 2), d });
      }
      return occ;
    };
    for (const c of pick) {
      const pj = boardProject(view, c.aid);
      if (!pj) continue;
      const mg = loopMerge(c.entries, nodes); // 같은 설계서의 러너 계획은 축 큐에 합침('+ 계획 n' 에서 빠짐, 진행 중 회차는 판에)
      const m = boardCard(mg.entries, { nowMs: wall, fx: lowMotion ? null : fx, labelOf, mainId: c.id, liveCy: liveCycleOf(mg.entries[0].plan, nodes) ?? mg.liveCy });
      if (!m) continue;
      keep.add(c.id);
      const b = boardEl(c.id);
      b.aid = c.aid;
      render(b, m);
      const sc = boardScreen(pj.p, pj.ppw, pj.wb, W, H);
      const bw = PLAN_UI.BASE_PX, bh = Math.round(bw * pj.wb.aspect); // 기준 크기(배율 1) — 모니터 폭 × 높이 1.5배 비율
      if (b.bw !== bw || b.bh !== bh) { b.bw = bw; b.bh = bh; b.el.style.width = bw + 'px'; b.el.style.height = bh + 'px'; }
      if (sc.lod != null && b.lod !== sc.lod) { b.lod = sc.lod; b.el.classList.toggle('lod', sc.lod); }
      b.dbg = { aid: c.aid, home: pj.home, wp: pj.wp, s: sc.s ?? null, hidden: !!sc.hidden, box: sc.box || null };
      if (sc.hidden) { if (!b.el.hidden) b.el.hidden = true; continue; } // 화면 밖·카메라 뒤·너무 멀면 그냥 안 보임(안으로 끌어오지 않음)
      curA = projA(view, c.id);
      { const o = !punch && curA < 1 ? (Math.round(curA * 20) / 20).toFixed(2) : ''; if (b.op !== o) { b.op = o; b.el.style.opacity = o; } } // 구멍 모드는 구멍 알파가 섞음
      const bx = sc.box.x, by = sc.box.y;
      const tf = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px) scale(${sc.s.toFixed(4)})`;
      if (tf !== b.tf) { b.tf = tf; b.el.style.transform = tf; }
      b.el.hidden = false;
      let clip = '';
      if (punch && pj.wp) { // 판 기준 월드 점 + 화면 상자 → 판 평면 네 모서리 구멍(모서리 반지름 = CSS 9px × 배율)
        punches.push({ wx: pj.wp.x, wy: pj.wp.y, wz: pj.wp.z, box: sc.box, r: 9 * sc.s, a: curA }); // 판 기준점 = 판 DOM 이 자리·배율을 잡는 월드 점(왼쪽 아래)
        hitBoxes.push({ id: c.id, x0: bx, y0: by, x1: bx + sc.box.w, y1: by + sc.box.h });
      } else if (occ3d && pj.wp) {
        const cp = view.camera.position, wc = { x: pj.wp.x + pj.wb.w / 2 - cp.x, y: pj.wp.y + pj.wb.h / 2 - cp.y, z: pj.wp.z - cp.z };
        const all = occluders().filter((o) => o.id !== c.aid);
        clip = holesMask(boardHoles(sc.box, sc.s, all, Math.hypot(wc.x, wc.y, wc.z)));
      }
      if (clip !== (b.clip || '')) { b.clip = clip; b.el.style.maskImage = clip; b.el.style.webkitMaskImage = clip; b.el.classList.toggle('occ', !!clip); }
      rects.push([bx - cr.left, by - cr.top, bx + sc.box.w - cr.left, by + sc.box.h - cr.top]); // 라벨이 피할 고정 장애물(캔버스 좌표)
      if (!svg) continue;
      // 선 하나: 앵커 원 가장자리 → 보드 왼쪽 변(앵커 높이에 가장 가까운 점). 양 끝 모두 이번 프레임 투영
      const a = anchorOf(view, { type: 'node', id: c.aid });
      if (!a || !(a.r > 0)) continue;
      const ex = bx, ey = Math.max(by + 8 * sc.s, Math.min(by + sc.box.h - 8 * sc.s, a.y));
      const dx = ex - a.x, dy = ey - a.y, dl = Math.hypot(dx, dy) || 1;
      if (dl < 4) continue;
      const st = Math.min(a.r * 0.9, dl * 0.5); // 보드 변이 앵커 원 안쪽에 걸쳐도(가까이서 비스듬히) 선은 남김
      const path = linkPath(li++);
      path.setAttribute('d', `M${f1(a.x + (dx / dl) * st)},${f1(a.y + (dy / dl) * st)} L${f1(ex)},${f1(ey)}`);
      path.setAttribute('class', 'pl-lead');
    }
    PLAN_CAM.rects = rects;
    curA = 1;
    if (punch) { view.setPlanPunch(punches); punchView = view; }
    for (let i = li; i < links.length; i++) { const w = links[i].__w; if (w.d) { w.d = ''; w.el.setAttribute('d', ''); } }
    for (const [id, b] of boards) if (!keep.has(id)) { b.el.remove(); boards.delete(id); }
  }

  // ── 앱 연결 ──
  /** node-update·node-add(meta.plans) — 병합 전에 부른다(이전 값과 비교해 연출) */
  function event(ev, prevNode, { quiet = false } = {}) {
    if (!on) return;
    let next;
    if (ev.type === 'node-update' && ev.patch && ev.patch.meta && 'plans' in ev.patch.meta) next = ev.patch.meta.plans;
    else if (ev.type === 'node-add' && ev.node && ev.node.meta && ev.node.meta.plans) next = ev.node.meta.plans;
    else return;
    dirty = true;
    if (quiet) return;
    const prev = prevNode && prevNode.meta ? prevNode.meta.plans : null;
    const ch = diffPlans(prev, next);
    if (ch.length) fx.note(ev.nodeId, ch, performance.now());
    kick();
  }
  function reset() { fx.clear(); dirty = true; if (layer) { for (const b of boards.values()) b.el.remove(); boards.clear(); } PLAN_CAM.rects = []; kick(); }

  /** 상세 팝업 노드 절 HTML(켜졌을 때만, 없으면 '') */
  function inspectHtml(node, nowMs) {
    if (!on || !node) return '';
    const model = planInspectModel(node, { nowMs, labelOf: (id) => { const n = h.nodes().get(id); return n ? n.label || id : ''; } });
    if (!model.length) return '';
    return model.map((p) => `<section class="ins-sec ins-plan"><h4><span aria-hidden="true">${esc(p.glyph)}</span> ${esc(p.title)} <small>${esc(p.count)} · ${esc(p.src)}${p.updated ? ' · ' + esc(p.updated) : ''}</small></h4>` +
      `<div class="pb-bar ins-pbar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.frac * 100)}" aria-label="${esc(t('boards.plan.progressAria'))}"><i class="d" style="width:${(p.frac * 100).toFixed(1)}%"></i></div>` +
      `<ol class="ins-plist">${p.items.map((it) => `<li class="s-${esc(it.s)}${it.cur ? ' cur' : ''}${it.hold ? ' hold' : ''}"><i aria-label="${esc(PLAN_ST_LABEL[it.s] || '')}">${esc(it.mark)}</i><span>${esc(it.t)}${it.hold ? ` <small>${esc(t('boards.plan.st.hold'))}</small>` : ''}</span>` +
        `${it.cy != null ? (it.by && h.nodes().has(it.by) ? `<button type="button" class="ins-link" data-goto="${esc(it.by)}">${esc(t('boards.plan.cycle', { n: it.cy }))}</button>` : `<small>${esc(t('boards.plan.cycle', { n: it.cy }))}</small>`) : it.byLabel && it.s !== 'pending' ? `<small>${esc(it.byLabel.slice(0, 18))}</small>` : ''}` +
        `${it.ago ? `<small>${esc(it.ago)}</small>` : ''}</li>`).join('')}</ol>${p.more ? `<p class="ins-dim">${esc(t('boards.plan.moreItems', { n: p.more }))}</p>` : ''}</section>`).join('');
  }


  /** 크게 보기 항목 목록: 줄마다 상태·번호·제목(★ 강조)·메모·부가(일정·묶음)·문서·단계 진행(남은 단계)·회차·얼마 전.
   *  항목이 SHEET_FOLD 넘으면 지금 항목 앞의 끝난 항목은 접힘(<details>) — 156축 큐도 지금 축이 바로 보이게. 목록은 카드 안에서 스크롤(CSS).
   * 러너 단계 계획을 합친 축: 줄 아래 러너 한 줄(러너·진행 중 회차·관찰 시각), 펼친 단계마다 닫은 회차·얼마 전, 살아 있는 러너가 보는 축은 접지 않음 */
  function sheetItems(p, nodes) {
    const go = (id, label, cls) => (id && nodes.has(id) ? `<button type="button" class="ins-link ${cls}" data-goto="${esc(id)}">${esc(label)}</button>` : `<b class="${cls}">${esc(label)}</b>`);
    const stepRow = (x) => `<li class="st-${esc(x.st)}${x.nx ? ' nx' : ''}"><i>${x.st === 'done' ? '✓' : x.st === 'current' ? '▶' : x.st === 'blocked' ? '⏸' : x.st === 'skipped' ? '⤼' : '○'}</i><span>${esc(x.t)}</span>` +
      `${x.cy != null ? go(x.by, t('boards.plan.cycle', { n: x.cy }), 'pr-cy') : ''}${x.ago ? `<small class="ipb-ago">${esc(x.ago)}</small>` : ''}</li>`;
    const runLine = (r) => `<span class="ipb-run">${esc(t('boards.plan.runBy'))} ${go(r.owner, r.label.slice(0, 24), 'ipb-by')}${r.n > 1 ? ` <small>${esc(t('boards.plan.runPlans', { n: r.n }))}</small>` : ''}` +
      `${r.liveCy != null ? ` <b class="pb-chip live">${esc(t('boards.plan.liveChip', { n: r.liveCy }))}</b>` : r.seen ? ` · <small>${esc(t('boards.plan.seen', { ago: r.seen }))}</small>` : ''}</span>`;
    const row = (it, i) => `<li class="pr st-${esc(it.st)}${it.cur ? ' cur' : ''}${it.emph ? ' emph' : ''}${it.run ? ' merged' : ''}"><i class="pl-m" aria-label="${esc(it.st === 'hold' ? t('boards.plan.st.hold') : it.st === 'skipped' ? t('boards.plan.st.skipped') : PLAN_ST_LABEL[it.s] || '')}">${esc(it.glyph)}</i><span class="ipb-i">${i + 1}</span><span class="pr-t">${esc(it.t)}</span>` +
      `${it.note ? `<b class="pr-hold">${esc(it.note)}</b>` : it.st === 'hold' ? `<b class="pr-hold">${esc(t('boards.plan.st.hold'))}</b>` : ''}` +
      `${it.steps ? `<span class="ipb-st" title="${esc(it.steps.cur || '')}"><span class="pb-sbar"><i style="width:${((it.steps.done / it.steps.total) * 100).toFixed(1)}%"></i></span>${esc(t('boards.plan.steps', { done: it.steps.done, total: it.steps.total }))}</span>` : ''}` +
      `${it.cy != null ? go(it.by, t('boards.plan.cycle', { n: it.cy }), 'pr-cy') : it.byLabel && it.s !== 'pending' ? (it.by && nodes.has(it.by) ? `<button type="button" class="ins-link ipb-by" data-goto="${esc(it.by)}">${esc(it.byLabel.slice(0, 22))}</button>` : `<small>${esc(it.byLabel.slice(0, 22))}</small>`) : ''}` +
      `${it.ago ? `<small class="ipb-ago">${esc(it.ago)}</small>` : ''}` +
      `${it.run ? runLine(it.run) : ''}` +
      `${it.open && it.steps && Array.isArray(it.steps.items) && it.steps.items.length ? `<ul class="ipb-steps">${it.steps.items.map(stepRow).join('')}</ul>` : ''}` +
      // 펼친 단계 목록이 있으면 '▶ 지금 단계' 는 목록의 강조 줄이 대신함(— 같은 글 두 번 없음)
      `${(it.meta && it.meta.length) || it.doc || (it.steps && it.cur && it.steps.cur && !(it.open && it.steps.items && it.steps.items.length)) ? `<span class="ipb-sub">${[...(it.meta || []), it.doc ? '▤ ' + it.doc : '', it.steps && it.cur && it.steps.cur && !(it.open && it.steps.items && it.steps.items.length) ? '▶ ' + it.steps.cur : ''].filter(Boolean).map(esc).join(' · ')}</span>` : ''}</li>`;
    const L = p.items;
    if (L.length <= SHEET_FOLD) return L.map(row).join('');
    const ci = L.findIndex((x) => x.cur);
    const cut = ci > 0 ? ci : L.findIndex((x) => x.s !== 'done');
    const k = cut > 0 ? cut : 0;
    const head = [], pin = [];
    L.slice(0, k).forEach((it, i) => (it.open ? pin : head).push([it, i])); // 살아 있는 러너가 보는 축은 접힘 밖
    const folded = head.length ? `<li class="pr-fold"><details><summary>${esc(t('boards.plan.doneGroup', { n: head.length }))}</summary><ol class="ipb-list" start="1">${head.map(([it, i]) => row(it, i)).join('')}</ol></details></li>` : '';
    return folded + pin.map(([it, i]) => row(it, i)).join('') + L.slice(k).map((it, j) => row(it, k + j)).join('');
  }
  /** 크게 보기(보드 전용 넓은 카드): {title, kindLine, pill, html} — 그 메인에 모인 계획 전부. 없으면 null.
   * 같은 설계서의 러너 계획은 축 큐 항목에 합쳐 한 덩어리 · 머리 알약 = 지금 상태(진행 중 회차·외부 대기·쉬는 중) — 끝남/전체는 덩어리 머리에만 */
  function sheetHtml(mainId, nowMs) {
    if (!on) return null;
    const nodes = h.nodes();
    if (dirty) { groups = gatherPlans(nodes); groupsAt = performance.now(); dirty = false; }
    const entries = groups.get(mainId);
    if (!entries || !entries.length) return null;
    const labelOf = (id) => { const n = nodes.get(id); return n ? n.label || id : ''; };
    const ms = sheetInspectModel(boardAnchor(entries, mainId, nodes).entries, { nowMs, labelOf, mainId, nodes }); // 판과 같은 순서(바깥 계획이 앞)
    const head = ms[0];
    const html = ms.map((p, i) => `<section class="ins-sec ins-plan ins-plan-big${p.apart ? ' apart' : ''}" style="--pk:var(--k-${(nodes.get(p.owner) || {}).kind || 'main'}, var(--accent))">` +
      (p.apart ? `<p class="ipb-apart">${esc(t('boards.plan.apart'))}</p>` : '') +
      `<h4><span class="pb-g" aria-hidden="true">${esc(p.glyph)}</span><span class="ipb-t">${esc(p.title)}</span><span class="ipb-n"><b>${p.done}</b>/${p.total}</span></h4>` +
      `<p class="ipb-o">${nodes.has(p.owner) ? `<button type="button" class="ins-link" data-goto="${esc(p.owner)}"><i class="pb-dot"></i>${esc(p.ownerLabel)}</button>` : esc(p.ownerLabel)} · ${esc(p.src)}${p.mergedN ? ` · ${esc(t('boards.plan.mergedN', { n: p.mergedN }))}` : ''}${p.updated ? ' · ' + esc(t('boards.plan.updated', { ago: p.updated })) : ''}${p.hold && i > 0 ? ` · <span class="ipb-hold">${esc(t('boards.plan.holdChip', { n: p.hold }))}</span>` : ''}${p.liveCy != null && i > 0 ? ` · <b class="pb-chip live">${esc(t('boards.plan.liveChip', { n: p.liveCy }))}</b>` : ''}</p>` +
      `<div class="pb-bar ipb-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.frac * 100)}" aria-label="${esc(t('boards.plan.progressAria'))}"><i class="d" style="width:${(p.fracDone * 100).toFixed(1)}%"></i><i class="p" style="width:${(p.fracProg * 100).toFixed(1)}%"></i></div>` +
      `<ol class="ipb-list">${sheetItems(p, nodes)}</ol>${p.more ? `<p class="ins-dim">${esc(t('boards.plan.moreItems', { n: p.more }))}</p>` : ''}</section>`).join('');
    const main = nodes.get(mainId);
    // 알약 = 맨 앞 덩어리의 지금 상태(숫자 끝남/전체는 덩어리 머리에 이미 있음 — 여러 계획 합산은 뜻이 없어 쓰지 않음)
    const pill = head.liveCy != null ? t('boards.plan.liveChip', { n: head.liveCy }) : head.hold ? t('boards.plan.holdChip', { n: head.hold }) : head.total && head.done === head.total ? t('boards.plan.allDone') : t('boards.plan.pillIdle');
    return { title: t('boards.plan.sheetTitle'), kindLine: `${(main && main.label) || t('boards.plan.main')}${ms.length > 1 ? ` · ${t('boards.plan.count', { n: ms.length })}` : ''}`, pill, html };
  }

  if (on) setOn(true);
  return {
    get on() { return on; }, setOn: (v) => setOn(v, { save: false }), event, reset, inspectHtml, sheetHtml, kick, sync,
    get boards() { return boards; }, fx, stats,
    /** 크게 보기 카드 앵커: 연 보드의 이번 프레임 화면 원(없으면 null — 화면 밖이면 카드는 앵커 노드 곁) */
    openAnchor: () => openBox,
    /** 캔버스 아래에 둔 판의 클릭 판정(페이지 px) — 그 자리 판 묶음 주인 id | null. 노드·패널 집기 뒤에 부른다 */
    hitBoard: (x, y) => { for (let i = hitBoxes.length - 1; i >= 0; i--) { const b = hitBoxes[i]; if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b.id; } return null; },
  };
}
