// 복셀 생각·말풍선 연결 — 3D(office.js)·2D(flat/voxel2d.js) 공용. 순수 규칙은 quip-core.mjs.
//   view 가 주는 것: chars(Map id → Character), clock(), ts(배속), focusId·hoverId, _now(렌더러 초)
//   out(id, text, kind('think'|'say'), dur, pri) — 뷰가 자기 말풍선 층에 띄운다
import { situationOf, thoughtOf, enterKey, leaveKey, quipRole, priOf, valsOf, quipDur, hashStr, rng, QuipPicker, QuipDirector, SITUATIONS } from './quip-core.mjs';
import { quipsOn, onQuips } from './quip-pref.mjs';
import { loadQuips } from './quips/index.mjs';
import { roleOf, idleAct } from './office-core.mjs';
import { levelOf } from '../degrade-core.mjs';
import { lang } from '../i18n.mjs';

const TICK = 0.25; // 생각 풍선 판정 주기(초)

export class VxQuips {
  constructor(view, out) {
    this.view = view;
    this.out = out;
    this.picker = new QuipPicker({});
    this.dir = new QuipDirector();
    this.ready = false;
    this.shown = new Map();   // id → {text, until} (지금 떠 있는 글 — 같은 줄 동시 표시 금지)
    this._avoid = new Set();
    this._seenEnter = new Set();
    this._seenLeave = new Set();
    this._tickAt = 0;
    this._on = quipsOn();
    this._off = onQuips((on) => { this._on = on; if (!on) this.clear(); else this._load(); if (view.onQuipsToggle) view.onQuipsToggle(on); });
    if (this._on) this._load();
  }
  get on() { return this._on && this.ready; }
  _load() {
    if (this._loading) return;
    this._loading = loadQuips(lang()).then((lines) => { this.picker.setLines(lines); this.ready = Object.keys(lines).length > 0; });
  }
  clear() { this.dir.clear(); this.shown.clear(); this._seenEnter.clear(); this._seenLeave.clear(); }
  dropNode(id) { this.dir.drop(id); this.shown.delete(id); this._seenEnter.delete(id); this._seenLeave.delete(id); }

  _role(ch) { return quipRole(roleOf(ch.kind || (ch.node && ch.node.kind), ch.seat && ch.seat.kind, ch.lead)); }
  _focus(id) { return id === this.view.focusId || id === this.view.hoverId; }
  _speed() { return Math.max(1, Number(this.view.ts) || 1); }
  _clockMs() { try { return Number(this.view.clock()) || Date.now(); } catch { return Date.now(); } }

  /** 같은 글이 화면에 이미 있으면 피한다 */
  _avoidSet(now) {
    const a = this._avoid; a.clear();
    for (const [id, s] of this.shown) { if (s.until < now) this.shown.delete(id); else a.add(s.text); }
    return a;
  }

  /** 상황 하나를 말하게 해 본다(빈도 규칙 통과 시). seedT = 결정적 시드용 시각(ms) */
  _try(id, key, { now, speed, vals = null, seedT = 0, r = 0.5 }) {
    const ch = this.view.chars.get(id);
    if (!ch || ch.state === 'gone' || ch.offstage || !this.picker.has(key)) return false;
    const pri = priOf(key), focus = this._focus(id);
    if (!this.dir.allow(id, now, pri, { speed, focus })) return false;
    const seed = hashStr(id) ^ Math.floor(seedT / 3.6e6); // 시 단위: 같은 재생 구간이면 같은 백 순서로 시작
    const text = this.picker.pick(id, key, { vals, seed, avoid: this._avoidSet(now), r });
    if (!text) return false;
    const kind = SITUATIONS[key] || 'say';
    const dur = quipDur(kind, speed);
    this.dir.commit(id, now, pri, kind);
    this.shown.set(id, { text, until: now + dur });
    this.out(id, text, kind, dur, pri);
    return true;
  }

  /** app.onEvent → view.flowEvent 경로(quiet·몰림 정리 이벤트는 오지 않음) */
  event(ev, opts = {}) {
    if (!this.on || !ev) return;
    const now = this.view._now || performance.now() / 1000;
    const speed = Math.max(1, opts.speed || this._speed());
    const ch = ev.nodeId ? this.view.chars.get(ev.nodeId) : null;
    if (ev.type === 'tool-end' && ev.ok === false && !ev.stopped && ch) this.dir.noteFail(ev.nodeId, now);
    const role = ch ? this._role(ch) : 'staff';
    const ts = Date.parse(ev.ts) || this._clockMs();
    const r = rng(hashStr(String(ev.nodeId) + '|' + ev.type + '|' + (ev.toolUseId || '') + '|' + ts))();
    const sit = situationOf(ev, { role }, r);
    if (!sit) return;
    const vals = valsOf(ev);
    const r2 = rng(hashStr(sit.key + ts))();
    this._try(sit.id, sit.key, { now, speed, vals, seedT: ts, r: r2 });
    if (sit.also) this._try(sit.also, sit.key, { now, speed, seedT: ts + 1, r: r2 });
  }

  /** 오류로 끝난 직원(뷰 onError) — 퇴장 말풍선을 기다리지 않고 바로 */
  onError(ch) { if (this.on && ch) { this._seenLeave.add(ch.id); this._try(ch.id, 'leave.error', { now: this.view._now, speed: this._speed(), seedT: this._clockMs() }); } }

  /** 프레임마다(뷰 _frame/_update). 생각 풍선·등장·퇴장은 0.25초마다 판정 */
  frame(now) {
    if (!this.on || now - this._tickAt < TICK) return;
    this._tickAt = now;
    const speed = this._speed();
    const clockMs = this._clockMs();
    const hour = new Date(clockMs).getHours();
    for (const ch of this.view.chars.values()) {
      if (!ch.placed || ch.state === 'gone' || ch.offstage) continue;
      const id = ch.id;
      // 등장(문·포털에서 걸어 들어오는 직원) · 퇴장(가방 들고 문으로)
      if (ch.state === 'enter' && !this._seenEnter.has(id)) {
        this._seenEnter.add(id);
        const k = enterKey(this._role(ch));
        if (k) this._try(id, k, { now, speed, seedT: clockMs });
        continue;
      }
      if (ch.state === 'leave') {
        if (!this._seenLeave.has(id)) { this._seenLeave.add(id); this._try(id, leaveKey(ch.node && ch.node.status), { now, speed, seedT: clockMs }); }
        continue;
      }
      if (!this.dir.thinkDue(id, now)) continue;
      const tool = ch.currentTool(now);
      const st = {
        role: this._role(ch), state: ch.state, status: ch.node && ch.node.status,
        onBreak: !!(ch.target && ch.target.type === 'break'), oversee: !!(ch.sup || (ch.target && ch.target.type === 'oversee')),
        stretch: idleAct(ch.hash, now).act === 'stretch',
        toolCat: tool ? tool.cat : null, toolAge: tool ? now - tool.t0 : 0,
        thinkFor: ch.lastBusy != null ? now - ch.lastBusy : 0,
        fails: this.dir.fails(id, now), ctxPct: levelOf(ch.node && ch.node.meta && ch.node.meta.ctx), hour,
      };
      const r = rng(hashStr(id) ^ Math.floor(clockMs / 1000))();
      const key = thoughtOf(st, r);
      if (!key || !this._try(id, key, { now, speed, seedT: clockMs, r })) this.dir.thinkLater(id, now, key ? 1.5 : 3);
    }
  }

  dispose() { if (this._off) this._off(); this._off = null; this.clear(); }
}
