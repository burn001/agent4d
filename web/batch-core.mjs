// 기동기(자율 실행 루프)·배치 장치·재무장 Monitor·추정 소속 — 세 표현이 함께 쓰는 순수 규칙
// three·DOM 없음(node --test 대상, web/test/batch.test.mjs).
//
// 서버가 보내는 것: 기동기 노드 kind 'bash-bg' + meta.launcher{script,via} + meta.batch,
// 회차 노드 kind 'claude-p' + meta.link{by:'launcher',confidence} + meta.cycle, 인계 기동기 meta.adopted,
// 독립 루트 meta.orphanSdk + meta.likelyMain(sessionId)·meta.unlinkedReason, Monitor 재무장 meta.rearmOf·rearmCount.
// 웹은 이것을 '배치 장치' 하나로 접어 그린다: 끝난 회차는 장치 안(최근 KEEP_ENDED 개만 장치에 작게 붙임),
// 진행 중 회차와 그 하위만 펼친다. 재무장 Monitor 사슬은 마지막 하나만 그리고 앞 것의 자리를 이어받는다.

import { t as tr } from './i18n.mjs';
import { isJob, jobOf, jobTags, jobFold, isProc, procTags } from './job-core.mjs'; // 작업 노드 · 분리 프로세스

export const BATCH = {
  KEEP_ENDED: 2,        // 장치에 작게 붙여 둘 끝난 회차 수(서버 BATCH_KEEP_ENDED 와 같은 값)
  DOCK_SCALE: 0.5,      // 장치에 붙은 끝난 회차 크기 배율
  REARM_WAIT_S: 600,    // 만료된 Monitor 가 재무장을 기다리며 대기 표시로 남는 시간(서버 재무장 판정 창 10분)
  BAND_N: 5,            // 최근 회차 상태 띠 칸 수(서버 recent 최대 5)
  DEVICE_K: 0.75,       // 기동기(배치 장치) 크기 배율 — 세 표현 × 3D·2D 공통(v0.4.1 사용자 지적으로 0.75배, 배치 간격 DEVICE_EXTENT 도 같이)
};

const ENDED = new Set(['done', 'stopped', 'error']);
export const isEndedSt = (s) => ENDED.has(s);
const metaOf = (n) => (n && n.meta) || {};
const tsOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

/** 기동기(배치 장치) 노드인가 */
export function isLauncher(n) { return !!(n && metaOf(n).launcher); }

/** 러너 노드인가(재기동기 → 러너 → 회차, 서버 kind 'bash-bg' + meta.runner{script, instance, launcher}) */
export function isRunner(n) { return !!(n && metaOf(n).runner); }

/** 기동기 L 의 회차 노드: 직속 회차 + 러너 아래 회차. kids = 부모 id → 자식 배열 */
function launcherCycles(L, kids, byId) {
  const out = [];
  for (const c of kids.get(L.id) || []) {
    if (isCycle(c, byId)) out.push(c);
    else if (isRunner(c)) for (const k of kids.get(c.id) || []) if (isCycle(k, byId)) out.push(k);
  }
  return out;
}
const kidsOf = (byId) => {
  const kids = new Map();
  for (const n of byId.values()) {
    const p = n.parentId;
    if (p && p !== n.id && byId.has(p)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); }
  }
  return kids;
};

/** 기동기 회차인가: claude -p + link.by 'launcher', 또는 부모가 기동기 */
export function isCycle(n, byId = null) {
  if (!n || n.kind !== 'claude-p') return false;
  const l = metaOf(n).link;
  if (l && l.by === 'launcher') return true;
  const p = byId && n.parentId ? byId.get(n.parentId) : null;
  return isLauncher(p);
}

/** 연결이 추정인가(점선): 회차·자식의 link.confidence 가 medium/low, 또는 추정 소속(likelyMain)으로 붙인 독립 루트 */
export function isGuessLink(n) {
  const m = metaOf(n);
  const c = m.link && m.link.confidence;
  if (c === 'medium' || c === 'low') return true;
  return !!(m.orphanSdk && m.likelyMain);
}

/** 독립 claude -p 루트(서버 kind 'main' + orphanSdk, mock 은 kind 'claude-p') */
export const isOrphanRoot = (n) => !!(n && metaOf(n).orphanSdk);

/** 상태 → 띠 칸 번호: 0 없음 · 1 진행 · 2 완료 · 3 중지 · 4 오류 */
export function bandState(st) {
  if (st === 'done') return 2;
  if (st === 'stopped') return 3;
  if (st === 'error') return 4;
  if (st === 'active' || st === 'idle' || st === 'running') return 1;
  return 0;
}

/**
 * 배치 장치 표시 값. node = 기동기 노드, nodes = 지금 받은 노드(Map, 있으면 회차 노드 상태로 보강)
 * → { total, running, done, stopped, failed, collapsed, currentId, avgMs, band:[0..4 × ≤5](오래된 → 최근), adopted, script }
 */
export function deviceInfo(node, nodes = null) {
  const m = metaOf(node);
  const b = m.batch || {};
  const kids = nodes ? launcherCycles(node, kidsOf(nodes), nodes) : [];
  kids.sort((a, c) => tsOf(a.startedAt) - tsOf(c.startedAt));
  const curSid = b.currentCycleId || null;
  let currentId = null;
  if (curSid) { const id = 's:' + curSid; if (!nodes || nodes.has(id)) currentId = id; }
  if (!currentId) { const live = kids.filter((k) => !isEndedSt(k.status)); if (live.length) currentId = live[live.length - 1].id; }
  let recent = Array.isArray(b.recent) && b.recent.length ? b.recent.map((r) => {
    const live = r.nodeId && nodes ? nodes.get(r.nodeId) : null;
    return live ? live.status : r.status;
  }) : kids.slice(-BATCH.BAND_N).map((k) => k.status);
  recent = recent.slice(-BATCH.BAND_N);
  const cnt = (s) => kids.filter((k) => k.status === s).length;
  const running = Number.isFinite(b.running) ? b.running : kids.filter((k) => !isEndedSt(k.status)).length;
  return {
    total: Number.isFinite(b.total) ? Math.max(b.total, kids.length) : kids.length,
    running,
    done: Number.isFinite(b.done) ? b.done : cnt('done'),
    stopped: Number.isFinite(b.stopped) ? b.stopped : cnt('stopped'),
    failed: Number.isFinite(b.failed) ? b.failed : cnt('error'),
    collapsed: Number.isFinite(b.collapsed) ? b.collapsed : 0,
    currentId,
    avgMs: Number.isFinite(b.avgDurationMs) ? b.avgDurationMs : null,
    lastCycleAt: b.lastCycleAt || null,
    band: recent.map(bandState),
    adopted: !!m.adopted,
    script: (m.launcher && m.launcher.script) || null,
  };
}

/** 띠를 셰이더용 수 하나로: 칸마다 0..4, 5진수(첫 칸 = 가장 오래된 것). 칸 수는 따로 */
export function bandCode(band) {
  let c = 0;
  for (let i = band.length - 1; i >= 0; i--) c = c * 5 + (band[i] | 0);
  return c;
}
export function bandDecode(code, n) {
  const out = [];
  for (let i = 0; i < n; i++) { out.push(code % 5); code = Math.floor(code / 5); }
  return out;
}

/** 진행 중 회차의 진행 표시(0..1): 경과 / 평균 길이. 평균을 모르면 null */
export function cycleProgress(info, curNode, nowMs) {
  if (!info || !curNode || !info.avgMs) return null;
  const t0 = tsOf(curNode.startedAt);
  if (!t0) return null;
  return Math.max(0, Math.min(1, (nowMs - t0) / info.avgMs));
}

export function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return tr('cards.t.s', { n: Math.max(1, Math.round(ms / 1000)) });
  if (m < 60) return tr('cards.t.m', { n: m });
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${tr('cards.t.h', { n: h })} ${tr('cards.t.m', { n: r })}` : tr('cards.t.h', { n: h });
}

/** 장치 한 줄 요약(라벨·툴팁): "회차 12 · 진행 1 · 완료 9 · 중지 1 · 평균 14분" */
export function deviceSummary(info) {
  const parts = [tr('cards.dev.total', { n: info.total })];
  for (const k of ['running', 'done', 'stopped', 'failed']) if (info[k]) parts.push(tr('cards.dev.' + k, { n: info[k] }));
  const a = fmtDur(info.avgMs);
  if (a) parts.push(tr('cards.dev.avg', { t: a }));
  return parts.join(' · ');
}

/**
 * 노드 꼬리표(라벨 옆 작은 글자). byId 가 있으면 회차 판정에 부모를 본다.
 *  기동기: '이어받음'(meta.adopted) · 회차: '회차 #k'·'연결 추정'(medium/low) · 재무장 Monitor: '재무장 ×N'
 *  독립 루트: 추정 소속이 있으면 '추정 소속', 없으면 '외부 작업' · /clear 승계 작업(meta.inheritedFrom): '승계'
 */
export function nodeTags(n, byId = null, nowMs = Date.now()) {
  const m = metaOf(n);
  const t = [];
  if (isJob(n)) return jobTags(jobOf(n), nowMs); // 작업: 상태·진행·재확인·정체·rc
  if (isLauncher(n)) { if (m.adopted) t.push(tr('cards.tag.adopted')); }
  if (isRunner(n) && Number.isFinite(m.runner.instance)) t.push(tr('cards.tag.run', { n: m.runner.instance }));
  if (isCycle(n, byId)) {
    if (Number.isFinite(m.cycle)) t.push(tr('cards.tag.cycle', { n: m.cycle }));
    if (m.link && (m.link.confidence === 'medium' || m.link.confidence === 'low')) t.push(tr('cards.tag.guess'));
  }
  if (n && n.kind === 'monitor' && (m.rearmCount || m.rearmOf)) t.push(tr('cards.tag.rearm', { n: m.rearmCount || 1 }));
  if (isOrphanRoot(n)) t.push(tr(m.likelyMain ? 'cards.tag.likely' : 'cards.tag.external'));
  if (m.inheritedFrom) t.push(tr('cards.tag.inherited')); // /clear 앞 세션에서 이어받은 작업
  if (isProc(n)) t.push(...procTags(n)); // 정체·rc·들여다봄 N
  return t;
}

/**
 * 접기 계획 — 지금 노드 집합(Map id → node)을 보고 무엇을 그릴지 정한다(배치 직전에 한 번, 프레임마다 아님).
 * @returns {{
 *   hidden: Set<string>,                 // 그리지 않음: 장치 안으로 접힌 끝난 회차와 그 하위, 뒤 것이 있는 재무장 Monitor
 *   docked: Map<string,{launcher,slot}>, // 장치에 작게 붙인 끝난 회차(slot 0 = 가장 최근)
 *   devices: Map<string,{currentId, cycles:string[], docked:string[]}>,
 *   zoneOf: Map<string,string>,          // 회차와 그 하위 → 기동기 id(복셀: 장치 앞 구역)
 *   rearm: Map<string,{prevIds:string[], count:number, anchorId:string}>, // 재무장 사슬 대표(마지막) → 앞 것들
 *   rearmPrev: Map<string,string>,       // 숨긴 앞 Monitor → 대표
 * }}
 */
export function batchFold(nodes, opts = {}) {
  const keep = Number.isFinite(opts.keepEnded) ? opts.keepEnded : BATCH.KEEP_ENDED;
  const byId = nodes instanceof Map ? nodes : new Map([...(nodes || [])].map((n) => [n.id, n]));
  const kids = kidsOf(byId);
  const out = { hidden: new Set(), docked: new Map(), devices: new Map(), zoneOf: new Map(), rearm: new Map(), rearmPrev: new Map() };
  const walk = (id, fn, guard = 0) => { for (const c of kids.get(id) || []) { if (guard > 4000) return; fn(c); walk(c.id, fn, guard + 1); } };
  const anyLiveBelow = (id) => { let live = false; walk(id, (c) => { if (!isEndedSt(c.status)) live = true; }); return live; };

  for (const L of byId.values()) {
    if (!isLauncher(L)) continue;
    const info = deviceInfo(L, byId);
    const cycles = launcherCycles(L, kids, byId);
    cycles.sort((a, b) => (tsOf(a.startedAt) - tsOf(b.startedAt)) || ((metaOf(a).cycle || 0) - (metaOf(b).cycle || 0)) || (a.id < b.id ? -1 : 1));
    const dev = { currentId: info.currentId, cycles: cycles.map((c) => c.id), docked: [] };
    out.devices.set(L.id, dev);
    const ended = cycles.filter((c) => isEndedSt(c.status) && c.id !== info.currentId && !anyLiveBelow(c.id));
    ended.reverse(); // 최근 먼저
    ended.forEach((c, i) => {
      walk(c.id, (d) => out.hidden.add(d.id)); // 끝난 회차의 하위는 장치 안으로
      if (i < keep) { out.docked.set(c.id, { launcher: L.id, slot: i }); dev.docked.push(c.id); }
      else out.hidden.add(c.id);
    });
    for (const c of cycles) {
      out.zoneOf.set(c.id, L.id);
      walk(c.id, (d) => { if (!out.zoneOf.has(d.id)) out.zoneOf.set(d.id, L.id); });
    }
    // 러너: 끝났고 펼친 회차가 없으면(회차가 모두 장치 안·장치 옆) 러너도 장치 안으로. 진행 중 러너는 장치 → 러너 → 회차로 펼침
    for (const r of kids.get(L.id) || []) {
      if (!isRunner(r)) continue;
      out.zoneOf.set(r.id, L.id);
      const open = (kids.get(r.id) || []).some((c) => !out.hidden.has(c.id) && !out.docked.has(c.id));
      if (isEndedSt(r.status) && !open) out.hidden.add(r.id);
    }
  }

  // 작업 노드: 주인마다 끝난 작업은 최근 몇 개만(나머지 접음)
  for (const id of jobFold(byId, opts.jobKeep != null ? { keepEnded: opts.jobKeep } : undefined).hidden) out.hidden.add(id);

  // 재무장 사슬: rearmOf 로 이어진 Monitor 중 뒤 것이 있는 노드는 숨기고 대표(마지막)가 자리를 잇는다
  const next = new Map();
  for (const n of byId.values()) {
    if (n.kind !== 'monitor') continue;
    const p = metaOf(n).rearmOf;
    if (p && byId.has(p) && p !== n.id) {
      const o = next.get(p);
      if (!o || tsOf(n.startedAt) > tsOf(o.startedAt)) next.set(p, n);
    }
  }
  for (const n of byId.values()) {
    if (n.kind !== 'monitor' || next.has(n.id)) continue;
    const prev = [];
    let cur = n, g = 0;
    while (g++ < 256) {
      const p = metaOf(cur).rearmOf;
      if (!p || !byId.has(p) || next.get(p) !== cur) break;
      prev.push(p);
      cur = byId.get(p);
    }
    if (!prev.length && !metaOf(n).rearmOf) continue;
    out.rearm.set(n.id, { prevIds: prev, count: metaOf(n).rearmCount || prev.length || 1, anchorId: prev.length ? prev[prev.length - 1] : n.id });
    for (const p of prev) { out.hidden.add(p); out.rearmPrev.set(p, n.id); }
  }
  return out;
}

/**
 * 만료(meta.expired)로 끝난 Monitor 가 재무장을 기다리는 중인가 — 그 동안은 퇴장(사라짐) 대신 대기 표시로 남겨
 * 30분마다 노드가 사라졌다 다시 생기는 깜빡임을 막는다. 주인(부모)이 끝났거나 waitS 가 지나면 false.
 * @param endedAgoS 끝난 뒤 흐른 (가상) 초
 */
export function rearmStandby(n, parent, endedAgoS, waitS = BATCH.REARM_WAIT_S) {
  if (!n || n.kind !== 'monitor' || n.status !== 'done' || !metaOf(n).expired) return false;
  if (parent && isEndedSt(parent.status)) return false;
  return endedAgoS >= 0 && endedAgoS < waitS;
}

/**
 * 독립 claude -p 루트의 자리(전체 보기): likelyMain 이 지금 보이는 (독립이 아닌) 루트면 그 메인 가장자리 대기석('guest'),
 * 아니면 그 프로젝트의 '외부 작업' 구역('external').
 * @param roots [{nodeId, projectId}] (assignRoots 결과)
 * @returns Map<orphanRootId, {mode:'guest', host:nodeId} | {mode:'external', projectId}>
 */
export function orphanPlan(roots, byId) {
  const out = new Map();
  const sid2root = new Map();
  for (const r of roots) {
    const n = byId.get(r.nodeId);
    if (!n || isOrphanRoot(n)) continue;
    sid2root.set(n.sessionId || r.nodeId.replace(/^s:/, ''), r.nodeId);
    sid2root.set(r.nodeId.replace(/^s:/, ''), r.nodeId);
  }
  for (const r of roots) {
    const n = byId.get(r.nodeId);
    if (!isOrphanRoot(n)) continue;
    const lm = metaOf(n).likelyMain;
    const host = lm ? sid2root.get(String(lm).replace(/^s:/, '')) : null;
    out.set(r.nodeId, host ? { mode: 'guest', host } : { mode: 'external', projectId: r.projectId });
  }
  return out;
}
