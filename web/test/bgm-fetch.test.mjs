// 배경음악 곡 통째 받기(bgm-fetch.mjs): 이어 받기·멈춤 감지·포기·LRU
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TrackFetcher, wantWholeFetch, parseContentRange } from '../bgm-fetch.mjs';

const DATA = Uint8Array.from({ length: 1000 }, (_, i) => i & 255);

/** 가짜 응답: 본문을 조각으로, cut 바이트에서 오류(연결 끊김) 또는 hang(멈춤) */
function res(status, bytes, { headers = {}, cut = null, hang = false, signal = null } = {}) {
  const h = new Map(Object.entries({ 'content-type': 'audio/mpeg', 'content-length': String(bytes.length), ...headers }));
  let pos = 0;
  return {
    status, headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
    body: {
      cancel() {},
      getReader: () => ({
        read: () => new Promise((resolve, reject) => {
          if (cut != null && pos >= cut) {
            if (hang) { signal && signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); return; }
            reject(new TypeError('network'));
            return;
          }
          if (pos >= bytes.length) return resolve({ done: true });
          const end = Math.min(bytes.length, pos + 100, cut != null ? cut : Infinity);
          const v = bytes.slice(pos, end); pos = end; resolve({ done: false, value: v });
        }),
      }),
    },
  };
}

class FakeBlob { constructor(parts, o) { this.parts = parts; this.type = o.type; this.size = parts.reduce((a, p) => a + p.length, 0); } bytes() { const out = new Uint8Array(this.size); let o = 0; for (const p of this.parts) { out.set(p, o); o += p.length; } return out; } }
const opts = (fetch, extra = {}) => ({ fetch, Blob: FakeBlob, makeUrl: (b) => ({ blob: b, id: Math.random() }), revoke: () => {}, sleep: async () => {}, ...extra });

test('wantWholeFetch: 루프백은 끄고 외부는 켬, ?bgmfetch 우선', () => {
  assert.equal(wantWholeFetch({ hostname: '127.0.0.1', search: '' }), false);
  assert.equal(wantWholeFetch({ hostname: 'localhost', search: '' }), false);
  assert.equal(wantWholeFetch({ hostname: 'x.workers.dev', search: '' }), true);
  assert.equal(wantWholeFetch({ hostname: 'x.workers.dev', search: '?bgmfetch=0' }), false);
  assert.equal(wantWholeFetch({ hostname: '127.0.0.1', search: '?t=a&bgmfetch=1' }), true);
  assert.deepEqual(parseContentRange('bytes 200-999/1000'), { start: 200, end: 999, total: 1000 });
  assert.equal(parseContentRange('nope'), null);
});

test('끝까지 받아 Blob URL — 같은 곡은 한 번만 받음', async () => {
  let n = 0;
  const f = new TrackFetcher(opts(async () => { n++; return res(200, DATA); }));
  const [a, b] = await Promise.all([f.get('u'), f.get('u')]);
  assert.equal(a, b);
  assert.equal(n, 1);
  assert.deepEqual(a.blob.bytes(), DATA);
  assert.equal(f.peek('u'), a);
});

test('도중에 끊기면 받은 데까지 이어 받기(Range 206)', async () => {
  const calls = [];
  const f = new TrackFetcher(opts(async (url, o) => {
    calls.push(o.headers.Range || null);
    if (calls.length === 1) return res(200, DATA, { cut: 400 });
    const start = Number(/bytes=(\d+)-/.exec(o.headers.Range)[1]);
    return res(206, DATA.slice(start), { headers: { 'content-range': `bytes ${start}-999/1000` } });
  }));
  const u = await f.get('u');
  assert.deepEqual(calls, [null, 'bytes=400-']);
  assert.deepEqual(u.blob.bytes(), DATA);
});

test('이어 받기를 200 으로 주면 처음부터 다시', async () => {
  let k = 0;
  const f = new TrackFetcher(opts(async () => (++k === 1 ? res(200, DATA, { cut: 300 }) : res(200, DATA))));
  const u = await f.get('u');
  assert.equal(u.blob.size, 1000);
  assert.deepEqual(u.blob.bytes(), DATA);
});

test('멈추면(바이트가 안 옴) 끊고 다시, 끝내 못 받으면 null', async () => {
  let k = 0;
  const f = new TrackFetcher(opts(async (url, o) => { k++; return res(200, DATA, { cut: 200, hang: true, signal: o.signal }); }, { stallMs: 30, attempts: 3 }));
  assert.equal(await f.get('u'), null);
  assert.equal(k, 3);
  assert.ok(f.log.some((x) => x.ev === 'give-up'));
  // HTTP 오류도 포기 → null(부르는 쪽이 URL 스트리밍으로)
  const g = new TrackFetcher(opts(async () => res(404, new Uint8Array(0)), { attempts: 2 }));
  assert.equal(await g.get('v'), null);
});

test('다 받은 곡은 최근 max 개만, 덱이 쓰는 곡은 남김', async () => {
  const revoked = [];
  const f = new TrackFetcher(opts(async () => res(200, DATA), { max: 2, revoke: (u) => revoked.push(u) }));
  const a = await f.get('a');
  f.inUse = () => [a];
  await f.get('b'); await f.get('c');
  assert.ok(f.peek('a'), '덱이 쓰는 곡은 남음');
  assert.equal(f.peek('b'), null, '오래된 쓰지 않는 곡은 버림');
  assert.equal(revoked.length, 1);
});

test('audio.js: 외부 접속은 통째 받기 뒤 재생(§154)', () => {
  const src = readFileSync(new URL('../audio.js', import.meta.url), 'utf8');
  assert.match(src, /new TrackFetcher\(\)/);
  assert.match(src, /await this\._fetched\(to, FETCH_WAIT\);\s*\n\s*if \(sid !== this\._switchId\) return;\s*\n\s*await this\._ready/);
  assert.match(src, /_fetched\(i, FETCH_WAIT\)/);
});

test('cancel: 받는 중인 곡을 그만 받으면 null, 다시 부르면 새로 받음', async () => {
  let k = 0;
  const f = new TrackFetcher(opts(async (url, o) => { k++; return k === 1 ? res(200, DATA, { cut: 200, hang: true, signal: o.signal }) : res(200, DATA); }));
  const p = f.get('u');
  await new Promise((r) => setTimeout(r, 5));
  f.cancel('u');
  assert.equal(await p, null);
  assert.equal(k, 1, '그만둔 뒤 다시 시도하지 않음');
  assert.ok(await f.get('u'));
});
