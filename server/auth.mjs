// 토큰 검사·쿠키 발급. localhost 면제 없음.
import crypto from 'node:crypto';

export const COOKIE = 'ccviz_t';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

function isLocalHost(host) {
  const h = String(host || '').replace(/:\d+$/, '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
}

/**
 * @returns {{ok:boolean, via?:'query'|'cookie'|'header', setCookie?:string, redirect?:string}}
 */
export function checkAuth(req, url, token) {
  const q = url.searchParams.get('t');
  if (q != null) {
    if (safeEqual(q, token)) {
      const secure = req.headers['x-forwarded-proto'] === 'https' || !isLocalHost(req.headers.host);
      const setCookie = `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`;
      let redirect;
      const p = url.pathname;
      if (req.method === 'GET' && (p === '/' || p.endsWith('.html'))) {
        const sp = new URLSearchParams(url.searchParams);
        sp.delete('t');
        const qs = sp.toString();
        redirect = p + (qs ? `?${qs}` : '');
      }
      return { ok: true, via: 'query', setCookie, redirect };
    }
    // 틀린 t 는 쿠키·헤더로 넘어가 보되, 최종적으로 실패면 401
  }
  const c = parseCookies(req.headers.cookie)[COOKIE];
  if (c && safeEqual(c, token)) return { ok: true, via: 'cookie' };
  const h = req.headers['x-ccviz-token'];
  if (typeof h === 'string' && safeEqual(h, token)) return { ok: true, via: 'header' };
  return { ok: false };
}

/** Accept-Language 에서 가장 앞선(q 가 가장 큰) 언어가 한국어인가(서버 응답 페이지: 기본 영어, ko 우선이면 한국어) */
export function prefersKo(acceptLanguage) {
  let best = null, bq = -1;
  for (const part of String(acceptLanguage || '').split(',')) {
    const [tag, ...params] = part.trim().split(';');
    if (!tag) continue;
    const qp = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
    const q = qp ? Number(qp.slice(2)) : 1;
    if (Number.isFinite(q) && q > bq) { bq = q; best = tag.toLowerCase(); }
  }
  return !!best && (best === 'ko' || best.startsWith('ko-'));
}

const PAGE = (lang, title, h1, p) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0f17;color:#e6e9ef;display:grid;place-items:center;min-height:100vh;margin:0}
@media (prefers-color-scheme: light){body{background:#f5f6fa;color:#151a23}}main{max-width:28rem;padding:0 16px;text-align:center}</style></head>
<body><main><h1>${h1}</h1><p>${p}</p></main></body></html>`;

export const UNAUTHORIZED_HTML = PAGE('ko', '인증 필요', '토큰이 필요합니다', '링크에 포함된 접속 토큰(<code>?t=…</code>)으로 다시 열어 주세요.');
export const UNAUTHORIZED_HTML_EN = PAGE('en', 'Authentication required', 'Access token required', 'Reopen this page using the link that includes the access token (<code>?t=…</code>).');
/** 401 페이지: 요청 Accept-Language 로 고른다 */
export const unauthorizedHtml = (acceptLanguage) => (prefersKo(acceptLanguage) ? UNAUTHORIZED_HTML : UNAUTHORIZED_HTML_EN);
/** 404 글(정적 파일): 요청 Accept-Language 로 고른다 */
export const notFoundText = (acceptLanguage) => (prefersKo(acceptLanguage) ? '찾을 수 없습니다' : 'Not found');
