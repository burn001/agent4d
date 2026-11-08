// cc-agent-viz 고정 주소 Worker
//
// 고정 주소(https://cc-agent-viz.<subdomain>.workers.dev) 요청을 KV "origin" 에 등록된
// 현재 cloudflared quick tunnel 주소(https://<랜덤>.trycloudflare.com)로 프록시한다.
//
// 바인딩: KV CCVIZ, 시크릿 VIEW_TOKEN, ADMIN_SECRET
// 엔드포인트
//   POST /_register  Authorization: Bearer <ADMIN_SECRET>, {"origin":"https://….trycloudflare.com","host":"…"}
//   GET  /_health    인증 없음, origin 주소는 노출하지 않음
//   POST /_share     Authorization: Bearer <ADMIN_SECRET>, {"op":"put","hash":"<sha256 hex>","id":"…","exp":<ms>} | {"op":"delete","hash":"…"}
// 범위 제한 공유 링크 — KV "share:<hash>" (토큰 원문은 받지 않음)
//   그 밖            토큰(쿼리 t → 쿠키 ccviz_t → 헤더 X-CCVIZ-Token) 확인 후 스트리밍 프록시
//                    보기 토큰이 아니고 sh_ 로 시작하면 공유 토큰: KV 에서 해시로 찾아 기한을 보고, 막힌 경로를 거른 뒤 프록시
//                    (로컬 서버가 같은 토큰을 shares.json 으로 다시 검사하고 데이터를 잠근다 — 이중 거부)

const ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const COOKIE = "ccviz_t";
const COOKIE_MAX_AGE = 2592000; // 30일
const MEM_TTL_MS = 10_000;
const SHARE_PREFIX = "sh_";
const HASH_RE = /^[0-9a-f]{64}$/;

let memCache = null; // { value, at }

async function getOrigin(env, { fresh = false } = {}) {
  if (!fresh && memCache && Date.now() - memCache.at < MEM_TTL_MS) return memCache.value;
  let value = null;
  try {
    value = await env.CCVIZ.get("origin", { type: "json", cacheTtl: 60 });
  } catch {
    value = null;
  }
  if (value && (typeof value.url !== "string" || !ORIGIN_RE.test(value.url))) value = null;
  memCache = { value, at: Date.now() };
  return value;
}

const enc = new TextEncoder();
/** 상수 시간 비교. 두 값을 SHA-256 으로 같은 길이로 만든 뒤 비교해 길이도 드러내지 않는다. */
async function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const [da, db] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(da, db) && a.length === b.length;
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return null; // 잘못된 퍼센트 인코딩 → 쿠키 없음으로 처리(1101 방지)
    }
  }
  return null;
}

function wantsHtml(request) {
  const accept = request.headers.get("Accept") || "";
  return request.method === "GET" && accept.includes("text/html");
}

function htmlPage(status, title, body, extraHeaders = {}) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{--bg:#f5f6fa;--text:#151a23;--muted:#5b6475;--card:#fff;--line:#dfe3ec}
@media (prefers-color-scheme: dark){:root{--bg:#0b0f17;--text:#e6e9ef;--muted:#9aa4b5;--card:#121826;--line:#1b2433}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif}
main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.card{max-width:520px;width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 8px}p{margin:6px 0;color:var(--muted)}
</style></head><body><main><div class="card"><h1>${title}</h1>${body}</div></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });
}

function json(status, obj, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });
}

function unauthorized(request) {
  if (wantsHtml(request)) {
    return htmlPage(401, "토큰이 필요합니다", "<p>이 페이지는 토큰이 포함된 고정 링크로만 열 수 있습니다.</p><p>링크 끝의 <code>?t=…</code> 부분까지 그대로 붙여 넣었는지 확인해 주십시오.</p>");
  }
  return json(401, { error: "unauthorized" });
}

function offline(request) {
  if (wantsHtml(request)) {
    return htmlPage(
      503,
      "로컬 서버가 꺼져 있습니다",
      "<p>시각화 서버(또는 터널)가 지금 실행 중이 아닙니다.</p><p>PC에서 <code>ccviz start</code> 로 다시 켜면 이 주소 그대로 접속됩니다. 30초쯤 뒤 새로고침해 주십시오.</p>",
      { "Retry-After": "30" },
    );
  }
  return json(503, { error: "origin-offline" }, { "Retry-After": "30" });
}

function cookieHeader(token, maxAge = COOKIE_MAX_AGE) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// ───────────── 공유 토큰 ─────────────
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** 공유 토큰 → {exp, id} | {expired:true} | null (KV share:<hash>, 엣지 캐시 60초) */
async function shareOf(env, tok) {
  if (typeof tok !== "string" || !tok.startsWith(SHARE_PREFIX) || tok.length < 20 || tok.length > 200) return null;
  let v = null;
  try {
    v = await env.CCVIZ.get("share:" + (await sha256hex(tok)), { type: "json", cacheTtl: 60 });
  } catch {
    v = null;
  }
  if (!v || typeof v.exp !== "number") return null;
  if (v.exp <= Date.now()) return { expired: true };
  return { exp: v.exp, id: v.id };
}
/** 공유 토큰으로 못 여는 경로(로컬 서버 shareBlockedPath 와 같은 목록) */
function shareBlocked(url) {
  let p;
  try {
    p = decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/, "") || "/";
  } catch {
    return true;
  }
  if (p === "/control" || p.startsWith("/control/") || p === "/interact" || p.startsWith("/interact/")) return true;
  if (p === "/md/full" || p === "/artifacts") return true;
  if (/^arc:/i.test(url.searchParams.get("session") || "") || url.searchParams.get("source") === "archive") return true;
  return false;
}
function expiredPage(request) {
  if (wantsHtml(request)) return htmlPage(410, "링크 기한이 지났습니다", "<p>이 공유 링크는 기한이 지나 더 이상 열 수 없습니다.</p>");
  return json(410, { error: "expired" });
}
async function handleShareAdmin(request, env) {
  if (request.method !== "POST") return json(405, { error: "method-not-allowed" }, { Allow: "POST" });
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!env.ADMIN_SECRET || !m || !(await safeEqual(m[1].trim(), env.ADMIN_SECRET))) return json(401, { error: "unauthorized" });
  let b;
  try {
    b = await request.json();
  } catch {
    return json(400, { error: "bad-json" });
  }
  if (!b || !HASH_RE.test(String(b.hash || ""))) return json(400, { error: "bad-hash" });
  const key = "share:" + b.hash;
  if (b.op === "delete") {
    await env.CCVIZ.delete(key);
    return json(200, { ok: true });
  }
  if (b.op !== "put" || typeof b.exp !== "number" || !Number.isFinite(b.exp) || b.exp <= Date.now()) return json(400, { error: "bad-share" });
  const id = typeof b.id === "string" ? b.id.slice(0, 32) : null;
  // KV 자동 삭제는 기한 하루 뒤(그동안은 '기한 지남' 안내), 최소 120초 뒤
  const expiration = Math.max(Math.ceil(Date.now() / 1000) + 120, Math.ceil(b.exp / 1000) + 86400);
  await env.CCVIZ.put(key, JSON.stringify({ id, exp: b.exp }), { expiration });
  return json(200, { ok: true });
}
/** 공유 토큰 요청: 막힌 경로 거르기 → 한도·메모리는 '꺼짐' → 프록시(SSE 는 기한에 끊음) */
async function proxyShare(request, env, url, tok, s) {
  if (shareBlocked(url)) return json(403, { error: "share_blocked" });
  if (url.pathname === "/limits") return json(200, { ok: true, source: null, five_hour: null, seven_day: null, disabled: true });
  if (url.pathname === "/mem") return json(200, { ok: true, disabled: true });
  if (!["GET", "HEAD"].includes(request.method)) return json(405, { error: "method-not-allowed" });
  const res = await proxy(request, env, url, tok);
  if ((res.headers.get("Content-Type") || "").includes("text/event-stream") && res.body) {
    const left = s.exp - Date.now();
    if (left < 2_147_000_000) {
      const ac = new AbortController();
      const { readable, writable } = new TransformStream();
      const timer = setTimeout(() => ac.abort(), Math.max(0, left));
      res.body.pipeTo(writable, { signal: ac.signal }).catch(() => {}).finally(() => clearTimeout(timer));
      return new Response(readable, { status: res.status, headers: res.headers });
    }
  }
  return res;
}

async function handleRegister(request, env) {
  if (request.method !== "POST") return json(405, { error: "method-not-allowed" }, { Allow: "POST" });
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!env.ADMIN_SECRET || !m || !(await safeEqual(m[1].trim(), env.ADMIN_SECRET))) return json(401, { error: "unauthorized" });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad-json" });
  }
  const origin = typeof body?.origin === "string" ? body.origin.trim().replace(/\/+$/, "") : "";
  if (!ORIGIN_RE.test(origin)) return json(400, { error: "bad-origin" });
  const host = typeof body?.host === "string" ? body.host.slice(0, 64) : null;
  const value = { url: origin, updatedAt: new Date().toISOString(), host };
  await env.CCVIZ.put("origin", JSON.stringify(value));
  memCache = { value, at: Date.now() };
  return json(200, { ok: true, updatedAt: value.updatedAt });
}

async function handleHealth(env) {
  const o = await getOrigin(env, { fresh: true });
  let upstream = null;
  if (o) {
    try {
      const r = await fetch(o.url + "/healthz", { signal: AbortSignal.timeout(5000), headers: { "Cache-Control": "no-cache" } });
      upstream = r.status;
      // 터널은 살아 있어도 origin 이 꺼지면 cloudflared 가 502 를 준다
    } catch {
      upstream = null;
    }
  }
  return json(200, { ok: true, originSet: !!o, updatedAt: o?.updatedAt ?? null, upstream });
}

// 진단용: Worker 자체가 1초 간격 SSE 5건을 흘려 보낸다(관리자 시크릿 필요). 네트워크 경로가 스트리밍을 버퍼링하는지 확인.
async function streamTest(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!env.ADMIN_SECRET || !m || !(await safeEqual(m[1].trim(), env.ADMIN_SECRET))) return json(401, { error: "unauthorized" });
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  (async () => {
    for (let i = 1; i <= 5; i++) {
      await w.write(enc.encode(`data: ${i} ${new Date().toISOString()}\n\n`));
      await new Promise((r) => setTimeout(r, 1000));
    }
    await w.close();
  })();
  return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}

/** /control 과 /control/ 아래 전부 — 단 화면이 쓰는 두 경로(/control/events·/control/ack)는 뺀다 */
function isControlAdminPath(pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    return true;
  }
  if (p !== "/control" && !p.startsWith("/control/")) return false;
  return p !== "/control/events" && p !== "/control/ack";
}

const HOP_HEADERS =["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "host"];

async function proxy(request, env, url, token) {
  const target = new URL(url.pathname + url.search, "https://placeholder.invalid");
  target.searchParams.delete("t");
  const qs = target.searchParams.toString();
  const pathAndQuery = target.pathname + (qs ? "?" + qs : "");

  const headers = new Headers(request.headers);
  for (const h of HOP_HEADERS) headers.delete(h);
  headers.delete("x-ccviz-token");
  headers.set("X-CCVIZ-Token", token);
  // 브라우저 쿠키의 ccviz_t 는 origin 으로 보내지 않는다(판정은 Worker 가 고른 X-CCVIZ-Token 하나로)
  const ck = headers.get("Cookie");
  if (ck) {
    const rest = ck.split(";").filter((x) => x.split("=")[0].trim() !== COOKIE).join(";").trim();
    if (rest) headers.set("Cookie", rest);
    else headers.delete("Cookie");
  }
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-Forwarded-Host", url.host);
  const isUpgrade = (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
  if (isUpgrade) {
    headers.set("Upgrade", "websocket");
    headers.set("Connection", "Upgrade");
  }

  const hasBody = !["GET", "HEAD"].includes(request.method);
  // 본문은 한 번만 읽을 수 있으므로 재시도용으로 미리 버퍼링(POST 는 작다)
  const bodyBuf = hasBody ? await request.arrayBuffer() : undefined;

  const attempt = async (fresh) => {
    const o = await getOrigin(env, { fresh });
    if (!o) return { res: null, origin: null };
    try {
      const res = await fetch(o.url + pathAndQuery, {
        method: request.method,
        headers,
        body: bodyBuf,
        redirect: "manual",
      });
      return { res, origin: o.url };
    } catch {
      return { res: null, origin: o.url };
    }
  };

  let { res, origin } = await attempt(false);
  const bad = (r) => !r || r.status === 530 || r.status === 502;
  if (bad(res)) {
    memCache = null;
    ({ res, origin } = await attempt(true));
  }
  if (bad(res)) return offline(request);

  if (isUpgrade && res.status === 101) return res; // WebSocket 그대로 통과

  const out = new Headers(res.headers);
  // origin 주소가 Location 으로 새어 나가지 않도록 고정 주소로 바꿈
  const loc = out.get("Location");
  if (loc && origin && loc.startsWith(origin)) out.set("Location", loc.slice(origin.length) || "/");
  if ((out.get("Content-Type") || "").includes("text/event-stream")) {
    out.set("Cache-Control", "no-cache, no-transform");
    out.set("X-Accel-Buffering", "no");
    out.delete("Content-Length");
  }
  // body 스트림을 그대로 넘김 (SSE 버퍼링 없음)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/_register") return handleRegister(request, env);
    if (url.pathname === "/_health") {
      if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "method-not-allowed" });
      return handleHealth(env);
    }
    if (url.pathname === "/_stream-test") return streamTest(request, env);
    if (url.pathname === "/_share") return handleShareAdmin(request, env);
    // 화면 원격 조작: 명령 보내기(control)·화면 목록 등 관리용 경로는 프록시하지 않는다. 원격 화면은 받기만(control/events·/control/ack)
    if (isControlAdminPath(url.pathname)) return json(404, { error: "not_found" });
    if (url.pathname === "/favicon.ico"&& !readCookie(request, COOKIE)) return new Response(null, { status: 204 });

    const token = env.VIEW_TOKEN;
    if (!token) return json(500, { error: "worker-not-configured" });

    const qt = url.searchParams.get("t");
    if (qt !== null && !(await safeEqual(qt, token))) {
      // 공유 토큰(쿼리)
      const s = await shareOf(env, qt);
      if (!s) return unauthorized(request);
      if (s.expired) return expiredPage(request);
      const maxAge = Math.max(1, Math.floor((s.exp - Date.now()) / 1000));
      if (wantsHtml(request)) {
        const clean = new URL(url);
        clean.searchParams.delete("t");
        return new Response(null, {
          status: 302,
          headers: { Location: clean.pathname + clean.search, "Set-Cookie": cookieHeader(qt, maxAge), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
        });
      }
      const res = await proxyShare(request, env, url, qt, s);
      const r2 = new Response(res.body, res);
      r2.headers.append("Set-Cookie", cookieHeader(qt, maxAge));
      return r2;
    }
    if (qt !== null) {
      if (wantsHtml(request)) {
        // 쿠키 발급 후 t 를 뺀 주소로 302
        const clean = new URL(url);
        clean.searchParams.delete("t");
        return new Response(null, {
          status: 302,
          headers: { Location: clean.pathname + clean.search, "Set-Cookie": cookieHeader(token), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
        });
      }
      const res = await proxy(request, env, url, token);
      if (res.status === 101) return res;
      const r2 = new Response(res.body, res);
      r2.headers.append("Set-Cookie", cookieHeader(token));
      return r2;
    }

    const ct = readCookie(request, COOKIE);
    const ht = request.headers.get("X-CCVIZ-Token");
    if ((await safeEqual(ct, token)) || (await safeEqual(ht, token))) return proxy(request, env, url, token);
    // 공유 토큰(쿠키 → 헤더)
    for (const tok of [ct, ht]) {
      const s = await shareOf(env, tok);
      if (!s) continue;
      if (s.expired) return expiredPage(request);
      return proxyShare(request, env, url, tok, s);
    }
    return unauthorized(request);
  },
};
