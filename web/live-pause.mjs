// 실시간 화면 일시정지. 순수 — DOM 없음, node --test 대상.
// 정지 중 SSE 는 그대로 받되 이벤트는 쌓기만 한다. 상한을 넘으면 더 쌓지 않고 '다시 받기'(refetch) 표시.
// 다시 누르면 밀린 것을 재생하지 않고 현재 /state 스냅샷으로 장면을 바꾼 뒤, 그 스냅샷보다 뒤(seq 큰) 이벤트만 조용히 붙인다.

import { t } from './i18n.mjs';

export const PAUSE_MAX = 5000;

const pad = (n) => String(n).padStart(2, '0');
export function clockText(ms) { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

export class PauseBuffer {
  constructor(max = PAUSE_MAX) {
    this.max = max;
    this.clear();
  }
  clear() {
    this.paused = false;
    this.since = null;      // 정지한 순간(벽시계 ms)
    this.events = [];
    this.count = 0;         // 정지 뒤 받은 이벤트 수(버린 것 포함)
    this.overflow = false;  // 상한 초과 → 재개 때 반드시 스냅샷 다시 받기
    this.projects = null;   // 마지막 projects 갱신(재개 때 한 번 적용)
    this.snapshotSeen = false; // 정지 중 SSE 재연결 스냅샷이 왔음 → 쌓은 이벤트는 무의미
  }
  pause(nowMs = Date.now()) {
    this.clear();
    this.paused = true;
    this.since = nowMs;
  }
  push(ev) {
    if (!this.paused) return false;
    this.count++;
    if (this.events.length >= this.max) { this.overflow = true; return false; }
    this.events.push(ev);
    return true;
  }
  /** 정지 중 새 스냅샷(재연결) — 이전에 쌓은 것은 버린다 */
  sawSnapshot() { if (!this.paused) return; this.snapshotSeen = true; this.events = []; }
  /** 재개 계획. needState: 서버 스냅샷을 다시 받아야 함(라이브는 늘 true) */
  plan({ live = true } = {}) {
    return { needState: live || this.overflow || this.snapshotSeen, events: this.events.slice(), projects: this.projects, overflow: this.overflow };
  }
  /** 좁은 상단 바용: 정지 14:03:22 · +n */
  shortLabel() { return this.paused ? t('app.pause.short', { time: clockText(this.since), n: this.count }) + (this.overflow ? '!' : '') : ''; }
  /** 머리말('일시정지 · ') 없는 설명: 14:03:22 기준 · 밀린 이벤트 n */
  detail() {
    if (!this.paused) return '';
    return t('app.pause.detail', { time: clockText(this.since), n: this.count }) + (this.overflow ? t('app.pause.overflow') : '');
  }
  label() { return this.paused ? t('app.pause.word') + ' · ' + this.detail() : ''; }
}

/** 스냅샷 seq 보다 뒤에 온(또는 seq 없는) 이벤트만 */
export function eventsAfter(events, seq) {
  return events.filter((e) => typeof e.seq !== 'number' || !(e.seq <= seq));
}

/** Space 단축키를 이 버튼이 받아도 되는가(재생 중·입력칸이면 아님) */
export function spaceForPause({ replaying = false, tag = '', editable = false, mods = false } = {}) {
  if (replaying || mods || editable) return false;
  return !/^(INPUT|SELECT|TEXTAREA)$/i.test(tag || '');
}
