// 배경음악 곡 통째 받기: 외부 접속(Worker·quick tunnel 경유)에서는 <audio src=URL> 의 점진 스트리밍이 리플레이 데이터·SSE 와
// 대역을 나눠 쓰다 곡 비트레이트(128kbps)보다 느려지면 waiting·stalled 로 뚝뚝 끊긴다. 그래서 곡을 fetch 로 끝까지 받아 Blob URL 로
// 재생한다 — 한 번 다 받은 곡은 네트워크와 상관없이 끊기지 않는다. 받는 동안 지금 곡은 계속 나오고(전환은 다 받은 뒤), 첫 곡은
// '불러오는 중' 표시. 끊기면 받은 데까지 이어 받기(Range, 206 이 아니면 처음부터), 20초 동안 한 바이트도 안 오면 끊고 다시,
// 최대 4번. 끝내 못 받으면 null → 부르는 쪽이 예전처럼 URL 을 바로 건다. 응답은 ?v=<해시> 1년 immutable 이라 HTTP 캐시에 남고
// 다음 접속·반복 때는 디스크에서 바로 나온다. 다 받은 곡은 최근 MAX 개만 Blob 으로 들고 있고, 덱이 쓰는 곡은 버리지 않는다.
//   - 쓰는 곳: 루프백(localhost·127.*·::1)이 아닌 접속. URL ?bgmfetch=1|0 으로 강제(시험용)

export const MAX_BLOBS = 4;
export const STALL_MS = 20000;
export const ATTEMPTS = 4;

/** 이 접속에서 통째 받기를 쓰나: ?bgmfetch=1|0 우선, 아니면 루프백이 아닐 때 */
export function wantWholeFetch(loc) {
  try {
    const v = new URLSearchParams((loc && loc.search) || '').get('bgmfetch');
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (e) {}
  const h = String((loc && loc.hostname) || '').toLowerCase();
  return !(h === 'localhost' || h === '::1' || h === '[::1]' || /^127\./.test(h));
}

/** Content-Range "bytes a-b/total" → {start,total} | null */
export function parseContentRange(v) {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(v || '').trim());
  if (!m) return null;
  return { start: +m[1], end: +m[2], total: m[3] === '*' ? null : +m[3] };
}

export class TrackFetcher {
  /**
   * @param {{fetch?: Function, makeUrl?: (blob)=>string, revoke?: (u)=>void, Blob?: any, stallMs?: number, attempts?: number, max?: number, sleep?: Function}} o
   */
  constructor(o = {}) {
    this._fetch = o.fetch || ((...a) => fetch(...a));
    this._makeUrl = o.makeUrl || ((b) => URL.createObjectURL(b));
    this._revoke = o.revoke || ((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
    this._Blob = o.Blob || Blob;
    this.stallMs = o.stallMs || STALL_MS;
    this.attempts = o.attempts || ATTEMPTS;
    this.max = o.max || MAX_BLOBS;
    this._sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this._done = new Map();    // url → objectURL (삽입 순서 = 오래된 것부터)
    this._pending = new Map(); // url → Promise<objectURL|null>
    this._cancel = new Map();  // url → 받기 그만두기
    this.inUse = () => [];     // 지금 덱에 걸린 objectURL 들(버리지 않음) — 부르는 쪽이 채움
    this.log = [];             // 시험·진단용 {url, ev, ...}
  }

  /** 다 받은 곡의 objectURL(없으면 null) */
  peek(url) {
    const u = this._done.get(url);
    if (u) { this._done.delete(url); this._done.set(url, u); } // 최근 사용으로
    return u || null;
  }

  /** 곡을 끝까지 받아 objectURL. 이미 받는 중이면 같은 약속 */
  get(url) {
    const hit = this.peek(url);
    if (hit) return Promise.resolve(hit);
    let p = this._pending.get(url);
    if (!p) {
      p = this._download(url).then((blob) => {
        if (this._pending.get(url) === p) { this._pending.delete(url); this._cancel.delete(url); }
        if (!blob) return null;
        const u = this._makeUrl(blob);
        this._done.set(url, u);
        this._trim();
        return u;
      }, () => { if (this._pending.get(url) === p) { this._pending.delete(url); this._cancel.delete(url); } return null; });
      this._pending.set(url, p);
    }
    return p;
  }

  /** 받는 중인 곡을 그만 받음(곡이 바뀌어 더는 안 쓸 때 — 대역을 다음 곡에). 약속은 null 로 끝난다 */
  cancel(url) { const c = this._cancel.get(url); if (c) { this._note({ url, ev: 'cancel' }); this._cancel.delete(url); this._pending.delete(url); c(); } }

  _note(o) { this.log.push({ t: Date.now(), ...o }); if (this.log.length > 40) this.log.shift(); }

  _trim() {
    if (this._done.size <= this.max) return;
    const keep = new Set(this.inUse() || []);
    for (const [k, u] of this._done) {
      if (this._done.size <= this.max) break;
      if (keep.has(u)) continue;
      this._done.delete(k);
      this._revoke(u);
    }
  }

  async _download(url) {
    let chunks = [], got = 0, total = null, type = 'audio/mpeg';
    const t0 = Date.now();
    let stopped = false, cur = null;
    this._cancel.set(url, () => { stopped = true; try { cur && cur.abort(); } catch (e) {} });
    for (let a = 0; a < this.attempts && !stopped; a++) {
      if (a) await this._sleep(Math.min(8000, 1000 * 2 ** (a - 1)));
      if (stopped) break;
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      cur = ac;
      let timer = null;
      const arm = () => { if (!ac) return; clearTimeout(timer); timer = setTimeout(() => ac.abort(), this.stallMs); };
      try {
        const headers = got > 0 ? { Range: `bytes=${got}-` } : {};
        arm();
        const r = await this._fetch(url, { headers, signal: ac && ac.signal, credentials: 'same-origin' });
        if (got > 0 && r.status === 206) {
          const cr = parseContentRange(r.headers.get('content-range'));
          if (!cr || cr.start !== got) { chunks = []; got = 0; total = null; try { r.body && r.body.cancel(); } catch (e) {} continue; }
          if (cr.total != null) total = cr.total;
        } else if (r.status === 200) {
          if (got > 0) { chunks = []; got = 0; } // 이어 받기를 안 받아 줌: 처음부터
          const cl = Number(r.headers.get('content-length'));
          total = Number.isFinite(cl) && cl > 0 ? cl : null;
        } else { try { r.body && r.body.cancel(); } catch (e) {} this._note({ url, ev: 'http', status: r.status, a }); continue; }
        type = r.headers.get('content-type') || type;
        if (!r.body || typeof r.body.getReader !== 'function') {
          const buf = await r.arrayBuffer();
          chunks.push(new Uint8Array(buf)); got += buf.byteLength;
        } else {
          const rd = r.body.getReader();
          for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            arm();
            chunks.push(value); got += value.byteLength;
          }
        }
        clearTimeout(timer);
        if (total != null && got < total) { this._note({ url, ev: 'short', got, total, a }); continue; } // 덜 받고 끝남: 이어서
        this._note({ url, ev: 'done', bytes: got, ms: Date.now() - t0, attempts: a + 1 });
        return new this._Blob(chunks, { type });
      } catch (e) {
        clearTimeout(timer);
        this._note({ url, ev: 'error', got, a, err: (e && e.name) || String(e) });
      }
    }
    if (!stopped) this._note({ url, ev: 'give-up', got });
    return null;
  }
}
