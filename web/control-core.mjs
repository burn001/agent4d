// 화면 원격 조작 공용 순수 함수 — CLI(bin/ctl.mjs)·서버(server/control.mjs)·웹(web/control.js)이 같은 표를 쓴다.
// three·DOM·i18n 없음(서버가 가져다 쓰므로). 명령은 웹이 이미 가진 설정 함수를 그대로 부르는 디스패처 applyControl 로 모은다.
//
//   parseCtl(['theme','light'])            → { cmd:'theme', args:{ value:'light' } }  (CLI 인자 → 명령)
//   normalizeCmd('theme', { value:'Light' }) → { ok:true, cmd, args } | { ok:false, error, hint }  (서버가 다시 검사)
//   applyControl({ cmd, args, temp }, hooks) → Promise<{ ok, error?, detail?, pendingGesture?, after? }>  (웹, hooks = app.js 함수들)

const ONOFF = { on: true, off: false, true: true, false: false, '1': true, '0': false, yes: true, no: false, show: true, hide: false, open: true, close: false };
const onoff = (v) => (v == null ? null : Object.prototype.hasOwnProperty.call(ONOFF, String(v).toLowerCase()) ? ONOFF[String(v).toLowerCase()] : null);

/** 명령 표: 값 목록(values) 또는 검사 함수(check). alias 는 같은 명령의 다른 이름 */
export const CTL_COMMANDS = {
  theme: { values: ['dark', 'light', 'auto'], usage: 'theme dark|light|auto' },
  view: { values: ['flow', 'planet', 'voxel'], alias: { shapes: 'planet', office: 'voxel' }, usage: 'view flow|planet|voxel' },
  dim: { values: ['3d', '2d'], usage: 'dim 3d|2d' },
  scope: { usage: 'scope all | project:<name|id> | session:<id|title>' },
  visible: { usage: 'visible all | hide|show|only project:<name> | session:<id>' },
  sound: { values: ['on', 'off', 'toggle'], usage: 'sound on|off|toggle' },
  music: { pct: true, power: true, usage: 'music <0-100>|on|off|toggle   (background music volume, or music on/off)' },
  sfx: { pct: true, power: true, usage: 'sfx <0-100>|on|off|toggle     (sound effects volume, or effects on/off)' },
  bgm: { usage: 'bgm auto|cycle|shuffle|<track id or name>' },
  lang: { values: ['auto', 'en', 'ko'], usage: 'lang auto|en|ko' },
  camera: { values: ['auto', 'manual', 'fit', 'follow'], usage: 'camera auto|manual|fit|follow' },
  focus: { usage: 'focus <node id | session id | label> | off' },
  pause: { none: true, usage: 'pause' },
  resume: { none: true, usage: 'resume' },
  replay: { usage: 'replay <session id|current> [--at 0..1|ms|ISO] [--speed 0.5-32]' },
  live: { none: true, usage: 'live' },
  artifacts: { values: ['on', 'off'], usage: 'artifacts on|off' },
  plans: { values: ['on', 'off'], usage: 'plans on|off' },
  weather: { values: ['auto', 'off', 'fog', 'rain', 'snow'], usage: 'weather auto|off|fog|rain|snow' },
  grid: { values: ['on', 'off'], usage: 'grid on|off' },
  noise: { usage: 'noise on|off|<0-100>' },
  panel: { values: ['open', 'close'], alias: { closed: 'close', collapse: 'close', fold: 'close', expand: 'open', unfold: 'open' }, usage: 'panel open|close' },
  timeline: { values: ['show', 'hide'], usage: 'timeline show|hide' },
  done: { values: ['on', 'off'], usage: 'done on|off   (show finished nodes)' },
  quips: { values: ['on', 'off'], usage: 'quips on|off  (voxel thought & speech bubbles)' },
  plinks: { values: ['rotate', 'laser', 'orbit'], alias: { alternate: 'rotate', auto: 'rotate', beam: 'laser', ring: 'orbit', rings: 'orbit' }, usage: 'plinks rotate|laser|orbit  (Planet relation lines)' },
  close: { none: true, usage: 'close   (close popups and menus)' },
  reload: { none: true, usage: 'reload' },
  toast: { usage: 'toast "<message>" [--sec 1-30]' },
};
/** 명령 이름 별칭(CLI 편의) */
export const CTL_ALIAS = { links: 'plinks', bubbles: 'quips', quip: 'quips', popup: 'close', popups: 'close', unpause: 'resume', volume: 'music', vol: 'music', layer: 'artifacts', plan: 'plans', msg: 'toast', message: 'toast', project: 'scope' };

const ON_OFF_VALUES = new Set(['on', 'off']);
const TOAST_MAX = 200;

const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();

/** 'project:atlas' · 'session:abc' · 'all' → { kind, q } */
export function parseTarget(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return null;
  if (lc(t) === 'all') return { kind: 'all', q: '' };
  const m = /^(project|proj|p|session|sess|s):(.+)$/i.exec(t);
  if (m) return { kind: /^p/i.test(m[1]) ? 'project' : 'session', q: m[2].trim() };
  return { kind: 'project', q: t }; // 접두사 없으면 프로젝트 이름으로
}

/** 이미 풀린 {kind, q}(CLI 가 보낸 것)면 그대로 */
const targetOf = (x) => (x && typeof x === 'object' && ['all', 'project', 'session'].includes(x.kind) ? { kind: x.kind, q: String(x.q || '') } : null);

/** at: 0..1 비율 · 시작부터 ms · epoch ms · ISO 시각 → 숫자(못 읽으면 NaN) */
export function parseAt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d+(\.\d+)?%$/.test(s)) return Number(s.slice(0, -1)) / 100;
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : NaN;
}

/**
 * 명령·인자 검사·정규화(서버·웹 공통). 프로젝트·세션 이름 해석은 서버가 따로(resolveScope) 한다.
 * @returns {{ok:true, cmd:string, args:object} | {ok:false, error:string, hint?:string}}
 */
export function normalizeCmd(cmd, args = {}) {
  let c = lc(cmd);
  if (CTL_ALIAS[c]) c = CTL_ALIAS[c];
  const spec = CTL_COMMANDS[c];
  if (!spec) return { ok: false, error: 'unknown_command', hint: Object.keys(CTL_COMMANDS).join(' ') };
  const a = args && typeof args === 'object' ? args : {};
  const bad = () => ({ ok: false, error: 'bad_value', hint: spec.usage });
  if (spec.none) return { ok: true, cmd: c, args: {} };
  if (spec.values) {
    let v = lc(a.value);
    if (spec.alias && spec.alias[v]) v = spec.alias[v];
    if (ON_OFF_VALUES.has(spec.values[0]) || spec.values.includes('on')) { const b = onoff(v); if (b != null && spec.values.includes(b ? 'on' : 'off')) v = b ? 'on' : 'off'; }
    if (c === 'panel') { const b = onoff(v); if (b != null) v = b ? 'open' : 'close'; }
    if (c === 'timeline') { const b = onoff(v); if (b != null) v = b ? 'show' : 'hide'; }
    if (c === 'dim' && (v === '3' || v === '2')) v += 'd';
    if (!spec.values.includes(v)) return bad();
    return { ok: true, cmd: c, args: { value: v } };
  }
  if (spec.pct) {
    // music·sfx: 낱말 on|off|toggle 은 켬/끔(부분 토글). 숫자 0·1 은 음량이므로 낱말만 받는다
    if (spec.power) {
      const w = lc(a.power ?? a.value);
      const p = ['on', 'true', 'yes'].includes(w) ? 'on' : ['off', 'false', 'no'].includes(w) ? 'off' : w === 'toggle' ? 'toggle' : null;
      if (p) return { ok: true, cmd: c, args: { power: p } };
    }
    const n = Number(String(a.value ?? '').replace(/%$/, ''));
    if (!Number.isFinite(n) || n < 0 || n > 100) return bad();
    return { ok: true, cmd: c, args: { value: Math.round(n) } };
  }
  switch (c) {
    case 'scope': {
      // 서버가 풀어 준 모양({scope, projectId|sessionId})이면 그대로 통과
      if (a.scope === 'all') return { ok: true, cmd: c, args: { scope: 'all' } };
      if (a.scope === 'project' && a.projectId) return { ok: true, cmd: c, args: { scope: 'project', projectId: String(a.projectId), name: a.name ? String(a.name) : null } };
      if (a.scope === 'session' && a.sessionId) return { ok: true, cmd: c, args: { scope: 'session', sessionId: String(a.sessionId), projectId: a.projectId ? String(a.projectId) : null, name: a.name ? String(a.name) : null } };
      const t = targetOf(a.target) || parseTarget(a.value);
      if (!t) return bad();
      return { ok: true, cmd: c, args: { target: t } };
    }
    case 'visible': {
      const act = lc(a.action || a.value);
      if (act === 'all' || act === 'reset') return { ok: true, cmd: c, args: { action: 'all' } };
      if (!['hide', 'show', 'only'].includes(act)) return bad();
      if (a.projectId || a.sessionId) return { ok: true, cmd: c, args: { action: act, projectId: a.projectId ? String(a.projectId) : null, sessionId: a.sessionId ? String(a.sessionId) : null, name: a.name ? String(a.name) : null } };
      const t = targetOf(a.target) || parseTarget(a.target);
      if (!t || t.kind === 'all') return bad();
      if (act === 'only' && t.kind !== 'project') return bad();
      return { ok: true, cmd: c, args: { action: act, target: t } };
    }
    case 'bgm': {
      const v = String(a.value ?? '').trim();
      if (!v) return bad();
      return { ok: true, cmd: c, args: { value: v.slice(0, 60) } };
    }
    case 'focus': {
      const v = String(a.value ?? '').trim();
      if (!v) return bad();
      return { ok: true, cmd: c, args: { value: v.slice(0, 120) } };
    }
    case 'noise': {
      const b = onoff(a.value);
      if (b != null) return { ok: true, cmd: c, args: { on: b } };
      const n = Number(String(a.value ?? '').replace(/%$/, ''));
      if (!Number.isFinite(n) || n < 0 || n > 100) return bad();
      return { ok: true, cmd: c, args: { amount: Math.round(n) } };
    }
    case 'replay': {
      const s = String(a.session ?? a.value ?? '').trim();
      if (!s) return bad();
      const at = parseAt(a.at);
      if (Number.isNaN(at)) return bad();
      let speed = a.speed == null || a.speed === '' ? null : Number(String(a.speed).replace(/x$/i, ''));
      if (speed != null && (!Number.isFinite(speed) || speed < 0.5 || speed > 32)) return bad();
      return { ok: true, cmd: c, args: { session: s.slice(0, 80), at, speed } };
    }
    case 'toast': {
      const text = String(a.text ?? a.value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
      if (!text) return bad();
      let sec = a.sec == null || a.sec === '' ? 5 : Number(a.sec);
      if (!Number.isFinite(sec)) sec = 5;
      return { ok: true, cmd: c, args: { text: text.slice(0, TOAST_MAX), sec: Math.max(1, Math.min(30, sec)) } };
    }
    default: return bad();
  }
}

/**
 * CLI 위치 인자 → {cmd, args}. 옵션(--at·--speed·--sec)은 opts 로 받는다.
 * 예: ['scope','project:atlas'] · ['visible','hide','project:beta'] · ['toast','빌드','끝'] · ['replay','abc1234',{at,speed}]
 */
export function parseCtl(words, opts = {}) {
  const [cmd0, ...rest] = (words || []).map((w) => String(w));
  if (!cmd0) return { ok: false, error: 'no_command' };
  let c = lc(cmd0);
  if (CTL_ALIAS[c]) c = CTL_ALIAS[c];
  let args;
  if (c === 'visible') args = { action: rest[0], target: rest.slice(1).join(' ') };
  else if (c === 'replay') args = { session: rest[0], at: opts.at ?? rest[1], speed: opts.speed ?? rest[2] };
  else if (c === 'toast') args = { text: rest.join(' '), sec: opts.sec };
  else if (c === 'scope' || c === 'focus' || c === 'bgm') args = { value: rest.join(' ') };
  else args = { value: rest[0] };
  return normalizeCmd(c, args);
}

// ───────────────────────── 이름 해석(서버) ─────────────────────────

/**
 * 프로젝트 고르기: 정확(이름·id) → 이름/id 부분일치(대소문자 무시). 하나면 그것, 여럿이면 후보.
 * @param {Array<{projectId:string,name:string}>} projects
 * @returns {{ok:true, project}|{ok:false, error:'not_found'|'ambiguous', candidates}}
 */
export function matchProject(projects, q) {
  const list = Array.isArray(projects) ? projects : [];
  const k = lc(q);
  if (!k) return { ok: false, error: 'not_found', candidates: list.slice(0, 8).map(projBrief) };
  const exact = list.filter((p) => lc(p.name) === k || lc(p.projectId) === k);
  if (exact.length === 1) return { ok: true, project: exact[0] };
  const pool = exact.length ? exact : list.filter((p) => lc(p.name).includes(k) || lc(p.projectId).includes(k));
  if (pool.length === 1) return { ok: true, project: pool[0] };
  if (!pool.length) return { ok: false, error: 'not_found', candidates: list.slice(0, 8).map(projBrief) };
  // 이름이 그 단어로 시작하는 것이 하나뿐이면 그것(예 'atlas' → 'atlas' 와 'atlas-old' 중 정확이 없을 때도 모호로 둔다)
  return { ok: false, error: 'ambiguous', candidates: pool.slice(0, 12).map(projBrief) };
}
const projBrief = (p) => ({ projectId: p.projectId, name: p.name, live: !!p.live });

/**
 * 세션 고르기: id 앞부분(4자 이상) 또는 제목 부분일치.
 * @param {Array<{sessionId:string,title?:string,projectId?:string}>} sessions
 */
export function matchSession(sessions, q) {
  const list = Array.isArray(sessions) ? sessions : [];
  const k = lc(q);
  if (!k) return { ok: false, error: 'not_found', candidates: [] };
  const exact = list.filter((s) => lc(s.sessionId) === k);
  if (exact.length) return { ok: true, session: exact[0] };
  const byId = k.length >= 4 ? list.filter((s) => lc(s.sessionId).startsWith(k)) : [];
  const pool = byId.length ? byId : list.filter((s) => s.title && lc(s.title).includes(k));
  const uniq = [...new Map(pool.map((s) => [s.sessionId, s])).values()];
  if (uniq.length === 1) return { ok: true, session: uniq[0] };
  if (!uniq.length) return { ok: false, error: 'not_found', candidates: [] };
  return { ok: false, error: 'ambiguous', candidates: uniq.slice(0, 12).map((s) => ({ sessionId: s.sessionId, title: s.title || null, projectId: s.projectId || null })) };
}

/** 화면 고르기(--client): id 정확 → id 앞부분 → 이름 부분일치 */
export function matchClients(clients, q) {
  const list = Array.isArray(clients) ? clients : [];
  if (q == null || q === '' || q === true) return list;
  const k = lc(q);
  const exact = list.filter((c) => lc(c.id) === k);
  if (exact.length) return exact;
  const pre = list.filter((c) => lc(c.id).startsWith(k));
  if (pre.length) return pre;
  return list.filter((c) => lc(c.name).includes(k));
}

// ───────────────────────── 화면 이름(웹) ─────────────────────────

/** 브라우저/OS/화면 크기로 자동 이름: 'Edge · Windows · 1920×1080' */
export function autoName(ua = '', w = 0, h = 0) {
  const u = String(ua);
  const br = /Edg\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? (/HeadlessChrome/.test(u) ? 'Chrome(headless)' : 'Chrome') : /Safari\//.test(u) ? 'Safari' : 'Browser';
  const os = /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' : /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Mac OS X|Macintosh/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : '';
  const size = w && h ? `${Math.round(w)}×${Math.round(h)}` : '';
  return [br, os, size].filter(Boolean).join(' · ');
}

/** 클라이언트 id 모양(서버·웹 공통): 영문·숫자·-_ 6～64자 */
export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
export const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]+/g, ' ').trim().slice(0, 60);

// ───────────────────────── 디스패처(웹) ─────────────────────────

/**
 * 명령 하나 적용. hooks 는 app.js 가 기존 설정 함수로 채운다(메뉴에서 고른 것과 같은 경로·같은 저장).
 * 각 hook 은 값 또는 Promise 를 돌려줄 수 있고, 실패는 { ok:false, error } 또는 throw.
 * 결과 after = ack 를 보낸 뒤 할 일(새로고침·언어 바꾸기처럼 페이지를 떠나는 것).
 */
export async function applyControl(msg, hooks) {
  const n = normalizeCmd(msg && msg.cmd, msg && msg.args);
  if (!n.ok) return { ok: false, error: n.error, detail: n.hint || null };
  const H = hooks || {};
  const fn = H[n.cmd];
  if (typeof fn !== 'function') return { ok: false, error: 'unsupported' };
  try {
    const r = await fn(n.args, { temp: !!(msg && msg.temp) });
    if (r && typeof r === 'object' && 'ok' in r) return r;
    if (r === false) return { ok: false, error: 'not_applied' };
    return { ok: true, ...(r && typeof r === 'object' ? r : {}) };
  } catch (e) {
    return { ok: false, error: 'exception', detail: String((e && e.message) || e).slice(0, 200) };
  }
}

/** --temp: 적용 전 ccviz.* 저장값을 떠 두고 적용 뒤 되돌린다(이번 접속만 바뀜) */
export function snapshotStore(storage, prefix = 'ccviz.') {
  const out = new Map();
  try {
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(prefix)) out.set(k, storage.getItem(k)); }
  } catch (e) { /* 저장소 없음 */ }
  return out;
}
export function restoreStore(storage, snap, prefix = 'ccviz.', keep = []) {
  try {
    const now = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(prefix)) now.push(k); }
    for (const k of now) if (!snap.has(k) && !keep.includes(k)) storage.removeItem(k);
    for (const [k, v] of snap) if (!keep.includes(k) && storage.getItem(k) !== v) storage.setItem(k, v);
  } catch (e) { /* 저장소 없음 */ }
}
