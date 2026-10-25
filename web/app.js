// 진입점: 데이터 원천(SSE·mock·재생) → 상태 저장소 → 장면(표현 모드)·패널·카메라·효과음
// 3D(three.js) 모듈은 정적으로 불러오지 않는다 — 카메라·장면·바닥·기상은 3D 로 그릴 때만 동적 import(2D 저사양 화면은 three.js 요청 0)
import { Panel } from './panel.js';
import { Music } from './audio.js';
import { ActivityMeter } from './bgm-auto.mjs';
import { mountViewSelector } from './viewsel.mjs';
import { Sfx } from './sfx.mjs';
import { Sound } from './sound.mjs';
import { createMockSource } from './mock.js';
import { KINDS, KIND_LABEL, KIND_SHAPE } from './layout.js';
import { CATS, CAT_LABEL } from './icons.js';
import { HOLO_KIND } from './holo-core.mjs';
import { RENDERERS, RENDERER_LABEL, DEFAULT_RENDERER, isRenderer, storedRenderer, nextRenderer, normRenderer, normDim, initialDim, renderer2dFor, DIM_LABEL } from './renderers.js';
import { ReplayEngine, createLocalReplayApi } from './replay/engine.mjs';
import { mountReplayUI, fmtClock } from './replay/ui.mjs';
import { serializeSelection, parseSelection, selectionLabel, sessionsOf } from './projects.js';
import { mountProjectSelector } from './projsel.js';
import { mountMacroTimeline } from './macro/macro.js';
import { mountArchiveCard } from './replay/archive-card.js'; // 보관함 설명 카드
import { demoTargetSpeed, nextInPlaylist, DEMO } from './replay/demo-core.mjs'; // 연속 재생
import { mountEnv } from './env/env.js';
import { mountLimits } from './limits.js';
import { mountTimeline } from './timeline.mjs';
import { CAT_ORDER, catColor } from './flow-core.mjs';
import { mountCtx } from './ctx-ui.js';
import { mountSettings } from './settings-menu.js'; // 상단 바 정리 · ⚙ 설정 메뉴
import { mountSoundPop } from './sound-pop.js'; // 소리 켜짐일 때 소리 버튼 옆 ♪ 소리 설정 팝업
import { MockCtx } from './ctx-mock.mjs';
import { ConflictBook } from './conflict-core.mjs';
import { sessionColorMap, nodeSessIdx } from './multi-core.mjs';
import { MockPanels } from './mock-panel.mjs';
import { mockEn } from './mock-en.mjs'; // 가짜 데이터 문구 → 영어 화면이면 영어 // 서버 없는 화면의 패널 내용
import { PauseBuffer, eventsAfter, spaceForPause } from './live-pause.mjs';
import { escClears, scopeClears } from './filter-ui.mjs';
import { pickLabelAt } from './overview/pick-core.mjs';
import { blankClickAction, areaAtDown } from './proj-fade.mjs';
import { mountInspector } from './inspector.js'; // 객체 클릭 상세 팝업
import { mountArtifacts } from './art-ui.js'; // 작업 대상 층(⚙ 켬/끔)
import { mountPlans } from './plan-ui.js'; // 계획 보드(⚙ 켬/끔)
import { t as tr, applyDom, fmtNum } from './i18n.mjs'; // 다국어
import { localizeEvent, localizeSnapshot, localizeProjects } from './i18n-server.mjs'; // 서버가 조합한 문구 → 지금 언어(ko 면 그대로)

// index.html 정적 문구(data-i18n*)·문서 제목을 지금 언어로 — 가능한 한 일찍
applyDom();
document.title = tr('app.doc.title');

const params = new URLSearchParams(location.search);
const flag = (k) => params.has(k) && params.get(k) !== '0' && params.get(k) !== 'false';
const MODE = flag('demo') ? 'demo' : flag('mock') ? 'mock' : 'live';
const STRESS = Number(params.get('stress') || 0) || 0;
const TOKEN = params.get('t'); // 보통 서버가 302 로 지우고 쿠키로 바꾼다. 남아 있으면 API 에도 붙인다.
const SHOW_FPS = flag('fps');
// ?mock=1&ctx=85: 메인 컨텍스트 사용률을 고정(열화 단계 미리 보기·시험)
const CTX_FIX = params.has('ctx') && isFinite(Number(params.get('ctx'))) ? Math.max(0, Math.min(100, Number(params.get('ctx')))) : null;
// ?mock=1&ctxk=250: 메인 컨텍스트의 '늘어난 양'을 토큰(천 단위)으로 고정 — 절대량 기준 단계 미리 보기. 기준선(첫 응답) 60k 위에 +k, 창 1M
const CTX_K = params.has('ctxk') && isFinite(Number(params.get('ctxk'))) ? Math.max(0, Math.min(900, Number(params.get('ctxk')))) : null;
const mockCtxOpts = () => (CTX_K != null ? { mainStart: (60 + CTX_K) / 1000, limit: 1e6, mainBase: 60_000, mainStep: 0 }
  : CTX_FIX != null ? { mainStart: CTX_FIX / 100, mainStep: 0 } : {});
// 3차: 전체 보기. live 는 기본 '전체', mock 은 ?scope= 가 있을 때만(기존 ?mock=1 화면은 그대로)
const URL_SCOPE = params.get('scope');
const URL_SESSION = params.get('session');
const OV_MOCK = MODE === 'mock' && !!URL_SCOPE;
const CAN_ALL = MODE === 'live' || OV_MOCK;

const $ = (id) => document.getElementById(id);
const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } };
function relApi(path, q = {}) {
  // 상대 경로 유지(Worker 프록시·하위 경로 대비)
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null) sp.set(k, v);
  if (TOKEN) sp.set('t', TOKEN);
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

// ---------------- 상태 ----------------
const store = { nodes: new Map(), root: null, seq: 0, sessionId: null, projects: [], roots: [] };
const getNode = (id) => store.nodes.get(id);
let timeline = null; // 화면 아래 이벤트 타임라인, 장면을 만든 뒤 붙인다
let ctxUi = null;    // 컨텍스트 게이지·신호 열화
const pauseBuf = new PauseBuffer(); // 실시간 일시정지
let pendingSnap = null;             // 정지 중 도착한 스냅샷(mock 재개용)
let frozenPerf = null;              // 정지한 순간의 performance.now (타임라인 시계를 멈춤)

// ---------------- 테마 ----------------
let themePref = lsGet('ccviz.theme', 'auto');
const mql = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
const resolveTheme = () => (themePref === 'auto' ? (mql && mql.matches ? 'light' : 'dark') : themePref);
let view = null;
let art = null; // 작업 대상 층 컨트롤러(mountArtifacts)
let plans = null; // 계획 보드 컨트롤러(mountPlans)
// 같은 프로젝트 여러 live 세션: 같은 파일 충돌 장부(모든 표현이 같은 것을 읽음)·세션 색 칸
const conflicts = new ConflictBook();
let sessColors = new Map();
function syncSessColors() { sessColors = streamAll ? sessionColorMap(store.projects || []) : new Map(); }
let env = null; // 배경 환경: 공통 바닥 그리드·기상
function applyTheme() {
  const th = resolveTheme();
  document.documentElement.setAttribute('data-theme', th);
  const name = tr('app.theme.' + themePref);
  $('btn-theme').textContent = tr('app.theme.btn', { name }) + (themePref === 'auto' ? tr(th === 'dark' ? 'app.theme.autoDark' : 'app.theme.autoLight') : '');
  if (view) view.applyTheme();
  if (env) env.applyTheme();
  if (timeline) timeline.refreshTheme();
}
applyTheme();
mql && mql.addEventListener && mql.addEventListener('change', () => { if (themePref === 'auto') applyTheme(); });
$('btn-theme').addEventListener('click', () => {
  themePref = { auto: 'dark', dark: 'light', light: 'auto' }[themePref] || 'auto';
  lsSet('ccviz.theme', themePref);
  applyTheme();
});

function setLoading(text) {
  const el = $('loading'); if (!el) return;
  el.hidden = !text;
  if (text) el.querySelector('span').textContent = text;
}
function notice(html) { const n = $('notice'); n.innerHTML = html || ''; n.classList.toggle('on', !!html); }
let noticeTimer = 0;
function flash(html, ms = 4000) { clearTimeout(noticeTimer); notice(html); noticeTimer = setTimeout(() => notice(''), ms); }

// ---------------- 표현 모드(장면) ----------------
const urlView = normRenderer(params.get('view')); // ?view=flow|planet|voxel (옛 shapes → planet)
let viewMode = isRenderer(urlView) ? urlView : storedRenderer(lsGet('ccviz.view2'), lsGet('ccviz.view')); // 기본 흐름
let clockFn = Date.now;   // 재생 중엔 가상 시계
let timeScale = 1;        // 재생 속도(라이브 1)
let focusId = null;
let pendingScopeFocus = null; // 세션을 골랐는데 그 메인 노드가 아직 없을 때(도착하면 카메라 이동)

// 3D·2D: 기본 3D. 저장 'ccviz.dim', URL ?dim=2d|3d 는 이번 접속에서만 우선(저장값은 덮지 않음, 소리 토글 와 같은 방식)
let dim = initialDim(params.get('dim'), lsGet('ccviz.dim'));
const DIR_CLASS = {};        // 차원 → 카메라 클래스(동적 import 로 받음)
async function loadView(mode, d) {
  if (d === '2d') {
    const r = renderer2dFor(mode); // 2D 판이 없는 표현은 Flow 2D 로 그리고 '준비 중'
    const [C, D] = await Promise.all([r.load(), import('./flat/camera2d.js').then((m) => m.Director2D)]);
    return { C, D, opts: r.pending ? { pending: r.pending, pendingLabel: RENDERER_LABEL[r.pending] } : {} };
  }
  const [C, D] = await Promise.all([RENDERERS[mode](), import('./camera.js').then((m) => m.CameraDirector)]);
  return { C, D, opts: {} };
}
async function createView(mode, d = dim) {
  const { C, D, opts } = await loadView(mode, d);
  DIR_CLASS[d] = D;
  const v = new C($('stage'), $('labels'), opts);
  if (v.setSessions) v.setSessions({ book: conflicts });
  return v;
}
const isGlFail = (e) => /webgl/i.test(String((e && e.message) || e));
const glFailMsg = `<b>${tr('app.flash.glFail')}</b><br><span style="color:var(--muted)">${tr('app.flash.glFailSub')}</span>`;
try { view = await createView(viewMode, dim); }
catch (e) {
  console.warn('표현 모드 로드 실패', viewMode, dim, e);
  view = null;
  if (dim === '3d' && !isGlFail(e)) {
    const fb = viewMode === 'planet' ? DEFAULT_RENDERER : 'planet'; // Flow 가 실패하면 Planet 으로
    try {
      view = await createView(fb, '3d');
      flash(`<b>${tr('app.flash.viewFail', { name: RENDERER_LABEL[viewMode] })}</b><br><span style="color:var(--muted)">${tr('app.flash.viewFallback', { name: RENDERER_LABEL[fb] })}</span>`); viewMode = fb;
    } catch (e2) { console.warn('3D 대체 표현도 실패', e2); }
  }
  if (!view) {
    // WebGL 생성 실패(저사양·드라이버 차단) 또는 3D 모듈을 못 받음 → 2D 로(저장값은 그대로 — 다음 접속에 다시 3D 시도)
    if (dim === '3d') flash(glFailMsg, 7000);
    dim = '2d';
    view = await createView(viewMode, '2d');
  }
}
view.applyTheme();
// 카메라: 차원마다 하나씩 만들어 두고 다시 쓴다(3D CameraDirector 는 창 키 입력을 떼지 못하므로 새로 만들지 않음)
let dir3 = null, dir2 = null;
function directorFor(v) {
  if (v.flat) { if (!dir2) dir2 = new DIR_CLASS['2d'](v, getNode); else { dir2.active = true; dir2.attach(v); } return dir2; }
  if (!dir3) dir3 = new DIR_CLASS['3d'](v, getNode); else dir3.attach(v);
  return dir3;
}
/** 차원 전환 때 카메라 상태 넘기기: 자동 카메라 켬/끔·구도 방식·범위·활동 기록·상태 칩 */
function handOff(from, to) {
  if (!from || from === to) return;
  to.activity = from.activity; to.added = from.added; to.lastEventAt = from.lastEventAt;
  to.onStatus = from.onStatus; from.onStatus = null;
  to.setCamMode(from.camMode);
  to.setScope({ ...from.scope });
  to.setEnabled(from.enabled);
  if (from.detach) from.detach();
}
let director = directorFor(view);
const panel = new Panel({
  getNode,
  onPickNode: (id) => { focusId = id; view.setFocus(id); director.focusNode(id); },
  getProject: (pid) => store.projects.find((p) => p.projectId === pid) || null,
});
panel.getSessIdx = (n) => nodeSessIdx(n, sessColors); // 실황 이름 세션 색
const origSetFilter = panel.setFilter.bind(panel);
panel.setFilter = (id) => { origSetFilter(id); if (!id) { focusId = null; view.setFocus(null); } };
const music = new Music();
const sfx = new Sfx({ getMusicTime: () => (music.on ? music.harmonyTime() : null) });
// 소리 토글 하나로 배경음악·효과음을 함께(저장 'ccviz.sound', URL ?sound=1|0 은 이번 접속만)
const sound = new Sound({ music, sfx, button: $('btn-sound'), sfxSlider: $('sfx-vol') });
// 배경음악 자동 선곡: 최근 활동(재생 중이면 재생 시계 기준) → 단계 → 곡
const activity = new ActivityMeter();
music.setActivitySource(() => activity.sample(clockFn(), store.nodes.values()), () => pauseBuf.paused); // 일시정지 중엔 단계 시계도 멈춤

let autoCam = lsGet('ccviz.autocam') !== 'off';
const camBtn = $('btn-camera');
function setAutoCam(on) {
  autoCam = on;
  director.setEnabled(on);
  camBtn.setAttribute('aria-pressed', String(on));
  camBtn.textContent = on ? tr('app.btn.autoCam') : tr('app.btn.autoCamOff');
  lsSet('ccviz.autocam', on ? 'on' : 'off');
}
setAutoCam(autoCam);
camBtn.addEventListener('click', () => setAutoCam(!autoCam));
// Esc: 실황 노드 필터·포커스 해제(입력창 포커스 중 제외)
window.addEventListener('keydown', (e) => { if (escClears(e, !!panel.filter)) { e.preventDefault(); panel.setFilter(null); } });
// 자동 카메라 방식: 전체 맞춤(기본) ⇄ 활동 따라가기. ?cam=fit|follow, localStorage ccviz.camMode
const camModeBtn = document.createElement('button');
camModeBtn.id = 'btn-cam-mode'; camModeBtn.className = 'tb'; camModeBtn.type = 'button';
camBtn.insertAdjacentElement('afterend', camModeBtn);
function setCamMode(m) {
  m = m === 'follow' ? 'follow' : 'fit';
  director.setCamMode(m);
  camModeBtn.textContent = m === 'fit' ? tr('app.btn.camFit') : tr('app.btn.camFollow');
  camModeBtn.title = m === 'fit' ? tr('app.btn.camFitTitle') : tr('app.btn.camFollowTitle');
  camModeBtn.setAttribute('aria-pressed', String(m === 'follow'));
  lsSet('ccviz.camMode', m);
}
setCamMode(params.get('cam') || lsGet('ccviz.camMode') || 'fit');
camModeBtn.addEventListener('click', () => { camModeBtn.blur(); setCamMode(director.camMode === 'fit' ? 'follow' : 'fit'); });
director.onStatus = (s) => { const c = $('cam-chip'); c.textContent = s.text; c.classList.toggle('manual', s.mode === 'manual'); };

// '완료 표시': 기본 꺼짐 → 끝난(완료·중지됨) 노드는 흐려지며 퇴장. 켜면 다시 보인다. localStorage 는 lsGet/lsSet(try/catch)
let showDone = lsGet('ccviz.showDone') === 'on';
const doneBtn = $('btn-done');
function setShowDone(on) {
  showDone = !!on;
  if (view.setShowDone) view.setShowDone(showDone);
  doneBtn.setAttribute('aria-pressed', String(showDone));
  doneBtn.textContent = showDone ? tr('app.btn.doneOn') : tr('app.btn.done');
  lsSet('ccviz.showDone', showDone ? 'on' : 'off');
  statsDirty = true;
}
doneBtn.addEventListener('click', () => { doneBtn.blur(); setShowDone(!showDone); });

// 이벤트 타임라인: 라이브·재생 공통으로 onEvent 에서 push
timeline = mountTimeline({
  el: $('timeline'), getNode, nowFn: () => (frozenPerf != null ? frozenPerf : performance.now()),
  onPick: (id) => { if (!store.nodes.has(id)) return; focusId = id; view.setFocus(id); director.focusNode(id); origSetFilter(id); },
});

// 객체 클릭 상세 팝업: 카메라 다가가기·머물기(release 까지 10초 복귀 없음)·실시간 내용
const inspector = mountInspector({
  getView: () => view, nodes: store.nodes, clock: () => clockFn(),
  isReplaying: () => replaying, canScope: () => CAN_ALL && !replaying, canReplay: () => replaying || MODE === 'live',
  getProject: (pid) => store.projects.find((p) => p.projectId === pid) || null,
  getLimits: () => lg.value, sessIdx: (n) => nodeSessIdx(n, sessColors),
  getArt: () => (art && art.on ? art : null), // 대상 팝업
  planHtml: (n, nowMs) => (plans ? plans.inspectHtml(n, nowMs) : ''), // 노드 팝업 계획 항목
  planSheet: (id, nowMs) => (plans ? plans.sheetHtml(id, nowMs) : null), // 계획 보드 크게 보기
  onFoot: (n, on) => { if (view.setArtFoot) view.setArtFoot(streamAll ? n.projectId || null : '_', on ? n.id : null); }, // 발자국 강조
  onFocus: (t, { follow }) => {
    if (view.setArtSelected) view.setArtSelected(t.type === 'artifact' ? { pid: t.pid, id: t.id } : null);
    if (t.type === 'artifact') return; // 대상은 카메라를 옮기지 않는다(바닥층은 섬 맞춤에 이미 들어 있음)
    if (t.type === 'node') { focusId = t.id; view.setFocus(t.id); origSetFilter(t.id); }
    else if (focusId) { focusId = null; view.setFocus(null); if (panel.filter) origSetFilter(null); }
    if (director.inspect) director.inspect(t, follow); else if (t.type === 'node') director.focusNode(t.id);
  },
  onClose: (reason, was, { silent } = {}) => {
    if (view.setArtSelected) view.setArtSelected(null);
    if (view.setArtFoot && was && was.type === 'node') view.setArtFoot(null, null);
    if (director.release) director.release();
    if (was && was.type === 'node' && panel.filter === was.id) panel.setFilter(null);
    else if (was && focusId === was.id) { focusId = null; view.setFocus(null); }
    if (!silent) director.resumeAuto();
  },
  onFollow: (on) => { if (director.setFollow) director.setFollow(on); },
  onScopeSession: (n) => scopeToNode(n),
  onScopeProject: (pid) => { director.resumeAuto(); selectScope({ scope: 'project', projectId: pid }); },
  onReplay: (n) => {
    const t0 = Date.parse(n.startedAt || '') || null;
    if (replaying && eng) { if (t0) { eng.seek(Math.max(eng.startT, Math.min(eng.endT, t0))); if (eng.status !== 'playing') eng.play(); } return; }
    const sid = n.rootSessionId || store.sessionId || n.sessionId || null;
    if (!sid) return;
    const last = Date.parse(n.lastActivityAt || '') || t0;
    startReplay(sid, { at: last ? Math.max(t0 || 0, last - 60000) : null });
  },
});

// 범례
const legend = $('legend');
const legLi = (color, key) => `<li><i style="background:${color}"></i>${tr(key)} <span>${tr(key + '.d')}</span></li>`; // 이름 + 설명(key.d)
const legNote = (key) => `<li><span>${tr(key)}</span></li>`;
const legPlain = (key) => `<li>${tr(key)}</li>`;
legend.innerHTML =
  `<h3>${tr('app.leg.h.nodes')}</h3><ul>` + KINDS.map((k) => `<li><i style="background:var(--k-${k})"></i>${KIND_LABEL[k]} <span>${KIND_SHAPE[k]}</span></li>`).join('') + '</ul>' +
  `<h3>${tr('app.leg.h.status')}</h3><ul>` + legLi('var(--ok)', 'app.leg.active') + legLi('var(--muted)', 'app.leg.idle') +
  legLi('var(--link)', 'app.leg.done') + legLi('var(--stopped)', 'app.leg.stopped') +
  legLi('var(--error)', 'app.leg.error') + legNote('app.leg.endedNote') + '</ul>' +
  `<h3>${tr('app.leg.h.flow')}</h3><ul>` + legLi('var(--flow-call)', 'app.leg.call') +
  legLi('var(--ok)', 'app.leg.result') +
  legNote('app.leg.trail') +
  legNote('app.leg.strip') + '</ul>' +
  `<h3>${tr('app.leg.h.cats')}</h3><ul class="cats">` + CAT_ORDER.map((c) => `<li><i style="background:${c === 'skill' ? 'var(--skill)' : catColor(c, resolveTheme() === 'light')}"></i>${CAT_LABEL[c] || c}</li>`).join('') + '</ul>' +
  `<h3>${tr('app.leg.h.holo')}</h3><ul>` + legNote('app.leg.holo') + CATS.map((c) => `<li><i style="background:${c === 'skill' ? 'var(--skill)' : 'var(--muted)'}"></i>${CAT_LABEL[c]} <span>${HOLO_KIND[c].desc}</span></li>`).join('') + '</ul>' +
  `<h3>${tr('app.renderer.voxel')}</h3><ul>` + ['app.leg.vox1', 'app.leg.vox2', 'app.leg.vox3', 'app.leg.vox4'].map(legPlain).join('') + '</ul>' +
  `<h3>${tr('app.leg.h.controls')}</h3><ul>` + ['app.leg.ctl1', 'app.leg.ctl2', 'app.leg.ctl3', 'app.leg.ctl4', 'app.leg.ctl5', 'app.leg.ctl6', 'app.leg.ctl7'].map(legPlain).join('') + '</ul>';
$('btn-legend').addEventListener('click', () => {
  legend.hidden = !legend.hidden;
  $('btn-legend').setAttribute('aria-pressed', String(!legend.hidden));
});

// 상단 바 높이(좁은 화면에서 줄바꿈될 때)
new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', $('topbar').offsetHeight + 'px')).observe($('topbar'));

// ---------------- 캔버스 입력: 호버·클릭 (표현 전환 때 새 캔버스에 다시 붙임) ----------------
let hoverEv = null, hoverRaf = 0, downAt = null;
/** 화면 좌표 → 전체 보기 섬·건물 projectId(이름표 우선, 그다음 바닥 판정). 전체 스트림·실시간일 때만.
 * 단일 프로젝트 모드에서는 고른 프로젝트 이름표만(다른 섬은 숨어 있다) */
function clusterAt(v, x, y) {
  if (!streamAll || replaying || !v.pickCluster) return null;
  const fp = focusPid();
  if (fp) return pickLabelAt(x, y) === fp ? fp : null;
  return pickLabelAt(x, y) || v.pickCluster(x, y);
}
/** 단일 프로젝트 모드(전체 보기 스트림·실시간에서 프로젝트나 그 안 세션을 고름)면 그 projectId */
function focusPid() { return streamAll && !replaying && sel.scope !== 'all' && sel.scope !== 'archive' ? focusProjectOf(sel) || null : null; }
function bindCanvas(v) {
  const canvas = v.renderer.domElement;
  canvas.addEventListener('pointermove', (e) => {
    hoverEv = e;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (view !== v) return;
      const id = v.pick(hoverEv.clientX, hoverEv.clientY);
      v.setHover(id);
      if (ctxUi) ctxUi.hover(id, hoverEv);
      canvas.style.cursor = id || clusterAt(v, hoverEv.clientX, hoverEv.clientY) ? 'pointer' : '';
    });
  });
  canvas.addEventListener('pointerleave', () => { if (view === v) v.setHover(null); if (ctxUi) ctxUi.hover(null); });
  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    // 단일 프로젝트 영역 판정은 누른 순간의 카메라로(자동 카메라가 손 떼기 전까지 움직여도 누른 자리 기준)
    const fp = view === v ? focusPid() : null;
    if (fp && v.pickCluster) { downAt.view = v; downAt.fp = fp; downAt.area = v.pickCluster(e.clientX, e.clientY, { pid: fp }); }
  });
  canvas.addEventListener('click', (e) => {
    if (view !== v) return;
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
    const id = v.pick(e.clientX, e.clientY);
    // 클릭 = 상세 팝업 + 카메라가 다가감(범위 전환은 팝업 버튼·더블클릭)
    if (id) { inspector.open({ type: 'node', id }); return; }
    const fp = focusPid(); // 단일 프로젝트 모드
    // 바닥층 대상(파일·DB·저장소…) = 대상 팝업(누가 언제 무엇을). 숨은(다른) 프로젝트 대상은 집지 않음
    const ap = v.pickArtifact ? v.pickArtifact(e.clientX, e.clientY) : null;
    if (ap && (!fp || ap.pid === fp)) { inspector.open({ type: 'artifact', pid: ap.pid, id: ap.id }); return; }
    if (fp) {
      // 단일 프로젝트 모드는 그 프로젝트 영역(섬·건물 바닥 + 둘레 여유) 바깥 빈 곳을 눌러야만 풀린다.
      // 안쪽 빈 곳 = 팝업 닫기·노드 필터 해제만, 이름표 = 프로젝트 팝업
      if (pickLabelAt(e.clientX, e.clientY) === fp) { inspector.open({ type: 'cluster', pid: fp }); return; }
      const a0 = areaAtDown(downAt, v, fp);
      const area = a0 !== undefined ? a0 : v.pickCluster ? v.pickCluster(e.clientX, e.clientY, { pid: fp }) : null;
      const act = blankClickAction({ focus: fp, area, popup: inspector.isOpen });
      if (act === 'all') { if (inspector.isOpen) inspector.close('scope', { silent: true }); director.resumeAuto(); selectScope({ scope: 'all' }); return; }
      if (act === 'close') { inspector.close('blank'); return; }
      panel.setFilter(null); director.resumeAuto(); return;
    }
    // 노드가 아닌 섬·건물(경계 링·안쪽·이름표) = 그 프로젝트 팝업(예전 '그 프로젝트 선택'은 더블클릭·팝업 버튼)
    const pid = clusterAt(v, e.clientX, e.clientY);
    if (pid) { inspector.open({ type: 'cluster', pid }); return; }
    // 빈 곳: 팝업이 열려 있으면 닫기만(카메라는 자동으로 돌아감)
    if (inspector.isOpen) { inspector.close('blank'); return; }
    // 섬 밖 빈 곳: 좁혀 있었으면 전체 조망으로(재생 중엔 범위를 바꾸면 재생이 끝나므로 필터·카메라만)
    if (streamAll && !replaying && sel.scope !== 'all') { director.resumeAuto(); selectScope({ scope: 'all' }); return; }
    panel.setFilter(null); // 빈 곳 클릭: 실황 필터 + 포커스 해제
    director.resumeAuto(); // 10초 기다리지 않고 바로 자동 카메라로
  });
  // 더블클릭 = 범위 전환(노드 → 그 세션, 섬 → 그 프로젝트) — 예전 클릭 동작
  canvas.addEventListener('dblclick', (e) => {
    if (view !== v || !CAN_ALL) return;
    const id = v.pick(e.clientX, e.clientY);
    const n = id && store.nodes.get(id);
    if (n) { inspector.close('scope', { silent: true }); scopeToNode(n); return; }
    const pid = clusterAt(v, e.clientX, e.clientY);
    if (pid) { inspector.close('scope', { silent: true }); director.resumeAuto(); selectScope({ scope: 'project', projectId: pid }); }
  });
}
/** 노드가 속한 세션만 보기(claude -p·메인은 그 세션, 그 밖은 그 노드가 기록된 세션) */
function scopeToNode(n) {
  const sid = n.sessionId || (n.id.startsWith('s:') ? n.id.slice(2) : null) || n.rootSessionId;
  if (!sid) return;
  director.resumeAuto();
  selectScope({ scope: 'session', projectId: n.projectId || undefined, sessionId: sid });
}
bindCanvas(view);
env = mountEnv({ button: $('btn-env'), isLight: () => resolveTheme() === 'light' });
env.attach(view, viewMode);
// 기상(three)은 3D 장면을 처음 그릴 때 불러온다 — 2D 화면에서는 생략
let weather = null, weatherLoad = null;
function ensureWeather() {
  if (weatherLoad) return;
  weatherLoad = import('./env/weather.js').then(({ WeatherLayer }) => {
    weather = new WeatherLayer({ initial: params.get('weather') }); // ?weather=auto|off|fog|rain|snow
    env.addLayer(weather, () => weather.rowHtml());
  }).catch((e) => console.warn('기상 모듈 로드 실패', e));
}
if (!view.flat) ensureWeather();
/** 배경 환경 갱신을 장면 프레임(렌더 직전)에 붙인다 — 실시간 일시정지 중엔 장면 프레임이 멈추므로 같이 얼어 있다 */
function hookEnv(v) { const f = v.onFrame; v.onFrame = (dt, now) => { if (f) f(dt, now); env.frame(v, dt, now); }; }

// ---------------- 통계·FPS ----------------
let statsDirty = true, frames = 0, fpsT = performance.now(), fps = 0;
const hookFrame = (v) => { v.onFrame = (dt, now) => { director.update(dt, now); frames++; if (plans && plans.on) plans.sync(); }; }; // 보드 자리는 카메라를 옮긴 바로 그 프레임에(한 프레임 늦게 따라오지 않게)
hookFrame(view);
hookEnv(view);
setShowDone(showDone);

function setClock(fn) { clockFn = fn; if (view.setClock) view.setClock(fn); }
function setTimeScale(k) { timeScale = k; if (view.setTimeScale) view.setTimeScale(k); }

// 표현 전환. 상단 바 드롭다운 하나(표현 3종 + 3D·2D) — 순환 버튼·#btn-dim 토글 대신
const viewSel = mountViewSelector({
  button: $('btn-view'),
  get: () => ({ view: viewMode, dim, pending: dim === '2d' ? renderer2dFor(viewMode).pending : null }),
  onView: (v) => switchView(v),
  onDim: (d) => setDim(d),
});
function viewLabel() { viewSel.render(); }
const dimLabel = viewLabel;
/** 차원 바꾸기. save(버튼) = 저장하고 URL 의 dim= 은 지움 */
async function setDim(d, { save = true } = {}) {
  d = normDim(d);
  if (!d) return false;
  if (save) {
    lsSet('ccviz.dim', d);
    const u = new URL(location.href);
    if (u.searchParams.has('dim')) { u.searchParams.delete('dim'); history.replaceState(null, '', u); }
  }
  if (d === dim) { dimLabel(); return true; }
  return switchView(viewMode, d);
}
let switching = false;
async function switchView(next, nextDim = dim) {
  next = normRenderer(next) || nextRenderer(viewMode);
  if ((next === viewMode && nextDim === dim) || switching || !isRenderer(next)) return false;
  switching = true; viewSel.setDisabled(true);
  let nv = null;
  try { nv = await createView(next, nextDim); }
  catch (e) {
    console.warn('표현 전환 실패', next, nextDim, e);
    if (nextDim === '3d' && dim === '2d') flash(`<b>${tr('app.flash.glNo')}</b><br><span style="color:var(--muted)">${tr('app.flash.glNoSub')}</span>`);
    else flash(`<b>${tr('app.flash.viewFail', { name: RENDERER_LABEL[next] })}</b><br><span style="color:var(--muted)">${tr('app.flash.viewKeep')}</span>`);
    switching = false; viewSel.setDisabled(false);
    return false;
  }
  const old = view;
  nv.applyTheme();
  if (nv.setShowDone) nv.setShowDone(showDone);
  nv.setRoot(streamAll ? null : store.root);
  for (const n of store.nodes.values()) nv.addNode(n, false);
  if (streamAll && nv.setScope) nv.setScope(scopeArgs());
  nv.layoutNow();
  if (nv.setClock) nv.setClock(clockFn);
  if (nv.setTimeScale) nv.setTimeScale(timeScale);
  const nd = directorFor(nv); // 같은 차원이면 attach, 다른 차원이면 그 차원 카메라로 상태를 넘김
  if (nd !== director) { handOff(director, nd); director = nd; }
  view = nv;
  bindCanvas(nv);
  hookFrame(nv);
  if (!nv.flat) ensureWeather();
  env.attach(nv, next); hookEnv(nv);
  if (pauseBuf.paused) freezeView(nv, true); // 정지 중 표현을 바꿔도 얼린 채로
  if (focusId && nv.has(focusId)) nv.setFocus(focusId);
  try { old.dispose(); } catch (e) { console.warn('이전 장면 정리 실패', e); }
  viewMode = next;
  dim = nextDim;
  if (art) art.viewChanged(next); // 표현마다 저장된 켬/끔
  lsSet('ccviz.view2', next);
  const u = new URL(location.href);
  if (u.searchParams.has('view')) { u.searchParams.set('view', next); history.replaceState(null, '', u); }
  viewLabel(); dimLabel();
  switching = false; viewSel.setDisabled(false);
  statsDirty = true;
  return true;
}

// ---------------- 이벤트 처리 ----------------
let replaying = false;
let liveSessionId = null; // 실시간으로 보던 세션(세션 고르기의 '현재 세션')
function onSnapshot(snap, o = {}) {
  localizeSnapshot(snap);
  if (pauseBuf.paused && !o.resume) { pauseBuf.sawSnapshot(); pendingSnap = snap; return; }
  if (snap && snap.scope === 'all') return onSnapshotAll(snap, o);
  streamAll = false;
  syncSessColors();
  conflicts.reset([]);
  store.nodes.clear();
  view.reset();
  panel.reset();
  director.resetActivity();
  if (view.scope && view.scope.mode === 'all') view.setScope({ mode: 'session' });
  director.setScope({ mode: 'session' });
  panel.setScopeFilter(null);
  panel.setShowProject(false);
  store.root = snap.root || null;
  store.seq = snap.seq || 0;
  store.sessionId = snap.sessionId || store.sessionId || null;
  if (!replaying) liveSessionId = store.sessionId;
  view.setRoot(store.root);
  for (const n of snap.nodes || []) { const c = { ...n, meta: { ...(n.meta || {}) }, openTools: [...(n.openTools || [])] }; store.nodes.set(c.id, c); view.addNode(c, false); }
  view.layoutNow();
  if (focusId && view.has(focusId)) view.setFocus(focusId);
  for (const ev of snap.recent || []) panel.add(ev);
  inspector.reset(snap.recent);
  timeline.clear();
  if (art) art.snapshot(); // 그 시점 기본 장부(재생이면 재생 시각까지)
  if (plans) plans.reset();
  if (!o.keepCamera) director.overview(true);
  statsDirty = true;
}

function onEvent(ev, opts = {}) {
  if (!ev || !ev.type) return;
  localizeEvent(ev);
  if (pauseBuf.paused && !opts.resume && !opts.replay) { pauseBuf.push(ev); pauseConn(); return; } // 정지 중: 쌓기만
  if (typeof ev.seq === 'number') { if (ev.seq <= store.seq) return; store.seq = ev.seq; }
  const quiet = !!opts.quiet;
  const speed = opts.speed || 1;
  const fx = !quiet;
  // 빠른 재생에서는 포커스 노드만 말풍선
  const sayOk = fx && (speed < 16 || ev.nodeId === focusId);
  const n = store.nodes.get(ev.nodeId);
  if (ctxUi && ev.type === 'node-update' && ev.patch && ev.patch.meta && ev.patch.meta.ctx) ctxUi.noteCtx(ev, n, opts); // 병합 전 값과 비교(급락 → 정화)
  if (plans && plans.on && (ev.type === 'node-update' || ev.type === 'node-add')) plans.event(ev, ev.type === 'node-add' ? store.nodes.get(ev.nodeId) : n, { quiet }); // 병합 전 값과 비교(항목 연출)
  switch (ev.type) {
    case 'node-add': {
      const node = ev.node; if (!node) break;
      const prev = store.nodes.get(node.id);
      if (prev) { Object.assign(prev, node); view.updateNode(node.id, node); }
      else {
        const c = { ...node, meta: { ...(node.meta || {}) }, openTools: [...(node.openTools || [])] };
        store.nodes.set(c.id, c);
        if (!streamAll && !store.root && (c.kind === 'main' || !c.parentId)) { store.root = c.id; view.setRoot(c.id); }
        view.addNode(c, fx);
      }
      if (pendingScopeFocus === node.id && streamAll) { pendingScopeFocus = null; focusId = node.id; view.setFocus(node.id); director.scopeNodeArrived(node.id); }
      break;
    }
    case 'node-remove': {
      // 전체 보기 전용: 서브트리 제거. 패널·효과음 없음. 화면에서는 퇴장 연출 뒤 지움(배속·조용함이면 바로)
      for (const id of ev.ids || [ev.nodeId]) {
        if (!store.nodes.has(id)) continue;
        store.nodes.delete(id);
        view.removeNode(id, { animate: fx, quiet });
        if (focusId === id) { focusId = null; view.setFocus(null); }
        if (panel.filter === id) panel.setFilter(null);
      }
      statsDirty = true;
      return;
    }
    case 'node-update': {
      if (!n) break;
      const { meta, ...rest } = ev.patch || {};
      Object.assign(n, rest);
      if (meta) n.meta = { ...(n.meta || {}), ...meta };
      view.updateNode(n.id, ev.patch || {}, { quiet });
      break;
    }
    case 'tool-start':
      if (n) {
        n.openTools = n.openTools || [];
        if (!n.openTools.some((t) => t.toolUseId === ev.toolUseId)) n.openTools.push({ toolUseId: ev.toolUseId, tool: ev.tool, cat: ev.cat, skill: ev.skill, startedAt: ev.ts, text: ev.text, ...(ev.brief ? { brief: ev.brief } : {}), ...(ev.panel ? { panel: ev.panel } : {}) });
        view.toolStart(n.id, ev, quiet);
        if (sayOk && (ev.text || ev.tool)) view.say(n.id, ev.text || ev.tool, { type: 'tool', cat: ev.cat });
      }
      break;
    case 'tool-end':
      if (n) { n.openTools = (n.openTools || []).filter((t) => t.toolUseId !== ev.toolUseId); view.toolEnd(n.id, ev); }
      break;
    case 'text':
      if (fx) view.ripple(ev.nodeId);
      if (sayOk && ev.role === 'assistant' && ev.text) view.say(ev.nodeId, ev.text, { type: 'text' });
      break;
    case 'thinking': break;
    case 'user':
      if (!fx) break;
      if (ev.origin === 'human') { view.beam(ev.nodeId); if (sayOk && ev.text) view.say(ev.nodeId, ev.text, { type: 'user' }); }
      else view.wave(ev.nodeId, view.tokens.skill, 1.2);
      break;
    case 'result':
      if (fx) {
        // 흐름 연출이 있는 표현(도형)은 결과 패킷이 부모로 돌아가므로 빛 구를 따로 띄우지 않는다
        if (n && n.parentId && store.nodes.has(n.parentId)) { if (!view.flowEvent) view.orb(ev.nodeId, n.parentId, ev.ok === false ? view.tokens.error : view.tokens.ok, 1.0); }
        else view.ripple(ev.nodeId, ev.ok === false ? view.tokens.error : view.tokens.ok);
      }
      if (sayOk) view.say(ev.nodeId, ev.text || '', { type: 'result', ok: ev.ok });
      break;
    case 'output': if (fx) view.wave(ev.nodeId, null, 0.9); break;
    case 'conflict': conflicts.apply(ev); break; // 같은 파일(화면은 장부를 매 프레임 읽음)
    case 'session-msg': if (fx && view.sessionMsg) view.sessionMsg(ev); break; // 세션 간 메시지 패킷
  }
  inspector.event(ev); // 상세 팝업 장부(재생이면 재생 시점 기준)
  if (art) art.event(ev, { quiet, speed }); // 작업 대상 장부·연출(끄면 아무것도 안 함) · art 없는 검색·실패·중지 연출도
  if (view.holo) view.holo.event(ev, { quiet }); // 홀로그램 패널 안 실제 글(panel·parentPanel →)
  if (n && ev.ts) n.lastActivityAt = ev.ts;
  // 흐름 연출·타임라인: 라이브·재생 같은 경로. 스크럽·밀린 이벤트(quiet)는 건너뛴다
  if (fx) {
    activity.note(ev, clockFn()); // 자동 선곡 지표(밀린·스크럽 이벤트는 세지 않음)
    if (view.flowEvent) view.flowEvent(ev, { speed });
    timeline.push(ev, store.nodes.get(ev.nodeId) || ev.node || null);
  }
  director.noteEvent(ev);
  panel.add(ev);
  sfx.onEvent(ev, { node: store.nodes.get(ev.nodeId) || ev.node || null, speed, quiet, replay: !!opts.replay });
  if (env) env.noteEvent(ev, { quiet });
  statsDirty = true;
}

// ---------------- 프로젝트 목록·한도 게이지 ----------------
const lg = mountLimits({ el: $('limits') });
function demoLimitsFor() {
  // mock·demo 화면: 서버 --demo 와 같은 모양의 고정 값(주의·경고·오래됨)
  const H = 3600e3, now = Date.now(), cap = new Date(now - 12 * 60000).toISOString();
  const w = (pct, inMs) => ({ pct, resetsAt: new Date(now + inMs).toISOString(), resetsInSec: Math.round(inMs / 1000), source: 'statusline', capturedAt: cap, expired: false });
  return { ok: true, source: 'statusline', capturedAt: cap, ageSec: 720, stale: true, five_hour: w(72, 2 * H + 40 * 60000), seven_day: w(93, 53 * H), plan: 'max' };
}
let pl = null;

// ---------------- 범위(전체·프로젝트·세션) ----------------
// sel = {scope:'all'} | {scope:'project', projectId} | {scope:'session', projectId?, sessionId}  ('session:auto' = 기존 자동 단일 세션)
function initialSelection() {
  if (!CAN_ALL) return { scope: 'session', sessionId: 'auto' };
  if (URL_SCOPE) return parseSelection(URL_SCOPE);
  if (URL_SESSION) return { scope: 'session', sessionId: URL_SESSION };   // 기존 ?session= 링크(ccviz start --session)
  if (MODE === 'live') { const saved = lsGet('ccviz.scope'); if (saved) return parseSelection(saved); }
  return { scope: 'all' };
}
let sel = initialSelection();
let streamAll = false;       // 지금 /events?scope=all 에 붙어 있는가
// 예전 '비활성 표시' 토글(ccviz.inactive)은 없앴다 — 비활성 세션은 목록·장면 어디에도 싣지 않는다. 남은 저장값은 지운다
try { localStorage.removeItem('ccviz.inactive'); } catch (e) { /* 저장소 없음 */ }
let sessionsResp = null;     // /sessions 응답(선택지 보충용)
if (CAN_ALL) {
  // 상단 바 프로젝트 선택기 하나(전체 · 프로젝트들). 예전 범위 드롭다운·패널 프로젝트 목록·재생 고르기 창을 합침
  pl = mountProjectSelector({
    host: $('proj-sel'),
    onSelect: (s) => selectScope(s),
    getNodeCount: (pid) => { let n = 0; for (const x of store.nodes.values()) if (x.projectId === pid) n++; return n; },
  });
  pl.setSelection(sel);
} else {
  $('proj-sel').innerHTML = `<button type="button" class="tb psel-btn" disabled title="${tr('app.mock.noServer')}"><span class="psel-name">${MODE === 'demo' ? tr('app.mock.demo') : tr('app.mock.fake')}${STRESS ? tr('app.mock.stressParen', { n: STRESS }) : ''}</span></button>`;
}

/** 세션 S 가 전체 보기 안에 있으면 그 허브 루트 sessionId, 아니면 null */
function overviewRootOf(sid) {
  if (!sid || sid === 'auto') return null;
  if (store.roots.some((r) => r.sessionId === sid)) return sid;
  if (streamAll) { const n = store.nodes.get('s:' + sid); if (n && n.rootSessionId) return n.rootSessionId; }
  for (const p of store.projects) {
    const it = (p.liveList || []).find((s) => s.sessionId === sid);
    if (!it || it.inOverview === false) continue;
    if (it.rootSessionId) return it.rootSessionId;
    // 허브가 아직 루트를 알려 주기 전(첫 연결 전)에는 live cli 메인이면 전체 보기 안이라고 본다
    if (!streamAll && !it.isChild && it.entrypoint === 'cli') return sid;
  }
  return null;
}
function projectOfSession(sid) {
  if (isArc(sid)) { const a = archiveSession(sid); return a ? a.projectId : null; }
  const n = store.nodes.get('s:' + sid);
  if (n && n.projectId) return n.projectId;
  const r = store.roots.find((x) => x.sessionId === sid);
  if (r) return r.projectId;
  for (const p of store.projects) if (sessionsOf(p).some((s) => s.sessionId === sid)) return p.projectId;
  const s = sessionsResp && (sessionsResp.sessions || []).find((x) => x.sessionId === sid);
  return s ? s.projectDir || null : null;
}
const wantAll = (s) => CAN_ALL && (s.scope !== 'session' || !!overviewRootOf(s.sessionId));
const focusProjectOf = (s) => (s.scope === 'all' || s.scope === 'archive' ? null : s.projectId || projectOfSession(s.sessionId));
// 보관함: 세션 id 'arc:<uuid>', 요약은 GET /archive
const isArc = (sid) => typeof sid === 'string' && sid.startsWith('arc:');
let archive = null;
const archiveSession = (sid) => (archive && (archive.sessions || []).find((x) => x.sessionId === sid)) || null;
const archiveName = (pid) => { const p = pid && archive && (archive.projects || []).find((x) => x.projectId === pid); return p ? p.name : null; };
function scopeArgs() {
  return { mode: 'all', roots: store.roots, projects: store.projects, showInactive: false, focusProject: focusProjectOf(sel) };
}

/** 3D·카메라·패널에 현재 선택 반영(전체 보기 스트림일 때). fly = 사용자가 방금 고름 */
function applyScopeView(fly = false) {
  if (!streamAll) return;
  if (view.setScope) view.setScope(scopeArgs());
  const fp = focusProjectOf(sel);
  const sessRid = sel.scope === 'session' ? (overviewRootOf(sel.sessionId) || sel.sessionId) : null;
  director.setScope({ mode: 'all', focusProject: fp, focusSession: sessRid, focusNode: sessRid ? 's:' + sel.sessionId : null });
  panel.setShowProject(sel.scope === 'all');
  if (sel.scope === 'session') {
    const rid = overviewRootOf(sel.sessionId) || sel.sessionId;
    panel.setScopeFilter({ rootSessionId: rid });
    const id = 's:' + sel.sessionId;
    // 카메라 이동은 director.setScope(focusSession·focusNode)가 맡는다(세션 트리 넓은 구도 + 그 세션 안 순환).
    // 예전엔 여기서 focusNode 를 또 불러 '수동 조작 중'으로 바뀌고 10초 동안 자동 순환이 멈췄다.
    if (view.has(id)) { focusId = id; view.setFocus(id); }
    else pendingScopeFocus = id; // 노드가 아직 안 왔으면(스냅샷 전) 도착하면 그때 이동
  } else {
    pendingScopeFocus = null;
    panel.setScopeFilter(fp ? { projectId: fp } : null);
    if (focusId) { focusId = null; view.setFocus(null); }
  }
  statsDirty = true;
}

function persistSelection() {
  if (MODE !== 'live' && !OV_MOCK) return;
  const auto = sel.scope === 'session' && sel.sessionId === 'auto';
  const u = new URL(location.href);
  if (auto) { u.searchParams.delete('scope'); u.searchParams.set('session', 'auto'); }
  else { u.searchParams.set('scope', serializeSelection(sel)); u.searchParams.delete('session'); }
  history.replaceState(null, '', u);
  if (MODE === 'live' && !auto) lsSet('ccviz.scope', serializeSelection(sel));
}

/** 선택 바꾸기(패널 목록·상단 선택지·섬 클릭·전체로 버튼 공통) */
function selectScope(next, { fly = true } = {}) {
  if (!next || !next.scope) next = { scope: 'all' };
  if (scopeClears(next) && panel.filter) panel.setFilter(null); // 프로젝트(재선택 포함)·전체 고르면 실황 노드 필터 해제
  if (next.scope === 'session' && !next.projectId && next.sessionId !== 'auto') next = { ...next, projectId: projectOfSession(next.sessionId) };
  sel = next;
  if (pauseBuf.paused) setPaused(false, { drop: true }); // 범위를 바꾸면 정지 풀고 새로 연결
  persistSelection();
  if (pl) pl.setSelection(sel);
  if (replaying) { stopReplay(); return; }     // 실시간으로 돌아가며 그 범위로 연결
  refreshScopeUi();
  if (wantAll(sel) && streamAll) applyScopeView(fly);
  else connect();
}

function refreshScopeUi() {
  if ($('btn-pause')) $('btn-pause').hidden = replaying;
  if (pl) pl.setLabel(replaying && eng ? (isArc(eng.sessionId) ? '▶ 📦 ' + (archiveName(replayProject) || tr('app.proj.archive')) : '▶ ' + (projectName(replayProject) || tr('app.btn.replay'))) : null);
  updateMacro();
}

// ---------------- 매크로 타임라인: 프로젝트 세션들을 시간축 막대로, 누르면 재생 ----------------
const projectName = (pid) => { const p = pid && store.projects.find((x) => x.projectId === pid); return p ? p.name : null; };
let replayProject = null; // 재생 중인 세션의 프로젝트(매크로 타임라인이 그 프로젝트를 보인다)
function macroContext() {
  if (!CAN_ALL) return { mode: 'project', projectId: null, label: MODE === 'demo' ? tr('app.mock.demoSession') : tr('app.mock.fakeSession') };
  // 보관함: 보관함을 골랐거나 보관 세션을 재생 중이면 보관 세션만
  const arcCtx = (pid) => ({ mode: 'archive', projectId: pid || null, label: pid ? archiveName(pid) || null : tr('app.proj.archive') });
  if (sel.scope === 'archive' && (!replaying || (eng && isArc(eng.sessionId)))) return arcCtx(sel.projectId);
  if (replaying && eng && isArc(eng.sessionId)) return arcCtx(replayProject);
  const pid = replaying ? (replayProject || focusProjectOf(sel)) : (sel.scope === 'all' ? null : focusProjectOf(sel));
  return pid ? { mode: 'project', projectId: pid } : { mode: 'all' };
}
let macro = null;
function updateMacro() { if (macro) macro.setContext(macroContext()); }

// ---------------- 연결(실시간) ----------------
let es = null, mockSrc = null, ovMock = null, retryTimer = 0;
let connSaved = null;
function setConn(state, text) {
  if (pauseBuf.paused) { connSaved = [state, text]; return; } // 정지 중엔 정지 문구 유지(재개 때 복원)
  const c = $('conn'); c.className = 'conn ' + state; c.querySelector('b').textContent = text; c.title = text;
}

function disconnect() {
  clearTimeout(retryTimer);
  setLoading('');
  if (es) { es.close(); es = null; }
  if (mockSrc) { mockSrc.close(); mockSrc = null; }
  if (ovMock) { ovMock.stop(); ovMock = null; }
}

/** scope=all 스냅샷: store 를 비우고 모든 노드 → setScope → layoutNow → director.setScope */
function onSnapshotAll(snap, o = {}) {
  localizeSnapshot(snap);
  if (pauseBuf.paused && !o.resume) { pauseBuf.sawSnapshot(); pendingSnap = snap; return; }
  streamAll = true;
  store.nodes.clear();
  view.reset();
  panel.reset();
  director.resetActivity();
  store.root = null;
  store.seq = snap.seq || 0;
  if (snap.projects) store.projects = snap.projects;
  store.roots = snap.roots || [];
  syncSessColors();
  conflicts.reset(snap.conflicts || []); // 지금 켜진 충돌
  view.setRoot(null);
  for (const n of snap.nodes || []) { const c = { ...n, meta: { ...(n.meta || {}) }, openTools: [...(n.openTools || [])] }; store.nodes.set(c.id, c); view.addNode(c, false); }
  if (view.setScope) view.setScope(scopeArgs());
  view.layoutNow();
  if (pl) pl.setProjects(store.projects);
  // 고른 세션이 전체 보기 밖이면(지난 세션 등) 단일 세션 연결로
  if (sel.scope === 'session' && !wantAll(sel)) { connect(); return; }
  if (sel.scope === 'session' && !sel.projectId) { sel = { ...sel, projectId: projectOfSession(sel.sessionId) }; if (pl) pl.setSelection(sel); }
  for (const ev of snap.recent || []) panel.add(ev);
  inspector.reset(snap.recent);
  if (art) art.snapshot();
  if (plans) plans.reset();
  if (!o.keepCamera) director.overview(true);
  applyScopeView(false);
  liveSessionId = currentSessionId();
  refreshScopeUi();
  statsDirty = true;
}

function onProjects(d) {
  if (!d) return;
  localizeProjects(d);
  if (pauseBuf.paused) { pauseBuf.projects = d; return; }
  if (Array.isArray(d.projects)) store.projects = d.projects;
  if (Array.isArray(d.roots)) store.roots = d.roots;
  syncSessColors();
  if (pl) pl.setProjects(store.projects);
  if (streamAll && view.setScope) view.setScope(scopeArgs());
  if (streamAll) liveSessionId = currentSessionId();
  if (art) art.projectsChanged(); // 새 섬의 기본 장부
  refreshScopeUi();
}

/** 재생 고르기의 '현재 세션': 고른 세션 → 고른 프로젝트의 첫 루트 → 첫 live 루트 */
function currentSessionId() {
  if (!streamAll) return store.sessionId;
  if (sel.scope === 'session') return sel.sessionId;
  const fp = focusProjectOf(sel);
  const r = (fp && store.roots.find((x) => x.projectId === fp && !x.orphanSdk)) || store.roots.find((x) => x.live && !x.orphanSdk) || store.roots[0];
  return r ? r.sessionId : null;
}

function connect() {
  disconnect();
  if (replaying) return;
  if (MODE !== 'live') {
    if (OV_MOCK) {
      import('./overview/mock.js').then(({ createOverviewMock }) => {
        if (replaying || ovMock) return;
        // ?multi=1: 같은 프로젝트 live 메인 3·2·5(마주 보기·파이·충돌·세션 간 메시지 확인용)
        const multi = params.get('multi');
        const isl = Number(params.get('islands')) || 0; // ?islands=N: 살아 있는 섬 N 개(화면 비율 배치 확인용)
        const m = (ovMock = createOverviewMock(isl ? { projects: isl, mainsPerProject: [2, 1, 1, 2, 1, 1].slice(0, isl), seed: 2026 } : { projects: 4, mainsPerProject: multi ? [3, 2, 0, 5] : [2, 1, 0, 1], seed: 2026 }));
        const mc = new MockCtx({ roots: true }), mp = new MockPanels();
        onSnapshotAll(mockEn(mp.seed(mc.seed(m.snapshot()))));
        setConn('ok', tr('app.mock.fakeAll'));
        m.start((ev) => { if (ovMock !== m) return; onEvent(mockEn(mp.apply(ev))); for (const x of mc.after(ev, getNode)) onEvent(x); }, (d) => { if (ovMock === m) onProjects(mockEn(d)); });
      });
      return;
    }
    const mc = new MockCtx(mockCtxOpts()), mp = new MockPanels();
    mockSrc = createMockSource({ onSnapshot: (snap) => onSnapshot(mockEn(mp.seed(mc.seed(snap)))), onEvent: (ev) => { onEvent(mockEn(mp.apply(ev))); for (const x of mc.after(ev, getNode)) onEvent(x); }, onStatus: (s, t) => setConn(s, t) }, { mode: MODE, stress: STRESS });
    return;
  }
  setConn('wait', tr('app.conn.connecting'));
  store.seq = 0;
  const all = wantAll(sel);
  setLoading(all ? tr('app.loading.all') : tr('app.loading.session'));
  const q = all ? { scope: 'all' } : { session: sel.scope === 'session' ? sel.sessionId : 'auto' };
  if (!all) streamAll = false;
  refreshScopeUi();
  const src = (es = new EventSource(relApi('events', q)));
  src.addEventListener('snapshot', (e) => {
    if (src !== es) return;
    setLoading('');
    try { const d = JSON.parse(e.data); if (all) onSnapshotAll(d); else onSnapshot(d); } catch (err) { console.warn('snapshot parse', err); }
  });
  src.addEventListener('ev', (e) => { if (src !== es) return; try { onEvent(JSON.parse(e.data)); } catch (err) { console.warn('ev parse', err); } });
  src.addEventListener('projects', (e) => { if (src !== es) return; try { onProjects(JSON.parse(e.data)); } catch (err) { console.warn('projects parse', err); } });
  src.addEventListener('limits', (e) => { if (src !== es) return; try { lg.set(JSON.parse(e.data)); } catch (err) { console.warn('limits parse', err); } });
  src.addEventListener('root', (e) => {
    if (src !== es || replaying) return; // 재생 중엔 자동 전환 무시
    try { const d = JSON.parse(e.data); toastRoot(d.sessionId); } catch (err) { /* 무시 */ }
  });
  src.onopen = () => { if (src !== es) return; setConn('ok', all ? tr('app.conn.okAll') : tr('app.conn.ok')); notice(''); };
  src.onerror = async () => {
    if (src !== es) return;
    if (src.readyState === EventSource.CLOSED) {
      setLoading('');
      setConn('bad', tr('app.conn.lost'));
      if (await authFailed()) return;
      if (src === es && !replaying) retryTimer = setTimeout(connect, 4000);
    } else setConn('wait', tr('app.conn.retry'));
  };
}

async function authFailed() {
  try {
    const r = await fetch(relApi('sessions'), { cache: 'no-store' });
    if (r.status === 401) {
      setConn('bad', tr('app.conn.auth'));
      notice(`<b>${tr('app.notice.token')}</b><br><span style="color:var(--muted)">${tr('app.notice.tokenSub')}</span>`);
      return true;
    }
    if (r.status === 503) notice(`<b>${tr('app.notice.serverOff')}</b><br><span style="color:var(--muted)">${tr('app.notice.serverOffSub')}</span>`);
  } catch (e) { /* 네트워크 오류: 재시도 */ }
  return false;
}

function toastRoot(sid) {
  const it = sessionsResp && (sessionsResp.sessions || []).find((x) => x.sessionId === sid);
  const name = (it && it.title) || (sid || '').slice(0, 8);
  setConn('ok', tr('app.conn.switched', { name: name.slice(0, 20) }));
  setTimeout(() => { if (!replaying) setConn('ok', tr('app.conn.ok')); }, 4000);
}

// ---------------- 재생 ----------------
// api.getJson(path, query) → {status, body}. live 는 서버, mock·demo 는 메모리 재생 API.
let localApiP = null;
async function buildLocalApi() {
  let events, sid, title;
  if (MODE === 'demo') {
    const r = await fetch('demo-events.jsonl', { cache: 'no-cache' });
    events = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    sid = 'demo-replay'; title = tr('app.mock.demoSession');
  } else {
    const { MockGenerator } = await import('./mock.js');
    const gen = new MockGenerator({ seed: 2026, startMs: Date.now() - 20 * 60000, stress: STRESS });
    events = [];
    while (gen.q.length) { const at = Math.min(...gen.q.map((x) => x.at)); if (at > 20 * 60000) break; events.push(...gen.next().events); }
    sid = 'mock-replay'; title = tr('app.mock.fakeSessionSim');
  }
  events = new MockPanels().inject(new MockCtx().inject(events)); // 컨텍스트 사용률 합성·패널 내용 — 재생에서도 그 시점 값
  const base = createLocalReplayApi(events, { sessionId: sid, title });
  const tl = base.timeline;
  const item = { sessionId: sid, projectDir: 'local', cwd: MODE === 'demo' ? tr('app.mock.demoCwd') : tr('app.mock.fake'), title, entrypoint: 'cli', isChild: false,
    mtime: tl.endTs, sizeBytes: 1, live: false, liveStatus: null, startedAt: tl.startTs, endedAt: tl.endTs, durationMs: tl.durationMs,
    eventCount: base.events.length, eventCountEst: base.events.length, replayCached: true };
  return {
    sid,
    async getJson(path, q = {}) {
      if (path === 'sessions') return { status: 200, body: { sessions: [item], auto: sid, projects: [] } };
      return base.getJson(path, { ...q, session: sid });
    },
  };
}
const replayApi = {
  async getJson(path, q = {}) {
    if (MODE !== 'live') { localApiP = localApiP || buildLocalApi(); return (await localApiP).getJson(path, q); }
    const r = await fetch(relApi(path, q), { cache: 'no-store' });
    let body = null;
    try { body = await r.json(); } catch (e) { /* 본문 없음 */ }
    return { status: r.status, body };
  },
};

let eng = null;
const STATUS_TXT = Object.fromEntries(['loading', 'buffering', 'ready', 'playing', 'paused', 'ended', 'error'].map((k) => [k, tr('app.replay.st.' + k)]));
let connRaf = 0;
function replayConn() {
  if (connRaf) return;
  connRaf = requestAnimationFrame(() => {
    connRaf = 0;
    if (!eng) return;
    const s = eng.status;
    const pct = s === 'loading' && eng.progress && eng.progress.bytesTotal ? ` ${Math.round((eng.progress.bytesRead / eng.progress.bytesTotal) * 100)}%` : '';
    const clock = eng.timeline ? ` · ${fmtClock(eng.vt)}` : '';
    const state = s === 'error' ? 'bad' : s === 'playing' ? 'ok' : 'wait';
    setConn(state, `${STATUS_TXT[s] || s}${pct} · ${eng.speed}×${clock}`);
    if (s === 'error') $('conn').title = tr('app.replay.errTitle', { msg: eng.error || '' });
  });
}
let lastClockConn = 0;

let ui = null;
function setReplayUrl(sid) {
  const u = new URL(location.href);
  if (sid) u.searchParams.set('replay', sid);
  else { u.searchParams.delete('replay'); u.searchParams.delete('at'); u.searchParams.delete('speed'); }
  history.replaceState(null, '', u);
}

async function startReplay(sid, { at = null, speed = null, autoplay = true } = {}) {
  if (!sid) return;
  if (eng) { eng.close(); eng = null; }
  if (pauseBuf.paused) setPaused(false, { drop: true });
  replaying = true;
  disconnect();
  streamAll = false;
  ui.closePicker();
  panel.markLate = false;
  // 재생 중에도 프로젝트 선택기는 쓸 수 있다(다른 프로젝트를 고르면 재생을 끝내고 그 범위로)
  replayProject = replayProjectHint || projectOfSession(sid) || (sel.scope === 'all' ? null : focusProjectOf(sel));
  replayProjectHint = null;
  lg.setReplaying(true);
  $('btn-replay').setAttribute('aria-pressed', 'true');
  if (isArc(sid)) arcCard.show(archiveSession(sid) || { sessionId: sid }); else arcCard.hide();
  const e = (eng = new ReplayEngine({
    api: replayApi, sessionId: sid,
    sink: { onSnapshot: (s) => { if (eng === e) onSnapshot(s); }, onEvent: (ev, o) => { if (eng === e) onEvent(ev, o || {}); } },
  }));
  ui.bind(e);
  refreshScopeUi(); // 매크로 타임라인: 재생 세션의 프로젝트
  if (speed) e.setSpeed(speed);
  ui.setVisible(true);
  setClock(() => e.vt);
  setTimeScale(e.speed);
  e.on('state', (s) => {
    if (eng !== e) return;
    if (s.speed !== timeScale) setTimeScale(s.speed);
    replayConn();
    // 연속 재생: 끝나면 잠깐 쉬고 다음 세션
    if (demoOn && s.status === 'ended' && !e._demoNext) { e._demoNext = true; setTimeout(() => { if (eng === e && demoOn) demoNext(e.sessionId); }, DEMO.NEXT_DELAY_MS); }
  });
  e.on('clock', () => { if (eng !== e) return; const t = performance.now(); if (t - lastClockConn > 250) { lastClockConn = t; replayConn(); if (macro) macro.setPlayhead(sid, e.vt); } });
  setReplayUrl(sid);
  replayConn();
  const ok = await e.open();
  if (eng !== e) return;
  if (ok && isArc(sid) && e.timeline && !archiveSession(sid)) arcCard.show({ sessionId: sid, title: e.timeline.title, startedAt: e.timeline.startTs, endedAt: e.timeline.endTs });
  if (!ok && demoOn) { setTimeout(() => { if (eng === e && demoOn) demoNext(sid); }, DEMO.NEXT_DELAY_MS); } // 연속 재생은 못 연 세션을 건너뜀
  if (!ok) { replayConn(); flash(`<b>${tr('app.replay.loadFail')}</b><br><span style="color:var(--muted)">${escapeAttr(e.error || '')}</span>`, 6000); return; }
  if (at != null && isFinite(at)) {
    // at: 0..1 은 비율, 1e11 미만은 시작부터 ms, 그 밖은 epoch ms
    const target = at <= 1 ? e.startT + at * (e.endT - e.startT) : at < 1e11 ? e.startT + at : at;
    await e.seek(Math.max(e.startT, Math.min(e.endT, target)));
  }
  if (eng === e && autoplay) e.play();
  if (eng === e && macro) macro.setPlayhead(sid, e.vt);
}

function stopReplay({ reconnect = true } = {}) {
  if (eng) { eng.close(); eng = null; }
  arcCard.hide();
  if (demoOn) setDemo(false);
  ui.unbind();
  ui.setVisible(false);
  replaying = false;
  replayProject = null;
  if (macro) macro.setPlayhead(null);
  panel.markLate = true;
  lg.setReplaying(false);
  $('btn-replay').setAttribute('aria-pressed', 'false');
  setClock(Date.now);
  setTimeScale(1);
  setReplayUrl(null);
  refreshScopeUi();
  if (reconnect) connect();
}

ui = mountReplayUI({
  bar: $('replay-bar'), api: replayApi, // 세션 고르기 창 없음 — 매크로 타임라인
  getEngine: () => eng,
  getCurrentSessionId: () => (MODE === 'live' ? (replaying ? liveSessionId : currentSessionId() || liveSessionId) : null),
  onPick: (sid) => startReplay(sid),
  onLive: () => stopReplay(),
  onPickList: () => openReplayHint(),
  // 연속 재생 중 속도를 직접 바꾸면 이 세션 동안(또는 '자동'을 다시 누를 때까지) 그 속도 유지
  onSpeed: () => { if (demoOn) { demoManual = true; syncDemoAuto(); } },
  onAutoSpeed: () => { if (!demoOn) return; demoManual = !demoManual; syncDemoAuto(); if (!demoManual) demoTick(); },
});
let replayProjectHint = null;
macro = mountMacroTimeline({
  el: $('macro-tl'), api: replayApi, anchorEl: $('timeline'),
  getSessIdx: (sid) => (sessColors.has(sid) ? sessColors.get(sid) : null), // 세션 색
  getNames: () => new Map(store.projects.map((p) => [p.projectId, p.name])),
  // 막대 클릭: 같은 세션을 재생 중이면 그 시각으로 이동만, 아니면 그 세션 재생(at = 그 시각, null = 처음부터)
  onReplay: (sid, at, it) => {
    if (replaying && eng && eng.sessionId === sid && eng.timeline) { eng.seek(at != null ? at : eng.startT); if (eng.status !== 'playing') eng.play(); return; }
    replayProjectHint = (it && it.projectId && it.projectId !== 'local') ? it.projectId : null;
    startReplay(sid, { at: at != null ? at : null });
  },
  // 실행 중 막대의 뒤 끝: 실시간으로 그 세션(재생 중이면 끝내고)
  onLive: (sid, pid) => { if (CAN_ALL) selectScope({ scope: 'session', projectId: pid, sessionId: sid }); else if (replaying) stopReplay(); },
  onPickProject: (pid) => selectScope({ scope: 'project', projectId: pid }),
  onAuto: (on) => setDemo(on),
});
const arcCard = mountArchiveCard({ host: document.body });

// ---------------- 연속 재생(데모) ----------------
// 매크로 타임라인의 세션(보관함이면 보관 세션, 프로젝트면 그 프로젝트 메인)을 시작 순으로 이어 재생.
// 속도는 0.5초마다 demoSpeedAt(볼거리 근처 1×, 바쁨 2×, 보통 4×, 한산 8×, 조용함 32×), 유휴 압축은 켬.
let demoOn = false, demoTimer = 0, demoManual = false;
function syncDemoAuto() { ui.setAutoSpeed({ shown: demoOn, auto: !demoManual }); }
function demoTick() {
  if (!demoOn || !eng || !eng.timeline || eng.status !== 'playing') return;
  const sp = demoTargetSpeed(eng.timeline, eng.vt, demoManual);
  if (sp != null && sp !== eng.speed) eng.setSpeed(sp);
}
function demoNext(cur) {
  const nx = nextInPlaylist(macro.items, cur);
  if (!nx) { setDemo(false); flash(`<b>${tr('app.macro.auto')}</b><br><span style="color:var(--muted)">${tr('app.replay.demoNone')}</span>`, 3000); return; }
  replayProjectHint = nx.projectId && nx.projectId !== 'local' ? nx.projectId : null;
  demoManual = false; syncDemoAuto(); // 다음 세션은 다시 자동 속도
  flash(`<b>${tr('app.replay.demoNext')}</b><br><span style="color:var(--muted)">${escapeAttr(nx.title || nx.id.slice(0, 12))}</span>`, 2500);
  startReplay(nx.id).then(() => { if (demoOn && eng) eng.setCompressIdle(true); });
}
function setDemo(on) {
  on = !!on;
  if (on === demoOn) return;
  demoOn = on;
  demoManual = false;
  syncDemoAuto();
  macro.setAuto(on);
  document.body.classList.toggle('demo-on', on);
  clearInterval(demoTimer); demoTimer = 0;
  if (on) {
    demoTimer = setInterval(demoTick, 500);
    if (replaying && eng && eng.status !== 'ended' && eng.status !== 'error') { eng.setCompressIdle(true); if (eng.status !== 'playing') eng.play(); demoTick(); }
    else demoNext(replaying && eng ? eng.sessionId : null);
  } else if (eng) {
    const p = ui.prefs; eng.setSpeed(p.speed); eng.setCompressIdle(p.compressIdle);
  }
}
/** 상단 '재생'·재생 막대 '세션': 프로젝트를 골랐으면 매크로 타임라인을 펼쳐 강조, 전체면 프로젝트 목록을 연다 */
function openReplayHint() {
  macro.reveal();
  if (macroContext().mode === 'project') { flash(`<b>${tr('app.replay.hintTitle')}</b><br><span style="color:var(--muted)">${tr('app.replay.hintProject')}</span>`, 3500); return; }
  if (pl && pl.open) pl.open(tr('app.replay.hintAll'));
}
$('btn-replay').addEventListener('click', () => { $('btn-replay').blur(); openReplayHint(); });

// ---------------- 실시간 일시정지 ----------------
// 재생 막대의 ⏸/▶(재생 시각 정지)와 다르다: 실시간 화면을 그 순간으로 멈추고, 다시 누르면 밀린 것을 건너뛰고 현재로.
const pauseBtn = document.createElement('button');
pauseBtn.id = 'btn-pause'; pauseBtn.className = 'tb'; pauseBtn.type = 'button';
$('btn-replay').after(pauseBtn);
function pauseLabel() {
  const on = pauseBuf.paused;
  pauseBtn.setAttribute('aria-pressed', String(on));
  pauseBtn.innerHTML = on ? `▶<span class="pz-t"> ${tr('app.pause.btnNow')}</span>` : `⏸<span class="pz-t"> ${tr('app.pause.btnLive')}</span>`;
  pauseBtn.setAttribute('aria-label', on ? tr('app.pause.ariaResume') : tr('app.pause.ariaPause'));
  pauseBtn.title = on ? tr('app.pause.titleResume') : tr('app.pause.titlePause');
}
let pauseRaf = 0;
function pauseConn() {
  if (pauseRaf) return;
  pauseRaf = requestAnimationFrame(() => {
    pauseRaf = 0;
    if (!pauseBuf.paused) return;
    pauseBadge.innerHTML = `<b>⏸ ${tr('app.pause.word')}</b><span>${escapeAttr(pauseBuf.detail())}</span><i>▶ ${tr('app.pause.btnNow')} (Space)</i>`;
    const c = $('conn'); c.className = 'conn wait paused'; c.querySelector('b').textContent = innerWidth < 1600 ? tr('app.pause.tiny', { n: pauseBuf.count }) : innerWidth < 1920 ? pauseBuf.shortLabel() : pauseBuf.label(); c.title = pauseBuf.label();
  });
}
// 정지 = 화면 움직임도 멈춤: 자동 카메라 순환을 끄고, 장면 프레임 갱신(맥동·패킷·홀로그램·퇴장 페이드·잔광)을 건너뛰고
// 렌더만 한다. 손 카메라 조작(끌기·휠·키)·노드 클릭·툴팁은 그대로. 예전엔 데이터만 쌓고 화면은 계속 움직여 "안 먹는다"로 보였다
function freezeView(v, on) {
  if (!v || !v.renderer) return;
  if (v.flat) { v.setFrozen(on, on ? (dt, now) => director.update(dt, now) : null); return; } // 2D: 장면 갱신만 멈추고 카메라는 그대로
  if (on) {
    let last = performance.now();
    v.renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000)); last = now;
      director.update(dt, now / 1000);
      v.renderer.render(v.scene, v.camera);
      if (v.labelRenderer) v.labelRenderer.render(v.scene, v.camera);
    });
  } else v.renderer.setAnimationLoop(typeof v._frame === "function" ? () => v._frame() : null);
}
const pauseBadge = document.createElement('button');
pauseBadge.id = 'pause-badge'; pauseBadge.type = 'button'; pauseBadge.hidden = true;
pauseBadge.title = tr('app.pause.badgeTitle');
document.body.appendChild(pauseBadge);
pauseBadge.addEventListener('click', () => { pauseBadge.blur(); setPaused(false); });
function freezeAll(on) {
  frozenPerf = on ? performance.now() : null;
  sound.setHold(on); // 정지 = 배경음악 일시정지(위치 유지)·효과음 막음, 풀면 소리 설정이 켜져 있을 때만 이어서
  director.setEnabled(on ? false : autoCam);
  if (on) { director.trans = null; director.focusFly = false; } // 날아가던 카메라도 그 자리에
  freezeView(view, on);
  pauseBadge.hidden = !on;
}
let resuming = false;
async function setPaused(on, { drop = false } = {}) {
  if (on === pauseBuf.paused || resuming) return;
  if (on) {
    if (replaying) return;
    const cur = $('conn'); connSaved = [cur.className.replace(/^conn\s*/, '').split(' ')[0] || 'ok', cur.querySelector('b').textContent];
    pauseBuf.pause(Date.now());
    freezeAll(true);
    pauseLabel(); pauseConn();
    return;
  }
  const plan = pauseBuf.plan({ live: MODE === 'live' });
  const snap0 = pendingSnap; pendingSnap = null;
  if (drop) { pauseBuf.clear(); freezeAll(false); pauseLabel(); if (connSaved) setConn(...connSaved); return; }
  resuming = true;
  pauseBtn.disabled = true;
  try {
    let snap = null;
    if (MODE === 'live') {
      // 지금 범위 그대로 현재 상태를 받는다(전체 보기면 scope=all, 아니면 그 세션)
      const q = streamAll ? { scope: 'all' } : { session: store.sessionId || 'auto' };
      try { const r = await fetch(relApi('state', q), { cache: 'no-store' }); if (r.ok) snap = await r.json(); } catch (e) { /* 아래 대체 */ }
    } else snap = snap0;
    const buffered = pauseBuf.events.slice();
    const projects = pauseBuf.projects;
    const pf = panel.filter, fid = focusId;
    pauseBuf.clear();
    freezeAll(false);
    if (connSaved) setConn(...connSaved);
    if (snap) {
      onSnapshot(snap, { resume: true, keepCamera: true });
      for (const ev of eventsAfter(buffered, store.seq)) onEvent(ev, { quiet: true, resume: true });
    } else if (MODE === 'live' && plan.overflow) {
      connect(); // 스냅샷을 못 받았고 쌓은 것도 넘침 → 새로 연결
    } else {
      for (const ev of buffered) onEvent(ev, { quiet: true, resume: true }); // 효과·소리 없이 따라잡기
    }
    if (projects) onProjects(projects);
    if (pf && store.nodes.has(pf) && panel.filter !== pf) origSetFilter(pf);
    if (fid && store.nodes.has(fid)) { focusId = fid; view.setFocus(fid); }
    flash(`<b>${tr('app.pause.jumped')}</b>` + (buffered.length || plan.overflow ? `<br><span style="color:var(--muted)">${plan.overflow ? tr('app.pause.skippedMany') : tr('app.pause.skipped', { n: buffered.length })}</span>` : ''), 2500);
  } finally {
    resuming = false;
    pauseBtn.disabled = false;
    pauseLabel();
  }
}
pauseLabel();
pauseBtn.addEventListener('click', () => { pauseBtn.blur(); setPaused(!pauseBuf.paused); });
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  const t = e.target;
  const editable = !!(t && t.closest && t.closest('[contenteditable=""], [contenteditable="true"]'));
  if (!spaceForPause({ replaying, tag: t && t.tagName, editable, mods: e.ctrlKey || e.metaKey || e.altKey }) || e.repeat) return;
  if (pl && pl.isOpen) return;
  e.preventDefault();
  setPaused(!pauseBuf.paused);
});

// ---------------- 세션 목록 ----------------
async function loadSessions() {
  // 세션 → 프로젝트 찾기(projectOfSession)·세션 전환 알림 제목용. 목록 UI 는 매크로 타임라인이 따로 받는다
  if (MODE !== 'live') return;
  try {
    const r = await fetch(relApi('sessions'), { cache: 'no-store' });
    if (!r.ok) return;
    sessionsResp = await r.json();
  } catch (e) { /* 다음 주기에 재시도 */ }
}
/** 전체 보기 스트림이 아닐 때(단일 세션·재생)도 프로젝트 목록은 /projects 로 갱신 */
async function loadProjects() {
  if (MODE !== 'live' || streamAll) return;
  try {
    const r = await fetch(relApi('projects'), { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    onProjects({ projects: j.projects || [] });
  } catch (e) { /* 다음 주기에 재시도 */ }
}
/** 보관함 요약(선택기 맨 아래 묶음·설명 카드·이름) */
async function loadArchive() {
  if (MODE !== 'live') return;
  try {
    const r = await fetch(relApi('archive'), { cache: 'no-store' });
    if (!r.ok) return;
    archive = await r.json();
    localizeProjects(archive);
    if (pl && pl.setArchive) pl.setArchive(archive);
    if (replaying && eng && isArc(eng.sessionId)) {
      if (!replayProject) replayProject = projectOfSession(eng.sessionId);
      const a = archiveSession(eng.sessionId); if (a) arcCard.show(a);
    }
    refreshScopeUi();
  } catch (e) { /* 다음 주기에 재시도 */ }
}
async function loadLimits() {
  if (MODE !== 'live') return;
  try {
    const r = await fetch(relApi('limits'), { cache: 'no-store' });
    if (r.ok) lg.set(await r.json());
  } catch (e) { /* SSE limits 로 받음 */ }
}
function escapeAttr(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

setInterval(() => {
  const t = performance.now();
  fps = Math.round((frames * 1000) / (t - fpsT)); frames = 0; fpsT = t;
  if (!statsDirty && !SHOW_FPS) return;
  statsDirty = false;
  let active = 0, tools = 0;
  for (const n of store.nodes.values()) { if (n.status === 'active') active++; tools += (n.openTools || []).length; }
  const hid = view.hiddenDoneCount || 0;
  $('stats-chip').textContent = tr('app.stats', { n: store.nodes.size, a: active, k: tools }) + (hid ? tr('app.statsHidden', { n: hid }) : '') + (SHOW_FPS ? ` · ${fps}fps` : '');
}, 1000);

// 시험용 핸들(콘솔·자동화 확인용)
window.__ccviz = {
  store, get director() { return director; }, panel, onEvent, onSnapshot, sfx, music, sound, replayUI: ui,
  get view() { return view; }, get viewMode() { return viewMode; }, switchView,
  replay: () => eng, startReplay, stopReplay, get replaying() { return replaying; },
  get fps() { return fps; },
  // 3차
  get scope() { return { ...sel }; }, setScope: (x) => selectScope(typeof x === 'string' ? parseSelection(x, store.projects) : x),
  get projects() { return store.projects; }, get roots() { return store.roots; }, get limits() { return lg.value; },
  get streamAll() { return streamAll; }, projectList: pl, limitsGauge: lg,
  macro, // 매크로 타임라인
  get archive() { return archive; }, archiveCard: arcCard, setDemo, get demo() { return demoOn; },
  env, get weather() { return weather; }, // 배경 환경(기상은 3D 에서만 불러옴)
  get dim() { return dim; }, setDim, // 3D ⇄ 2D
  timeline, setShowDone, get showDone() { return showDone; },
  setPaused, get paused() { return pauseBuf.paused; }, pauseBuf,
  conflicts, get sessColors() { return sessColors; },
  inspector,
};

ctxUi = mountCtx({ store, getView: () => view, getState: () => ({ focusId, streamAll, sel, paused: pauseBuf.paused }), music, sfx });
window.__ccvizSettings = mountSettings(); // 상단 바는 꼭 필요한 것만, 나머지는 ⚙ 메뉴로(버튼 DOM 을 그대로 옮김)
window.__ccvizSoundPop = mountSoundPop({ music, sound }); // 곡·재생 방식·음량(기존 조작을 모음)
// 작업 대상 층: ⚙ 메뉴 '작업 대상' 줄(표현마다 저장, ?artifacts=1|0), 기본 끔
art = mountArtifacts({
  getView: () => view, viewMode: () => viewMode, params, lsGet, lsSet, relApi, live: MODE === 'live', clock: () => clockFn(),
  scope: () => ({ all: streamAll, sessionId: store.sessionId, pids: streamAll ? [...new Set((store.roots || []).map((r) => r.projectId).filter(Boolean))] : [] }),
  replay: () => (replaying && eng ? { sessionId: eng.sessionId, at: eng.vt } : null),
  onEvent: (ev) => onEvent(ev), nodes: () => store.nodes.values(),
  nodeLabel: (id) => { const n = store.nodes.get(id); return n ? n.label || id : ''; },
});
window.__ccviz.art = art;
// 계획 보드: ⚙ 메뉴 '계획' 줄(?plans=1|0, 저장 ccviz.plans), 기본 끔
plans = mountPlans({
  getView: () => view, nodes: () => store.nodes, focusId: () => focusId, params, lsGet, lsSet, mock: MODE === 'mock',
  inspectedId: () => { const t = inspector.target; return t && t.type === 'node' ? t.id : null; },
  openNode: (id) => { if (store.nodes.has(id)) inspector.open({ type: 'node', id }); },
  openPlan: (id) => { if (store.nodes.has(id)) inspector.open({ type: 'plan', id }); }, // 보드 → 크게 보기
  openedPlan: () => { const t = inspector.target; return t && t.type === 'plan' ? t.id : null; },
  replay: () => replaying, onEvent: (ev) => onEvent(ev), clock: () => clockFn(),
});
window.__ccviz.plans = plans;
if (SHOW_FPS) document.body.classList.add('show-stats'); // 노드 수 칩은 ?fps=1 일 때만

refreshScopeUi();
if (MODE === 'live') {
  loadLimits();
  // 세션 선택으로 시작하면 그 세션이 전체 보기 안인지 알아야 연결 방식을 정한다(최대 3초 대기)
  if (sel.scope === 'session' && sel.sessionId !== 'auto') {
    await Promise.race([loadProjects(), new Promise((r) => setTimeout(r, 3000))]);
  }
} else lg.set(demoLimitsFor());
const replayParam = params.get('replay');
if (replayParam) {
  const at = params.has('at') ? Number(params.get('at')) : null;
  const sp = params.has('speed') ? Number(params.get('speed')) : null;
  startReplay(replayParam === 'auto' && MODE !== 'live' ? (MODE === 'demo' ? 'demo-replay' : 'mock-replay') : replayParam, { at, speed: sp });
} else connect();
// 세션 목록은 SSE 연결을 먼저 연 뒤에 받는다(외부 경유 시 첫 화면이 목록 조회에 묶이지 않도록)
setTimeout(loadSessions, 1500);
setInterval(loadSessions, 30000);
setTimeout(loadProjects, 1200);
loadArchive();
setInterval(loadArchive, 60000);
setInterval(loadProjects, 30000);
setInterval(() => { if (replaying || !es) loadLimits(); }, 120000);   // 재생·끊김 중에도 한도는 실시간 값
