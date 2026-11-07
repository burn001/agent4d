// 입력 대기 세션 배지 순수 부분 — 서버(session.mjs·interact.mjs)와 화면(wait-ui.js)이 같이 쓴다. DOM·네트워크 없음.
// 판정(Claude Code 2.1.318 실측·설치본 코드):
//  · 강한 신호 ① 답 없는 AskUserQuestion·ExitPlanMode tool_use(카드 '⏳ 답 대기 중') — 화면 store 의 메인 노드 openTools
//  · 강한 신호 ② 세션 기록(~/.claude/sessions/<pid>.json) status 'waiting' + waitingFor 'input needed'(AskUserQuestion 선택 창·MCP 입력 요청)
//  · 보조 'other' — waitingFor 'sandbox request'·'goal proposal'·'worker request'(그 세션 화면에서 답해야 하는 창)
//  · 채택 안 함 — waitingFor 'dialog open'(터미널에서 사람이 연 /config 같은 창 · 자동 압축 제안 등), 턴이 끝난 뒤 '?' 로 끝나는 응답(오탐 많음)
//  · 판정 불가 — 도구 권한 요청(대화상자는 화면에만, transcript 에도 세션 기록 waitingFor 에도 남지 않음: status 는 'busy')
//  · 제외 — 헤드리스(-p·SDK,·143.1) · 끝난 세션 · 재생 중

export const WAIT_TOOLS = new Map([['AskUserQuestion', 'ask'], ['ExitPlanMode', 'plan']]);
export const REC_ASK = new Set(['input needed']);
export const REC_OTHER = new Set(['sandbox request', 'goal proposal', 'worker request']);
const ENDED = new Set(['done', 'stopped', 'error', 'ended', 'killed']);
export const WAIT_POLL_MS = 10_000; // 실황 패널을 보는 동안 Interactive 세션 목록(세션 기록 대기) 확인 간격
export const WAIT_FLASH_MS = 2600;

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** 카드(서버 ask-card 모양) → 가벼운 머리표 {t:'ask', h?, q, n?} | {t:'plan'} — openTools·배지 목록용 */
export function askHead(card) {
  if (!card || (card.t !== 'ask' && card.t !== 'plan')) return null;
  if (card.t === 'plan') return { t: 'plan' };
  const q = Array.isArray(card.qs) ? card.qs[0] : null;
  if (!q) return { t: 'ask' };
  return { t: 'ask', ...(q.h ? { h: clip(q.h, 40) } : {}), q: clip(q.q, 140), ...(card.qs.length > 1 ? { n: card.qs.length } : {}) };
}

/** 세션 기록 waitingFor → 종류('ask'|'other') | null */
export const recKind = (why) => (REC_ASK.has(why) ? 'ask' : REC_OTHER.has(why) ? 'other' : null);

/** /interact/sessions 의 세션 기록 → {k, why, since?} | null (헤드리스는 늘 null) */
export function recordWait(rec) {
  if (!rec || rec.headless === true || typeof rec.waitingFor !== 'string') return null;
  const k = recKind(rec.waitingFor);
  if (!k) return null;
  return { k, why: rec.waitingFor, ...(Number.isFinite(rec.statusAt) ? { since: rec.statusAt } : {}) };
}

const baseName = (p) => (typeof p === 'string' && p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : null);
const sidOf = (n) => { const s = n.sessionId || (typeof n.id === 'string' && n.id.startsWith('s:') ? n.id.slice(2) : null); return s ? String(s).toLowerCase() : null; };

/**
 * 화면 store 의 노드들 → 입력 대기 목록. 메인 노드(kind 'main')만 — 서브에이전트·claude -p 자식(kind 'claude-p')·독립 sdk 루트(orphanSdk)는 제외.
 * @returns {Array<{sid, nodeId, k:'ask'|'plan'|'other', tu?, ask?, why?, since?, label, project}>}
 */
export function nodeWaits(nodes, { replaying = false } = {}) {
  if (replaying || !nodes) return [];
  const out = [];
  for (const n of nodes) {
    if (!n || n.kind !== 'main') continue;
    const m = n.meta || {};
    if (m.orphanSdk || m.live === false || ENDED.has(n.status)) continue;
    const sid = sidOf(n);
    if (!sid) continue;
    let best = null;
    for (const t of n.openTools || []) {
      const k = t && WAIT_TOOLS.get(t.tool);
      if (!k) continue;
      const since = Date.parse(t.startedAt) || null;
      if (!best || (since || 0) >= (best.since || 0)) best = { k, tu: t.toolUseId || null, ask: t.ask || null, since };
    }
    if (!best && m.liveWait) { const k = recKind(m.liveWait); if (k) best = { k, why: m.liveWait, since: null }; }
    if (!best) continue;
    out.push({ sid, nodeId: n.id, label: n.label || null, project: baseName(m.cwd) || null, ...best });
  }
  return out;
}

export const waitPrio = (w) => (w.k === 'other' ? 1 : 0);
export const waitKey = (w) => `${w.sid}:${w.tu || w.why || w.k}`;

/**
 * 화면 신호 + 서버 세션 목록(승인 기기일 때만, 없으면 null) → 합친 목록(우선순위 → 오래 기다린 순).
 * 서버 목록이 있으면: 그 목록에 없는 세션(끝남·범위 밖)의 화면 신호는 버리고, 헤드리스로 확인된 세션도 버린다. 세션 이름·프로젝트·보낼 수 있음(ready)을 채운다.
 */
export function mergeWaits(nodeList, sessions = null) {
  const by = new Map();
  for (const w of nodeList || []) if (!by.has(w.sid) || waitPrio(w) < waitPrio(by.get(w.sid))) by.set(w.sid, { ...w });
  if (Array.isArray(sessions)) {
    const live = new Map(sessions.map((s) => [String(s.sessionId || '').toLowerCase(), s]));
    for (const [sid, w] of [...by]) {
      const s = live.get(sid);
      if (!s || s.headless) { by.delete(sid); continue; }
      w.name = s.name || null; if (!w.project && s.project) w.project = s.project; w.ready = !!s.ready;
      if (!w.since && s.wait && Number.isFinite(s.wait.since)) w.since = s.wait.since;
    }
    for (const [sid, s] of live) {
      if (by.has(sid) || s.headless) continue;
      const rw = s.wait && recKind(s.wait.why) ? s.wait : recordWait(s);
      if (!rw) continue;
      by.set(sid, { sid, nodeId: `s:${sid}`, k: rw.k, why: rw.why, since: Number.isFinite(rw.since) ? rw.since : null, name: s.name || null, project: s.project || null, label: s.title || null, ready: !!s.ready });
    }
  }
  return [...by.values()].sort((a, b) => waitPrio(a) - waitPrio(b) || (a.since || Infinity) - (b.since || Infinity) || a.sid.localeCompare(b.sid));
}

/** 새로 생긴 대기(깜빡임): 이전 열쇠 집합에 없던 것이 있나 */
export function newWaits(list, prevKeys) {
  const keys = new Set(list.map(waitKey));
  let fresh = false;
  for (const k of keys) if (!prevKeys.has(k)) { fresh = true; break; }
  return { keys, fresh };
}

/** 대기 시간 글자(i18n 함수 t) */
export function ageText(since, now, t) {
  if (!Number.isFinite(since) || since <= 0) return '';
  const s = Math.max(0, Math.round((now - since) / 1000));
  if (s < 60) return t('ix.wait.age.now');
  if (s < 3600) return t('ix.wait.age.min', { n: Math.floor(s / 60) });
  return t('ix.wait.age.hour', { n: Math.floor(s / 3600) });
}

/** 목록 한 줄의 질문 머리표(글자) */
export function waitHead(w, t) {
  if (w.k === 'plan' || (w.ask && w.ask.t === 'plan')) return t('ix.wait.plan');
  if (w.ask && (w.ask.h || w.ask.q)) return (w.ask.h ? `[${w.ask.h}] ` : '') + (w.ask.q || '') + (w.ask.n > 1 ? ` (+${w.ask.n - 1})` : '');
  if (w.k === 'other') return t('ix.wait.why', { why: w.why || '' });
  return t('ix.wait.ask');
}

/** 세션 이름(목록 줄 제목) */
export const waitName = (w) => clip(w.name || w.label || w.sid.slice(0, 8), 60);
