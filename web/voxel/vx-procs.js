// 복셀 오피스 '분리 프로세스 = 생산 라인' 3D 그리기 — 규칙은 순수 vx-proc-core.mjs(2D 평면도도 같은 것).
//   · 기계(플라이휠이 돌고, 굴뚝 김·경광등·외벽 열기 = 과열) + 레인마다 컨베이어(무늬·부품이 처리율 속도로 흐름) + 팔레트(누적 압축 상자)
//   · 기계 위 전광판 = 캔버스 글 평면(풀 4장, 가까울 때만 글 — 값이 바뀔 때만 다시 그림). 판 틀 상자의 주인 = 자동 진행 작업 노드(집기·인스펙터)
//   · 들여다보기(watch): WatchTracker(공용) → WatchPlanner → 직원 심부름(클립보드 들고 기계 앞) 또는 자리에서 빛줄(desk·백그라운드 셸·Monitor)
// 그리기는 동적 상자 묶음(BoxBatch)에만 넣는다(그리기 호출 추가 = 전광판 글 평면 수). 돌린 방은 roomFrame 으로 지역 좌표에서 그린다.
import * as THREE from 'three';
import { roomFrame, endXf, partBox } from './props.js';
import { toLocal, xfAngle } from './xf.mjs';
import { isProc, procOf, procState, jobOf, WatchTracker, procJobId } from '../job-core.mjs';
import { BAY, BELT_LEN, PALLET, laneDZ, machineDepth, bayLine, bayModel, boardModel, palletDigits, palletBoxes, forkPose, WatchPlanner, boardYaw, watchErrands, stepFeeds } from './vx-proc-core.mjs';

const PI = Math.PI;
const BOARD_POOL = 4;
const TEXT_DIST = 70;          // 카메라가 이보다 가까울 때만 전광판 글
const _c = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color(), _heat = new THREE.Color();
const _pal = [];
const _u = [];

/** 과열 색(차가움 → 따뜻 → 뜨거움, 0..1 연속) */
function heatColor(pal, h, out) {
  if (h < 0.5) return out.copy(pal.heatCool).lerp(pal.heatWarm, h / 0.5);
  return out.copy(pal.heatWarm).lerp(pal.heatHot, (h - 0.5) / 0.5);
}

export class VxProcs {
  constructor(view) {
    this.v = view;
    this.feeds = new Map();          // 프로세스 id → BayFeed
    this.watch = new WatchTracker(); // 공용 들여다보기 기억
    this.plan = new WatchPlanner();
    this.boards = [];                // 전광판 글 평면 풀
    this.stats = { bays: 0, crates: 0, boards: 0, errands: 0, pulses: 0 };
    this._pulses = [];
  }
  clear() { this.feeds.clear(); this.watch.clear(); this.plan.clear(); for (const b of this.boards) { b.mesh.visible = false; b.sig = ''; } }
  /** app.onEvent 흐름(라이브·재생 같은 길): watch 이벤트만 */
  event(ev) { if (ev && ev.type === 'watch') this.watch.push(ev); }
  /** 노드가 처음 들어올 때: 열린 들여다보기(스냅샷 meta.proc.watch)로 채움 */
  seedNode(node) { if (isProc(node)) this.watch.seed([node]); }
  dropNode(id) { this.feeds.delete(id); }

  /**
   * 한 프레임(캐릭터 상태 머신 앞): 들여다보기 계획 → 직원 심부름, 라인 장부(상자·팔레트·지게차)
   */
  step(now, dt) {
    const v = this.v, clockMs = v.clock();
    const pulses = this._pulses = this.watch.pulses(clockMs);
    this.stats.errands = watchErrands(v, this.plan, pulses, now, clockMs);
    this.stats.pulses = pulses.length;
    const r = stepFeeds(v, this.feeds, (id) => v.nodes.get(id), now, dt, v.reduced);
    this.stats.bays = r.bays; this.stats.crates = r.crates;
  }

  /** 라인 하나 그리기(동적 묶음 B) */
  drawBay(m, B, now) {
    const v = this.v, pal = v.pal, tok = v.tokens, L = B.lit, G = B.glow;
    const light = !!tok.isLight;
    const n = m.node, id = m.id;
    const jn = v.nodes.get(procJobId(n));
    const job = jn ? jobOf(jn) : null;
    const jid = jn ? jn.id : id;
    const clockMs = v.clock();
    const md = bayModel(procState(n), job, clockMs);
    const f = this.feeds.get(id);
    const nl = Math.max(1, Math.min(BAY.LANES, md.lanes.length || 1));
    const D = machineDepth(nl);
    // 등장(0.5초 자라남)·퇴장(반납 전 0.8초 줄어듦)
    let k = m.appearT0 != null ? Math.min(1, Math.max(0.02, (now - m.appearT0) / 0.5)) : 1;
    if (m.endWall != null && Number.isFinite(m.heldUntil)) k = Math.min(k, Math.max(0.02, (m.heldUntil - now) / 0.8));
    const flash = Math.max(0, Math.min(1, (m.flashUntil - now) / 0.35));
    const room = v.roomsById.get(m.pos.roomId);
    const rot = !!(room && room.xf && room.xf.k && room.local);
    if (rot) roomFrame(room, B);
    const lp = rot ? toLocal(room.xf, m.pos.x, m.pos.z) : m.pos;
    const mx = lp.x, mz = lp.z;
    const t = now;
    const H = BAY.MH * k;
    // 바닥 구역: 어두운 깔판 + 안전 노란 테두리(라인 전체)
    const ln = bayLine(mx, m.pos.slot), dir = ln.dir;
    const x0 = Math.min(mx - dir * (BAY.MW / 2 + 0.25), ln.px + dir * (PALLET.W / 2 + 0.2)), x1 = Math.max(mx - dir * (BAY.MW / 2 + 0.25), ln.px + dir * (PALLET.W / 2 + 0.2)), zw = Math.max(D, nl * BAY.DZ + 0.1) + 0.3;
    L.box((x0 + x1) / 2, 0.012, mz, x1 - x0, 0.02, zw, pal.metalDark);
    for (const s of [-1, 1]) L.box((x0 + x1) / 2, 0.026, mz + s * (zw / 2 - 0.03), x1 - x0, 0.01, 0.05, pal.hazard);
    // 과열 색·외벽 열기
    heatColor(pal, md.heat, _heat);
    const body = _c.copy(pal.lineBody);
    if (md.glow > 0) body.lerp(_heat, md.glow * (light ? 0.14 : 0.1));
    if (md.state === 'stopped') body.lerp(tok.stopped, 0.5);
    if (md.state === 'failed') body.lerp(tok.error, 0.3);
    if (flash > 0) body.lerp(_c2.setRGB(1, 1, 1), flash * 0.5);
    // 기계 몸통 · 위 덮개 · 호퍼 · 굴뚝
    L.box(mx, H / 2, mz, BAY.MW, H, D, body, 0, id);
    L.box(mx, H + 0.03, mz, BAY.MW + 0.06, 0.06, D + 0.06, pal.lineTrim, 0, id);
    L.box(mx - dir * 0.18, H + 0.18, mz, 0.42, 0.24 * k, D * 0.55, pal.metal, 0, id);
    L.box(mx - dir * 0.18, H + 0.31, mz, 0.5, 0.04, D * 0.62, pal.lineTrim, 0, id);
    const chX = mx + dir * 0.28, chZ = mz - D / 2 + 0.18;
    L.box(chX, H + 0.32, chZ, 0.15, 0.64 * k, 0.15, pal.metalDark, 0, id);
    // 앞면(+z) 플라이휠: 돌아가면 돈다(처리율 비례), 정체·끝이면 멈춤
    const fz = mz + D / 2 + 0.035, fwx = mx - dir * 0.18, fwy = 0.56 * k;
    const spin = f ? (f.lanes.size ? [...f.lanes.values()][0].off * 4.2 : 0) : 0;
    for (let i = 0; i < 3; i++) partBox(L, null, fwx, fwy, fz, 0, 0, spin + (i * PI) / 3, 0, 0, 0, 0.5, 0.05, 0.03, pal.metal, id);
    for (let i = 0; i < 8; i++) { const a = spin + (i * PI) / 4; partBox(L, null, fwx + Math.cos(a) * 0.25, fwy + Math.sin(a) * 0.25, fz, 0, 0, a + PI / 2, 0, 0, 0, 0.2, 0.05, 0.04, pal.lineTrim, id); }
    L.box(fwx, fwy, fz + 0.02, 0.08, 0.08, 0.04, pal.hazard);
    // 앞면 오른쪽: 열기 환기 창살(과열이면 달아오름 — 라이트는 진한 잉크), 작은 상태 LED 줄
    for (let i = 0; i < 3; i++) {
      const y = (0.36 + i * 0.16) * k;
      if (md.glow > 0.05) {
        const hc = _c3.copy(_heat).multiplyScalar(light ? 0.85 : 0.35 + 0.65 * md.glow * (0.85 + 0.15 * Math.sin(t * 5 + i)));
        (light ? L : G).box(mx + dir * 0.28, y, fz, 0.3, 0.05, 0.02, hc);
      } else L.box(mx + dir * 0.28, y, fz, 0.3, 0.05, 0.02, pal.metalDark);
    }
    for (let i = 0; i < 4; i++) {
      const on = md.run ? (v.reduced ? 1 : (Math.floor(t * 6 + i * 1.3) % 3 ? 1 : 0)) : 0;
      G.box(mx + dir * (0.16 + i * 0.08), 0.98 * k, fz, 0.045, 0.045, 0.02, on ? pal.led : md.ended ? pal.ledOff : pal.ledIdle);
    }
    // 레인 출구(+x 면) · 컨베이어
    const bx0 = ln.x0, bx1 = ln.x1, bcx = (bx0 + bx1) / 2, px = ln.px;
    const by = 0.6 * k;
    for (let i = 0; i < nl; i++) {
      const lz = mz + laneDZ(i, nl);
      const lane = md.lanes[i] || null;
      const r = f && lane ? f.lanes.get(lane.key) : null;
      L.box(mx + dir * (BAY.MW / 2 + 0.012), by + 0.04, lz, 0.03, 0.22, 0.28, pal.metalDark, 0, id); // 출구
      L.box(mx + dir * (BAY.MW / 2 + 0.02), by + 0.17, lz, 0.05, 0.03, 0.32, lane ? heatColor(pal, lane.heat, _c3) : pal.lineTrim); // 출구 위 레인 과열 띠
      // 벨트 · 옆 레일 · 다리 · 끝 롤러
      L.box(bcx, by, lz, BELT_LEN, 0.04, BAY.BELT_W, pal.belt, 0, id);
      for (const s of [-1, 1]) L.box(bcx, by + 0.03, lz + s * (BAY.BELT_W / 2 + 0.02), BELT_LEN + 0.06, 0.07, 0.03, pal.metal, 0, id);
      for (const xx of [bx0 + dir * 0.15, bcx, bx1 - dir * 0.15]) for (const s of [-1, 1]) L.box(xx, by / 2, lz + s * 0.15, 0.04, by, 0.04, pal.metalDark);
      // 벨트 무늬(가로 살) — 벨트 위치(off)로 흐름
      const off = r ? r.off : 0, SP = 0.3;
      const ph = ((off % SP) + SP) % SP;
      for (let d = ph; d < BELT_LEN; d += SP) L.box(bx0 + dir * d, by + 0.022, lz, 0.03, 0.006, BAY.BELT_W - 0.05, pal.lineTrim);
      // 흐르는 부품(돌아가는 동안): 살 사이 작은 조각
      if (r && r.speed > 0.01 && md.run) {
        const PSP = 0.9, pp = ((off % PSP) + PSP) % PSP;
        for (let d = pp + 0.15; d < BELT_LEN - 0.05; d += PSP) L.box(bx0 + dir * d, by + 0.06, lz, 0.07, 0.07, 0.07, pal.crateWrap);
      }
      // 상자(진행 줄 하나 = 상자 하나)
      if (f && lane) for (const u of f.cratesOf(lane.key, now, _u)) {
        const xx = bx0 + dir * (0.1 + u * (BELT_LEN - 0.2));
        L.box(xx, by + 0.13, lz, 0.2, 0.2, 0.2, pal.crate, 0, id);
        L.box(xx, by + 0.13, lz, 0.205, 0.04, 0.205, pal.crateBand);
      }
      // 팔레트 + 쌓인 상자(묶음·낱개)
      const pv = r ? r.pallet : lane ? lane.value : 0;
      this._pallet(L, px, lz, pv, pal, id, 0, 1);
    }
    // 지게차 반출(새 회차·끝)
    if (f) for (const fk of f.forks) {
      const r = f.lanes.get(fk.key);
      if (!r || r.ord >= nl) continue;
      const lz = mz + laneDZ(r.ord, nl);
      const P = forkPose(now - fk.t0);
      const a = P.alpha;
      if (a <= 0.02) continue;
      const fx = px + dir * P.dx; // 지게차는 라인 바깥쪽에서 포크를 라인 쪽으로
      if (P.carry) this._pallet(L, fx - dir * 0.5, lz, fk.value, pal, null, P.lift, a);
      // 몸통·운전석 지붕·기둥(마스트)·포크
      L.box(fx + dir * 0.12, 0.2 * a, lz, 0.44 * a, 0.3 * a, 0.36 * a, pal.forklift);
      L.box(fx + dir * 0.2, 0.45 * a, lz, 0.26 * a, 0.03, 0.34 * a, pal.metalDark);
      for (const s of [-1, 1]) L.box(fx + dir * 0.2, 0.36 * a, lz + s * 0.15, 0.03, 0.2 * a, 0.03, pal.metalDark);
      L.box(fx - dir * 0.12, 0.45 * a, lz, 0.05, 0.85 * a, 0.3 * a, pal.metalDark);
      for (const s of [-1, 1]) L.box(fx - dir * 0.33, 0.05 + P.lift, lz + s * 0.1, 0.42 * a, 0.03, 0.06, pal.metalDark);
    }
    // 경광등(위): 과열 호박·빨강, 정체 노랑 깜빡, 실패 빨강 회전, 끝 초록, 중지 회색
    const bxl = mx - dir * 0.32, byl = H + 0.36, bzl = mz + D / 2 - 0.16;
    L.box(bxl, H + 0.27, bzl, 0.14, 0.06, 0.14, pal.metalDark, 0, id);
    if (md.beacon !== 'off') {
      const bc = md.beacon === 'red' ? tok.error : md.beacon === 'amber' ? pal.heatWarm : md.beacon === 'green' ? tok.ok : tok.stopped;
      const on = md.beaconBlink && !v.reduced ? (Math.sin(t * PI * 2 * md.beaconBlink) > -0.2 ? 1 : 0.25) : 1;
      G.box(bxl, byl, bzl, 0.11, 0.14, 0.11, _c.copy(bc).multiplyScalar(0.3 + 0.7 * on));
      if (md.beacon === 'red' && !v.reduced) { // 회전 빛살
        const a = t * 5;
        G.box(bxl + Math.sin(a) * 0.22, byl, bzl + Math.cos(a) * 0.22, 0.05, 0.05, 0.3, _c.copy(bc).multiplyScalar(0.8), a);
      }
    } else G.box(bxl, byl, bzl, 0.1, 0.12, 0.1, pal.ledOff);
    // 굴뚝 김(과열일수록 많고 빠름) — 돌아갈 때만
    if (md.steam > 0 && !v.reduced) {
      const N = 2 + Math.round(md.steam * 5), top = H + 0.66 * k;
      for (let i = 0; i < N; i++) {
        const u = (t * (0.32 + 0.35 * md.heat) + i / N) % 1;
        const sz = (0.1 + u * 0.32) * (1 - u * 0.55);
        const sc = _c.copy(pal.steam);
        if (md.level === 'hot' && u < 0.3) sc.lerp(_heat, 0.35 * (1 - u / 0.3));
        L.box(chX + dir * u * 0.35 + 0.06 * Math.sin(t * 1.7 + i * 2.1), top + u * 1.25, chZ + 0.05 * Math.cos(t + i), sz, sz, sz, sc, t * 0.4 + i);
      }
    }
    // 전광판 기둥·틀(틀의 주인 = 자동 진행 작업 — 누르면 그 작업 인스펙터)
    const s = Math.max(0, Math.min(BAY.MAX - 1, m.pos.slot | 0));
    const yB = BAY.BOARD_Y[s] * (0.6 + 0.4 * k);
    const cp = v.camera.position;
    const wy = boardYaw(xfAngle(rot ? room.xf : null), Math.atan2(cp.x - m.pos.x, cp.z - m.pos.z));
    const yawL = wy.yaw - xfAngle(rot ? room.xf : null);
    L.box(mx + 0.06, (H + 0.06 + yB - BAY.BOARD_H / 2) / 2, mz - D / 2 + 0.1, 0.06, Math.max(0.01, yB - BAY.BOARD_H / 2 - H - 0.06), 0.06, pal.metalDark);
    L.box(mx, yB, mz, BAY.BOARD_W + 0.08, BAY.BOARD_H * k + 0.08, 0.07, light ? pal.metalDark : pal.lineTrim, yawL, jid);
    const focus = v.focusId === jid || v.hoverId === jid || v.focusId === id || v.hoverId === id;
    if (focus) { // 포커스·호버: 판 테두리 빛
      const ex = Math.sin(yawL), ez = Math.cos(yawL), rx = Math.cos(yawL), rz = -Math.sin(yawL);
      for (const sx of [-1, 1]) G.box(mx + rx * sx * (BAY.BOARD_W / 2 + 0.06) + ex * 0.05, yB, mz + rz * sx * (BAY.BOARD_W / 2 + 0.06) + ez * 0.05, 0.03, BAY.BOARD_H + 0.1, 0.03, tok.text, yawL);
      G.box(mx + ex * 0.05, yB + BAY.BOARD_H / 2 + 0.06, mz + ez * 0.05, BAY.BOARD_W + 0.1, 0.03, 0.03, tok.text, yawL);
    }
    if (rot) endXf(B);
    // 글 평면(세계): 가까우면 캔버스, 멀면 빛 판으로 대신
    const far = Math.hypot(cp.x - m.pos.x, cp.y - yB, cp.z - m.pos.z) > TEXT_DIST || v._farAll;
    const bw = { x: m.pos.x + Math.sin(wy.yaw) * 0.045, y: yB, z: m.pos.z + Math.cos(wy.yaw) * 0.045, yaw: wy.yaw, k };
    return { far, bw, title: (procOf(n) && procOf(n).script) || n.label || n.id, job, pstate: md.state, id };
  }

  /** 팔레트 + 압축 상자 더미(묶음 = 랩 감은 큰 상자, 낱개 = 작은 상자) */
  _pallet(L, x, z, value, pal, id, lift = 0, a = 1) {
    L.box(x, (PALLET.H / 2) * a + lift, z, PALLET.W * a, PALLET.H * a, PALLET.W * a, pal.pallet, 0, id);
    if (!(value > 0)) return;
    const d = palletDigits(value);
    for (const b of palletBoxes(d, _pal)) {
      const s = b.s * a;
      L.box(x + b.dx * a, b.dy * a + lift, z + b.dz * a, s, s, s, b.big ? pal.crateBig : pal.crate, 0, id);
      if (b.big) { L.box(x + b.dx * a, b.dy * a + lift, z + b.dz * a, s + 0.006, s * 0.18, s + 0.006, pal.crateWrap); L.box(x + b.dx * a, b.dy * a + lift, z + b.dz * a, s * 0.18, s + 0.006, s + 0.006, pal.crateWrap); }
      else L.box(x + b.dx * a, b.dy * a + lift, z + b.dz * a, s + 0.004, s * 0.2, s + 0.004, pal.crateBand);
    }
  }

  /** 모든 라인 그리기 — office.js _drawDynamic 의 기계 줄에서(라인 자리 기계만 여기로 온다) */
  drawAll(B, now) {
    const want = this._want || (this._want = []);
    want.length = 0;
    for (const m of this.v.machines.values()) {
      if (m.released || !m.pos || m.pos.type !== 'proc') continue;
      if (this.v.scope.mode === 'all' && this.v._isDim(m.id)) continue;
      want.push(this.drawBay(m, B, now));
    }
    this._drawPulses(B.glow, now);
    this._syncBoards(want, now);
  }

  /** 전광판 글 평면: 가까운 판부터 풀 4장, 내용(sig)이 바뀔 때만 캔버스 다시 */
  _syncBoards(want, now) {
    const v = this.v, clockMs = v.clock();
    const near = want.filter((w) => !w.far);
    const cp = v.camera.position;
    near.sort((a, b) => Math.hypot(a.bw.x - cp.x, a.bw.z - cp.z) - Math.hypot(b.bw.x - cp.x, b.bw.z - cp.z));
    let used = 0;
    for (const w of near.slice(0, BOARD_POOL)) {
      let b = this.boards.find((x) => x.owner === w.id) || this.boards.find((x) => !x._taken && !near.some((q) => q.id === x.owner));
      if (!b && this.boards.length < BOARD_POOL) b = this._newBoard();
      if (!b) break;
      b._taken = true; b.owner = w.id;
      const bm = boardModel(w.title, w.job, w.pstate, clockMs);
      if (bm.sig !== b.sig || (now - b.at > 0.25 && bm.rows.some((r) => r.rate))) { if (bm.sig !== b.sig) { this._paint(b, bm); b.sig = bm.sig; } b.at = now; }
      b.mesh.visible = true;
      b.mesh.position.set(w.bw.x, w.bw.y, w.bw.z);
      b.mesh.rotation.set(0, w.bw.yaw, 0);
      b.mesh.scale.set(BAY.BOARD_W, BAY.BOARD_H * w.bw.k, 1);
      const fa = v._fxA ? v._fxA(w.bw.x, w.bw.z) : 1; // 프로젝트 페이드
      b.mesh.material.opacity = fa; b.mesh.material.transparent = fa < 1;
      if (fa <= 0.02) b.mesh.visible = false;
      used++;
    }
    for (const b of this.boards) { if (!b._taken) { b.mesh.visible = false; b.owner = null; } b._taken = false; }
    // 먼 판: 글 대신 빛 판(레인 줄 막대) — 동적 묶음은 이미 끝났으므로 다음 프레임 그림에 넣지 않고 여기서는 표시만 생략
    this.stats.boards = used;
  }
  _newBoard() {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 240;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 3;
    mesh.visible = false;
    mesh.raycast = () => {};
    this.v.scene.add(mesh);
    const b = { cv, ctx: cv.getContext('2d'), tex, mesh, sig: '', owner: null, at: 0, _taken: false };
    this.boards.push(b);
    return b;
  }
  /** 전광판 캔버스: 어두운 LED 판(두 테마 같은 판 — 실제 전광판처럼) */
  _paint(b, bm) {
    const g = b.ctx, W = b.cv.width, Hh = b.cv.height;
    g.fillStyle = '#070a0f'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 2; y < Hh; y += 4) g.fillRect(0, y, W, 1);
    const FONT = '"Cascadia Mono", "Consolas", "D2Coding", monospace';
    const hcol = bm.level === 'hot' ? '#ff6a3d' : bm.level === 'warm' ? '#ffb02e' : '#3fe0c5';
    const stc = bm.state === 'failed' ? '#ff4d4f' : bm.state === 'done' ? '#3ddc84' : bm.state === 'stopped' ? '#8a94a3' : bm.state === 'stale' ? '#ffd24a' : hcol;
    // 머리: 상태 점 · 제목(스크립트) · 과열 막대
    g.fillStyle = stc; g.beginPath(); g.arc(20, 24, 8, 0, PI * 2); g.fill();
    g.font = `600 24px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#c9d4e3';
    g.fillText(fit(g, bm.title, 300), 38, 25);
    const hw = 120, hx = W - hw - 16;
    g.fillStyle = '#1b2230'; g.fillRect(hx, 17, hw, 14);
    g.fillStyle = hcol; g.fillRect(hx, 17, Math.max(3, hw * bm.heat), 14);
    g.strokeStyle = '#3a4456'; g.lineWidth = 1; g.strokeRect(hx + 0.5, 17.5, hw - 1, 13);
    // 레인 줄
    const rows = bm.rows.length ? bm.rows : [{ key: '…', text: '', unit: '', rate: '', ratio: null, heat: 0 }];
    const rh = Math.min(64, (Hh - 82) / Math.max(1, rows.length));
    rows.forEach((r, i) => {
      const y = 52 + i * rh + rh / 2;
      g.textAlign = 'left'; g.font = `500 ${Math.round(rh * 0.36)}px ${FONT}`; g.fillStyle = '#7fb8d9';
      g.fillText(fit(g, r.key + (r.pass > 1 ? ` #${r.pass}` : ''), 168), 14, y);
      g.textAlign = 'right'; g.font = `700 ${Math.round(rh * 0.62)}px ${FONT}`; g.fillStyle = r.heat >= 0.66 ? '#ff8a5c' : '#ffc23d';
      const unitW = r.unit ? 50 : 0;
      g.fillText(r.text, W - 112 - unitW, y + 1);
      if (r.unit) { g.font = `500 ${Math.round(rh * 0.32)}px ${FONT}`; g.fillStyle = '#d8a83a'; g.textAlign = 'left'; g.fillText(fit(g, r.unit, 48), W - 108 - unitW + 4, y + 4); }
      g.textAlign = 'right'; g.font = `500 ${Math.round(rh * 0.34)}px ${FONT}`; g.fillStyle = '#8aa0b8';
      g.fillText(r.rate || '', W - 12, y + 2);
      if (r.ratio != null) { // 진행 막대
        g.fillStyle = '#1b2230'; g.fillRect(150, y + rh * 0.36, W - 280, 5);
        g.fillStyle = '#3ddc84'; g.fillRect(150, y + rh * 0.36, (W - 280) * r.ratio, 5);
      }
    });
    // 바닥 줄: ETA · 구석 최장 시간 · 넘친 레인
    g.font = `500 19px ${FONT}`; g.textBaseline = 'alphabetic';
    g.textAlign = 'left'; g.fillStyle = '#9fb0c4';
    const foot = [bm.eta ? 'ETA ' + bm.eta : '', bm.extra ? `+${bm.extra}` : ''].filter(Boolean).join('  ');
    if (foot) g.fillText(foot, 14, Hh - 12);
    if (bm.corner) { g.textAlign = 'right'; g.fillStyle = bm.level === 'hot' ? '#ff8a5c' : '#9fb0c4'; g.fillText(bm.corner, W - 12, Hh - 12); }
    g.strokeStyle = stc; g.lineWidth = 3; g.globalAlpha = 0.55; g.strokeRect(1.5, 1.5, W - 3, Hh - 3); g.globalAlpha = 1;
    b.tex.needsUpdate = true;
  }

  /** 자리에서 보기·백그라운드 셸·Monitor 의 들여다보기 빛줄: 읽는 쪽 → 전광판(wait 열림 = 계속 흐름, peek·끝 = 짧은 빛, 진행 줄이면 숫자 패킷이 돌아옴) */
  _drawPulses(G, now) {
    const v = this.v, plans = this.plan.plans;
    const col = v.tokens['k-bash-bg'] || v.tokens.skill;
    for (const p of this._pulses) {
      const pl = plans.get(p.from);
      if (pl && pl.mode === 'walk' && pl.peer === p.to) continue; // 걸어가는 직원은 몸으로 보여 줌
      const m = this.v.machines.get(p.to);
      if (!m || !m.pos || m.released) continue;
      const a = this._at(p.from);
      if (!a) continue;
      const bx = m.pos.x, by = m.pos.type === 'proc' ? BAY.BOARD_Y[Math.min(BAY.MAX - 1, m.pos.slot | 0)] : 2.1, bz = m.pos.z;
      const dx = bx - a.x, dy = by - a.y, dz = bz - a.z, len = Math.hypot(dx, dy, dz);
      if (len < 0.5) continue;
      const st = p.strength;
      const n = Math.max(4, Math.min(18, Math.round(len / 0.7)));
      const flow = p.open && p.kind === 'wait' && !v.reduced ? (now * 0.8) % 1 : 0;
      for (let i = 0; i < n; i++) {
        const u = (i + flow) / n;
        if (u > 1) continue;
        const arc = Math.sin(u * PI) * Math.min(1.2, len * 0.12);
        const s = p.open ? (p.kind === 'wait' ? 0.05 : 0.07) : 0.07 * st;
        if (s < 0.01) continue;
        G.box(a.x + dx * u, a.y + dy * u + arc, a.z + dz * u, s, s, s, _c.copy(col).multiplyScalar(p.open ? 0.75 : 0.4 + 0.6 * st));
      }
      if (!p.open && p.progress && st > 0.05) { // 숫자 패킷: 전광판 → 읽는 쪽
        const u = 1 - st, arc = Math.sin(u * PI) * Math.min(1.2, len * 0.12);
        G.box(bx - dx * u, by - dy * u + arc, bz - dz * u, 0.14, 0.14, 0.14, v.tokens.ok, now * 3);
      }
    }
  }
  _at(id) {
    const v = this.v, ch = v.chars.get(id);
    const o = this._atO || (this._atO = { x: 0, y: 0, z: 0 });
    if (ch) { if (!ch.placed || ch.state === 'gone' || ch.offstage || v._isDim(id)) return null; o.x = ch.pos.x; o.y = 1.45; o.z = ch.pos.z; return o; }
    const m = v.machines.get(id);
    if (m && m.pos && !m.released && !v._isDim(id)) { o.x = m.pos.x; o.y = m.pos.type === 'rack' ? 2.05 : (m.pos.y || 0) + 0.5; o.z = m.pos.z; return o; }
    return null;
  }

  dispose() {
    for (const b of this.boards) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.tex.dispose(); }
    this.boards = [];
  }
}

/** 글을 폭에 맞춰 자름(…) */
function fit(g, s, w) {
  s = String(s || '');
  if (g.measureText(s).width <= w) return s;
  while (s.length > 1 && g.measureText(s + '…').width > w) s = s.slice(0, -1);
  return s + '…';
}
