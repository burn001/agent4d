// 복셀 오피스·연구소 effort = 캐릭터 옷차림 + 자리 분위기 — 순수 규칙(web/voxel/vx-effort-core.mjs) + 소스 연결 확인. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EFFORT, EffortTween } from '../effort-core.mjs';
import { appearance } from '../voxel/appearance-core.mjs';
import {
  VX_EFF, VX_EFF_KINDS, EFF_HEX, vxEffort, ghostOf, vxEffortState, effKey, dress, jacketOn, body2D, deskProps, labPropsOk,
  leftAxis, labFwd, labLeftAxis, deskToWorld,
} from '../voxel/vx-effort-core.mjs';

const N = (kind, meta = {}, id = 'n:' + kind) => ({ id, kind, status: 'active', meta });
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const NAMES = ['low', 'medium', 'high', 'xhigh', 'max'];
/** '#rrggbb' → 크로마(최대 − 최소, 0..1) — 밝은 색에서 부풀지 않는 '색기' 척도 */
function sat(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return Math.max(...v) - Math.min(...v);
}

test('vxEffort: 메인 포함(복셀 예외) · 하위 노드 · 독립 claude -p 루트, 미상·미지정·대상 아닌 종류는 null · xhigh = max(4)', () => {
  assert.deepEqual([...VX_EFF_KINDS].sort(), ['claude-p', 'main', 'subagent', 'workflow-agent']);
  NAMES.forEach((v, i) => {
    for (const kind of ['main', 'subagent', 'workflow-agent', 'claude-p']) assert.deepEqual(vxEffort(N(kind, { effort: v })), { level: [1, 2, 3, 4, 4][i], confirmed: true }, kind + v);
  });
  assert.deepEqual(vxEffort(N('subagent', { effortReq: 'high' })), { level: 3, confirmed: false });
  assert.deepEqual(vxEffort({ id: 'r', kind: 'main', meta: { effort: 'low', orphanSdk: true } }), { level: 1, confirmed: true }, '독립 claude -p 루트');
  assert.equal(vxEffort(N('subagent', { effort: 'ultra' })), null, '모르는 단계 이름 = 지금 모습(글만)');
  assert.equal(vxEffort(N('subagent', {})), null);
  assert.equal(vxEffort(N('bash-bg', { effort: 'high' })), null);
  assert.equal(vxEffort(null), null);
});

test('ghostOf·vxEffortState: 요청값만 = 옅게(GHOST), 확정 0.4초 동안 GHOST_STEPS 로 끊어 진해짐 · 동작 줄이기·8배속은 즉시', () => {
  assert.equal(ghostOf(0), VX_EFF.GHOST);
  assert.equal(ghostOf(1), 0);
  assert.equal(ghostOf(NaN), 0);
  const vals = new Set();
  for (let c = 0; c <= 1.0001; c += 0.01) vals.add(ghostOf(c));
  assert.equal(vals.size, VX_EFF.GHOST_STEPS + 1, '끊은 값 수(외형을 다시 만드는 횟수 상한)');
  const tw = new EffortTween();
  const n = N('subagent', { effortReq: 'xhigh' }, 's:1');
  let st = vxEffortState(n, tw, 1000);
  assert.deepEqual([st.level, st.ghost], [4, VX_EFF.GHOST]);
  n.meta.effort = 'xhigh';
  st = vxEffortState(n, tw, 1100);
  assert.ok(st.ghost === VX_EFF.GHOST && st.busy, '확정 순간: 옅은 데서 출발');
  st = vxEffortState(n, tw, 1100 + EFFORT.TWEEN_MS / 2);
  assert.ok(st.ghost > 0 && st.ghost < VX_EFF.GHOST);
  st = vxEffortState(n, tw, 1100 + EFFORT.TWEEN_MS + 1);
  assert.ok(st.ghost === 0 && !st.busy);
  n.meta.effort = 'low';
  assert.equal(vxEffortState(n, tw, 1200).level, 1, '단계 바뀜은 옷을 바로 갈아입음');
  const m = N('subagent', { effortReq: 'high' }, 's:2');
  vxEffortState(m, tw, 0); m.meta.effort = 'high';
  assert.equal(vxEffortState(m, tw, 10, { reduced: true }).ghost, 0);
  const q = N('subagent', { effortReq: 'high' }, 's:3');
  vxEffortState(q, tw, 0); q.meta.effort = 'high';
  assert.equal(vxEffortState(q, tw, 10, { rate: 8 }).ghost, 0);
  assert.equal(vxEffortState(N('subagent', {}), tw, 0), null);
  assert.equal(effKey(null, 'office'), '');
  assert.notEqual(effKey({ level: 3, ghost: 0 }, 'office'), effKey({ level: 3, ghost: 0 }, 'lab'));
});

test('dress: medium·null·운영자·손님은 그대로(같은 객체), 원래 외형은 바꾸지 않음', () => {
  const A = appearance('a:1', 'staff');
  const snap = JSON.stringify(A);
  assert.equal(dress(A, 2), A);
  assert.equal(dress(A, null), A);
  for (const lv of [1, 3, 4]) for (const venue of ['office', 'lab']) dress(A, lv, { venue });
  assert.equal(JSON.stringify(A), snap);
  for (const role of ['operator', 'guest']) { const B = appearance('x', role); assert.equal(dress(B, 4), B); }
  assert.deepEqual(dress(A, 4), dress(A, 4), '결정적');
});

test('dress 오피스 팀원: low 반팔·반바지·슬리퍼 → high 셔츠+조끼 → xhigh·max 재킷+넥타이, 같은 색 정장+헤드셋', () => {
  for (let i = 0; i < 60; i++) {
    for (const role of ['staff', 'wf']) {
      const A = appearance('a:' + i, role);
      const lo = dress(A, 1);
      assert.equal(lo.shoe, 'slide');
      assert.ok(lo.neckPhones && !lo.phones, '헤드폰은 목에(머리에 쓴 것도 내려 걺)');
      if (A.phones) assert.equal(lo.neckPhones, A.phones);
      if (A.top !== 'dress') assert.equal(lo.top, 'tee');
      if (A.bottom !== 'skirt' && A.bottom !== 'dress') assert.equal(lo.bottom, 'shorts');
      const hi = dress(A, 3);
      assert.ok(hi.top === 'shirt' && hi.waist && hi.jacket === false && !hi.headset && hi.bottom !== 'dress');
      assert.equal(jacketOn(hi, role), false);
      const mx = dress(A, 4);
      assert.ok(mx.top === 'suit3' && mx.jacket === true && mx.waist && mx.neck === (A.sex === 'f' ? 'bow' : 'tie'));
      assert.ok(!mx.hat && !mx.phones && !mx.pack);
      assert.ok(EFF_HEX.jacket.includes(mx.topC) && EFF_HEX.shirt.includes(mx.top2C));
      assert.ok(mx.headset && mx.bottomC === mx.topC && (mx.shoe === 'oxford' || mx.shoe === 'loafer'));
      assert.ok(mx.bottom === 'slacks' || mx.bottom === 'skirt');
    }
  }
});

test('dress 오피스 팀장(정장 기본, 같은 언어): low 셔츠 바람+슬리퍼 · high 조끼 바람 · xhigh·max 쓰리피스 + 헤드셋', () => {
  for (let i = 0; i < 40; i++) {
    for (const role of ['lead', 'annex']) {
      const A = appearance('m:' + i, role);
      const lo = dress(A, 1);
      assert.ok(lo.top === 'shirt' && lo.jacket === false && lo.neck == null && lo.shoe === 'slide' && lo.topC === A.top2C && lo.neckPhones);
      const hi = dress(A, 3);
      assert.ok(hi.top === 'shirt' && hi.jacket === false && hi.waist && hi.neck === A.neck, '넥타이는 그대로');
      assert.equal(jacketOn(hi, role), false);
      const xh = dress(A, 4);
      assert.ok(xh.top === 'suit3' && xh.waist && xh.jacket === undefined && xh.topC === A.topC && xh.headset);
      assert.equal(jacketOn(xh, role), true, '역할 기본 재킷');
    }
  }
});

test('dress 연구소: high 실험복 열림 · xhigh·max 잠금+고글(눈)+장갑+마스크, 팀장도 같은 차림', () => {
  for (let i = 0; i < 40; i++) for (const role of ['staff', 'lead']) {
    const A = appearance('l:' + i, role), o = { venue: 'lab' };
    assert.equal(dress(A, 1, o).shoe, 'slide');
    const hi = dress(A, 3, o), mx = dress(A, 4, o);
    assert.ok(hi.coat === 'open' && !hi.goggle && !hi.pack && hi.top === A.top, '안 옷은 그대로(앞섶 사이로 보임)');
    assert.ok(mx.coat === 'closed' && mx.goggle === 'eyes' && mx.glove && mx.mask && mx.glasses == null && !mx.hat && !mx.phones);
    assert.equal(body2D(hi, role), EFF_HEX.coat);
  }
});

test('네 단계가 서로 다른 차림(오피스·연구소, 팀원·팀장) — 실루엣 열쇠가 겹치지 않음 · xhigh 와 max 는 같은 차림', () => {
  const key = (D, role) => [D.top === 'shirt' ? 'shirt' : D.top === 'tee' ? 'tee' : jacketOn(D, role) ? 'jacket' : 'casual', D.shoe === 'slide' ? 'slide' : '-', D.neckPhones ? 'np' : '-', D.waist ? 'w' : '-', D.headset ? 'h' : '-', D.coat || '-', D.goggle || '-', D.mask ? 'm' : '-'].join('|');
  for (const venue of ['office', 'lab']) for (const role of ['staff', 'lead']) for (let i = 0; i < 30; i++) {
    const A = appearance('k:' + i, role);
    const ks = [1, 2, 3, 4].map((lv) => key(dress(A, lv, { venue }), role));
    assert.equal(new Set(ks).size, 4, `${venue} ${role} ${i}: ${ks.join(' / ')}`);
    const [x, m] = ['xhigh', 'max'].map((v) => dress(A, vxEffort(N(role === 'lead' ? 'main' : 'subagent', { effort: v })).level, { venue }));
    assert.deepEqual(x, m, `${venue} ${role} ${i}: xhigh = max`);
  }
});

test('단계 옷·소품 색은 무채·저채도(상태색·과열 물듦과 겹치지 않음), 스탠드 색온도는 따뜻 → 차가움', () => {
  const garments = [...EFF_HEX.jacket, ...EFF_HEX.vest, ...EFF_HEX.shirt, ...EFF_HEX.tie, EFF_HEX.coat, EFF_HEX.coatShade, EFF_HEX.goggle, EFF_HEX.lens, EFF_HEX.glove, EFF_HEX.mask, EFF_HEX.headset, EFF_HEX.mic, EFF_HEX.neckPhones, ...EFF_HEX.can];
  for (const h of garments) assert.ok(sat(h) < 0.2, h + ' 크로마 ' + sat(h).toFixed(2));
  const rb = (h) => parseInt(h.slice(1, 3), 16) - parseInt(h.slice(5, 7), 16);
  assert.deepEqual(Object.keys(EFF_HEX.lamp), ['3', '4'], '스탠드는 high·맨 위 두 색');
  assert.ok(rb(EFF_HEX.lamp[3]) > 0 && rb(EFF_HEX.lamp[4]) < 0);
  for (const lv of [3, 4]) assert.ok(sat(EFF_HEX.lamp[lv]) < 0.25 && parseInt(EFF_HEX.lamp[lv].slice(1, 3), 16) > 0xd0, '백색 계열(호박 아님)');
});

test('deskProps: 소품 밀도 low 1(캔) · medium 0 · high < xhigh·max, 스탠드는 high 부터, 상판 안·가운데 손 자리 비움', () => {
  assert.equal(deskProps(2).boxes, 0);
  assert.equal(deskProps(null).boxes, 0);
  const lo = deskProps(1);
  assert.equal(lo.boxes, 1); assert.equal(lo.lamp, null);
  const b = [3, 4].map((lv) => deskProps(lv).boxes);
  assert.ok(b[0] < b[1], b.join(','));
  for (const [hw, hd] of [[0.65, 0.35], [0.55, 0.35], [1.0, 0.35]]) for (const lv of [1, 3, 4]) {
    const P = deskProps(lv, { hw });
    assert.equal(P.lamp, EFF_HEX.lamp[lv] || null);
    for (const it of P.items) {
      assert.ok(Math.abs(it.u) + it.sx / 2 <= hw + 1e-9 && Math.abs(it.v) + it.sz / 2 <= hd + 1e-9, `상판 안 ${lv} ${JSON.stringify(it)}`);
      if (!it.pool) assert.ok(Math.abs(it.u) - it.sx / 2 >= 0.15 - 1e-9, `가운데 비움 ${lv} ${it.c}`);
    }
    assert.equal(P.items.filter((it) => it.bulb).length, P.lamp ? 1 : 0);
  }
  // 정적 스탠드가 있는 오피스 팀장 책상: 기둥·갓 없이 전구만, 소품은 안쪽
  const L = deskProps(4, { hw: 1.0, lampAt: { u: 0.67, v: -0.15 } });
  assert.equal(L.items.filter((it) => it.pole).length, 0);
  const bulb = L.items.find((it) => it.bulb);
  assert.ok(near(bulb.u, 0.67) && near(bulb.v, -0.15));
  for (const it of L.items) if (!it.glow) assert.ok(Math.abs(it.u) < 0.75, '정적 스탠드(0.75)·화분(−0.8)과 안 겹침');
  assert.equal(deskProps(4, { hw: 1.0, lampAt: { u: 0.67, v: -0.15 } }).boxes, deskProps(4).boxes - 1, '기둥 없음(갓 대신 전구)');
  assert.equal(labPropsOk(200, 40), true);
  assert.equal(labPropsOk(230, 20), false);
});

test('좌표: 오피스(+z 를 봄) 왼쪽 = +x, 연구소 θ 앞 = −(sinθ, cosθ) · 왼쪽 = (−cosθ, sinθ), deskToWorld', () => {
  const L = leftAxis(0, 1);
  assert.ok(near(L.x, 1) && near(L.z, 0));
  for (const deg of [0, 37, 90, 200]) {
    const a = (deg * Math.PI) / 180, l = labLeftAxis(a), f = labFwd(a);
    assert.ok(near(l.x, -Math.cos(a)) && near(l.z, Math.sin(a)), String(deg));
    assert.ok(near(f.x, -Math.sin(a)) && near(f.z, -Math.cos(a)));
  }
  const w = deskToWorld(10, 5, { x: 0, z: 1 }, 0.3, 0.2);
  assert.ok(near(w.x, 10.3) && near(w.z, 5.2));
});

test('body2D: 실험복 > 재킷 > 조끼 > 윗옷', () => {
  const A = appearance('b:1', 'staff');
  assert.equal(body2D(A, 'staff'), A.topC);
  assert.equal(body2D(dress(A, 3), 'staff'), dress(A, 3).waist);
  assert.equal(body2D(dress(A, 4), 'staff'), dress(A, 4).topC);
  assert.equal(body2D(dress(A, 4, { venue: 'lab' }), 'staff'), EFF_HEX.coat);
  const M = appearance('b:2', 'lead');
  assert.equal(body2D(M, 'lead'), M.topC, '팀장 medium = 정장 색(지금)');
  assert.equal(body2D(dress(M, 1), 'lead'), M.top2C, '셔츠 바람');
});

test('소스 연결: 발광대 게이지 제거 · 오피스·연구소·2D 가 같은 dress·deskProps · 팀장 이름표 글 없음 · 외형 파일은 effort 를 모름', () => {
  const office = src('../voxel/office.js'), props = src('../voxel/props.js'), labP = src('../lab/lab-props.js'), labV = src('../lab/lab-view.js');
  const v2 = src('../flat/voxel2d.js'), l2 = src('../flat/lab2d.js'), ch = src('../voxel/character.js');
  for (const s of [office, props, labP, labV, v2, l2]) assert.ok(!/drawEffortGauge|deskGauge|_effGauge2D|labBaseOk/.test(s), '게이지 흔적 없음');
  assert.ok(/export function drawDeskEmitter\(G, d, lead, state, col, pal, k = 0\)/.test(props));
  assert.ok(/export function drawDeskProps\(L, G, P, x, z, fx, fz, y, pal, ry = 0, ghost = 0\)/.test(props));
  assert.ok(office.includes('dress(A0, es.level, { venue })') && office.includes('_effState(ch.id, this._now || 0)') && office.includes('deskProps(st.level, { hw, lampAt })'));
  assert.ok(office.includes('this._deskPropsAt(B, r.ownerId, now') && office.includes('this._deskPropsAt(B, d.occupant, now'));
  assert.ok(/function leadEffTag\(n\) \{ if \(vxEffort\(n\)\) return EMPTY;/.test(office), '팀장 이름표: 단계를 알면 글 없음');
  assert.ok(labP.includes('drawDeskProps(B.lit, G, s.p, x, z, f.x, f.z') && labP.includes('labPropsOk(used, s.p.boxes)'));
  assert.ok(labV.includes('this._effState(id, now)') && labV.includes('deskProps(es.level'));
  assert.ok(v2.includes('dress(ap0, es.level') && v2.includes('_deskProps2D(ctx, d.occupant, s, now') && v2.includes('body2D(ap, role)'));
  assert.ok(l2.includes('this._deskProps2D(ctx, d.occupant, s, now') && l2.includes('labFwd(a)'));
  for (const k of ["A.shoe === 'slide'", "case 'shirt':", 'look.coat', 'function gear(', 'look.glove', 'waist', 'look.neckPhones']) assert.ok(ch.includes(k), 'character.js: ' + k);
  assert.ok(!ch.includes("'brow'"), '이마 고글(옛 xhigh 연구소 차림) 없음');
  for (const f of ['../voxel/character.js', '../voxel/character-core.mjs', '../voxel/appearance-core.mjs']) assert.ok(!/effort/i.test(src(f)), f + ': 그리기·외형은 차림 칸만 알고 effort 는 모름');
});
