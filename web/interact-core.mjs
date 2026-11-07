// Interactive 패널 순수 부분 — 서버(server/interact.mjs)와 화면(interact.js)이 같이 쓴다. DOM·네트워크 없음.

export const SIG_PREFIX = 'A4D-IX1';
/** 서명 대상 문자열: 접두·방법·경로·시각(ms)·nonce·본문 sha256(hex) 을 줄바꿈으로 */
export const signingString = (method, pathname, ts, nonce, bodyHash) => `${SIG_PREFIX}\n${method}\n${pathname}\n${ts}\n${nonce}\n${bodyHash}`;

export const MODE_KEY = 'ccviz.panelMode'; // 'live' | 'ix'
export const POLL_MS = 2000;
/** '-p 확인 안 됨' 세션의 확인 단계 유효 시간(첫 누름 뒤 이 안에 다시 눌러야 보냄) */
export const CONFIRM_MS = 10_000;
/**
 * Claude Code **내장(클라이언트 전용) 슬래시 명령** — 설치본 2.1.318 번들의 명령 정의(type 'local'·'local-jsx'·내장 'prompt' + 별칭)를
 * 읽기 전용으로 뽑은 목록(2026-11-05). 교차 세션 통로로 보내면 글자로만 전달되고 실행되지 않는다(받는 쪽 화면의 입력 처리기가 아니라 모델에게 감).
 * 스킬·플러그인·사용자 정의 명령(done 등)은 받은 쪽 모델이 Skill 도구로 실행하므로 여기 없다. Claude Code 판이 바뀌면 목록이 어긋날 수 있다.
 */
export const CC_BUILTIN_CMDS = new Set(('add-dir advisor agents app android artifacts auto-mode-setup autocompact autofix-pr background bashes bg branch break-reminder breaks brief btw bug '
  + 'cd checkup clear cloud-plugins color compact config context copy cost daemon design-consent design-login design-revoke desktop diff doctor downtime effort exit export '
  + 'extra-usage fast feedback focus fork goal heapdump help hooks ide import init insights install install-github-app install-slack-app ios list-agents login logout loops '
  + 'marketplace mcp memory memory-pause mobile model name new output-style passes pause-memory peers permissions allowed-tools plan plugin plugins powerup privacy-settings '
  + 'pro-trial-expired project quit radio rate-limit-options rc recap reload-plugins reload-skills remote remote-control remote-env rename reset restart resume review '
  + 'scroll-speed session settings setup-bedrock setup-vertex skill-doctor skills stats status stickers stop subtask tasks team-onboarding teleport terminal-setup theme '
  + 'toggle-memory tp tui ultraplan ultrareview update upgrade usage usage-credits use-case version vim voice web-setup wellbeing workflow-launch-exec workflows').split(' '));
/** 입력 → 슬래시 명령 종류: 'builtin'(내장 — 실행 안 됨) · 'skill'(그 밖 — 받은 세션이 스킬로 실행) · null(명령 아님). 줄 첫 글자(앞 공백 무시)가 '/' + 이름 */
export function slashKind(text) {
  const m = /^\s*\/([A-Za-z0-9_][A-Za-z0-9_:.-]{0,60})(?=\s|$)/.exec(String(text ?? ''));
  if (!m) return null;
  return CC_BUILTIN_CMDS.has(m[1].toLowerCase()) ? 'builtin' : 'skill';
}
export const isSlashCommand = (text) => slashKind(text) === 'builtin';
export const HOLD_AFTER_MS = 30_000; // 이만큼 지나도 transcript 에 없으면 '대상 세션 승인 대기'(권한 무시 세션) 또는 '수신 대기'
export const UNCONFIRMED_MS = 600_000; // 10분 지나도 없으면 '확인 안 됨'

export const b64u = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 노드 → 그 노드가 속한 메인 세션 id(서브에이전트·작업 노드는 뿌리 세션) */
export function sessionOfNode(n, storeSessionId = null) {
  if (!n) return storeSessionId ? String(storeSessionId).toLowerCase() : null;
  const sid = n.rootSessionId || n.sessionId || (typeof n.id === 'string' && n.id.startsWith('s:') ? n.id.slice(2) : null) || storeSessionId;
  return sid ? String(sid).toLowerCase() : null;
}

/**
 * 보낸 글 상태(로컬) — delivered·replied 는 feed 가 정한다.
 * 수신 쪽 대기열 도착(feed 'enq')을 봤으면 queued(선택 창이 열려 있으면 queuedAsk), 아직이어도 선택 창이 열려 있으면 sentAsk
 * 선택 창이 열린 동안 보낸 글은 그 창의 답이 되지 못하고 대기열에서 기다린다
 */
export function localState(m, now, holdLikely, askOpen = false) {
  if (m.state === 'sending' || m.state === 'failed' || m.state === 'delivered' || m.state === 'replied') return m.state;
  if (m.queued) return askOpen ? 'queuedAsk' : 'queued';
  if (askOpen && !holdLikely && now - (m.at || now) < UNCONFIRMED_MS) return 'sentAsk';
  const age = now - (m.at || now);
  if (age >= UNCONFIRMED_MS) return 'unconfirmed';
  if (age >= HOLD_AFTER_MS) return holdLikely ? 'held' : 'waiting';
  return holdLikely ? 'held' : 'sent';
}

/** 내 기기가 보낸 peer 줄인가(feed 가 from-name 에서 뽑은 src 'ix' + 영문 별칭) */
export const isMine = (it, aliasEn) => !!it && it.k === 'peer' && it.src === 'ix' && !!aliasEn && it.alias === aliasEn; // from-name 형식(새·옛)은 서버 feed 가 판정

/** 같은 입력이 두 번 오는 경우(턴 도중 대기열 attachment → 뒤에 같은 글의 user 줄) 를 거르는 창 */
export const DUP_MS = 600_000;
/** 줄의 출처 꼬리표 키: human(터미널·원격) · sdk · ix(Interactive) · peer(다른 세션) */
export const srcOf = (it) => (it.k === 'peer' ? (it.src === 'ix' ? 'ix' : 'peer') : it.src === 'sdk' ? 'sdk' : 'human');

/**
 * feed 항목(시간순) + 아직 transcript 에 안 보이는 내 글 → 그릴 목록.
 * 연속한 도구 줄은 하나로, 연속한 시스템 알림(k 'sys')은 '시스템 알림 n건' 한 줄(sys 묶음, items)로 접는다.
 * 내 글이 transcript 에 보이면 delivered, 그 뒤 assistant 글이 오면 replied. 같은 msgId·(끼어듦 뒤 같은 글) 는 한 번만.
 * @returns {{rows:Array, local:Array}} local = 아직 안 보인 내 글(상태 갱신본)
 */
export function viewRows(items, local, { aliasEn = null, now = Date.now(), holdLikely = false } = {}) {
  const rows = [];
  const seen = new Set();
  const peerIds = new Set();
  const lastText = new Map(); // 출처 + 글 → {ts, mid}(끼어듦 중복 거르기)
  const cards = new Map(); // 질문·계획 카드: id → 줄(결과가 오면 그 줄에 붙임)
  const enq = []; // 내 글의 대기열 도착 줄(아직 전달 전) — 화면을 다시 열어도 '대기열' 로 보이게
  const norm = (s) => String(s || '').trim();
  for (const it of items) {
    if (it.k === 'enq') {
      if (it.src !== 'ix' || !aliasEn || it.alias !== aliasEn) continue;
      const r = { k: 'mine', ts: it.ts, text: it.text, msgId: null, state: 'queued', enq: 1, hid: it.hid || 0 };
      rows.push(r); enq.push(r);
      continue;
    }
    if (it.k === 'ask') { const r = { k: 'ask', ts: it.ts, id: it.id, card: it.card, res: null }; rows.push(r); if (it.id) cards.set(it.id, r); continue; }
    if (it.k === 'ask-res') {
      const r = it.id && cards.get(it.id);
      if (r) r.res = it.res;
      else rows.push({ k: 'ask', ts: it.ts, id: it.id, card: it.card, res: it.res }); // 시작 줄이 읽은 범위 밖이면 결과만으로
      continue;
    }
    if (it.k === 'tool') {
      const last = rows[rows.length - 1];
      if (last && last.k === 'tool') { for (const t of it.tools) if (!last.tools.includes(t)) last.tools.push(t); last.n += it.tools.length; continue; }
      rows.push({ k: 'tool', ts: it.ts, tools: [...new Set(it.tools)], n: it.tools.length });
      continue;
    }
    if (it.k === 'sys') {
      const last = rows[rows.length - 1];
      if (last && last.k === 'sys') { last.items.push(it); continue; }
      rows.push({ k: 'sys', ts: it.ts, key: `${it.o ?? ''}:${it.ts ?? ''}`, items: [it] });
      continue;
    }
    if (it.k === 'peer' && it.msgId) { if (peerIds.has(it.msgId)) continue; peerIds.add(it.msgId); }
    if ((it.k === 'user' || it.k === 'peer') && it.text) {
      const key = srcOf(it) + '\u0000' + it.text;
      const prev = lastText.get(key);
      if (prev && prev.mid && !it.mid && it.ts != null && Math.abs(it.ts - prev.ts) < DUP_MS) continue; // 끼어듦(대기열)으로 이미 본 같은 글
      if (it.ts != null) lastText.set(key, { ts: it.ts, mid: !!it.mid });
    }
    if (it.k === 'peer' && isMine(it, aliasEn)) {
      if (it.msgId) seen.add(it.msgId);
      const qi = enq.findIndex((r) => norm(r.text) === norm(it.text)); // 대기열 줄 → 전달됨(앞 자리 줄은 지움)
      if (qi >= 0) { const qr = enq.splice(qi, 1)[0]; const ri = rows.indexOf(qr); if (ri >= 0) rows.splice(ri, 1); }
      rows.push({ k: 'mine', ts: it.ts, text: it.text, msgId: it.msgId, state: 'delivered', mid: it.mid || 0, hid: it.hid || 0 });
      continue;
    }
    if (it.k === 'assistant') {
      for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].k === 'mine') { if (rows[i].state === 'delivered') rows[i].state = 'replied'; break; } if (rows[i].k === 'user' || rows[i].k === 'peer') break; }
    }
    rows.push({ ...it });
  }
  // 선택 창이 아직 열려 있나(답 없는 질문·계획 카드)
  const askOpen = rows.some((r) => r.k === 'ask' && !r.res);
  if (askOpen) for (const r of enq) r.state = 'queuedAsk';
  const left = [];
  for (const m of local) {
    if (m.msgId && seen.has(m.msgId)) continue;
    // 대기열 도착 줄과 같은 글이면 그 줄을 이 글로(도착 확인)
    const qi = enq.findIndex((r) => norm(r.text) === norm(m.text) || (norm(m.text).length > 40 && norm(r.text).startsWith(norm(m.text).slice(0, 40))));
    let mm = m;
    if (qi >= 0) { const qr = enq.splice(qi, 1)[0]; const ri = rows.indexOf(qr); if (ri >= 0) rows.splice(ri, 1); mm = { ...m, queued: true }; }
    const st = localState(mm, now, holdLikely, askOpen);
    left.push({ ...mm, state: st });
    rows.push({ k: 'mine', ts: m.at, text: m.text, msgId: m.msgId, state: st, why: m.why || null, local: true });
  }
  return { rows, local: left };
}

/** 기기 상태 → 안내 키(null 이면 입력 가능) */
export function noticeKey({ supported = true, enabled = null, device = null, error = null } = {}) {
  if (!supported) return 'unsupported';
  if (error) return 'offline';
  if (enabled === false) return 'disabled';
  if (enabled == null) return 'loading';
  if (!device) return 'registering';
  if (device.status === 'pending') return 'pending';
  if (device.status === 'revoked') return 'revoked';
  return device.status === 'allowed' ? null : 'pending';
}
