// 민감정보 마스킹. 모든 text 필드에 적용한다.

const KEY = String.raw`(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|authorization|client[_-]?secret|access[_-]?key|private[_-]?key|credentials?)`;

const RULES = [
  // URI 자격증명 scheme://user:pass@host → scheme://user:***@host (mongodb, postgres, redis, smtp, https …)
  [/\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@'"]+:)[^@\s'"]+@/gi, '$1***@'],
  // PEM 개인키 본문
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '-----BEGIN PRIVATE KEY-----***'],
  // JWT 전체(header.payload.signature)
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, 'eyJ***'],
  // Anthropic 키
  [/sk-ant-[\w-]{10,}/g, 'sk-ant-***'],
  // OpenAI 류 sk- 키
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, 'sk-***'],
  // Bearer 토큰
  [/(Bearer\s+)[\w.\-~+/=]{16,}/gi, '$1***'],
  // GitHub 토큰
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh*_***'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_***'],
  // AWS 액세스 키
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***'],
  // Slack 토큰
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, 'xox*-***'],
  // Google API 키
  [/\bAIza[0-9A-Za-z_-]{35}/g, 'AIza***'],
  // 따옴표로 감싼 값 전체: "password": "P@ss w0rd!" / password='a b'
  [new RegExp(String.raw`(${KEY}["']?\s*[:=]\s*)(["'])(?:(?!\2)[^\n]){1,300}\2`, 'gi'), '$1$2***$2'],
  // key=value / key: value 형태 (값만 가림)
  [new RegExp(String.raw`(${KEY}["']?\s*[:=]\s*["']?)([^\s"'\`,;}&]+)`, 'gi'), '$1***'],
  // 한글 키워드: 비밀번호: x / 암호는 x / 앱 비밀번호는 abcd efgh ijkl mnop
  [/((?:비밀\s*번호|비번|암호|패스워드|인증\s*키|시크릿|토큰)\s*(?:[:=：]|은|는|이|가|를|을|로|으로)?\s*)([a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}|[^\s,;)\]}'"]{4,})/gi,
    (m, k, v) => (/^\*+$/.test(v) || /^(바꾸|변경|입력|확인|설정|재설정|필요|없|있|만료|틀|맞|분실|찾|저장|발급|관리|요구|규칙|정책|사용|교체|노출|포함|생성|복사|붙여)/.test(v) ? m : k + '***')],
  // URL 쿼리의 t=, token=, key=
  [/([?&](?:t|token|key|access_token|auth|sig|signature|password)=)[^&\s"'#]+/gi, '$1***'],
  // 주민등록번호·외국인등록번호
  [/\b\d{6}-[1-8]\d{6}\b/g, '******-*******'],
  // 휴대전화
  [/\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/g, '010-****-****'],
  // 이메일: 로컬 부분만 가림(도메인은 맥락용으로 남김)
  [/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g, '***@$1'],
];

// 40자 이상 연속 base64url/hex 토막. 경로처럼 '-' 가 많은 것은 제외한다.
const LONG_RUN = /[A-Za-z0-9_\-+/]{40,}={0,2}/g;

function looksLikeSecret(run) {
  const core = run.replace(/=+$/, '');
  if (/^[0-9a-f]{40,}$/i.test(core)) return true; // hex
  if (core.includes('/')) {
    // base64 표준은 '/' 를 포함할 수 있지만 경로와 구분이 어렵다: 슬래시로 나눈 조각이 모두 짧으면 경로로 본다
    const parts = core.split('/');
    if (parts.some((p) => p.length >= 40)) return looksLikeSecret(parts.find((p) => p.length >= 40));
    return false;
  }
  const dashes = (core.match(/-/g) || []).length;
  if (dashes >= 3) return false; // encodeCwd 경로, uuid 묶음 등
  const hasUpper = /[A-Z]/.test(core), hasLower = /[a-z]/.test(core), hasDigit = /[0-9]/.test(core);
  return hasUpper && hasLower && hasDigit;
}

const extraLiterals = new Set();
/** 서버가 아는 비밀(예: viewToken)을 문자열 그대로 가리도록 등록 */
export function addSecretLiteral(s) {
  if (typeof s === 'string' && s.length >= 8) extraLiterals.add(s);
}

export function redact(input) {
  if (input == null) return input;
  let s = String(input);
  for (const lit of extraLiterals) if (s.includes(lit)) s = s.split(lit).join('***');
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  s = s.replace(LONG_RUN, (m) => (looksLikeSecret(m) ? '***' : m));
  return s;
}
