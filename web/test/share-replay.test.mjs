// 공유 링크 기본 리플레이: data-share-replay 해석·첫 화면 판정·반복 구간
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShareReplay, pickShareReplay, loopStep } from '../replay/share-replay.mjs';

const SID = 'a3443dd5-9fbf-49dd-a07d-f4c2d629e9ce';

test('parseShareReplay: 형식이 맞을 때만', () => {
  assert.deepEqual(parseShareReplay(`${SID}|1000|5000|4|1`), { session: SID, from: 1000, until: 5000, speed: 4, loop: true });
  assert.deepEqual(parseShareReplay(`${SID.toUpperCase()}|1000||2|0`), { session: SID, from: 1000, until: null, speed: 2, loop: false });
  for (const bad of [null, '', 'x|1|2|1|1', `${SID}|abc|5000|4|1`, `${SID}|5000|1000|4|1`, `${SID}|0||1|0`]) assert.equal(parseShareReplay(bad), null, String(bad));
});

test('pickShareReplay: ?live 면 실시간, 다른 세션 ?replay 면 그 세션, 같은 세션(새로고침)이면 기본', () => {
  const sr = parseShareReplay(`${SID}|1000|5000|4|1`);
  assert.equal(pickShareReplay(sr, new URLSearchParams('')), sr);
  assert.equal(pickShareReplay(sr, new URLSearchParams(`replay=${SID}`)), sr);
  assert.equal(pickShareReplay(sr, new URLSearchParams('replay=11111111-2222-3333-4444-555555555555')), null);
  assert.equal(pickShareReplay(sr, new URLSearchParams('live=1')), null);
  assert.equal(pickShareReplay(null, new URLSearchParams('')), null);
});

test('loopStep: 끝 시각을 앞에서 넘을 때·세션이 끝날 때만 처음으로', () => {
  const lp = { from: 1000, until: 5000 };
  assert.equal(loopStep(lp, 4990, 5010, 'playing'), 'restart');
  assert.equal(loopStep(lp, 4000, 4500, 'playing'), null);
  assert.equal(loopStep(lp, NaN, 6000, 'playing'), null);        // 끝 뒤로 직접 옮김(첫 시각)
  assert.equal(loopStep(lp, 6000, 6100, 'playing'), null);       // 끝 뒤에서 재생 중
  assert.equal(loopStep(lp, 4000, 4000, 'ended'), 'restart');
  assert.equal(loopStep({ from: 1000, until: null }, 9000, 9100, 'playing'), null);
  assert.equal(loopStep({ from: 1000, until: null }, 9000, 9100, 'ended'), 'restart');
  assert.equal(loopStep(null, 4990, 5010, 'playing'), null);
});
