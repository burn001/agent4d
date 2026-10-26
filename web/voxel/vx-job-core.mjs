// 복셀 오피스 작업(Job) 현황판의 순수 규칙 — three·DOM 없음(node --test: web/test/jobs-voxel.test.mjs).
// 3D(office.js · vx-jobs.js)와 2D 평면도(flat/voxel2d.js)가 같이 쓴다.
//
// 은유: 작업 노드는 기계를 새로 세우지 않고 **주인 기계에 딸린 작은 작업 현황판(칸반)의 카드 한 장**이다.
//   · 서버랙(백그라운드 명령·러너) 위에 짧은 기둥으로 꽂은 판 · 모니터 벽(Monitor) 화면 위 벽걸이 판 ·
//     복합기(기동기) 오른쪽 바닥에 선 판 · 팀장 책상(메인) 왼쪽에 선 판. 카드는 아래(주인 쪽)부터 위로 쌓인다.
//   · 카드 = 흰 카드 + 왼쪽 상태 띠 + 오른쪽 표시등(정체면 끊긴 맥박) + 진행 막대(비율이 있으면) + 대기면 모래시계(재확인 시각이 가까울수록 아래가 참)
//   · 색 = job-core jobCode(job, nowMs) — 진행 호박 · 대기 파랑 흐림 · 줄 섬 회색 흐림 · 끝 초록 · 실패 빨강 · 정체 주황
//   · 2D 평면도는 같은 판을 위에서 본 모양: 판 앞쪽(카드가 보는 쪽)으로 칩이 한 줄로 늘어선다.
import { isJob, jobOf, jobCode, jobProgress, JOB_CODE } from '../job-core.mjs';
import { isProcAutoJob, boardPos } from './vx-proc-core.mjs';

const PI = Math.PI;

/** 판·카드 크기(세계 단위 1 ≈ 1m) */
export const JOBCARD = {
  W: 0.62, H: 0.2, PITCH: 0.26,  // 카드 폭·높이·쌓는 간격
  BOARD_W: 0.74,                 // 판(뒤판) 폭
  MAX: 8,                        // 주인마다 그리는 카드 수 상한(넘는 작업은 자리 없음 — 접기가 끝난 것은 3개로 줄여 둔다)
  CHIP: 0.24,                    // 2D 칩 간격(판 앞쪽으로)
};

/** 상태 번호(JOB_CODE) → 색 열쇠: 3D·2D 가 이 열쇠로 테마 색을 고른다 */
export const JOB_COLOR_KEY = ['queued', 'running', 'waiting', 'done', 'failed', 'stale'];

/**
 * 주인 자리 → 판 기준점. owner = 주인의 배치(layout machine 또는 seat):
 *   {type:'rack'|'screen'|'batch'|'board', x, y, z, face, slot} 또는 {type:'lead'|'desk', x(책상), z(책상)}
 * @returns {{ x, y0, z, face, pole:number|null, d2:number }|null}
 *   y0 = 맨 아래 카드 중심 높이, pole = 기둥이 시작하는 높이(null = 벽걸이), d2 = 2D 칩 줄이 시작하는 판 앞쪽 거리
 */
export function jobAnchor(owner) {
  if (!owner) return null;
  switch (owner.type) {
    case 'rack': return { x: owner.x, y0: 2.38, z: owner.z + 0.05, face: 0, pole: 2.05, d2: -0.32 }; // 2D: 판이 랙 위라 칩도 랙 위(옆 복합기와 안 겹침)
    case 'screen': {
      // 모니터 벽(오른쪽 벽, 앞면 −x): 위 단 화면 위 벽걸이 판. 같은 열의 아래·위 단은 좌우로 비켜 선다
      const tier = Math.floor(((owner.slot || 0) % 8) / 4);
      return { x: owner.x - 0.06, y0: 2.02, z: owner.z + (tier ? 0.38 : -0.38), face: owner.face ?? -PI / 2, pole: (Number.isFinite(owner.y) ? owner.y : 1.48) + 0.3, d2: 0.22 }; // 기둥 = 주인 화면 윗변에서
    }
    case 'batch': return { x: owner.x + 1.2, y0: 0.95, z: owner.z + 0.1, face: 0, pole: 0, d2: -0.3 };
    case 'board': return { x: owner.x + 2.0, y0: 1.0, z: owner.z + 0.3, face: 0, pole: 0, d2: 0.2 };
    case 'proc': return { x: owner.x + 4.75, y0: 0.95, z: owner.z, face: 0, pole: 0, d2: -0.3 }; // 생산 라인 끝(팔레트 오른쪽) — 자동 진행 작업은 전광판으로 가고 그 밖 작업만
    case 'lead': return { x: owner.x - 1.75, y0: 0.95, z: owner.z + 0.15, face: 0, pole: 0, d2: -0.3 };
    default: return { x: owner.x - 0.95, y0: 0.95, z: owner.z, face: 0, pole: 0, d2: -0.3 }; // 그 밖 책상 주인
  }
}

/** 판 기준점 + 칸 번호 → 카드 중심(3D) */
export function jobCardPos(anchor, slot) {
  return { x: anchor.x, y: anchor.y0 + slot * JOBCARD.PITCH, z: anchor.z, face: anchor.face };
}

/** 2D 칩 중심: 카드(x, z) 에서 판 앞쪽(face)으로 d2 + 칸 × CHIP (돌린 방도 face 가 같이 돌아 맞는다) */
export function jobFlatPos(m, out = {}) {
  const f = m.face || 0, d = (m.d2 || 0) + (m.slot || 0) * JOBCARD.CHIP;
  out.x = m.x + Math.sin(f) * d; out.z = m.z + Math.cos(f) * d;
  return out;
}

const tsOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };

/**
 * 주인마다 보이는 작업에 칸을 준다. 순서: 이전 칸이 있으면 그 순서를 지키고(판에서 튀지 않게), 새 작업은 시작 순으로 위에.
 * 칸은 늘 0..n−1 로 채운다(숨은 것이 빠지면 위 카드가 한 칸 내려온다).
 * @param jobs   보이는 작업 노드 배열(같은 주인)
 * @param prevMach 이전 layout.machine(Map) — {type:'job', slot}
 * @returns [{ node, slot }] (MAX 넘는 작업은 빠짐)
 */
export function jobSlots(jobs, prevMach = null) {
  const prevSlot = (n) => { const p = prevMach && prevMach.get(n.id); return p && p.type === 'job' && p.owner === n.parentId && Number.isFinite(p.slot) ? p.slot : Infinity; };
  const startOf = (n) => { const j = jobOf(n); const t = tsOf((j && j.startedAt) || n.startedAt); return Number.isFinite(t) ? t : Infinity; };
  const arr = jobs.slice().sort((a, b) => (prevSlot(a) - prevSlot(b)) || (startOf(a) - startOf(b)) || ((a.order ?? 0) - (b.order ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return arr.slice(0, JOBCARD.MAX).map((node, slot) => ({ node, slot }));
}

/**
 * 배치 결과(out: computeOffice 의 seat·machine·roomOf)에 작업 카드 자리를 더한다 — 주인 자리가 정해진 뒤 부른다.
 * 주인이 자리에 없으면(퇴장·접힘·재무장 앞 Monitor) 그 작업도 자리가 없다(그리지 않음).
 * @param jobs  작업 노드 배열(isJob)
 * @param out   { seat:Map, machine:Map, roomOf:Map }
 * @param prevMach 이전 machine Map
 */
export function placeJobs(jobs, out, prevMach = null) {
  const groups = new Map();
  for (const n of jobs) {
    const o = n.parentId;
    if (!o || o === n.id) continue;
    if (!groups.has(o)) groups.set(o, []);
    groups.get(o).push(n);
  }
  for (let [ownerId, arr] of groups) {
    const om = out.machine.get(ownerId), os = out.seat.get(ownerId);
    let owner = null, roomId = null;
    if (om && om.type !== 'job') { owner = om; roomId = om.roomId; }
    else if (os) { owner = { type: os.kind === 'lead' ? 'lead' : 'desk', x: os.deskX, z: os.deskZ }; roomId = os.roomId; }
    if (!owner) continue;
    if (owner.type === 'proc') { // 자동 진행 작업 = 라인 기계 위 전광판(카드 없음 — vx-procs.js 가 판을 그리고 이 자리로 집기·이름표·카메라)
      const auto = arr.find((n) => isProcAutoJob(n, ownerId));
      if (auto) {
        const p = boardPos(owner);
        out.machine.set(auto.id, { roomId, x: p.x, y: p.y, z: p.z, type: 'job', procBoard: true, slot: 0, face: owner.face || 0, owner: ownerId, ownerType: 'proc', rows: 1, lo: true, hi: true, pole: null, d2: 0 });
        out.roomOf.set(auto.id, roomId);
        arr = arr.filter((n) => n !== auto);
        if (!arr.length) continue;
      }
    }
    const a = jobAnchor(owner);
    if (!a) continue;
    const slots = jobSlots(arr, prevMach);
    const rows = slots.length;
    for (const { node, slot } of slots) {
      const p = jobCardPos(a, slot);
      out.machine.set(node.id, { roomId, x: p.x, y: p.y, z: p.z, type: 'job', slot, face: p.face, owner: ownerId, ownerType: owner.type, rows, lo: slot === 0, hi: slot === rows - 1, pole: a.pole, d2: a.d2 });
      out.roomOf.set(node.id, roomId);
    }
  }
}

/** 대기 모래시계 채움 0..1: 박동(대기 시작 쪽) → 재확인 시각(until) 사이 지금 자리. until 이 없으면 null */
export function jobWaitFill(job, nowMs) {
  if (!job || job.state !== 'waiting') return null;
  const u = tsOf(job.until);
  if (!Number.isFinite(u) || !Number.isFinite(nowMs)) return null;
  let b = tsOf(job.beatAt);
  if (!Number.isFinite(b) || b >= u) b = u - 15 * 60000;
  return Math.max(0, Math.min(1, (nowMs - b) / (u - b)));
}

/** 정체 표시등 '끊긴 맥박': 1.8초 주기에 짧게 두 번 켜지고 긴 쉼(0 = 꺼짐, 1 = 켜짐). reduced 면 늘 켜짐 */
export function staleBlink(tSec, reduced = false) {
  if (reduced) return 1;
  const u = ((tSec % 1.8) + 1.8) % 1.8;
  return (u < 0.16 || (u > 0.32 && u < 0.48)) ? 1 : 0;
}

/**
 * 카드 한 장의 그림 모델(3D·2D 공통) — 색은 열쇠로만 돌려준다.
 * @returns {{ code, key, dim, progress:number|null, wait:number|null, lamp:number(0..1), ended:boolean }}
 *   dim = 흐린 카드(줄 섬·대기), lamp = 표시등 밝기(진행 = 느린 숨쉬기, 정체 = 끊긴 맥박, 그 밖 늘 켜짐)
 */
export function jobCardModel(n, nowMs, tSec = 0, reduced = false) {
  const job = isJob(n) ? jobOf(n) : null;
  if (!job) return null;
  const code = jobCode(job, nowMs);
  const key = JOB_COLOR_KEY[code] || 'running';
  const ended = code === JOB_CODE.done || code === JOB_CODE.failed;
  const prog = jobProgress(job);
  const lamp = code === JOB_CODE.stale ? staleBlink(tSec, reduced)
    : code === JOB_CODE.running ? (reduced ? 1 : 0.6 + 0.4 * Math.sin(tSec * 3.2))
    : 1;
  return { code, key, dim: code === JOB_CODE.queued || code === JOB_CODE.waiting, progress: ended && prog == null ? null : prog, wait: jobWaitFill(job, nowMs), lamp, ended };
}

/** 이름표를 늘 붙일 작업인가: 끝나지 않은 작업(끝난 것은 포커스·호버 때만) */
export function jobLabelAlways(n, nowMs) {
  const job = jobOf(n);
  if (!job) return false;
  const c = jobCode(job, nowMs);
  return c !== JOB_CODE.done && c !== JOB_CODE.failed;
}

/** '#rrggbb' 두 색 섞기(k = b 쪽 몫). 꼴이 다르면 a 그대로 — 2D 평면도용 */
export function mixHex(a, b, k) {
  const p = (h) => (typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
  const A = p(a), B = p(b);
  if (!A || !B) return a;
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

/** 상태 열쇠 → 2D 색(CSS 토큰 문자열 · palette-hex). 3D vx-jobs.js jobColor 와 같은 규칙 */
export function jobColorHex(key, tok, pal) {
  switch (key) {
    case 'running': return tok.skill;
    case 'waiting': return pal.jobWait || pal.screenOn;
    case 'queued': return pal.jobQueue || pal.ledOff;
    case 'done': return tok.ok;
    case 'failed': return tok.error;
    case 'stale': return mixHex(tok.skill, tok.error, 0.45);
    default: return tok.skill;
  }
}

/** 판이 카메라 쪽으로 돌 수 있는 한계(기준 방향에서 ±) — 카드는 양면이라 뒤에서 봐도 앞면처럼 읽힌다 */
export const JOB_YAW_LIM = Math.PI / 3;
const wrapPi = (a) => { a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a; };

/**
 * 3D 판의 yaw: 기준 방향 face 에서 카메라 쪽(camYaw = 판 → 카메라 방향의 yaw, 0 = +z)으로 ±JOB_YAW_LIM 안에서 돈다.
 * 카메라가 판 뒤쪽 반면이면 뒷면(양면 카드)을 카메라에 맞춘다 — 어느 쪽에서 봐도 30° 넘게 비스듬하지 않다.
 */
export function jobBoardYaw(face, camYaw, lim = JOB_YAW_LIM) {
  if (!Number.isFinite(camYaw)) return face;
  let d = wrapPi(camYaw - face);
  if (Math.abs(d) > PI / 2) d = wrapPi(d - PI);
  return face + Math.max(-lim, Math.min(lim, d));
}
