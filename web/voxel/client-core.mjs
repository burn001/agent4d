// 의뢰인 창구(사용자 ↔ 메인) 연출의 순수 부분. three·DOM 없음(node 시험: web/test/vx-office.test.mjs).
// 사용자 = 의뢰인, 메인 = 팀장. 사무실 뒤 벽 화상 스크린(office-core clientScreen)과 팀장 동작을 이벤트로 정한다.
//   요청(사용자 메시지)  → 스크린 켜짐 + 의뢰서 카드가 스크린 → 팀장 책상으로 날아감, 팀장이 받아 읽음
//   작업 중 추가 메시지   → 팀장 책상 위 메모가 쌓임(턴이 끝나면 치움)
//   질문(AskUserQuestion) → 팀장이 스크린 앞에서 손 들고 선택지 카드 펼침 → 답이 오면 고른 카드가 빛남
//   최종 답변(턴 끝)      → 팀장이 스크린 앞으로 가서 보고
//   권한 거부·인터럽트    → 스크린 붉은 깜빡임 + 그 사무실 팀원이 멈칫
//   사용자 대기가 길면    → 스크린 화면보호기(어두워짐)
// 입력은 두 갈래: ① 서버 특별 상호작용 user 범주(ev.ix.cat === 'user', op = message·midturn·ask·answer·deny·interrupt·final·wait),
//                ② 그것이 없을 때 기존 이벤트에서 추정(user origin human · AskUserQuestion 도구 · 메인 result). ①이 한 번이라도 오면 ②는 끈다.

export const CLIENT = {
  CARD_DUR: 1.1,      // 의뢰서 카드 비행
  READ: 2.6,          // 팀장이 카드를 읽는 시간
  REPORT: 4.5,        // 보고 시간(스크린 앞)
  ASK_GLOW: 2.4,      // 답 뒤 고른 카드 빛남
  ALERT: 2.2,         // 거부·인터럽트 붉은 깜빡임
  FLINCH: 0.9,        // 팀원 멈칫
  SAVER_AFTER: 90,    // 이만큼 사용자 입력이 없으면(팀장 대기 중) 화면보호기
  MEMO_MAX: 6,
  CARDS_MAX: 6,
};

const ASK_TOOL = 'AskUserQuestion';

/** 이벤트 → 의뢰인 창구 동작(순수). isMain(nodeId) → 이 사무실 팀장(메인) 노드인가. 반환: {op, lead, ...} | null */
export function clientOp(ev, isMain, st = null) {
  if (!ev || !ev.type) return null;
  const ix = ev.ix;
  if (ix && ix.cat === 'user') {
    // 서버 사용자 범주: prompt·command(요청) · midturn(끼어듦 = 메모) · interrupt·deny(거부·중단) · ask(질문: 시작 = 펼침, 끝 = 고른 답 pick / 거절 declined)
    //   · reply(턴 끝 최종 답변, node-update) · auto(자동 알림 — 창구 연출 없음)
    if (st) st.ixSeen = true;
    const op = String(ix.op || '');
    switch (op) {
      case 'prompt': case 'command': case 'message': return { op: 'request', lead: ev.nodeId };
      case 'midturn': return { op: 'memo', lead: ev.nodeId, mid: true };
      case 'interrupt': case 'deny': return { op: 'alert', lead: ev.nodeId, why: op };
      case 'reply': case 'final': return { op: 'report', lead: ev.nodeId };
      case 'ask':
        if (ev.type === 'tool-end' || ix.phase === 'end') return ix.ok === false || ix.declined ? { op: 'alert', lead: ev.nodeId, why: 'declined' } : { op: 'answer', lead: ev.nodeId, choice: Number.isFinite(ix.pick) ? ix.pick : null };
        return { op: 'ask', lead: ev.nodeId, toolUseId: ev.toolUseId, options: Number.isFinite(ix.opts) && ix.opts > 0 ? ix.opts : null };
      default: return null;
    }
  }
  if (st && st.ixSeen) return null; // 서버 범주가 오면 추정은 끔
  if (!isMain(ev.nodeId)) return null;
  switch (ev.type) {
    case 'user': return ev.origin === 'human' ? { op: 'request', lead: ev.nodeId } : null;
    case 'tool-start': return ev.tool === ASK_TOOL ? { op: 'ask', lead: ev.nodeId, toolUseId: ev.toolUseId, options: null } : null;
    case 'tool-end': return ev.tool === ASK_TOOL || (st && st.askId && ev.toolUseId === st.askId) ? { op: ev.ok === false ? 'alert' : 'answer', lead: ev.nodeId, choice: null } : null;
    case 'result': return { op: 'report', lead: ev.nodeId };
    default: return null;
  }
}

/** 팀장 사무실 하나의 창구 상태 */
export class ClientDesk {
  constructor() {
    this.cards = [];        // 날아가는 카드 {t0, kind:'request'|'memo'|'answer'}
    this.memo = 0;          // 책상 위 메모 수
    this.readUntil = 0;
    this.report = null;     // {t0, until}
    this.ask = null;        // {t0, n, chosen, chosenAt}
    this.alertAt = -1e9;
    this.lastUserAt = null;
    this.onAt = -1e9;       // 스크린이 마지막으로 켜진 시각
    this.askId = null;
    this.ixSeen = false;
  }
  /** op 적용. leadBusy = 팀장(메인)이 지금 작업 중(턴 중)인가 */
  apply(o, now, leadBusy = false) {
    if (!o) return false;
    let op = o.op;
    if (op === 'request' && (o.mid || leadBusy)) op = 'memo';
    switch (op) {
      case 'request': this._card(now, 'request'); this.readUntil = now + CLIENT.CARD_DUR + CLIENT.READ; this.lastUserAt = now; this.onAt = now; this.report = null; break;
      case 'memo': this._card(now, 'memo'); this.memo = Math.min(CLIENT.MEMO_MAX, this.memo + 1); this.lastUserAt = now; this.onAt = now; break;
      case 'ask': this.ask = { t0: now, n: Math.max(2, Math.min(5, o.options || 3)), chosen: -1, chosenAt: null }; this.askId = o.toolUseId || null; this.onAt = now; break;
      case 'answer':
        if (this.ask) { this.ask.chosen = o.choice != null ? Math.max(0, Math.min(this.ask.n - 1, o.choice)) : 0; this.ask.chosenAt = now; }
        this._card(now, 'answer'); this.lastUserAt = now; this.onAt = now; this.askId = null; break;
      case 'alert': this.alertAt = now; this.ask = null; this.askId = null; this.onAt = now; break;
      case 'report': this.report = { t0: now, until: now + CLIENT.REPORT }; this.memo = 0; this.onAt = now; break;
      case 'wait': break;
      default: return false;
    }
    return true;
  }
  _card(now, kind) { this.cards.push({ t0: now, kind }); if (this.cards.length > CLIENT.CARDS_MAX) this.cards.shift(); }
  /** 날고 있는 카드만 남김 */
  liveCards(now) { this.cards = this.cards.filter((c) => now - c.t0 < CLIENT.CARD_DUR); return this.cards; }
  /** 고른 카드 빛남이 끝난 질문은 정리 */
  step(now) { if (this.ask && this.ask.chosenAt != null && now - this.ask.chosenAt > CLIENT.ASK_GLOW) this.ask = null; if (this.report && now > this.report.until) this.report = null; }
  /**
   * 스크린 상태: 'alert'(붉은 깜빡) · 'ask'(선택지) · 'report'(보고 받는 중) · 'on'(최근 메시지) · 'saver'(오래 대기) · 'idle'(옅게 켜짐)
   * leadWaiting = 팀장이 사람 입력을 기다리는 중(idle)
   */
  screen(now, leadWaiting = false) {
    if (now - this.alertAt < CLIENT.ALERT) return 'alert';
    if (this.ask) return 'ask';
    if (this.report) return 'report';
    if (now - this.onAt < CLIENT.CARD_DUR + CLIENT.READ) return 'on';
    if (leadWaiting && now - Math.max(this.onAt, this.lastUserAt ?? -1e9) > CLIENT.SAVER_AFTER) return 'saver';
    return 'idle';
  }
  /** 팀장이 스크린 앞에 서야 하나: 'ask'(손 들기) · 'report'(보고) · null */
  errand(now) {
    if (this.ask && (this.ask.chosenAt == null || now - this.ask.chosenAt < CLIENT.ASK_GLOW)) return { kind: 'ask', until: now + 0.5 };
    if (this.report && now < this.report.until) return { kind: 'report', until: this.report.until };
    return null;
  }
}
