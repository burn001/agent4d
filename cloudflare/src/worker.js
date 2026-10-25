// cc-agent-viz 고정 주소 Worker
//
// 고정 주소(https://cc-agent-viz.<subdomain>.workers.dev) 요청을 KV "origin" 에 등록된
// 현재 cloudflared quick tunnel 주소(https://<랜덤>.trycloudflare.com)로 프록시한다.
//
// 바인딩: KV CCVIZ, 시크릿 VIEW_TOKEN, ADMIN_SECRET
// 엔드포인트
//   POST /_register  Authorization: Bearer <ADMIN_SECRET>, {"origin":"https://….trycloudflare.com","host":"…"}
//   GET  /_health    인증 없음, origin 주소는 노출하지 않음
//   그 밖            토큰(쿼리 t → 쿠키 ccviz_t → 헤더 X-CCVIZ-Token) 확인 후 스트리밍 프록시

const ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const COOKIE = "ccviz_t";
const COOKIE_MAX_AGE = 2592000; // 30일
const MEM_TTL_MS = 10_000;

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

function cookieHeader(token) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
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
    if (url.pathname === "/favicon.ico"&& !readCookie(request, COOKIE)) return new Response(null, { status: 204 });

    const token = env.VIEW_TOKEN;
    if (!token) return json(500, { error: "worker-not-configured" });

    const qt = url.searchParams.get("t");
    if (qt !== null) {
      if (!(await safeEqual(qt, token))) return unauthorized(request);
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
    if (!((await safeEqual(ct, token)) || (await safeEqual(ht, token)))) return unauthorized(request);
    return proxy(request, env, url, token);
  },
};
