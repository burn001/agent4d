// 복셀 2D 평면도 '분리 프로세스 = 생산 라인' — 3D(voxel/vx-procs.js)와 같은 순수 규칙(voxel/vx-proc-core.mjs)·같은 배치.
// 위에서 본 기계(굴뚝·경광등 점) · 레인마다 컨베이어 띠(흐르는 살) · 흐르는 상자 점 · 팔레트(묶음·낱개 칸) · 기계 옆 전광판(레인 숫자·처리율)
// · 들여다보기: 걸어가는 직원은 상태 머신 그대로(클립보드·✓ 표식은 voxel2d 캐릭터에서), 자리에서 보기·백그라운드 셸·Monitor 는 점선 빛줄.
// 돌린 방은 voxel2d 의 _rotBegin/_rotEnd 로 지역 좌표에서 그린다(글자는 _text 로 똑바로).
import { WatchTracker, isProc, procOf, procState, procJobId, jobOf } from '../job-core.mjs';
import { BAY, BELT_LEN, PALLET, laneDZ, machineDepth, bayLine, bayModel, boardModel, palletDigits, forkPose, WatchPlanner, watchErrands, stepFeeds, fmtInt } from '../voxel/vx-proc-core.mjs';
import { toLocal } from '../voxel/xf.mjs';

const FONT = '"Cascadia Mono", "Consolas", "D2Coding", monospace';
const _u = [];

/** 과열 색(0..1 연속, 2D 문자열) */
function heatHex(pal, h) {
  const a = h < 0.5 ? pal.heatCool : pal.heatWarm, b = h < 0.5 ? pal.heatWarm : pal.heatHot, k = h < 0.5 ? h / 0.5 : (h - 0.5) / 0.5;
  const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

export class Vx2DProcs {
  constructor(view) {
    this.v = view;
    this.feeds = new Map();
    this.watch = new WatchTracker();
    this.plan = new WatchPlanner();
    this._pulses = [];
    this.stats = { bays: 0, crates: 0, errands: 0, pulses: 0 };
  }
  clear() { this.feeds.clear(); this.watch.clear(); this.plan.clear(); }
  event(ev) { if (ev && ev.type === 'watch') this.watch.push(ev); }
  seedNode(node) { if (isProc(node)) this.watch.seed([node]); }
  dropNode(id) { this.feeds.delete(id); }

  /** 캐릭터 상태 머신 앞: 들여다보기 → 심부름, 라인 장부 */
  step(now, dt) {
    const v = this.v, clockMs = v.clock();
    const pulses = this._pulses = this.watch.pulses(clockMs);
    this.stats.errands = watchErrands(v, this.plan, pulses, now, clockMs);
    this.stats.pulses = pulses.length;
    const nm = v._nodeMap();
    const r = stepFeeds(v, this.feeds, (id) => nm.get(id), now, dt, v.reduced);
    this.stats.bays = r.bays; this.stats.crates = r.crates;
  }
  /** 다시 그려야 하나(0 = 아니, 1 = 15fps, 2 = 매 프레임) */
  animating(now) {
    if (this._pulses.length) return 2;
    let lv = 0;
    for (const f of this.feeds.values()) if (f.animating(now)) lv = 2;
    if (!lv && this.stats.bays) lv = 1; // 플라이휠·경광등·숫자 보간
    return lv;
  }

  /** 라인 하나(voxel2d _drawMachine 에서 라인 자리 기계면 이리로) */
  drawBay(ctx, m, v0, s, now) {
    const v = this.v, pal = v.pal, t = v.tokens, L = !!t.isLight;
    const n = m.node, nm = v._nodeMap();
    const jn = nm.get(procJobId(n));
    const job = jn ? jobOf(jn) : null;
    const clockMs = v.clock();
    const md = bayModel(procState(n), job, clockMs);
    const f = this.feeds.get(m.id);
    const nl = Math.max(1, Math.min(BAY.LANES, md.lanes.length || 1));
    const D = machineDepth(nl);
    const room = v.roomsById.get(m.pos.roomId);
    const rl = v._rotBegin(ctx, room);
    const rot = rl !== room;
    const lp = rot ? toLocal(room.xf, m.pos.x, m.pos.z) : m.pos;
    const X = v._X, Y = v._Y;
    const mx = lp.x, mz = lp.z, ln = bayLine(mx, m.pos.slot), dir = ln.dir;
    const rect = (x, z, w, d) => ctx.fillRect(X(x - w / 2), Y(z - d / 2), w * s, d * s);
    // 바닥 구역 + 안전 노란 띠
    const xa = Math.min(mx - dir * (BAY.MW / 2 + 0.25), ln.px + dir * (PALLET.W / 2 + 0.2)), xb = Math.max(mx - dir * (BAY.MW / 2 + 0.25), ln.px + dir * (PALLET.W / 2 + 0.2));
    const zw = Math.max(D, nl * BAY.DZ + 0.1) + 0.3;
    ctx.fillStyle = pal.metalDark; ctx.globalAlpha *= L ? 0.35 : 0.6; rect((xa + xb) / 2, mz, xb - xa, zw); ctx.globalAlpha /= L ? 0.35 : 0.6;
    ctx.fillStyle = pal.hazard; for (const sg of [-1, 1]) rect((xa + xb) / 2, mz + sg * (zw / 2 - 0.03), xb - xa, 0.06);
    // 컨베이어 띠(흐르는 살) · 상자 점 · 팔레트
    const bx0 = ln.x0;
    for (let i = 0; i < nl; i++) {
      const lz = mz + laneDZ(i, nl), lane = md.lanes[i] || null, r = f && lane ? f.lanes.get(lane.key) : null;
      ctx.fillStyle = pal.belt; rect((ln.x0 + ln.x1) / 2, lz, BELT_LEN, BAY.BELT_W);
      ctx.fillStyle = pal.metal; for (const sg of [-1, 1]) rect((ln.x0 + ln.x1) / 2, lz + sg * (BAY.BELT_W / 2 + 0.02), BELT_LEN, 0.03);
      if (s > 9) {
        const off = r ? r.off : 0, SP = 0.3, ph = ((off % SP) + SP) % SP;
        ctx.fillStyle = pal.lineTrim;
        for (let d = ph; d < BELT_LEN; d += SP) rect(bx0 + dir * d, lz, 0.03, BAY.BELT_W - 0.06);
      }
      if (f && lane) for (const u of f.cratesOf(lane.key, now, _u)) {
        const xx = bx0 + dir * (0.1 + u * (BELT_LEN - 0.2));
        ctx.fillStyle = pal.crate; rect(xx, lz, 0.22, 0.22);
        ctx.fillStyle = pal.crateBand; rect(xx, lz, 0.22, 0.05);
      }
      // 팔레트: 위에서 본 칸 — 묶음은 큰 칸(랩 띠), 낱개는 작은 칸
      const pv = r ? r.pallet : lane ? lane.value : 0;
      this._pallet(ctx, ln.px, lz, pv, pal, rect);
      if (lane && s > 14) { // 출구 위 레인 과열 띠
        ctx.fillStyle = heatHex(pal, lane.heat); rect(mx + dir * (BAY.MW / 2 + 0.03), lz, 0.06, 0.3);
      }
    }
    // 지게차(반출)
    if (f) for (const fk of f.forks) {
      const r = f.lanes.get(fk.key);
      if (!r || r.ord >= nl) continue;
      const P = forkPose(now - fk.t0);
      if (P.alpha <= 0.02) continue;
      const lz = mz + laneDZ(r.ord, nl), fx = ln.px + dir * P.dx;
      const a0 = ctx.globalAlpha; ctx.globalAlpha = a0 * P.alpha;
      if (P.carry) this._pallet(ctx, fx - dir * 0.5, lz, fk.value, pal, rect);
      ctx.fillStyle = pal.forklift; rect(fx + dir * 0.12, lz, 0.44, 0.36);
      ctx.fillStyle = pal.metalDark; rect(fx - dir * 0.33, lz - 0.1, 0.42, 0.05); rect(fx - dir * 0.33, lz + 0.1, 0.42, 0.05);
      ctx.globalAlpha = a0;
    }
    // 기계(위에서): 몸통 + 과열 테두리 + 굴뚝 + 플라이휠 + 경광등
    ctx.fillStyle = pal.lineBody; rect(mx, mz, BAY.MW, D);
    if (md.glow > 0.05 || md.state === 'failed') { ctx.strokeStyle = md.state === 'failed' ? t.error : heatHex(pal, md.heat); ctx.lineWidth = Math.max(1, 0.06 * s); ctx.strokeRect(X(mx - BAY.MW / 2), Y(mz - D / 2), BAY.MW * s, D * s); }
    ctx.fillStyle = pal.metalDark; rect(mx + dir * 0.28, mz - D / 2 + 0.18, 0.16, 0.16);
    if (s > 8) {
      const spin = f && f.lanes.size ? [...f.lanes.values()][0].off * 4.2 : 0;
      ctx.strokeStyle = pal.metal; ctx.lineWidth = Math.max(1, 0.05 * s);
      const cx = X(mx - dir * 0.18), cy = Y(mz + D / 2 - 0.05);
      ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = spin + (i * Math.PI) / 3; ctx.moveTo(cx - Math.cos(a) * 0.22 * s, cy - Math.sin(a) * 0.06 * s); ctx.lineTo(cx + Math.cos(a) * 0.22 * s, cy + Math.sin(a) * 0.06 * s); } ctx.stroke();
    }
    if (md.beacon !== 'off') {
      const on = md.beaconBlink && !v.reduced ? (Math.sin(now * Math.PI * 2 * md.beaconBlink) > -0.2 ? 1 : 0.3) : 1;
      ctx.fillStyle = md.beacon === 'red' ? t.error : md.beacon === 'amber' ? pal.heatWarm : md.beacon === 'green' ? t.ok : t.stopped;
      const a0 = ctx.globalAlpha; ctx.globalAlpha = a0 * on;
      ctx.beginPath(); ctx.arc(X(mx - dir * 0.32), Y(mz + D / 2 - 0.16), Math.max(1.5, 0.1 * s), 0, Math.PI * 2); ctx.fill();
      if (md.beacon === 'red' && on > 0.5 && !v.reduced) { ctx.globalAlpha = a0 * 0.25; ctx.beginPath(); ctx.arc(X(mx - dir * 0.32), Y(mz + D / 2 - 0.16), 0.3 * s, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = a0;
    }
    // 김(과열): 굴뚝에서 바깥(라인 반대쪽 뒤)으로 옅은 원
    if (md.steam > 0 && !v.reduced && s > 8) {
      const N = 2 + Math.round(md.steam * 4), a0 = ctx.globalAlpha;
      for (let i = 0; i < N; i++) {
        const u = (now * (0.32 + 0.35 * md.heat) + i / N) % 1;
        ctx.globalAlpha = a0 * 0.45 * (1 - u); ctx.fillStyle = pal.steam;
        ctx.beginPath(); ctx.arc(X(mx + dir * (0.28 + u * 0.3)), Y(mz - D / 2 + 0.18 - u * 0.9), (0.08 + u * 0.22) * s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = a0;
    }
    // 전광판(위에서 본 판 = 라인 뒤쪽 가장자리에 붙은 어두운 판, 가까우면 레인 숫자)
    const bw = BAY.BOARD_W, bh = 0.16 + 0.26 * nl;
    const bxc = mx + dir * 0.75, bzc = mz - D / 2 - bh / 2 - 0.12; // 컨베이어 쪽으로 비켜 — 뒤 서버랙·기동기 줄에 덮이지 않게
    ctx.fillStyle = pal.ledBoard; rect(bxc, bzc, bw, bh);
    const foc = v.focusId === m.id || v.hoverId === m.id || (jn && (v.focusId === jn.id || v.hoverId === jn.id));
    ctx.strokeStyle = foc ? t.text : (md.level === 'hot' ? heatHex(pal, md.heat) : pal.lineTrim); ctx.lineWidth = foc ? 1.5 : 1;
    ctx.strokeRect(X(bxc - bw / 2), Y(bzc - bh / 2), bw * s, bh * s);
    if (s > 16) {
      const bm = boardModel((procOf(n) && procOf(n).script) || n.label || n.id, job, md.state, clockMs);
      const fs = Math.max(7, Math.min(13, 0.2 * s));
      ctx.textBaseline = 'middle';
      const avail = (bw - 0.12) * s, gap = fs * 0.6;
      bm.rows.forEach((r, i) => {
        const yy = bzc - bh / 2 + 0.14 + (i + 0.5) * 0.26;
        // 판 폭에 맞춤: 값(+처리율) 먼저, 넘치면 처리율을 빼고, 남는 폭만큼 열쇠를 줄이거나 뺀다(겹쳐 그리지 않게)
        ctx.font = `700 ${fs}px ${FONT}`;
        let val = r.text + (r.rate ? '  ' + r.rate : '');
        if (r.rate && ctx.measureText(val).width > avail * 0.72) val = r.text;
        const vw = ctx.measureText(val).width;
        ctx.font = `500 ${fs}px ${FONT}`;
        let key = r.key.length > 12 ? r.key.slice(0, 11) + '…' : r.key;
        while (key && ctx.measureText(key).width + gap + vw > avail) key = key.length > 2 ? key.slice(0, -2) + '…' : '';
        if (key) { ctx.fillStyle = '#7fb8d9'; ctx.textAlign = 'left'; v._text(ctx, key, X(bxc - bw / 2 + 0.06), Y(yy)); }
        ctx.font = `700 ${fs}px ${FONT}`; ctx.fillStyle = r.heat >= 0.66 ? '#ff8a5c' : '#ffc23d'; ctx.textAlign = 'right';
        v._text(ctx, val, X(bxc + bw / 2 - 0.06), Y(yy));
      });
      if (!bm.rows.length) { ctx.font = `500 ${fs}px ${FONT}`; ctx.fillStyle = '#9fb0c4'; ctx.textAlign = 'center'; v._text(ctx, '…', X(bxc), Y(bzc)); }
    } else if (md.lanes.length) { // 멀면 레인 막대(값이 오를수록 노란 막대가 흐름)
      md.lanes.slice(0, nl).forEach((l, i) => { ctx.fillStyle = l.heat >= 0.66 ? '#ff8a5c' : '#ffc23d'; rect(bxc - bw / 2 + 0.1 + ((l.value / 997) % 1) * (bw - 0.3), bzc - bh / 2 + 0.14 + (i + 0.5) * 0.26, 0.1, 0.1); });
    }
    if (foc) { ctx.strokeStyle = t.text; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X(mx), Y(mz), 0.9 * s, 0, Math.PI * 2); ctx.stroke(); }
    v._rotEnd(ctx, room);
    void v0; void fmtInt;
  }
  _pallet(ctx, x, z, value, pal, rect) {
    ctx.fillStyle = pal.pallet; rect(x, z, PALLET.W, PALLET.W);
    if (!(value > 0)) return;
    const d = palletDigits(value);
    ctx.fillStyle = pal.crateBig;
    for (let i = 0; i < Math.min(4, d.big); i++) rect(x + (i % 2 ? 0.106 : -0.106), z + (i < 2 ? -0.106 : 0.106), 0.19, 0.19);
    if (d.big > 4) { ctx.fillStyle = pal.crateWrap; rect(x, z, PALLET.W * 0.9, 0.04); rect(x, z, 0.04, PALLET.W * 0.9); } // 2단 이상: 랩 띠
    if (d.small) { ctx.fillStyle = pal.crate; for (let i = 0; i < Math.min(9, d.small); i++) rect(x + ((i % 3) - 1) * 0.138, z + (Math.floor(i / 3) - 1) * 0.138, 0.1, 0.1); }
  }

  /** 자리에서 보기·백그라운드 셸·Monitor 들여다보기: 점선 빛줄(wait 열림 = 흐름), 끝 + 진행 = 되돌아오는 점. 캐릭터 위에 그린다 */
  drawPulses(ctx, now, s) {
    const v = this.v, plans = this.plan.plans, col = v.kindColor ? v.kindColor('bash-bg') : v.tokens.skill;
    for (const p of this._pulses) {
      const pl = plans.get(p.from);
      if (pl && pl.mode === 'walk' && pl.peer === p.to) continue;
      const m = v.machines.get(p.to), a = v.vis.get(p.from);
      if (!m || !m.pos || m.released || !a || !a.pos || a.hidden) continue;
      const x1 = v._X(a.pos.x), y1 = v._Y(a.pos.z), x2 = v._X(m.pos.x), y2 = v._Y(m.pos.z);
      const st = p.open ? 1 : p.strength;
      if (st < 0.03) continue;
      ctx.save();
      ctx.globalAlpha = (p.open ? 0.7 : 0.8) * st;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, 0.05 * s);
      ctx.setLineDash([Math.max(2, 0.25 * s), Math.max(2, 0.2 * s)]);
      ctx.lineDashOffset = p.open && p.kind === 'wait' && !v.reduced ? -now * 0.9 * s : 0;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
      if (!p.open && p.progress) {
        const u = 1 - st;
        ctx.fillStyle = v.tokens.ok; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(x2 + (x1 - x2) * u, y2 + (y1 - y2) * u, Math.max(2, 0.12 * s), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}
