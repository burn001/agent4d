// 복셀 직원 외형: id 시드 결정성 · 역할별 formal/casual 규칙 · 조합 다양성 · 같은 방 겹침 회피 · 말풍선 높이 보정
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appearance, Wardrobe, classOf, comboCount, headExtra, sigOf, ROLE_CLASS, HAIR_STYLES, NO_HAIR } from '../voxel/appearance-core.mjs';
import { Character } from '../voxel/character-core.mjs';

const ids = (n, p = 'agent-') => Array.from({ length: n }, (_, i) => p + i.toString(36) + '-' + ((i * 2654435761) >>> 0).toString(16));

test('같은 id·역할 → 늘 같은 외형(새 옷장에서도), 다른 소금이면 달라짐', () => {
  for (const id of ids(50)) for (const role of Object.keys(ROLE_CLASS)) {
    assert.deepEqual(appearance(id, role), appearance(id, role));
    const a = new Wardrobe().get(id, role, 'r1'), b = new Wardrobe().get(id, role, 'r1');
    assert.deepEqual(a, b);
  }
  const diff = ids(50).filter((id) => appearance(id, 'staff', 0).sig !== appearance(id, 'staff', 1).sig).length;
  assert.ok(diff > 40);
});

test('역할 → 옷 계열: 팀장·별관 = formal(정장·구두·넥타이류, 조금 크고 반듯), 팀원 = casual(캐주얼 윗옷·운동화), 운영자·손님 고유', () => {
  assert.equal(classOf('lead'), 'formal'); assert.equal(classOf('annex'), 'formal');
  assert.equal(classOf('staff'), 'casual'); assert.equal(classOf('wf'), 'casual');
  assert.equal(classOf('operator'), 'operator'); assert.equal(classOf('guest'), 'guest');
  const CASUAL_TOPS = new Set(['tee', 'longtee', 'hoodie', 'sweat', 'cardigan', 'polo', 'flannel', 'knit', 'dress']);
  for (const id of ids(300)) {
    for (const role of ['lead', 'annex']) {
      const a = appearance(id, role);
      const c = appearance(id, 'staff');
      assert.ok(a.top === 'suit' || a.top === 'suit3', a.top);
      assert.equal(a.hat, null); assert.equal(a.phones, null); assert.equal(a.pack, null);
      if (a.sex === 'm') {
        assert.equal(a.shoe, 'oxford'); assert.equal(a.bottom, 'slacks');
        assert.ok(['tie', 'bow', 'scarf', 'turtle'].includes(a.neck));
        assert.ok(a.h >= 1.03 && a.w >= 1.05, '남성 정장은 키·어깨가 기본 이상');
      } else {
        assert.ok(['pumps', 'loafer'].includes(a.shoe)); assert.ok(['skirt', 'slacks'].includes(a.bottom));
        assert.ok([null, 'scarf', 'bow', 'brooch', 'necklace', 'turtle'].includes(a.neck));
        assert.ok(a.h >= 0.99 && a.w >= 0.97, '여성 정장도 캐주얼보다 반듯하게');
      }
      if (c.sex === a.sex) assert.ok(a.w > c.w, '같은 성별이면 정장 어깨가 캐주얼보다 넓다');
      assert.equal(a.beard == null || a.sex === 'm', true);
    }
    for (const role of ['staff', 'wf']) {
      const a = appearance(id, role);
      assert.ok(CASUAL_TOPS.has(a.top), a.top);
      assert.equal(a.shoe, 'sneaker');
      assert.ok(['jeans', 'shorts', 'chinos', 'joggers', 'skirt', 'leggings', 'dress'].includes(a.bottom));
      if (a.sex === 'm') assert.ok(!['skirt', 'leggings', 'dress'].includes(a.bottom) && !['knit', 'dress'].includes(a.top));
      if (a.bottom === 'dress') assert.equal(a.top, 'dress');
      if (a.bottom === 'skirt' || a.bottom === 'dress') assert.ok(a.legC, '치마 아래 다리 색');
      assert.ok(a.h <= 1.02 && a.w <= 1.01, '캐주얼은 정장보다 작거나 같게');
    }
    assert.ok(['tee', 'longtee'].includes(appearance(id, 'operator').top));
    assert.equal(appearance(id, 'guest').top, 'coat');
  }
});

test('조합 다양성: 이론 조합 수백 이상, 300명 중 겉모습(sig) 겹침이 거의 없음, 각 선택지가 실제로 다 나옴', () => {
  assert.ok(comboCount('casual') > 1e6 && comboCount('formal') > 1e5);
  const many = ids(300);
  const sigs = new Set(many.map((id) => appearance(id, 'staff').sig));
  assert.ok(sigs.size >= 290, `staff sig ${sigs.size}/300`);
  const seen = (role, key) => new Set(many.map((id) => appearance(id, role)[key]));
  assert.ok(seen('staff', 'hairStyle').size >= 12);
  assert.ok(seen('staff', 'top').size === 9);
  assert.ok(seen('staff', 'skin').size === 6);
  assert.ok(seen('staff', 'hat').size === 4); // null·cap·capBack·beanie
  assert.ok(seen('lead', 'topC').size >= 8 && seen('lead', 'neck').size >= 7);
  assert.ok(many.some((id) => appearance(id, 'staff').glasses) && many.some((id) => appearance(id, 'staff').beard));
  assert.ok(many.some((id) => appearance(id, 'staff').phones) && many.some((id) => appearance(id, 'staff').pack));
});

test('같은 방 겹침 회피: 이미 있는 sig 와 같으면 다른 외형, 다른 방은 상관없음, 처음 정해진 외형은 유지', () => {
  // 일부러 같은 sig 가 나오도록 소금 0 결과가 같은 둘을 찾기는 어렵다 → sig 집합을 미리 채워 확인
  const w = new Wardrobe();
  const id = 'sub-x';
  const base = appearance(id, 'staff', 0);
  w.rooms.set('r1', new Set([base.sig]));
  const got = w.get(id, 'staff', 'r1');
  assert.notEqual(got.sig, base.sig);
  assert.deepEqual(w.get(id, 'staff', 'r1'), got); // 기억
  const w2 = new Wardrobe();
  w2.rooms.set('r1', new Set([base.sig]));
  assert.equal(w2.get(id, 'staff', 'r2').sig, base.sig); // 다른 방
  // 한 방 40명: sig 전부 다름
  const w3 = new Wardrobe();
  const s = new Set(ids(40, 'room-').map((i) => w3.get(i, 'staff', 'big').sig));
  assert.equal(s.size, 40);
  assert.equal(sigOf(base), base.sig);
});

test('말풍선 높이 보정: 번·곱슬·비니·큰 키는 위로, headY 에 더해짐', () => {
  const A = { h: 1, hairStyle: 'short', hat: null, phones: null };
  assert.equal(headExtra(A), 0);
  assert.ok(headExtra({ ...A, hairStyle: 'bun' }) > 0.05);
  assert.ok(headExtra({ ...A, hat: 'beanie' }) > 0.05);
  assert.ok(headExtra({ ...A, h: 1.06 }) > 0.09);
  assert.ok(headExtra({ ...A, h: 0.94 }) < 0);
  const ch = new Character('c1', { id: 'c1', kind: 'subagent', status: 'active' }, {});
  const y0 = ch.headY();
  ch.headExtra = 0.12;
  assert.ok(Math.abs(ch.headY() - (y0 + 0.12)) < 1e-9);
});

test('여성 캐릭터: 역할마다 대략 절반, 여성 머리 모양·복장이 실제로 나옴, 수염 없음', () => {
  const many = ids(600);
  for (const role of ['lead', 'staff', 'operator', 'guest']) {
    const f = many.filter((id) => appearance(id, role).sex === 'f').length;
    assert.ok(f > 240 && f < 360, `${role} 여성 ${f}/600`);
  }
  const fs = many.map((id) => appearance(id, 'staff')).filter((a) => a.sex === 'f');
  const styles = new Set(fs.map((a) => a.hairStyle));
  for (const st of ['long', 'pony', 'twin', 'braid', 'bob', 'bangs']) assert.ok(styles.has(st), st);
  assert.ok(fs.some((a) => a.top === 'dress') && fs.some((a) => a.bottom === 'skirt') && fs.some((a) => a.hairAcc));
  assert.ok(fs.every((a) => !a.beard));
  const fl = many.map((id) => appearance(id, 'lead')).filter((a) => a.sex === 'f');
  assert.ok(fl.some((a) => a.bottom === 'skirt') && fl.some((a) => a.bottom === 'slacks'), '스커트 정장·바지 정장 둘 다');
});

test('민머리 없음: 목록·실제 배정 어디에도 머리카락 없는 모양이 없다(모자를 써도)', () => {
  for (const sex of ['m', 'f']) for (const cls of ['formal', 'casual']) for (const st of HAIR_STYLES[sex][cls]) assert.ok(!NO_HAIR.includes(st), st);
  for (const id of ids(1000)) for (const role of Object.keys(ROLE_CLASS)) {
    const a = appearance(id, role);
    assert.ok(a.hairStyle && !NO_HAIR.includes(a.hairStyle), a.hairStyle);
  }
});
