// 진행 줄 자동 인식(규칙 없이) — 출력 줄에서 흔한 진행 모양을 알아보고 라벨별 카운터(레인)·처리율·ETA·과열(heat)을 굴린다
//. 순수 코어: 그래프·파일 없음. 작업 장부(jobs.mjs JobBook)가 스트림마다 하나씩 쓴다.
//
// 알아보는 모양(한 줄에 하나, 앞에서부터 처음 맞는 것):
//  A `[라벨] 12,345 단위 · 경과 · 최장 x s`   (라벨 괄호 + 수 + 선택 /total·단위, 뒤는 '·|,;' 로 나눈 부가값)
//  B `라벨 n/total`                             (tqdm·`[3/10]`·`12/40 · ok` — 한 줄에 여럿이면 마지막. n > total·total < 2 는 아님)
//  C `라벨 n%`                                  (마지막 것)
//  D `라벨: n [단위]` / `라벨=n`                (줄 전체가 그 꼴일 때만)
// 오탐을 줄이려고 같은 모양(종류+라벨)이 **두 번 이상 단조 증가**(관측 3개, 같은 값 반복은 무시)해야 레인으로 인정한다.
// 인정된 레인이 줄어들면 새 회차(pass)로 본다(처음 처리율 rate0 은 그대로 — 과열 비교 기준).
import { redact } from './redact.mjs';

export const LANE = {
  MAX: 8,            // 스트림 하나의 인정 레인 상한
  CAND_MAX: 24,      // 후보(아직 인정 전) 상한
  CONFIRM: 3,        // 인정에 필요한 단조 증가 관측 수(증가 2번)
  WIN: 6,            // 최근 처리율 창(표본 수)
  RATE0_N: 5,        // 처음 처리율(rate0)을 정하는 첫 회차 앞 표본 수
  KEEP: 16,          // 레인마다 남길 표본 수
  KEY_MAX: 40, UNIT_MAX: 12,
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const r2 = (x) => Math.round(x * 100) / 100;
/** 유효 숫자 3자리 */
const sig3 = (x) => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(3)) : x);
const num = (s) => { if (s == null) return NaN; const v = Number(String(s).replace(/[,_]/g, '')); return Number.isFinite(v) ? v : NaN; };

/** 라벨 → 레인 열쇠: 공백 정리, 숫자 묶음은 '#'(epoch 3·worker-12 → epoch #·worker-#), 마스킹, 40자 */
export function laneKey(label) {
  const s = String(label || '').replace(/\s+/g, ' ').trim().replace(/[:=|\s]+$/, '').replace(/\d+/g, '#');
  return s ? redact(s).slice(0, LANE.KEY_MAX) : '';
}

const TIME_UNIT = { ms: 0.001, s: 1, sec: 1, secs: 1, second: 1, seconds: 1, '초': 1, m: 60, min: 60, mins: 60, '분': 60, h: 3600, hr: 3600, '시간': 3600 };
const EXTRA_RE = /^(최장|최대|최악|max|longest|worst|지연|lag|latency|p9\d|p50|avg|평균)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|초|분|m)?$/i;
const ELAPSED_RE = /^(?:경과|elapsed|took|time|t)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds|초|m|min|mins|분|h|hr|시간)$/i;
const CLOCK_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;
const TQDM_RE = /\[(?:(\d+):)?(\d+):(\d{2})\s*</;

/** 줄의 나머지(부가값 토막)에서 경과 초·부가값({k,v,u}) */
function tailInfo(rest, whole) {
  let elapsed = null, extra = null;
  for (const raw of String(rest || '').split(/[·|,;]/)) {
    const tok = raw.trim().replace(/^[(\[]|[)\]]$/g, '').trim();
    if (!tok) continue;
    let m = EXTRA_RE.exec(tok);
    if (m) { if (!extra) extra = { k: m[1], v: Number(m[2]), u: m[3] || null }; continue; }
    if (elapsed == null && (m = ELAPSED_RE.exec(tok))) { elapsed = Number(m[1]) * (TIME_UNIT[m[2].toLowerCase()] ?? TIME_UNIT[m[2]] ?? 1); continue; }
    if (elapsed == null && (m = CLOCK_RE.exec(tok))) elapsed = (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
  }
  if (elapsed == null && whole) { const t = TQDM_RE.exec(whole); if (t) elapsed = (+(t[1] || 0)) * 3600 + (+t[2]) * 60 + (+t[3]); }
  return { elapsed, extra };
}

const A_RE = /^\s*\[([^\]\d\s][^\]\n]{0,39})\]\s*(\d[\d,_]*(?:\.\d+)?)(?:\s*\/\s*(\d[\d,_]*))?\s*([^\s\d·|,;:()[\]/%=][^\s·|,;:()[\]/%=]{0,11})?(.*)$/;
const B_RE = /(?:^|[^\w/.:\-])(\d[\d,]*)\s*\/\s*(\d[\d,]*)(?![\w/.])\]?\s*([A-Za-z가-힣]{1,12})?/g;
const C_RE = /(?:^|[^\w.])(\d{1,3}(?:\.\d+)?)\s*%(?![\w%])/g;
const D_RE = /^\s*([A-Za-z가-힣_][\w가-힣.\- ]{0,30}?)\s*[:=]\s*(\d[\d,_]*(?:\.\d+)?)\s*([A-Za-z가-힣%]{1,10})?\s*$/;
const LEAD_RE = /^\s*\[?([A-Za-z가-힣_][\w가-힣 .\-]{0,30}?)\s*(?:[:|\]]|\s(?=\d))/;

/**
 * 한 줄 → 관측 {type:'A'|'B'|'C'|'D', key, n, total|null, unit|null, elapsed(초)|null, extra:{k,v,u}|null} 또는 null.
 * 규약 줄(`::agent4d`)은 여기 오지 않는다(장부가 먼저 거름).
 */
export function parseProgressLine(line) {
  if (typeof line !== 'string') return null;
  const s = line.length > 600 ? line.slice(-600) : line;
  if (!/\d/.test(s)) return null;
  let m = A_RE.exec(s);
  if (m) {
    const n = num(m[2]);
    const total = m[3] != null ? num(m[3]) : null;
    if (Number.isFinite(n) && !(total != null && (!(total >= 2) || n > total))) {
      const { elapsed, extra } = tailInfo(m[5], s);
      const key = laneKey(m[1]);
      if (key) return { type: 'A', key, n, total, unit: m[4] ? redact(m[4]).slice(0, LANE.UNIT_MAX) : null, elapsed, extra };
    }
  }
  const lead = () => { const l = LEAD_RE.exec(s); return l ? laneKey(l[1]) : ''; };
  let last = null;
  for (const b of s.matchAll(B_RE)) {
    const n = num(b[1]), total = num(b[2]);
    if (!Number.isFinite(n) || !(total >= 2) || n > total) continue;
    last = { b, n, total };
  }
  if (last) {
    const after = s.slice(last.b.index + last.b[0].length);
    const { elapsed, extra } = tailInfo(after, s);
    return { type: 'B', key: lead() || 'progress', n: last.n, total: last.total, unit: last.b[3] ? redact(last.b[3]).slice(0, LANE.UNIT_MAX) : null, elapsed, extra };
  }
  let pc = null;
  for (const c of s.matchAll(C_RE)) { const v = Number(c[1]); if (v >= 0 && v <= 100) pc = { c, v }; }
  if (pc) {
    const { elapsed, extra } = tailInfo(s.slice(pc.c.index + pc.c[0].length), s);
    return { type: 'C', key: lead() || 'progress', n: pc.v, total: 100, unit: '%', elapsed, extra };
  }
  m = D_RE.exec(s);
  if (m) {
    const n = num(m[2]);
    const key = laneKey(m[1]);
    if (Number.isFinite(n) && key) return { type: 'D', key, n, total: null, unit: m[3] ? redact(m[3]).slice(0, LANE.UNIT_MAX) : null, elapsed: null, extra: null };
  }
  return null;
}

/**
 * 스트림 하나의 레인들. observe(관측, 시각 ms) 를 줄 순서대로 넣는다. 라이브·재생이 같은 줄을 같은 순서로 넣으면 같은 답
 * (처리율은 줄에 경과 초가 있으면 그것, 없으면 도착 시각으로 — 재생의 도착 시각은 배분 값이라 경과 초가 있는 쪽이 더 정확).
 */
export class ProgressLanes {
  constructor() {
    this.lanes = new Map(); // id → lane
    this.order = 0;
  }

  /** 줄 하나. 인정된 레인이 바뀌었으면 true */
  feedLine(line, tMs) {
    const o = parseProgressLine(line);
    return o ? this.observe(o, tMs) : false;
  }

  observe(o, tMs) {
    const id = `${o.type}|${o.key}`;
    let L = this.lanes.get(id);
    if (!L) {
      const cands = [...this.lanes.values()];
      if (cands.filter((x) => !x.conf).length >= LANE.CAND_MAX) {
        // 오래된 후보부터 버림
        const old = cands.filter((x) => !x.conf).sort((a, b) => a.atMs - b.atMs)[0];
        if (old) this.lanes.delete(old.id);
      }
      L = { id, type: o.type, key: o.key, unit: o.unit, n: o.n, total: o.total, samples: [], conf: false, inc: 0, pass: 1,
        rate0: null, rate0Fixed: false, rate: null, last: null, last0: null, atMs: tMs, ord: this.order++ };
      this.lanes.set(id, L);
    }
    const s = { n: o.n, t: tMs, e: o.elapsed };
    if (!L.conf) {
      if (L.samples.length) {
        if (o.n === L.n) return false;
        if (o.n < L.n) { L.samples = []; L.inc = 0; L.last0 = null; }
        else L.inc++;
      }
      this._push(L, o, s);
      if (L.inc >= LANE.CONFIRM - 1) {
        if ([...this.lanes.values()].filter((x) => x.conf).length >= LANE.MAX) return false;
        L.conf = true;
        this._rates(L);
        return true;
      }
      return false;
    }
    if (o.n === L.n && (o.total ?? null) === (L.total ?? null)) return false;
    if (o.n < L.n) { L.pass++; L.samples = []; }
    this._push(L, o, s);
    this._rates(L);
    return true;
  }

  _push(L, o, s) {
    L.samples.push(s);
    if (L.samples.length > LANE.KEEP) L.samples.splice(0, L.samples.length - LANE.KEEP);
    L.n = o.n;
    if (o.total != null) L.total = o.total;
    if (o.unit) L.unit = o.unit;
    L.atMs = s.t;
    L.elapsed = s.e;
    if (o.extra) {
      L.last = o.extra;
      if (!L.last0 || L.last0.k !== o.extra.k) L.last0 = o.extra;
    }
  }

  /** 표본 i..j 의 Δn/Δt(경과 초가 모두 있으면 그것, 아니면 도착 시각). Δt 가 0 이면 null */
  static _span(S, i, j) {
    const a = S[i], b = S[j];
    const useE = S.slice(i, j + 1).every((x) => x.e != null) && b.e >= a.e;
    const dt = useE ? b.e - a.e : (b.t - a.t) / 1000;
    return dt > 0 ? (b.n - a.n) / dt : null;
  }

  _rates(L) {
    const S = L.samples;
    if (S.length >= 2) {
      // 최근 창: 끝에서 WIN 개, Δt 가 0 이면 창을 넓힌다
      let r = null;
      for (let i = Math.max(0, S.length - LANE.WIN); i >= 0 && r == null; i--) r = ProgressLanes._span(S, i, S.length - 1);
      if (r != null) L.rate = r;
      // 처음 처리율: 첫 회차의 앞 RATE0_N 개(Δt 가 0 이면 늘려 가며), 표본이 다 차면 고정
      if (!L.rate0Fixed && L.pass === 1) {
        let r0 = null, k = Math.min(LANE.RATE0_N, S.length) - 1;
        for (; k < S.length && r0 == null; k++) r0 = ProgressLanes._span(S, 0, k);
        if (r0 != null) L.rate0 = r0;
        if (S.length >= LANE.RATE0_N && L.rate0 != null) L.rate0Fixed = true;
      } else if (L.rate0 == null && L.rate != null) { L.rate0 = L.rate; L.rate0Fixed = true; }
    }
  }

  /** 레인 과열 0..1: 처리율이 처음 대비 떨어진 정도(100배 = 1)와 한 단위 최장(부가값)이 오른 정도(약 30배 = 1) 중 큰 것 */
  static heatOf(L) {
    const hr = L.rate0 > 0 && L.rate > 0 ? clamp01(Math.log10(L.rate0 / L.rate) / 2) : 0;
    const hl = L.last && L.last0 && L.last.k === L.last0.k && L.last0.v > 0 && L.last.v > 0 ? clamp01(Math.log10(L.last.v / L.last0.v) / 1.5) : 0;
    return r2(Math.max(hr, hl));
  }

  /** 인정된 레인이 있는가 */
  get confirmed() { for (const L of this.lanes.values()) if (L.conf) return true; return false; }

  /**
   * 작업(meta.job)에 싣는 요약. 인정된 레인이 없으면 null.
   * → { lanes:[{key, n, total, unit, rate, last, pass, at, elapsed, heat}], primary, rate, eta, heat, progress }
   */
  summary() {
    const conf = [...this.lanes.values()].filter((L) => L.conf).sort((a, b) => a.ord - b.ord);
    if (!conf.length) return null;
    let primary = conf[0];
    for (const L of conf) if (L.atMs > primary.atMs) primary = L;
    let eta = null, heat = 0;
    const lanes = conf.map((L) => {
      const h = ProgressLanes.heatOf(L);
      if (h > heat) heat = h;
      if (L.total != null && L.rate > 0 && L.n < L.total) {
        const e = L.atMs + ((L.total - L.n) / L.rate) * 1000;
        if (Number.isFinite(e) && (eta == null || e > eta)) eta = e;
      }
      return { key: L.key, n: L.n, total: L.total ?? null, unit: L.unit ?? null, rate: L.rate != null ? sig3(L.rate) : null,
        last: L.last ? { ...L.last } : null, pass: L.pass, at: new Date(L.atMs).toISOString(), elapsed: L.elapsed ?? null, heat: h };
    });
    return {
      lanes, primary: primary.key, rate: primary.rate != null ? sig3(primary.rate) : null,
      eta: eta != null ? new Date(Math.round(eta)).toISOString() : null, heat,
      progress: primary.total != null && primary.total > 0 ? { n: Math.min(primary.n, primary.total), total: primary.total } : null,
    };
  }
}
