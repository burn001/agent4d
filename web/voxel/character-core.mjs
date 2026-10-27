// 복셀 캐릭터 상태 머신(순수, three 없음). 3D(character.js drawCharacter)와 2D 평면도(flat/voxel2d.js)가 같이 쓴다.
//   spawn ─▶ enter ─▶ seated ⇄ walk ─▶ work ─▶ walk(return) ─▶ seated
//                       └──(done/error)──▶ leave ─▶ gone
import { pathBetween, pathLength, hashStr } from './layout.js';
import { STAND_CATS, breakDecision, BREAK, superviseAct } from './office-core.mjs';
import { runOf, runWorking, runVisStatus } from '../run-core.mjs'; // 실행 중 셸

const PI = Math.PI;
const WALK_SPEED = 3.5;
const TOOL_LINGER = 0.8;     // toolEnd 뒤 최소 작업 시간(벽시계 초)
const APPEAR = 0.4, VANISH = 0.5;
const MAX_TOOLS = 16;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Character {
  constructor(id, node, { lead = false } = {}) {
    this.id = id;
    this.node = node;
    this.lead = lead;
    this.hash = hashStr(id);
    this.side = ((this.hash % 7) - 3) / 10;    // ±0.3 옆 오프셋(겹침 완화)
    this.pos = { x: 0, z: 0 };
    this.yaw = 0;
    this.state = 'seated';      // enter|seated|walk|work|leave|gone|blink
    this.path = null; this.pi = 0;
    this.phase = (this.hash % 100) / 16;
    this.tools = [];            // {id, cat, tool, t0, end}
    this.target = null;         // {key, type:'desk'|'station', cat, spot, toolId}
    this.workCat = null;        // 지금 하는 작업 cat(없으면 앉아 쉼)
    this.inPlace = false;       // 시설 없이 제자리(머리 위 작은 상자)
    this.arrivedAt = 0;
    this.appearT0 = null; this.vanishT0 = null;
    this.endAt = null;
    this.flashUntil = 0; this.errFlashUntil = 0; this.errUntil = 0;
    this.seat = null; this.roomId = null; this.room = null;
    this.placed = false;        // 처음 자리 배정 받았는지
    this.spawnFrom = null;      // 'door'|'portal'|null(바로 앉힘)
    this.snapNext = false;      // 다음 목표로 걷지 않고 순간 이동
    this.goneAt = null;
    this.blinkEnd = 0;
    this.leaveAfter = 0;
    // 대기 동작: 도구 없이 지난 시간 → 탕비실 쉬러 가기
    this.lastBusy = null;       // 마지막으로 도구가 있던 시각
    this.breakUntil = 0;        // 팀원 커피 끝 시각
    this.cooldownUntil = 0;
    this.sup = null;            // 팀장 지휘·감독 중이면 {yaw(팀원 쪽), k(칸 안 진행)}
  }

  get present() { return this.state !== 'gone'; }

  addTool(id, cat, tool, now) {
    if (this.tools.some((t) => t.id === id)) return;
    this.tools.push({ id, cat: cat || 'other', tool, t0: now, end: null });
    if (this.tools.length > MAX_TOOLS) this.tools.splice(0, this.tools.length - MAX_TOOLS);
  }
  endTool(id, ok, now) {
    const t = this.tools.find((x) => x.id === id);
    if (t && t.end == null) t.end = now;
    if (ok === false) this.errFlashUntil = now + 0.6;
    return !!t;
  }

  /** 지금 효력 있는 가장 최근 도구 */
  currentTool(now) {
    let keep = 0;
    let cur = null;
    for (let i = this.tools.length - 1; i >= 0; i--) {
      const t = this.tools[i];
      const committed = this.target && this.target.toolId === t.id && (this.state === 'walk' || this.state === 'blink' || now < this.arrivedAt + TOOL_LINGER);
      const live = t.end == null || now < t.end + TOOL_LINGER || committed;
      if (live) { keep++; if (!cur) cur = t; }
    }
    if (this.tools.length > keep + 4) this.tools = this.tools.filter((t) => t.end == null || now < t.end + TOOL_LINGER + 2);
    return cur;
  }

  /** meta.run(전경)이 도는 중이면 가상의 셸 도구(이벤트로 받은 열린 셸이 있으면 그쪽이 먼저) */
  _runTool(ctx) {
    if (ctx.clockMs == null || !runOf(this.node) || this.node.meta.run.kind !== 'fg' || !runWorking(this.node, ctx.clockMs)) return null;
    const r = this._runT || (this._runT = { id: 'run:' + this.id, cat: 'shell', tool: 'Bash', t0: 0, end: null });
    r.tool = this.node.meta.run.tool || 'Bash';
    return r;
  }

  openCount() { let n = 0; for (const t of this.tools) if (t.end == null) n++; return n; }

  placeAt(p, face) { this.pos.x = p.x; this.pos.z = p.z; if (face != null) this.yaw = face; }

  /** 등장 준비: from = {x,z}(문 밖·포털 앞) */
  spawnAt(from, now) {
    this.placeAt(from, PI);
    this.appearT0 = now;
    this.state = 'enter';
    this.target = null;
  }

  /**
   * 한 프레임. ctx = { now, dt, ts(재생 속도), room, seat, stationSpot(ch,cat)→spot|null, releaseStation(ch), onError(ch), onArrive?(ch) }
   */
  update(ctx) {
    const { now, dt } = ctx;
    const ts = ctx.ts || 1;
    const node = this.node;
    const st = node.status;
    if (this.state === 'gone') return;
    if (!ctx.seat) return;
    this.seat = ctx.seat; this.room = ctx.room;
    // 1) 처음 배치
    if (!this.placed) {
      this.placed = true;
      if (this.spawnFrom && ts < 16) this.spawnAt(this.spawnFrom, now);
      else { this.placeAt(this.seat, this.seat.face); this.state = 'seated'; if (this.spawnFrom) this.appearT0 = now; }
    }
    // 2) 퇴장
    // forceLeave: 노드가 제거됨(node-remove) — 팀장도 자리에서 일어나 문으로 걸어 나간다
    const ended = this.forceLeave || (!this.lead && (st === 'done' || st === 'error' || st === 'stopped'));
    if (ended && this.state !== 'leave') {
      if (this.endAt == null) {
        this.endAt = now;
        this.leaveAfter = now + (this.forceLeave ? 0.15 : st === 'error' ? 2.0 : 0.6) / Math.min(4, Math.max(1, ts));
        if (st === 'error') { this.errUntil = now + 2; ctx.onError && ctx.onError(this); }
      }
      if (now >= this.leaveAfter) this._startLeave(ctx);
    } else if (!ended && (this.state === 'leave' || this.endAt != null)) {
      // 재개: 퇴장 취소
      this.endAt = null;
      if (this.state === 'leave') { this.state = 'walk'; this.target = null; this.vanishT0 = null; }
    }
    // 3) 목표
    if (this.state !== 'leave' && this.state !== 'enter' || (this.state === 'enter' && !this.target)) {
      if (this.state !== 'leave') this._decide(ctx);
    }
    // 4) 이동
    this._move(ctx);
    // 5) 퇴장 소멸
    if (this.vanishT0 != null && now - this.vanishT0 >= VANISH) { this.state = 'gone'; this.goneAt = now; ctx.releaseStation && ctx.releaseStation(this); }
    // yaw 보간
    const want = this._wantYaw();
    if (want != null) this.yaw += angDiff(this.yaw, want) * Math.min(1, dt * 10);
  }

  _wantYaw() {
    if (this.state === 'walk' || this.state === 'leave' || this.state === 'enter') {
      if (this.path && this.pi < this.path.length) {
        const q = this.path[this.pi];
        const dx = q.x - this.pos.x, dz = q.z - this.pos.z;
        if (dx * dx + dz * dz > 1e-4) return Math.atan2(dx, dz);
      }
      return null;
    }
    if (this.sup) return this.sup.yaw; // 팀원 쪽으로 몸을 돌린다
    if (this.target && this.target.spot && this.target.spot.face != null) return this.target.spot.face;
    return this.seat ? this.seat.face : null;
  }

  _decide(ctx) {
    this.sup = null;
    if (this.endAt != null) return; // 끝남: 하던 자리에서 마무리 후 퇴장
    const now = ctx.now;
    // 의뢰인 창구: 팀장이 스크린 앞으로(보고·질문) — 도구보다 먼저
    if (this.errand && this.errand.until > now && ctx.room) {
      const sp = this.errand.spot;
      const want = { key: 'errand:' + sp.x.toFixed(2) + ',' + sp.z.toFixed(2), type: 'errand', spot: sp, cat: null, toolId: null };
      ctx.releaseStation(this);
      if (!(this.target && this.target.key === want.key)) this._goTo(want, ctx);
      return;
    }
    if (this.errand) this.errand = null;
    // 라운지 방문(같은 파일 충돌): 정한 시각까지 캐비닛 앞 자리에 선다(도구보다 먼저)
    if (this.visit && this.visit.until > now && ctx.room && ctx.room.door) {
      const sp = this.visit.spot;
      const want = { key: 'visit:' + sp.x.toFixed(2) + ',' + sp.z.toFixed(2), type: 'visit', spot: sp, cat: null, toolId: null };
      ctx.releaseStation(this);
      if (!(this.target && this.target.key === want.key)) this._goTo(want, ctx);
      return;
    }
    if (this.visit) this.visit = null;
    // 전경 셸이 오래 도는 중(meta.run fg, 정체 아님)이면 도구 이벤트를 놓쳤어도(스냅샷·재생 중간) 셸 작업으로 본다 — 커피·대기 대신 작업
    const tool = this.currentTool(now) || this._runTool(ctx);
    if (tool || this.lastBusy == null) this.lastBusy = now;
    // 쉬러 가기: 팀장은 사람 입력을 기다리는 동안, 팀원은 도구 없이 오래 생각할 때 가끔 — 탕비실 커피
    if (!tool && ctx.breakSpot) {
      const onBreak = !!(this.target && this.target.type === 'break');
      const d = breakDecision({ lead: this.lead, status: ctx.clockMs != null ? runVisStatus(this.node, ctx.clockMs) : this.node.status, idleFor: now - this.lastBusy, hash: this.hash, ts: ctx.ts || 1, now, breakUntil: this.breakUntil, cooldownUntil: this.cooldownUntil, onBreak });
      if (d === 'go' || d === 'stay') {
        if (!onBreak) {
          const sp = ctx.breakSpot(this);
          if (sp) {
            ctx.releaseStation(this);
            const sq = Math.max(1, Math.sqrt(ctx.ts || 1));
            if (!this.lead) { this.breakUntil = now + BREAK.STAFF_DUR / sq; this.cooldownUntil = now + BREAK.COOLDOWN; }
            else { this.breakUntil = now + BREAK.LEAD_DUR / sq; this.cooldownUntil = now + BREAK.LEAD_COOLDOWN; } // 한 번 다녀오면 긴 쿨다운
            this._goTo({ key: 'break:' + sp.x.toFixed(2) + ',' + sp.z.toFixed(2), type: 'break', spot: sp, cat: null, toolId: null }, ctx);
            return;
          }
        } else return;
      }
    }
    // 지휘·감독: 자율 루프 팀장은 도구 없이 쉴 때 가끔 책상 옆으로 나와 일하는 팀원(회차) 쪽을 가리키며 둘러본다
    if (this.lead && !tool && ctx.crewOf && ctx.overseeSpot && (ctx.ts || 1) < BREAK.MAX_TS && this.node.status !== 'error') {
      const a = superviseAct(this.hash, now);
      const crew = a.on ? ctx.crewOf(this) : null;
      // 이번 칸에 볼 팀원 하나 — 자기 책상에 있는 팀원을 먼저(그 책상 앞 통로로). 모두 자리를 비웠으면 아무나(팀장 책상 곁에서)
      let c = null;
      if (crew && crew.length) {
        let nAt = 0;
        for (const e of crew) if (e.at) nAt++;
        if (nAt) { let i = a.slot % nAt; for (const e of crew) if (e.at && i-- === 0) { c = e; break; } } else c = crew[a.slot % crew.length];
      }
      const sp = c ? ctx.overseeSpot(this, c) : null;
      if (sp) {
        ctx.releaseStation(this);
        const key = 'oversee:' + sp.x.toFixed(2) + ',' + sp.z.toFixed(2);
        if (!(this.target && this.target.key === key)) this._goTo({ key, type: 'oversee', spot: sp, cat: null, toolId: null }, ctx);
        if (this.state === 'seated') this.sup = { yaw: Math.atan2(c.x - this.pos.x, c.z - this.pos.z), k: a.k };
        return;
      }
    }
    let want;
    if (!tool) want = { key: 'desk', type: 'desk', spot: this.seat, cat: null, toolId: null };
    else if (STAND_CATS.has(tool.cat)) want = { key: 'desk', type: 'desk', spot: this.seat, cat: tool.cat, toolId: tool.id };
    else {
      const spot = ctx.stationSpot(this, tool.cat);
      if (spot) want = { key: 'st:' + tool.cat + ':' + spot.x.toFixed(2) + ',' + spot.z.toFixed(2), type: 'station', spot, cat: tool.cat, toolId: tool.id };
      else want = { key: 'desk', type: 'desk', spot: this.seat, cat: tool.cat, toolId: tool.id, inPlace: true };
    }
    if (want.type !== 'station') ctx.releaseStation(this);
    // 자리가 바뀌었으면(재배치) 책상 목표도 새로
    const seatKey = this.seat ? this.seat.x.toFixed(2) + ',' + this.seat.z.toFixed(2) : '';
    if (want.type === 'desk') want.key = 'desk:' + seatKey;
    const same = this.target && this.target.key === want.key;
    if (same) {
      this.target.cat = want.cat; this.target.toolId = want.toolId; this.target.inPlace = !!want.inPlace;
    } else {
      this._goTo(want, ctx);
    }
    // 작업 표시
    const atTarget = this.state === 'seated' || this.state === 'work';
    if (atTarget) {
      this.workCat = this.target.cat;
      this.inPlace = !!this.target.inPlace || this.target.cat === 'other';
      this.state = this.workCat ? 'work' : 'seated';
    }
  }

  _goTo(want, ctx) {
    const ts = ctx.ts || 1;
    const now = ctx.now;
    const fromSeat = this.target && this.target.type === 'desk' && (this.state === 'seated' || this.state === 'work');
    const a = fromSeat ? this.seat : { x: this.pos.x, z: this.pos.z };
    const b = want.type === 'desk' ? this.seat : want.spot;
    const fromVisit = this.target && this.target.type === 'visit';
    this.target = want;
    this.workCat = null;
    // 라운지 방문: 방 안 → 문 → 문 밖 → 라운지 자리, 돌아올 때는 거꾸로(라운지는 방 밖이라 방 경계로 자르지 않음)
    const door = ctx.room && ctx.room.door;
    let path;
    if (want.type === 'visit' && door) path = [...pathBetween(a, door, ctx.room), door.out, b];
    else if (fromVisit && door && want.type !== 'visit') path = [{ x: this.pos.x, z: this.pos.z }, door.out, ...pathBetween(door, b, ctx.room)];
    else path = pathBetween(a, b, ctx.room);
    const speed = WALK_SPEED * clamp(ts, 1, 6);
    const est = pathLength(path) / speed;
    if (this.state === 'enter' && this.appearT0 != null && now - this.appearT0 < APPEAR) {
      // 등장 중: 경로만 잡아 두고 이어서 걷는다
      this.path = path; this.pi = 1;
      return;
    }
    if (this.snapNext || ts >= 16 || est < 0.05) {
      this.snapNext = false;
      this._arrive(b, now);
      return;
    }
    if (ts >= 8 && est > 1.2) { this.state = 'blink'; this.blinkEnd = now + 0.15; this.blinkTo = b; this.blinkT0 = now; return; }
    this.path = path; this.pi = 1;
    this.state = 'walk';
  }

  _arrive(b, now) {
    this.placeAt(b, b.face);
    this.path = null;
    this.arrivedAt = now;
    this.state = this.target && this.target.cat ? 'work' : 'seated';
    this.workCat = this.target ? this.target.cat : null;
    this.inPlace = !!(this.target && (this.target.inPlace || this.target.cat === 'other'));
  }

  _startLeave(ctx) {
    const ts = ctx.ts || 1;
    ctx.releaseStation(this);
    const door = ctx.room.door;
    const a = (this.state === 'seated' || this.state === 'work') && this.target && this.target.type === 'desk' ? this.seat : { x: this.pos.x, z: this.pos.z };
    this.state = 'leave';
    this.workCat = null;
    this.target = { key: 'leave', type: 'door', spot: door, cat: null, toolId: null };
    if (ts >= 16) { this.path = null; this.vanishT0 = ctx.now; return; }
    this.path = [...pathBetween(a, door, ctx.room), door.out];
    this.pi = 1;
  }

  _move(ctx) {
    const { now, dt } = ctx;
    const ts = ctx.ts || 1;
    if (this.state === 'blink') {
      if (now >= this.blinkEnd) this._arrive(this.blinkTo, now);
      return;
    }
    const moving = this.state === 'walk' || this.state === 'leave' || (this.state === 'enter' && (this.appearT0 == null || now - this.appearT0 >= APPEAR * 0.6));
    if (!moving || !this.path) {
      if (this.state === 'enter' && !this.path && (this.appearT0 == null || now - this.appearT0 >= APPEAR)) { this.state = 'seated'; this.target = null; }
      return;
    }
    let step = WALK_SPEED * clamp(ts, 1, 6) * dt;
    this.phase += dt * WALK_SPEED * clamp(ts, 1, 6) * 2.4;
    while (step > 0 && this.pi < this.path.length) {
      const q = this.path[this.pi];
      const dx = q.x - this.pos.x, dz = q.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d <= step) { this.pos.x = q.x; this.pos.z = q.z; step -= d; this.pi++; }
      else { this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step; step = 0; }
    }
    if (this.pi >= this.path.length) {
      if (this.state === 'leave') { if (this.vanishT0 == null) this.vanishT0 = now; this.path = null; return; }
      const b = this.target && (this.target.type === 'desk' ? this.seat : this.target.spot);
      if (b) this._arrive(b, now); else { this.state = 'seated'; this.path = null; }
    }
  }

  /** 크기(등장 0→1, 소멸 1→0) */
  scale(now) {
    let k = 1;
    if (this.appearT0 != null) { const a = (now - this.appearT0) / APPEAR; if (a < 1) k = Math.max(0.001, easeOutBack(Math.max(0, a))); else this.appearT0 = null; }
    if (this.vanishT0 != null) k *= Math.max(0.001, 1 - (now - this.vanishT0) / VANISH);
    if (this.state === 'blink') { const u = (now - this.blinkT0) / 0.15; k *= Math.max(0.05, Math.abs(1 - 2 * u)); }
    return k;
  }

  /** 카메라가 볼 점(머리 쪽) — 스탠딩 데스크라 늘 선 키 */
  headY() { return 1.55; }
  /** 자기 책상 앞에 서 있나(홀로그램 모니터를 펼칠 자리) */
  atDesk() { return (this.state === 'seated' || this.state === 'work') && !!this.target && this.target.type === 'desk'; }
}

const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

/** 팀장 lead 와 같은 방에서 자율 루프 팀원 책상(seat.kind 'op')에 있는 일하는 팀원들(out 재사용)
 *  항목 = {x, z(지금 위치), lx, lz(그 책상의 방 지역 좌표, 책상 앞 통로 감독 자리)}, 캐릭터마다 객체 하나를 다시 씀 */
export function crewSpots(chars, lead, out = []) {
  out.length = 0;
  for (const c of chars) {
    if (c === lead || c.room !== lead.room || !c.seat || c.seat.kind !== 'op') continue;
    if (c.state === 'gone' || c.state === 'leave' || c.endAt != null) continue;
    const e = c._crewE || (c._crewE = {});
    e.x = c.pos.x; e.z = c.pos.z;
    const at = c.atDesk(); // 자리를 비웠으면(시설로 걸어감) 책상 앞에 서도 빈 책상 — 책상 좌표를 주지 않아 예전 자리(팀장 책상 곁)에서 가리킴
    e.lx = at ? c.seat.deskLX : undefined; e.lz = at ? c.seat.deskLZ : undefined; e.at = at;
    out.push(e);
  }
  return out;
}
