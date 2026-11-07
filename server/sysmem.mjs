// 시스템 메모리(PC RAM) 사용률 수집 — 이 PC 서버 → 자기 화면 SSE 로 값만(used·total·pct) 보낸다.
// · 기본: Node os.totalmem()/os.freemem(). Windows 의 freemem 은 GlobalMemoryStatusEx 의 가용(Available) 물리 메모리,
//   Linux 는 /proc/meminfo MemAvailable(libuv) — 둘 다 그대로 '가용'으로 쓴다(외부 명령 없음).
// · macOS 만 freemem 이 '빈 페이지'(free)뿐이라 사용률이 늘 높게 나온다 → vm_stat 을 길게(기본 60초) 한 번 읽어
//   가용(free + inactive + speculative) − freemem 의 차이를 보정값으로 두고, 그 사이 틱은 freemem + 보정값만 쓴다.
// · 주기 pollSec(5～15초, 기본 10초). 값이 의미 있게 바뀔 때만(정수 % 또는 64MiB) 알린다.
// · 프로세스별·커널 풀 값은 모으지 않는다(사용자 결정: PC 메모리만).
import os from 'node:os';
import { execFile } from 'node:child_process';

export const SYSMEM_DEFAULT = { on: true, pollSec: 10 };
const MIB64 = 64 * 1024 * 1024;

/** config.memory 정규화: false → 끔, { on, pollSec } — pollSec 5～15 로 자름 */
export function normSysmem(v) {
  if (v === false) return { ...SYSMEM_DEFAULT, on: false };
  const o = v && typeof v === 'object' ? v : {};
  const n = Number(o.pollSec);
  const pollSec = Number.isFinite(n) && n > 0 ? Math.min(15, Math.max(5, n)) : SYSMEM_DEFAULT.pollSec;
  return { on: o.on !== false, pollSec };
}

/** macOS vm_stat 출력 → 가용 바이트(free + inactive + speculative). 형식이 다르면 null */
export function parseVmStat(text) {
  if (typeof text !== 'string') return null;
  const ps = /page size of (\d+) bytes/.exec(text);
  const page = ps ? Number(ps[1]) : 0;
  if (!(page > 0)) return null;
  const pages = (name) => { const m = new RegExp('^Pages ' + name + ':\\s+(\\d+)\\.?\\s*$', 'm').exec(text); return m ? Number(m[1]) : null; };
  const free = pages('free');
  if (free == null) return null;
  return (free + (pages('inactive') || 0) + (pages('speculative') || 0)) * page;
}

/** 한 번 잰 값 → { used, total, pct } (바이트 정수, pct 소수 한 자리). total 이 0 이하면 null */
export function memSample({ total, avail }) {
  if (!(Number(total) > 0)) return null;
  const a = Math.min(total, Math.max(0, Number(avail) || 0));
  const used = Math.round(total - a);
  return { used, total: Math.round(total), pct: Math.round((used / total) * 1000) / 10 };
}

const runVmStat = () => new Promise((resolve) => {
  execFile('vm_stat', [], { timeout: 3000, windowsHide: true }, (err, out) => resolve(err ? null : String(out || '')));
});

export class SysMemCollector {
  constructor({ on = true, pollSec = SYSMEM_DEFAULT.pollSec, demo = false, platform = process.platform,
    totalmem = () => os.totalmem(), freemem = () => os.freemem(), vmStat = runVmStat, vmStatSec = 60, now = () => Date.now() } = {}) {
    this.on = on !== false;
    this.pollMs = normSysmem({ pollSec }).pollSec * 1000;
    this.demo = !!demo;
    this.platform = platform;
    this.totalmem = totalmem; this.freemem = freemem; this.vmStat = vmStat;
    this.vmStatMs = Math.max(10, Number(vmStatSec) || 60) * 1000;
    this.now = now;
    this.value = null;
    this.listeners = new Set();
    this.timer = null;
    this._key = null;
    this._adj = 0;        // macOS 보정값(가용 − freemem, 바이트)
    this._adjAt = -Infinity;
    this._vmBusy = false;
  }

  start() {
    if (this.timer || !this.on) return this;
    this.sample();
    if (this.demo) return this; // --demo 는 고정 값 한 번
    this.timer = setInterval(() => this.sample(), this.pollMs);
    this.timer.unref?.();
    return this;
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** 지금 값(없거나 꺼짐이면 null) */
  current() { return this.on ? this.value : null; }

  /** 한 번 잰다(동기). macOS 보정값은 오래됐을 때만 뒤에서 새로 읽는다(그 결과는 다음 틱부터) */
  sample() {
    if (!this.on) return null;
    let v;
    if (this.demo) {
      const total = 32 * 1024 ** 3;
      v = memSample({ total, avail: total * 0.18 }); // 82% — 주의 색이 보이는 고정 값
    } else {
      let total, free;
      try { total = this.totalmem(); free = this.freemem(); } catch { return this.value; }
      if (this.platform === 'darwin') this._refreshDarwin(free);
      v = memSample({ total, avail: free + (this.platform === 'darwin' ? this._adj : 0) });
    }
    if (!v) return this.value;
    this.value = v;
    const key = Math.round(v.pct) + '|' + Math.round(v.used / MIB64) + '|' + v.total;
    if (key !== this._key) {
      this._key = key;
      for (const fn of this.listeners) { try { fn(v); } catch { /* 구독자 오류 무시 */ } }
    }
    return v;
  }

  _refreshDarwin(freeNow) {
    const t = this.now();
    if (this._vmBusy || t - this._adjAt < this.vmStatMs) return;
    this._vmBusy = true; this._adjAt = t;
    Promise.resolve().then(() => this.vmStat()).then((text) => {
      const avail = parseVmStat(text);
      if (avail != null) { let f = freeNow; try { f = this.freemem(); } catch { /* 앞 값 */ } this._adj = Math.max(0, avail - f); }
    }).catch(() => {}).finally(() => { this._vmBusy = false; });
  }
}
