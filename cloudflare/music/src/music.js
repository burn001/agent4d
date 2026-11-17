// Agent4D 배경음악 CDN Worker
//
// R2 버킷(바인딩 MUSIC)의 곡을 공개로 내보낸다. 읽기 전용(GET·HEAD·OPTIONS), 인증 없음 — 곡은 공개 레포와 같은 자산이다.
//   GET|HEAD /bgm/<hash>/<file>.mp3   hash = 곡 내용 sha256 앞 8～64자(매니페스트 hash), 주소 = 내용이라 1년 immutable
//     - Range(bytes=a-b · a- · -n) → 206 + Content-Range, 범위 밖 → 416
//     - If-None-Match·If-Modified-Since 가 맞으면 304(Range 가 있어도 — RFC 9110)
//     - CORS: Access-Control-Allow-Origin * (웹이 외부 접속에서 곡을 fetch 로 통째 받는다)
//   GET /_health   {ok:true}
//   그 밖          404 (목록 조회 없음)
// workers.dev 에서는 Cache API 가 동작하지 않는다 — 브라우저 캐시(immutable)만 믿는다.

const KEY_RE = /^bgm\/[0-9a-f]{8,64}\/[A-Za-z0-9._-]+\.mp3$/;
const CC = "public, max-age=31536000, immutable";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-None-Match, If-Modified-Since",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
  "Timing-Allow-Origin": "*",
};

function plain(status, text, extra = {}) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra } });
}

/** Range 헤더 → {offset, length} | {suffix} | null(없음) | false(형식 틀림·여러 범위) */
export function parseRange(v, size) {
  if (!v) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(v).trim());
  if (!m || (m[1] === "" && m[2] === "")) return false;
  let start, end;
  if (m[1] === "") { const n = Number(m[2]); if (!(n > 0)) return false; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return false;
  return { offset: start, length: end - start + 1 };
}

/** 조건부 요청이 맞나(304) */
export function notModified(req, etag, uploaded) {
  const inm = req.headers.get("If-None-Match");
  if (inm) return inm.split(",").some((x) => { const s = x.trim().replace(/^W\//, ""); return s === "*" || s === etag; });
  const ims = Date.parse(req.headers.get("If-Modified-Since") || "");
  return Number.isFinite(ims) && uploaded && Math.floor(uploaded.getTime() / 1000) * 1000 <= ims;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "GET" && req.method !== "HEAD") return plain(405, "method not allowed", { Allow: "GET, HEAD, OPTIONS" });
    if (url.pathname === "/_health") return new Response('{"ok":true}', { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
    let key;
    try { key = decodeURIComponent(url.pathname.slice(1)); } catch { return plain(400, "bad path"); }
    if (!KEY_RE.test(key)) return plain(404, "not found");

    const headers = (o) => ({
      "Content-Type": "audio/mpeg",
      "Cache-Control": CC,
      "Accept-Ranges": "bytes",
      ETag: o.httpEtag, // "<md5>" 따옴표 포함
      "Last-Modified": o.uploaded.toUTCString(),
      ...CORS,
    });
    const rangeHdr = req.headers.get("Range");

    if (req.method === "HEAD") {
      const h = await env.MUSIC.head(key);
      if (!h) return plain(404, "not found");
      const base = headers(h);
      if (notModified(req, h.httpEtag, h.uploaded)) return new Response(null, { status: 304, headers: base });
      const r = parseRange(rangeHdr, h.size);
      if (r === false) return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${h.size}` } });
      return new Response(null, r
        ? { status: 206, headers: { ...base, "Content-Range": `bytes ${r.offset}-${r.offset + r.length - 1}/${h.size}`, "Content-Length": String(r.length) } }
        : { status: 200, headers: { ...base, "Content-Length": String(h.size) } });
    }

    // GET: 읽기 한 번(Class B 1회)으로 조건·범위를 함께 — 형식이 틀린 범위는 미리 거른다(크기를 몰라 parseRange 는 형식만)
    if (rangeHdr && parseRange(rangeHdr, Number.MAX_SAFE_INTEGER) === false) {
      const h = await env.MUSIC.head(key);
      if (!h) return plain(404, "not found");
      return new Response(null, { status: 416, headers: { ...headers(h), "Content-Range": `bytes */${h.size}` } });
    }
    let obj;
    try {
      obj = await env.MUSIC.get(key, { onlyIf: req.headers, ...(rangeHdr ? { range: req.headers } : {}) });
    } catch {
      const h = await env.MUSIC.head(key); // 범위가 곡 끝을 넘음
      if (!h) return plain(404, "not found");
      return new Response(null, { status: 416, headers: { ...headers(h), "Content-Range": `bytes */${h.size}` } });
    }
    if (!obj) return plain(404, "not found");
    const base = headers(obj);
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers: base }); // 조건이 맞음(바뀌지 않음)
    const size = obj.size;
    if (rangeHdr && obj.range) {
      const rg = obj.range;
      const offset = "suffix" in rg && rg.suffix != null ? Math.max(0, size - rg.suffix) : (rg.offset || 0);
      const length = "suffix" in rg && rg.suffix != null ? size - offset : (rg.length != null ? rg.length : size - offset);
      return new Response(obj.body, { status: 206, headers: { ...base, "Content-Range": `bytes ${offset}-${offset + length - 1}/${size}`, "Content-Length": String(length) } });
    }
    return new Response(obj.body, { status: 200, headers: { ...base, "Content-Length": String(size) } });
  },
};
