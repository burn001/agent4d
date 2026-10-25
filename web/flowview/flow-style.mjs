// '흐름(Flow)' 표현의 순수 부분(three·DOM 없음)
// agent-flow(patoles/agent-flow, Apache-2.0) 의 시각 언어를 참고: 깊은 남색 배경 · 육각 노드(글로우·내부 스캔라인·상태색 테두리) ·
// 굵기가 줄어드는 곡선 빔(부모→자식) · 혜성 꼬리 입자 · 상태색(생각=하늘, 도구=호박, 완료=초록, 오류=빨강, 대기·중지=회색).
// 색 값은 이 저장소의 테마 규칙(다크·라이트)에 맞춰 다시 정했다. node --test 로 시험(web/test/flowview.test.mjs).

// 다크: agent-flow 팔레트 그대로에 가깝게, 라이트: 같은 색상을 진하게(밝은 바탕에서 읽히게)
import { t as _t } from '../i18n.mjs';
export const FLOW_PALETTE = {
  dark: {
    void: '#050510', grid: '#16204a', holo: '#66ccff', holoBright: '#aaeeff',
    thinking: '#66ccff', tool: '#ffbb44', done: '#66ffaa', error: '#ff5566', stopped: '#8a8aa0', idle: '#5aa8d8',
    dispatch: '#cc88ff', ret: '#66ffaa', output: '#66ccff', interior: '#0a0f28', text: '#aaeeff', textDim: '#66ccffb0',
    // 작업 칩(job-chip-core): 대기 = 파랑 흐림 · 줄 섬 = 회색 흐림 · 정체 = 호박과 빨강 사이 주황
    jobWait: '#5b93d6', jobQueued: '#6a6f86', jobStale: '#ff7a3a',
  },
  light: {
    void: '#eef2f8', grid: '#c9d4ea', holo: '#1f7fc4', holoBright: '#0b4f86',
    thinking: '#1f7fc4', tool: '#c27c0e', done: '#0f9e6a', error: '#d4313f', stopped: '#7a7f8c', idle: '#4a86b8',
    dispatch: '#8a3fd1', ret: '#0f9e6a', output: '#1f7fc4', interior: '#ffffff', text: '#0b2a44', textDim: '#2b5e86',
    jobWait: '#4f86bd', jobQueued: '#8b909d', jobStale: '#d9541a',
  },
};
export const paletteOf = (isLight) => (isLight ? FLOW_PALETTE.light : FLOW_PALETTE.dark);

// 노드 상태 → 표시 상태 번호(셰이더) · 색 이름
//   0 대기(idle) · 1 생각(active, 열린 도구 없음) · 2 도구 사용(active + 도구) · 3 완료 · 4 오류 · 5 중지됨
export const NODE_STATE = { idle: 0, thinking: 1, tool: 2, done: 3, error: 4, stopped: 5 };
export function nodeVisualState(status, openTools = 0) {
  if (status === 'error') return NODE_STATE.error;
  if (status === 'stopped') return NODE_STATE.stopped;
  if (status === 'done') return NODE_STATE.done;
  if (status === 'active') return openTools > 0 ? NODE_STATE.tool : NODE_STATE.thinking;
  return NODE_STATE.idle;
}
const STATE_KEY = ['idle', 'thinking', 'tool', 'done', 'error', 'stopped'];
export function stateColor(state, isLight = false) { return paletteOf(isLight)[STATE_KEY[state] || 'idle']; }
export const STATE_TEXT = ['idle', 'thinking', 'tool', 'done', 'error', 'stopped'].map((k) => _t('scene.state.' + k));

// 노드 종류 → 가운데 아이콘 번호(셰이더): 0 별(메인) · 1 마름모(서브에이전트) · 2 사각(claude -p) · 3 삼각(워크플로) · 4 작은 마름모(워크플로 에이전트) · 5 > (백그라운드 명령) · 6 파형(모니터)
export const KIND_ICON = { main: 0, subagent: 1, 'claude-p': 2, workflow: 3, 'workflow-agent': 4, 'bash-bg': 5, monitor: 6 };
export const kindIcon = (k) => KIND_ICON[k] ?? 1;

// 빔(곡선) — agent-flow BEAM: 곡률 0.15, 제어점 1/3·2/3, 굵기 시작 3 → 끝 1(도구 1.5 → 0.5)
// 사용자 피드백 "연결선이 너무 강하다": 기본 빔은 배경에 녹게(가늘고 옅게, 글로우 거의 없음), 정보는 움직임으로
//     데이터 패킷이 지나가는 구간만 잠깐 밝아진다(packetBoost·packetSpan). 위계: 충돌 곡선 > 패킷 > 일반 연결선 > 띄움 점선
// 굵기는 agent-flow(부모→자식 3px → 1px) 수준으로 가늘게. 선 위를 늘 흐르는 가는 혜성 대시(FLOW_DASH)로 살아 있게 —
// 방향 = 호출 흐름(부모 → 자식), 속도·밝기 = 활동(작업 중 빠르고 밝게, 대기 느리게, 끝남·중지 멈춤). 패킷이 지나면 그 구간이 잠깐 밝다
export const BEAM = { curvature: 0.15, cp1: 0.33, cp2: 0.66, segments: 32, startW: 0.13, endW: 0.04, idleAlpha: 0.065, activeAlpha: 0.2, glowW: 0.14, glowAlpha: 0.02, packetBoost: 0.5, packetSpan: 0.1, wobble: 0.35 };
/** 흐르는 대시(세계 단위): gap = 대시 간격, speed·amp = 상태별 속도(단위/초)·밝기 배율(기본 밝기에 곱해 더함) */
export const FLOW_DASH = { gap: 4.2, sharp: 7, active: { speed: 7, amp: 3.2 }, idle: { speed: 1.6, amp: 1.4 }, error: { speed: 0.8, amp: 1.0 }, done: { speed: 0, amp: 0 }, stopped: { speed: 0, amp: 0 } };
export const flowDash = (status) => FLOW_DASH[status === 'active' ? 'active' : status === 'error' ? 'error' : status === 'done' ? 'done' : status === 'stopped' ? 'stopped' : 'idle'];
/** 대시 밝기(0..1) — s = 부모에서 잰 길이, time 초: 머리 바로 뒤가 가장 밝고 꼬리로 갈수록 옅은 혜성 모양(셰이더와 같은 식) */
export function dashShape(s, time, speed) {
  if (!speed) return 0;
  const g = FLOW_DASH.gap, ph = (((s - time * speed) / g) % 1 + 1) % 1;
  return Math.pow(ph, FLOW_DASH.sharp);
}
/** 패킷 흔들림(agent-flow wobble: 진행 수직 사인, 양 끝 0) — 부모→자식 위치 u, 초 time */
export const packetWobble = (u, time, phase = 0) => BEAM.wobble * Math.sin(u * 10 + time * 3 + phase);

/** 빔 기본 불투명도(상태별): 작업 중 0.2(라이트 0.3) > 대기 > 오류 > 중지 > 완료 */
export function beamAlpha(status, light = false, stale = false) {
  let al = BEAM.idleAlpha;
  if (status === 'active') al = BEAM.activeAlpha;
  else if (status === 'error') al = stale ? 0.05 : 0.22;
  else if (status === 'stopped') al = 0.045;
  else if (status === 'done') al = 0.03;
  return light ? Math.min(1, al * 1.35 + 0.03) : al;
}
/** 빔 위치 t(0 = 부모, 1 = 자식)에서 지나가는 패킷들(es = 빔 위 위치들) 때문에 더해지는 밝기 — 머리 근처만 종 모양 */
export function packetGlow(t, es) {
  if (!es || !es.length) return 0;
  let g = 0;
  for (const e of es) { const d = (t - e) / BEAM.packetSpan; g = Math.max(g, Math.exp(-d * d)); }
  return g * BEAM.packetBoost;
}

function bez(t, a, b, c, d) { const m = 1 - t; return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d; }

/**
 * 평면(XZ) 위 곡선 빔의 제어점. a→b, 곡률은 거리 비례로 진행 방향 왼쪽으로 휜다(agent-flow 와 같은 규칙).
 * 반환 {c1x,c1z,c2x,c2z,dist} 또는 거리 0 이면 null
 */
export function beamControls(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return null;
  const k = dist * BEAM.curvature;
  const px = (-dz / dist) * k, pz = (dx / dist) * k;
  return { c1x: a.x + dx * BEAM.cp1 + px, c1z: a.z + dz * BEAM.cp1 + pz, c2x: a.x + dx * BEAM.cp2 + px, c2z: a.z + dz * BEAM.cp2 + pz, dist };
}

/**
 * 흐름 3D 높이 계층: 위층(부모) → 아래층(자식)으로 '떨어지는' 빔의 높이. 수평 곡선(beamControls)은 그대로 두고 y 만 3차 베지어
 * 부모에서 살짝 떠올라(LIFT × 수평 거리, 최대 LIFT_MAX) 수평으로 나가다가, 끝에서 자식 위로 내리꽂힌다(제2 제어점 = 낙차의 MID 지점).
 * 같은 높이면 LIFT 만큼 살짝 뜬 낮은 호. 2D(flat/flow2d.js)는 이 함수를 쓰지 않는다(평면 그대로).
 */
export const BEAM_DROP = { lift: 0.06, liftMax: 2.4, mid: 0.3 };
export function beamY(t, ay, by, dist = 0) {
  const lift = Math.min(BEAM_DROP.liftMax, BEAM_DROP.lift * dist);
  return bez(t, ay, ay + lift, ay + (by - ay) * BEAM_DROP.mid, by);
}

/** 빔 위 점(u 0..1). y 는 a·b 사이 직선 보간(drop 이면 떨어지는 곡선 beamY). wobble 은 진행 방향 수직 흔들림(입자용, 양 끝 0) */
export function beamPoint(out, a, b, u, wobble = 0, drop = false) {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  const c = beamControls(a, b);
  if (!c) { out.x = a.x; out.y = a.y; out.z = a.z; return out; }
  out.x = bez(t, a.x, c.c1x, c.c2x, b.x);
  out.z = bez(t, a.z, c.c1z, c.c2z, b.z);
  out.y = drop ? beamY(t, a.y, b.y, c.dist) : a.y + (b.y - a.y) * t;
  if (wobble) {
    const w = wobble * Math.sin(Math.PI * t);
    out.x += (-(b.z - a.z) / c.dist) * w;
    out.z += ((b.x - a.x) / c.dist) * w;
  }
  return out;
}

/** 빔 굵기(시작 → 끝으로 가늘게) */
export const beamWidth = (t, startW = BEAM.startW, endW = BEAM.endW) => startW + (endW - startW) * t;

/** 노드 '숨쉬기' 배율 — 생각 중 2Hz·3%, 대기 0.7Hz·1.5%, 그 밖 1 */
export function breathe(state, t, seed = 0) {
  if (state === NODE_STATE.thinking || state === NODE_STATE.tool) return 1 + 0.03 * Math.sin(t * 2 * 2 + seed);
  if (state === NODE_STATE.idle) return 1 + 0.015 * Math.sin(t * 0.7 * 2 + seed);
  return 1;
}

/**
 * 말풍선(say) 표시 규칙: 같은 노드는 마지막 하나, 전체 MAX 개(오래된 것부터 교체), HOLD 초 유지 후 FADE 초 동안 흐려짐.
 * BubbleBook 은 순수 장부 — 그리기는 flowview/bubbles.js
 */
export const BUBBLE = { MAX: 4, HOLD: 10, FADE: 1.5, LINES: 3, CHARS: 140 };
export class BubbleBook {
  constructor(max = BUBBLE.MAX) { this.max = max; this.items = []; }
  push(nodeId, role, text, now) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const body = clean.length > BUBBLE.CHARS ? clean.slice(0, BUBBLE.CHARS - 1) + '…' : clean;
    const i = this.items.findIndex((x) => x.nodeId === nodeId);
    if (i >= 0) this.items.splice(i, 1);
    const it = { nodeId, role, text: body, at: now };
    this.items.push(it);
    while (this.items.length > this.max) this.items.shift();
    return it;
  }
  /** 살아 있는 항목과 불투명도 */
  live(now) {
    this.items = this.items.filter((x) => now - x.at < BUBBLE.HOLD + BUBBLE.FADE);
    return this.items.map((x) => ({ ...x, alpha: now - x.at < BUBBLE.HOLD ? 1 : 1 - (now - x.at - BUBBLE.HOLD) / BUBBLE.FADE }));
  }
  drop(nodeId) { this.items = this.items.filter((x) => x.nodeId !== nodeId); }
  clear() { this.items = []; }
}
