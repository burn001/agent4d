// Interactive 패널 순수 부분: 서명 문자열(서버와 같은 함수), 노드 → 세션, 보낸 글 상태(보냄·승인 대기·전달·응답·확인 안 됨),
// 도구 줄 접기, 안내 키, 사전(en·ko)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signingString, sessionOfNode, localState, viewRows, noticeKey, isMine, b64u, hex, HOLD_AFTER_MS, UNCONFIRMED_MS } from '../interact-core.mjs';
import { signingString as serverSigning } from '../../server/interact.mjs';
import ix from '../i18n/ix.mjs';

test('서명 문자열: 화면·서버가 같은 함수', () => {
  assert.equal(signingString('POST', '/interact/send', 1, 'n', 'h'), 'A4D-IX1\nPOST\n/interact/send\n1\nn\nh');
  assert.equal(serverSigning, signingString);
  assert.equal(b64u(new Uint8Array([251, 255])), '-_8');
  assert.equal(hex(new Uint8Array([0, 255])), '00ff');
});

test('노드 → 메인 세션 id(서브에이전트는 뿌리, 없으면 화면 세션)', () => {
  assert.equal(sessionOfNode({ id: 'a:1', rootSessionId: 'ABC' }), 'abc');
  assert.equal(sessionOfNode({ id: 's:def' }), 'def');
  assert.equal(sessionOfNode(null, 'XYZ'), 'xyz');
  assert.equal(sessionOfNode(null, null), null);
});

test('보낸 글 상태: 보냄 → (권한 무시 세션) 승인 대기 → 확인 안 됨, transcript 에 보이면 전달 → 응답', () => {
  const t0 = 1_000_000;
  assert.equal(localState({ state: 'sent', at: t0 }, t0 + 1000, false), 'sent');
  assert.equal(localState({ state: 'sent', at: t0 }, t0 + 1000, true), 'held');
  assert.equal(localState({ state: 'sent', at: t0 }, t0 + HOLD_AFTER_MS, false), 'waiting');
  assert.equal(localState({ state: 'sent', at: t0 }, t0 + UNCONFIRMED_MS, true), 'unconfirmed');
  assert.equal(localState({ state: 'failed', at: t0 }, t0 + UNCONFIRMED_MS, true), 'failed');
  const mine = { k: 'peer', src: 'ix', alias: 'blue-sky-cat', msgId: 'm1', name: '사용자 (Agent4D 화면 · blue-sky-cat)', text: 'hi' };
  assert.ok(isMine(mine, 'blue-sky-cat')); assert.ok(!isMine(mine, 'red-sky-cat'));
  const items = [
    { k: 'user', text: 'q' },
    { k: 'tool', tools: ['Bash'] }, { k: 'tool', tools: ['Read', 'Bash'] },
    mine,
    { k: 'assistant', text: 'a' },
  ];
  const local = [{ lid: 'x', msgId: 'm1', at: t0, text: 'hi', state: 'sent' }, { lid: 'y', msgId: 'm2', at: t0, text: 'later', state: 'sent' }];
  const { rows, local: left } = viewRows(items, local, { aliasEn: 'blue-sky-cat', now: t0 + 1000 });
  assert.deepEqual(rows.map((r) => r.k), ['user', 'tool', 'mine', 'assistant', 'mine']);
  assert.deepEqual(rows[1].tools, ['Bash', 'Read'], '연속 도구 줄 접기');
  assert.equal(rows[2].state, 'replied', '보인 뒤 assistant 글 → 응답');
  assert.equal(rows[4].state, 'sent'); assert.equal(rows[4].local, true);
  assert.deepEqual(left.map((m) => m.lid), ['y'], 'transcript 에 보인 내 글은 로컬 목록에서 빠짐');
  // 남의 peer 는 내 글 아님
  assert.equal(viewRows([{ k: 'peer', name: 'other', text: 'x' }], [], { aliasEn: 'blue-sky-cat' }).rows[0].k, 'peer');
});

test('안내 키: 미지원 → 오프라인 → 꺼짐 → 등록 중 → 승인 대기 → 취소 → 입력 가능', () => {
  assert.equal(noticeKey({ supported: false }), 'unsupported');
  assert.equal(noticeKey({ error: new Error('x') }), 'offline');
  assert.equal(noticeKey({ enabled: false }), 'disabled');
  assert.equal(noticeKey({ enabled: null }), 'loading');
  assert.equal(noticeKey({ enabled: true }), 'registering');
  assert.equal(noticeKey({ enabled: true, device: { status: 'pending' } }), 'pending');
  assert.equal(noticeKey({ enabled: true, device: { status: 'revoked' } }), 'revoked');
  assert.equal(noticeKey({ enabled: true, device: { status: 'allowed' } }), null);
});

test('사전: 화면이 쓰는 상태·이유·안내 키가 en·ko 모두에', () => {
  for (const k of ['sending', 'sent', 'waiting', 'held', 'delivered', 'replied', 'unconfirmed', 'failed']) { assert.ok(ix.en['ix.st.' + k]); assert.ok(ix.ko['ix.st.' + k]); }
  for (const k of ['unsupported', 'offline', 'loading', 'disabled', 'registering', 'pending', 'revoked', 'hold']) { assert.ok(ix.en['ix.note.' + k]); assert.ok(ix.ko['ix.note.' + k]); }
  for (const k of ['gone', 'busy', 'no_key', 'protocol', 'no_session', 'timeout', 'rate', 'too_long', 'io', 'pending', 'revoked', 'disabled', 'other']) assert.ok(ix.en['ix.why.' + k] && ix.ko['ix.why.' + k], k);
});
