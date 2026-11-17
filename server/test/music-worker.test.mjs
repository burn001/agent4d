// node --test server/test/music-worker.test.mjs 배경음악 CDN Worker(cloudflare/music/src/music.js): 키 검사·Range·304·CORS·immutable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { parseRange, notModified } from '../../cloudflare/music/src/music.js';

const BODY = new Uint8Array(1000).map((_, i) => i % 251);
const KEY = 'bgm/0123456789abcdef/bgm-lofi.mp3';
const UPLOADED = new Date('2026-11-14T00:00:00Z');
const ETAG = '"abc123"';

/** R2 바인딩 흉내: head·get(range·onlyIf 를 Headers 로) */
function fakeR2() {
  const calls = [];
  const meta = { key: KEY, size: BODY.length, httpEtag: ETAG, etag: 'abc123', uploaded: UPLOADED };
  return {
    calls,
    async head(k) { calls.push(['head', k]); return k === KEY ? { ...meta } : null; },
    async get(k, o = {}) {
      calls.push(['get', k]);
      if (k !== KEY) return null;
      const h = o.onlyIf;
      if (h instanceof Headers) {
        const inm = h.get('If-None-Match');
        if (inm && inm.split(',').some((x) => x.trim().replace(/^W\//, '') === ETAG)) return { ...meta }; // 본문 없음
      }
      let range;
      const rh = o.range instanceof Headers ? o.range.get('Range') : null;
      if (rh) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(rh);
        if (m[1] === '') range = { suffix: Number(m[2]) };
        else {
          const off = Number(m[1]);
          if (off >= BODY.length) throw new Error('InvalidRange');
          const end = m[2] === '' ? BODY.length - 1 : Math.min(Number(m[2]), BODY.length - 1);
          range = { offset: off, length: end - off + 1 };
        }
      }
      const slice = !range ? BODY : range.suffix != null ? BODY.slice(BODY.length - range.suffix) : BODY.slice(range.offset, range.offset + range.length);
      return { ...meta, range, body: new Blob([slice]).stream() };
    },
  };
}
const call = (path, init = {}, env = { MUSIC: fakeR2() }) => worker.fetch(new Request('https://music.example' + path, init), env);

test('parseRange: a-b·a-·-n·형식 틀림·범위 밖', () => {
  assert.equal(parseRange(null, 10), null);
  assert.deepEqual(parseRange('bytes=0-', 10), { offset: 0, length: 10 });
  assert.deepEqual(parseRange('bytes=2-4', 10), { offset: 2, length: 3 });
  assert.deepEqual(parseRange('bytes=5-99', 10), { offset: 5, length: 5 });
  assert.deepEqual(parseRange('bytes=-3', 10), { offset: 7, length: 3 });
  for (const v of ['bytes=-', 'bytes=4-2', 'bytes=10-', 'bytes=0-1,3-4', 'items=0-1', 'bytes=-0']) assert.equal(parseRange(v, 10), false, v);
});

test('곡 GET: 200 · audio/mpeg · 1년 immutable · CORS · 크기', async () => {
  const r = await call('/' + KEY);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-expose-headers'), /Content-Range/);
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  assert.equal(r.headers.get('etag'), ETAG);
  assert.equal(r.headers.get('content-length'), '1000');
  assert.equal((await r.arrayBuffer()).byteLength, 1000);
});

test('Range: 206 + Content-Range(시작·끝·뒤에서 n), 읽기 한 번, 범위 밖 416', async () => {
  const env = { MUSIC: fakeR2() };
  let r = await call('/' + KEY, { headers: { Range: 'bytes=100-199' } }, env);
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal(r.headers.get('content-length'), '100');
  const b = new Uint8Array(await r.arrayBuffer());
  assert.equal(b.length, 100); assert.equal(b[0], BODY[100]);
  assert.deepEqual(env.MUSIC.calls, [['get', KEY]], 'GET 은 R2 읽기 한 번');
  r = await call('/' + KEY, { headers: { Range: 'bytes=900-' } });
  assert.equal(r.headers.get('content-range'), 'bytes 900-999/1000');
  r = await call('/' + KEY, { headers: { Range: 'bytes=-10' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 990-999/1000');
  r = await call('/' + KEY, { headers: { Range: 'bytes=5000-' } });
  assert.equal(r.status, 416);
  assert.equal(r.headers.get('content-range'), 'bytes */1000');
  r = await call('/' + KEY, { headers: { Range: 'bytes=9-3' } });
  assert.equal(r.status, 416);
});

test('조건부: 맞는 If-None-Match 면 Range 가 있어도 304(본문 없음, immutable 유지), 틀리면 206', async () => {
  let r = await call('/' + KEY, { headers: { 'If-None-Match': ETAG, Range: 'bytes=0-' } });
  assert.equal(r.status, 304);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(r.body, null);
  r = await call('/' + KEY, { headers: { 'If-None-Match': '"other"', Range: 'bytes=0-' } });
  assert.equal(r.status, 206);
  assert.equal(notModified(new Request('https://x', { headers: { 'If-Modified-Since': UPLOADED.toUTCString() } }), ETAG, UPLOADED), true);
  assert.equal(notModified(new Request('https://x', { headers: { 'If-None-Match': 'W/' + ETAG } }), ETAG, UPLOADED), true);
});

test('HEAD·OPTIONS·health·잘못된 키·다른 메서드', async () => {
  let r = await call('/' + KEY, { method: 'HEAD', headers: { Range: 'bytes=0-9' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-length'), '10');
  r = await call('/' + KEY, { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-length'), '1000');
  r = await call('/' + KEY, { method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('access-control-allow-headers'), /Range/);
  r = await call('/_health');
  assert.deepEqual(await r.json(), { ok: true });
  for (const p of ['/', '/bgm/', '/bgm/0123456789abcdef/../x.mp3', '/bgm/XYZ/bgm.mp3', '/bgm/0123456789abcdef/a.json', '/secret.txt', '/bgm/0123456789abcdef/sub/a.mp3']) {
    r = await call(p);
    assert.equal(r.status, 404, p);
  }
  r = await call('/bgm/0123456789abcdef/none.mp3');
  assert.equal(r.status, 404);
  r = await call('/' + KEY, { method: 'PUT', body: 'x' });
  assert.equal(r.status, 405);
});
