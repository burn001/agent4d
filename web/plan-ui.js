// 계획 보드 — 앱 쪽 연결과 그리기. 세 표현(흐름·Planet·복셀) × 3D/2D 공용 DOM 덧층.
// 세션 메인 바로 옆에 세운 작은 판(카메라를 향하는 빌보드, 일반 홀로그램 모니터의 약 2배) — 그 세션의 메인·서브에이전트·러너·
// 워크플로가 가진 계획을 모아 가장 앞 계획의 제목·출처 노드·크게 쓴 완료/전체·진행 막대·항목 칸 띠·진행 중 항목 한두 줄(+ 다른 계획 수)을
// 보이고, 누르면 상세 팝업 체계로 보드 전용 넓은 카드(계획 전부·항목 전체·상태·회차·출처 노드)를 띄운다. 상태별 색·기호(완료 ✓ ·
// 진행 ▶ 맥동 · 대기 ○ · 외부 대기 ⏸), 항목 추가·전이·삭제 때 칸 연출. 회차 노드 → 그 회차가 닫은 칸 선(진행 중 회차는 흐르는 점선),
// 계획 주인(러너 등) → 보드 머리 선, 메인 → 보드 지시선, 3D 는 판 아래 바닥까지 기둥. 선 양 끝은 같은 프레임에서 화면에 그려진 노드(isShown)의 투영과
// 이번 프레임 보드 자리만 쓴다(퇴장·숨김 노드는 vis 에 옛 자리·원점이 남아 있어 쓰면 엉뚱한 곳에서 선이 나감).
// ⚙ '계획' 줄 켬/끔(저장 ccviz.plans, URL ?plans=1|0 이 이번 접속에서 우선, 기본 끔). 끄면 덧층·rAF·연출 큐·카메라 맞춤 점 모두 없음.
// 읽기 전용(보드를 누르면 크게 보기 카드).
import { anchorOf } from './inspector.js';
import { isShown } from './camera-core.mjs';
import { escapeHtml as esc } from './html-util.mjs';
import { t } from './i18n.mjs';
import {
  PLAN_UI, PLAN_STORE_KEY, PLAN_ST_LABEL, planInitial, diffPlans, PlanFx, gatherPlans, boardSize, boardCard, sheetInspectModel, placeSheet, PLAN_CAM,
  cycleLinks, cycleNodeOf, planInspectModel, boardAnchor, BoardHold, holdAnchor, anchorLabelRel, nextLabelRel,
} from './plan-core.mjs';

let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const href = new URL('./plan.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}

/** 무대 안쪽(상단 바·실황 패널·아래 띠 제외) */
function stageBounds() {
  const W = innerWidth, H = innerHeight;
  let top = 0, right = W, bottom = H;
  const tb = document.getElementById('topbar');
  if (tb) top = tb.getBoundingClientRect().bottom;
  const pn = document.getElementById('panel');
  if (pn) { const r = pn.getBoundingClientRect(); if (r.width > 0 && r.left > W * 0.4) right = r.left; }
  for (const id of ['timeline', 'macro-tl', 'replay-bar']) {
    const o = document.getElementById(id);
    if (!o || o.hidden) continue;
    const r = o.getBoundingClientRect();
    if (r.height > 0 && r.top > H * 0.5) bottom = Math.min(bottom, r.top);
  }
  return { left: 0, top, right, bottom };
}

/** 화면에 보이는 노드 이름표 상자(최대 160) */
function nodeLabelBoxes() {
  const out = [];
  const W = innerWidth, H = innerHeight;
  for (const el of document.querySelectorAll('#labels .node-label, .node-label')) {
    if (out.length >= 160) break;
    if (el.closest('#plan-boards')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.right < 0 || r.bottom < 0 || r.left > W || r.top > H) continue;
    if (el.style.display === 'none' || el.style.visibility === 'hidden' || el.style.opacity === '0') continue;
    out.push({ x: r.left - 2, y: r.top - 2, w: r.width + 4, h: r.height + 4, k: 1.5 });
  }
  return out;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 화면에 실제로 그려진 노드인가(퇴장·숨김 노드는 vis 에 남아 옛 자리나 원점을 가리킨다 — 선 끝으로 쓰면 안 됨) */
const shownNode = (view, id) => !!(view && id && view.has && view.has(id) && fadeShown(view.vis && view.vis.get(id)));
/** isShown 과 같되 프로젝트 페이드 중(projOut, 아직 안 사라짐)인 노드는 흐리게 남긴다 */
const fadeShown = (v) => !!v && (v.projOut && !v.hidden ? isShown({ ...v, projOut: false, scopeK: v.scopeD ?? 1 }) : isShown(v));
/** 그 노드 프로젝트의 투명도 */
const projA = (view, id) => { const v = view && view.vis && view.vis.get(id); return v && v.projA != null ? v.projA : 1; };
const onScreen = (a, W, H, m = 40) => !!a && a.x > -m && a.y > -m && a.x < W + m && a.y < H + m;
const f1 = (v) => v.toFixed(1);
const curve = (ax, ay, bx, by, lift = 24) => `M${f1(ax)},${f1(ay)} Q${f1((ax + bx) / 2)},${f1(Math.min(ay, by) - lift)} ${f1(bx)},${f1(by)}`;

/**
 * @param {object} h 훅
 *  getView() · nodes() → Map(store.nodes) · focusId() · openPlan(mainId)(크게 보기) · openedPlan() → 크게 보기로 연 메인 id · params · lsGet/lsSet
 *  mock(bool: ?mock=1) · replay() → 재생 중이면 truthy · onEvent(ev)(mock 드라이버가 앱 경로로 넣음) · clock() → ms(재생이면 가상 시계)
 */
export function mountPlans(h) {
  ensureCss();
  const fx = new PlanFx();
  let on = planInitial(h.params.get('plans'), h.lsGet(PLAN_STORE_KEY));
  let layer = null, svg = null, raf = 0, driver = null;
  const boards = new Map(); // 메인 id → {el, sig, pos, side, w, h, rows:[[{x,y}]], secs:[{y}]}
  const anchors = new Map(); // 메인 id → 앵커 붙들기 상태 {id, cand, since}
  const links = []; // svg path 풀
  let boundsAt = 0, bounds = null, hover = null, labelBoxes = [], obstacles = [], discs = [];
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
    document.body.append(svg, layer);
    layer.addEventListener('click', (e) => { const b = e.target.closest('.pb'); if (b && b.dataset.node && h.openPlan) h.openPlan(b.dataset.node); }); // 크게 보기(카드)
    layer.addEventListener('pointerover', (e) => { const b = e.target.closest('.pb'); hover = b ? b.dataset.node : null; });
    layer.addEventListener('pointerleave', () => { hover = null; });
  }
  function dropLayer() {
    if (layer) layer.remove();
    if (svg) svg.remove();
    layer = null; svg = null; boards.clear(); links.length = 0; PLAN_CAM.boards.clear();
  }

  function setOn(v, { save = false } = {}) {
    on = !!v;
    if (save) h.lsSet(PLAN_STORE_KEY, on ? '1' : '0');
    label();
    if (on) { ensureLayer(); mountLegend(); startDriver(); dirty = true; kick(); }
    else { stopDriver(); fx.clear(); if (raf) cancelAnimationFrame(raf); raf = 0; dropLayer(); const lg = document.querySelector('#legend .plan-legend'); if (lg) lg.remove(); }
    const v2 = h.getView(); if (v2 && v2.invalidate) v2.invalidate();
  }

  // ── mock 드라이버 ──
  function startDriver() {
    if (!h.mock || driver || h.params.get('planmock') === '0' || (h.replay && h.replay())) return;
    import('./plan-mock.mjs').then(({ PlanMockDriver }) => {
      if (!on || driver || (h.replay && h.replay())) return;
      driver = new PlanMockDriver({ nodes: () => h.nodes().values(), emit: (ev) => h.onEvent(ev) });
      driver.start();
    }).catch(() => {});
  }
  function stopDriver() { if (driver) { driver.stop(); driver = null; } }

  function kick() { if (on && !raf) raf = requestAnimationFrame(loop); }

  // ── 그리기 ──
  function boardEl(id) {
    let b = boards.get(id);
    if (b) return b;
    const el = document.createElement('div');
    el.className = 'pb'; el.dataset.node = id; el.setAttribute('role', 'button'); el.tabIndex = -1;
    el.setAttribute('aria-label', t('boards.plan.boardAria'));
    layer.appendChild(el);
    b = { el, sig: '', pos: null, side: null, w: 0, h: 90, cells: [], headY: 16, hold: new BoardHold(), aid: null, rel: null, tgt: null, tgtI: null, lab: null };
    boards.set(id, b);
    return b;
  }

  function render(b, m, size) {
    const sig = JSON.stringify([size.w, m.pid, m.owner, m.ownerLabel, m.title, m.count, m.prog, m.hot, m.more, m.hold, m.extra, m.dels.length,
      m.cells.map((c) => [c.st, c.cur, c.fx, c.cy]), m.lines.map((l) => [l.i, l.st, l.t, l.cy])]);
    if (sig === b.sig) return;
    b.sig = sig;
    b.w = size.w;
    b.el.style.width = size.w + 'px';
    b.el.style.setProperty('--pbk', size.k.toFixed(3));
    b.el.style.setProperty('--pk', `var(--k-${(h.nodes().get(m.owner) || {}).kind || 'main'}, var(--accent))`);
    b.el.classList.toggle('hot', m.hot);
    b.el.classList.toggle('all-done', m.allDone);
    b.el.title = `${m.title} — ${m.srcLabel} · ${m.ownerLabel} · ${t('boards.plan.tipDone', { n: m.count })}${m.more ? ` · ${t('boards.plan.tipMore', { n: m.more })}` : ''} ${t('boards.plan.tipClick')}`;
    const cells = m.cells.map((c) => `<i class="pc st-${c.st}${c.cur ? ' cur' : ''}${c.fx ? ' fx-' + c.fx : ''}" title="${esc(c.st === 'hold' ? t('boards.plan.st.hold') : PLAN_ST_LABEL[c.s] || '')} · ${esc(c.t)}${c.cy != null ? ` · ${esc(t('boards.plan.cycle', { n: c.cy }))}` : ''}"></i>`).join('');
    const dels = m.dels.map(() => '<i class="pc st-pending fx-del"></i>').join('');
    const lines = m.lines.length
      ? m.lines.map((l) => `<div class="pb-l st-${l.st}"><i class="pl-m">${esc(l.mark)}</i><span class="pr-t">${l.next ? esc(t('boards.plan.next')) : ''}${esc(l.t)}</span>${l.cy != null ? `<b class="pr-cy">${esc(t('boards.plan.cycle', { n: l.cy }))}</b>` : ''}</div>`).join('')
      : `<div class="pb-l st-done"><i class="pl-m">✓</i><span class="pr-t">${m.allDone ? esc(t('boards.plan.allDone')) : '—'}</span></div>`;
    const chips = [m.hold ? `<span class="pb-chip hold">${esc(t('boards.plan.holdChip', { n: m.hold }))}</span>` : '', m.more ? `<span class="pb-chip">${esc(t('boards.plan.moreChip', { n: m.more }))}</span>` : ''].filter(Boolean).join('');
    b.el.innerHTML = `<header class="pb-h"><span class="pb-g" aria-hidden="true">${esc(m.glyph)}</span><span class="pb-ti"><span class="pb-t">${esc(m.title)}</span>` +
      `<span class="pb-o"><i class="pb-dot"></i>${esc(m.ownerLabel)} · ${esc(m.srcLabel)}</span></span>` +
      `<span class="pb-n" aria-label="${esc(t('boards.plan.countAria', { done: m.done, total: m.total }))}"><b>${m.done}</b><small>/${m.total}</small></span></header>` +
      `<div class="pb-bar"><i class="d" style="width:${(m.fracDone * 100).toFixed(1)}%"></i><i class="p" style="width:${(m.fracProg * 100).toFixed(1)}%"></i></div>` +
      `<div class="pb-cells">${cells}${dels}${m.extra ? `<span class="pb-x">+${m.extra}</span>` : ''}</div>` +
      `<div class="pb-lines">${lines}</div>` + (chips ? `<div class="pb-chips">${chips}</div>` : '');
    // 칸 자리(보드 안 오프셋) — 선 끝을 같은 프레임의 보드 자리에서 계산하려고 내용이 바뀔 때만 잰다
    b.h = b.el.offsetHeight || b.h;
    b.cells = [...b.el.querySelectorAll('.pb-cells > .pc:not(.fx-del)')].map((c) => ({ x: c.offsetLeft + c.offsetWidth / 2, y: c.offsetTop + c.offsetHeight / 2 }));
    const hd = b.el.querySelector('.pb-h');
    b.headY = hd ? hd.offsetTop + hd.offsetHeight / 2 : 16;
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
  const linkProxy = (w) => ({
    setAttribute(k, v) {
      if (k === 'd') { const r = v.replace(/-?\d+\.\d+/g, (x) => String(Math.round(+x))); /* 정수 px — 노드가 조금 흔들릴 때마다 SVG 를 다시 칠하지 않게 */ if (r !== w.d) { w.d = r; w.el.setAttribute('d', r); } }
      else if (k === 'class') { if (v !== w.cls) { w.cls = v; w.el.setAttribute('class', v); } }
    },
    style: { setProperty(k, v) { if (v !== w.pk) { w.pk = v; w.el.style.setProperty(k, v); } } },
  });

  /** 3D: 보드 아래 가운데 → 바닥(y=0)까지 기둥의 바닥 끝(화면 px). 2D·카메라 뒤·너무 길면 null */
  function poleFoot(view, mainId, bx, by) {
    if (!view || view.flat || !view.camera || !view.nodePos) return null;
    const mp = view.nodePos(mainId);
    if (!mp || !mp.clone) return null;
    const cam = view.camera, dom = view.renderer && view.renderer.domElement;
    const rect = dom ? dom.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    // 보드 아래 점을 메인 높이 평면으로 되쏨 → 그 바로 아래 바닥
    const v = mp.clone().set(((bx - rect.left) / rect.width) * 2 - 1, -((by - rect.top) / rect.height) * 2 + 1, 0.5).unproject(cam);
    const o = cam.position, dy = v.y - o.y;
    if (Math.abs(dy) < 1e-6) return null;
    const t = (mp.y - o.y) / dy;
    if (!(t > 0)) return null;
    const f = mp.clone().set(o.x + (v.x - o.x) * t, 0, o.z + (v.z - o.z) * t).project(cam);
    if (f.z > 1 || f.z < -1) return null;
    const sy = rect.top + ((1 - f.y) / 2) * rect.height;
    if (sy < by + 6 || sy - by > Math.min(160, rect.height * 0.2)) return null; // 너무 길면(카메라가 낮거나 판이 높이 뜸) 생략
    return { x: rect.left + ((f.x + 1) / 2) * rect.width, y: sy };
  }

  const stats = { ms: 0, max: 0, n: 0 }; // 점검용: 계획 루프 한 프레임 JS 시간(지수 평균·최대)
  function loop() {
    raf = 0;
    if (!on || !layer) return;
    const wall = performance.now();
    try { frame(wall); } finally { const dt = performance.now() - wall; stats.ms = stats.ms * 0.95 + dt * 0.05; stats.max = Math.max(stats.max * 0.999, dt); stats.n++; }
    raf = requestAnimationFrame(loop);
  }
  function frame(wall) {
    const view = h.getView();
    const nodes = h.nodes();
    const fresh = !bounds || wall - boundsAt > 250;
    if (fresh) {
      bounds = stageBounds(); labelBoxes = nodeLabelBoxes(); boundsAt = wall;
      obstacles = [];
      try { if (view && view.obstacleRects) for (const r of view.obstacleRects()) obstacles.push({ x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1], k: 2 }); } catch (e) { /* 표현마다 다름 */ }
      discs = [];
      if (view) for (const n of nodes.values()) {
        if (discs.length > 200 || !shownNode(view, n.id)) continue;
        const a = anchorOf(view, { type: 'node', id: n.id });
        if (a && onScreen(a, innerWidth, innerHeight, 0) && a.r >= 2) discs.push({ id: n.id, x: a.x - a.r, y: a.y - a.r, w: 2 * a.r, h: 2 * a.r, k: 0.8 });
      }
    }
    if (dirty || wall - groupsAt > 1000) { groups = gatherPlans(nodes); groupsAt = wall; dirty = false; }
    const focus = h.focusId ? h.focusId() : null;
    const opened = h.openedPlan ? h.openedPlan() : null; // 크게 보기로 연 보드는 그 카드가 대신함
    const cands = [];
    if (view) for (const [mid, entries] of groups) {
      if (mid === opened) continue;
      // 러너 계획이면 진행 중 회차(없으면 러너) 곁에 세워 회차 선을 짧게, 아니면 메인 옆
      // 앵커 후보가 ANCHOR_MS 이어질 때만 바꿈(지금 앵커가 안 보이거나 화면 밖이면 바로)
      const usable = (id) => shownNode(view, id) && onScreen(anchorOf(view, { type: 'node', id }), innerWidth, innerHeight, 80);
      let st = anchors.get(mid); if (!st) anchors.set(mid, st = { id: null, cand: null, since: 0 });
      const aid = holdAnchor(st, boardAnchor(entries[0], mid, nodes, (id) => shownNode(view, id)), wall, usable);
      if (!usable(aid)) continue;
      const a = anchorOf(view, { type: 'node', id: aid });
      const live = entries.some((e) => e.plan.items.some((x) => x.s === 'in_progress'));
      const at = Math.max(...entries.map((e) => e.plan.at || 0));
      cands.push({ id: mid, aid, a, entries, rank: (mid === focus || mid === hover ? 4 : 0) + (live ? 2 : 0), at });
    }
    cands.sort((p, q) => q.rank - p.rank || q.at - p.at || (p.id < q.id ? -1 : 1));
    const pick = cands.slice(0, PLAN_UI.MAX_BOARDS);
    const avoid = labelBoxes.concat(obstacles);
    const ins = document.getElementById('inspector');
    if (ins && !ins.hidden) { const r = ins.getBoundingClientRect(); if (r.width) avoid.push({ x: r.left, y: r.top, w: r.width, h: r.height, k: 4 }); }
    const keep = new Set();
    let li = 0;
    const lowMotion = reduced();
    const labelOf = (id) => { const n = nodes.get(id); return n ? n.label || id : ''; };
    PLAN_CAM.boards.clear();
    for (const c of pick) {
      const m = boardCard(c.entries, { nowMs: wall, fx: lowMotion ? null : fx, labelOf, mainId: c.id });
      if (!m) continue;
      keep.add(c.id);
      const b = boardEl(c.id);
      curA = projA(view, c.id);
      { const o = curA < 1 ? (Math.round(curA * 20) / 20).toFixed(2) : ''; if (b.op !== o) { b.op = o; b.el.style.opacity = o; } }
      let size = boardSize(c.a.r, view.nodeRadius ? view.nodeRadius(c.aid) : 1, bounds.right - bounds.left);
      if (b.w && Math.abs(size.w - b.w) < PLAN_UI.SIZE_STEP) size = { ...size, w: b.w }; // 확대·축소 중 폭 맥동 없게
      render(b, m, size);
      // 앵커가 바뀌면(회차 ↔ 러너 ↔ 메인) 지금 화면 자리에서 새 앵커 기준으로 미끄러지게 — 자리 기억은 새로
      if (b.aid !== c.aid) { if (b.pos) b.rel = { x: b.pos.x - c.a.x, y: b.pos.y - c.a.y }; b.aid = c.aid; b.hold.reset(); b.tgt = null; b.lab = null; }
      // 덮으면 안 되는 앵커(메인·회차·러너) 상자 = 원 + 그 자기 이름표. 이름표 상자는 250ms 마다 재니 앵커 기준 상대 자리로 들고 있다가
      // 이번 프레임 앵커에 붙인다(카메라 이동 중 묵은 상자가 core 를 부풀리지 않게)
      if (fresh || !b.lab) b.lab = nextLabelRel(b.lab, anchorLabelRel(c.a, labelBoxes), wall);
      const core = { x: c.a.x - c.a.r, y: c.a.y - c.a.r, w: 2 * c.a.r, h: 2 * c.a.r };
      const lr = b.lab.rel;
      if (lr) {
        const qx = c.a.x + lr.x, qy = c.a.y + lr.y, x0 = Math.min(core.x, qx), y0 = Math.min(core.y, qy);
        core.w = Math.max(core.x + core.w, qx + lr.w) - x0; core.h = Math.max(core.y + core.h, qy + lr.h) - y0; core.x = x0; core.y = y0;
      }
      const av = avoid.concat(discs.filter((d) => d.id !== c.aid));
      const p = placeSheet(c.a, { w: b.w, h: b.h }, bounds, { avoid: av, prevSide: b.side, core });
      // 고른 후보는 확실히 나빠진 상태가 이어질 때만 옮김(BoardHold), 같은 후보 안 작은 변화는 데드밴드
      const q = b.hold.pick(p, wall);
      const tg = { x: q.x - c.a.x, y: q.y - c.a.y };
      if (!b.tgt || b.tgtI !== q.i || Math.abs(tg.x - b.tgt.x) >= PLAN_UI.DEADBAND || Math.abs(tg.y - b.tgt.y) >= PLAN_UI.DEADBAND) { b.tgt = tg; b.tgtI = q.i; }
      b.side = q.side;
      avoid.push({ x: c.a.x + b.tgt.x, y: c.a.y + b.tgt.y, w: b.w, h: b.h, k: 6 }); // 다음 메인 보드는 이 보드를 피함
      // 보간은 앵커 기준 상대 자리에서 — 카메라·앵커가 움직이면 판은 같은 프레임에 같이 움직이고(뒤처져 흔들리지 않음), 자리를 바꿀 때만 미끄러짐
      if (!b.rel || lowMotion) b.rel = { ...b.tgt };
      else { const k = 0.3; b.rel.x += (b.tgt.x - b.rel.x) * k; b.rel.y += (b.tgt.y - b.rel.y) * k; if (Math.abs(b.tgt.x - b.rel.x) < 0.5) b.rel.x = b.tgt.x; if (Math.abs(b.tgt.y - b.rel.y) < 0.5) b.rel.y = b.tgt.y; }
      b.pos = { x: c.a.x + b.rel.x, y: c.a.y + b.rel.y };
      const tf = `translate(${Math.round(b.pos.x)}px, ${Math.round(b.pos.y)}px)`;
      if (tf !== b.tf) { b.tf = tf; b.el.style.transform = tf; }
      b.el.hidden = false;
      PLAN_CAM.boards.set(c.aid, b.side); // 자동 카메라: 앵커를 잡을 때 보드 자리도(붙든 쪽 — 카메라 ↔ 자리 되먹임 없게)
      if (!svg) continue;
      // 선 양 끝 = 이번 프레임의 노드 투영(anchorOf) + 이번 프레임 보드 자리(b.pos) — 같은 좌표계(뷰포트 px)
      const bx = Math.round(b.pos.x), by = Math.round(b.pos.y);
      // 앵커 → 보드 지시선(원 가장자리 → 보드 가까운 변)
      {
        const ex = b.side === -1 ? bx + b.w : b.side === 1 ? bx : bx + b.w / 2;
        const ey = b.side === 0 ? (by > c.a.y ? by : by + b.h) : Math.max(by + 12, Math.min(by + b.h - 12, c.a.y));
        const dx = ex - c.a.x, dy = ey - c.a.y, dl = Math.hypot(dx, dy) || 1;
        const path = linkPath(li++);
        path.setAttribute('d', `M${f1(c.a.x + (dx / dl) * c.a.r * 0.9)},${f1(c.a.y + (dy / dl) * c.a.r * 0.9)} L${f1(ex)},${f1(ey)}`);
        path.setAttribute('class', 'pl-lead');
      }
      // 3D: 판 아래 기둥(세운 게시판)
      const foot = poleFoot(view, c.aid, bx + b.w / 2, by + b.h);
      if (foot) {
        const px = bx + b.w / 2;
        const path = linkPath(li++);
        path.setAttribute('d', `M${f1(px)},${by + b.h} L${f1(px)},${f1(foot.y)} M${f1(px - 14)},${f1(foot.y)} a14,3.5 0 1,0 28,0 a14,3.5 0 1,0 -28,0`);
        path.setAttribute('class', 'pl-pole');
      }
      // 항목 칸(없으면 — 상한 밖·잔상 — 보드 가장자리)
      const edgeX = (ax) => (ax < bx + b.w / 2 ? bx : bx + b.w);
      const cellPt = (i, ax) => { const q = b.cells[i]; return q ? { x: bx + q.x, y: by + q.y } : { x: edgeX(ax), y: by + b.headY }; };
      // 계획 주인(메인 아닌 노드: 러너·서브에이전트·워크플로) → 보드 머리
      if (m.owner !== c.id && m.owner !== c.aid && shownNode(view, m.owner)) {
        const a = anchorOf(view, { type: 'node', id: m.owner });
        if (onScreen(a, innerWidth, innerHeight, 200)) {
          const path = linkPath(li++);
          path.setAttribute('d', curve(a.x, a.y, edgeX(a.x), by + b.headY, 16));
          path.setAttribute('class', 'pl-own');
          path.style.setProperty('--pk', `var(--k-${(nodes.get(m.owner) || {}).kind || 'main'}, var(--accent))`);
        }
      }
      if (!m.runner) continue;
      const plan = c.entries[0].plan;
      // 회차 노드 → 그 회차가 닫은 칸(최근 회차 3개). 회차 하위 에이전트가 고쳤으면 그 회차. 화면에 그려진 회차만
      const seen = new Set();
      for (const L of cycleLinks(plan)) {
        const cid = cycleNodeOf(L.by, nodes);
        if (!cid || seen.has(cid) || !shownNode(view, cid)) continue;
        seen.add(cid);
        const a = anchorOf(view, { type: 'node', id: cid });
        if (!onScreen(a, innerWidth, innerHeight, 200)) continue;
        const cn = nodes.get(cid);
        const ds = L.idx.map((i) => { const q = cellPt(i, a.x); return curve(a.x, a.y, q.x, q.y, 18); });
        const path = linkPath(li++);
        path.setAttribute('d', ds.join(' '));
        path.setAttribute('class', cn && cn.status === 'active' ? 'pl-link live' : 'pl-link');
      }
      // 지금 계획을 붙든 진행 중 회차 → 지금 항목 칸(아직 닫지 않은 것)
      const cid = plan.by ? cycleNodeOf(plan.by, nodes) : null;
      const cn = cid && nodes.get(cid);
      const ci = m.cells.findIndex((x) => x.cur);
      if (cn && cn.status === 'active' && ci >= 0 && !seen.has(cid + '#cur') && shownNode(view, cid)) {
        const a = anchorOf(view, { type: 'node', id: cid });
        if (onScreen(a, innerWidth, innerHeight, 200)) {
          const q = cellPt(ci, a.x);
          const path = linkPath(li++);
          path.setAttribute('d', curve(a.x, a.y, q.x, q.y, 26));
          path.setAttribute('class', 'pl-link live cur');
        }
      }
    }
    curA = 1;
    for (let i = li; i < links.length; i++) { const w = links[i].__w; if (w.d) { w.d = ''; w.el.setAttribute('d', ''); } }
    for (const [id, b] of boards) if (!keep.has(id)) { b.el.remove(); boards.delete(id); }
    for (const id of anchors.keys()) if (!groups.has(id)) anchors.delete(id);
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
  function reset() { fx.clear(); dirty = true; if (layer) { for (const b of boards.values()) b.el.remove(); boards.clear(); } PLAN_CAM.boards.clear(); kick(); }

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

  /** 크게 보기(보드 전용 넓은 카드): {title, kindLine, pill, html} — 그 메인에 모인 계획 전부. 없으면 null */
  function sheetHtml(mainId, nowMs) {
    if (!on) return null;
    const nodes = h.nodes();
    if (dirty) { groups = gatherPlans(nodes); groupsAt = performance.now(); dirty = false; }
    const entries = groups.get(mainId);
    if (!entries || !entries.length) return null;
    const labelOf = (id) => { const n = nodes.get(id); return n ? n.label || id : ''; };
    const ms = sheetInspectModel(entries, { nowMs, labelOf, mainId });
    let done = 0, total = 0, prog = 0;
    for (const p of ms) { done += p.done; total += p.total; prog += p.prog; }
    const html = ms.map((p) => `<section class="ins-sec ins-plan ins-plan-big" style="--pk:var(--k-${(nodes.get(p.owner) || {}).kind || 'main'}, var(--accent))">` +
      `<h4><span class="pb-g" aria-hidden="true">${esc(p.glyph)}</span><span class="ipb-t">${esc(p.title)}</span><span class="ipb-n"><b>${p.done}</b>/${p.total}</span></h4>` +
      `<p class="ipb-o">${nodes.has(p.owner) ? `<button type="button" class="ins-link" data-goto="${esc(p.owner)}"><i class="pb-dot"></i>${esc(p.ownerLabel)}</button>` : esc(p.ownerLabel)} · ${esc(p.src)}${p.updated ? ' · ' + esc(t('boards.plan.updated', { ago: p.updated })) : ''}${p.hold ? ` · <span class="ipb-hold">${esc(t('boards.plan.holdChip', { n: p.hold }))}</span>` : ''}</p>` +
      `<div class="pb-bar ipb-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.frac * 100)}" aria-label="${esc(t('boards.plan.progressAria'))}"><i class="d" style="width:${(p.fracDone * 100).toFixed(1)}%"></i><i class="p" style="width:${(p.fracProg * 100).toFixed(1)}%"></i></div>` +
      `<ol class="ipb-list">${p.items.map((it, i) => `<li class="pr st-${esc(it.st)}${it.cur ? ' cur' : ''}"><i class="pl-m" aria-label="${esc(it.st === 'hold' ? t('boards.plan.st.hold') : PLAN_ST_LABEL[it.s] || '')}">${esc(it.glyph)}</i><span class="ipb-i">${i + 1}</span><span class="pr-t">${esc(it.t)}</span>` +
        `${it.st === 'hold' ? `<b class="pr-hold">${esc(t('boards.plan.st.hold'))}</b>` : ''}` +
        `${it.cy != null ? (it.by && nodes.has(it.by) ? `<button type="button" class="ins-link pr-cy" data-goto="${esc(it.by)}">${esc(t('boards.plan.cycle', { n: it.cy }))}</button>` : `<b class="pr-cy">${esc(t('boards.plan.cycle', { n: it.cy }))}</b>`) : it.byLabel && it.s !== 'pending' ? (it.by && nodes.has(it.by) ? `<button type="button" class="ins-link ipb-by" data-goto="${esc(it.by)}">${esc(it.byLabel.slice(0, 22))}</button>` : `<small>${esc(it.byLabel.slice(0, 22))}</small>`) : ''}` +
        `${it.ago ? `<small class="ipb-ago">${esc(it.ago)}</small>` : ''}</li>`).join('')}</ol>${p.more ? `<p class="ins-dim">${esc(t('boards.plan.moreItems', { n: p.more }))}</p>` : ''}</section>`).join('');
    const main = nodes.get(mainId);
    return { title: t('boards.plan.sheetTitle'), kindLine: `${(main && main.label) || t('boards.plan.main')} · ${t('boards.plan.count', { n: ms.length })}`, pill: `${t('boards.plan.pillDone', { done, total })}${prog ? ` · ${t('boards.plan.pillProg', { n: prog })}` : ''}`, html };
  }

  if (on) setOn(true);
  return {
    get on() { return on; }, setOn: (v) => setOn(v, { save: false }), event, reset, inspectHtml, sheetHtml, kick,
    get boards() { return boards; }, fx, stats,
  };
}
