// 공유 링크 잠금 등급 'details'(설명 공개) — 설명 글을 보여 주되 그 안의 경로·명령·코드·문서 번호·커밋·이름을 지우는 필터.
//
// 서버 한곳(share.mjs shareClean)에서만 부른다: REST·SSE·리플레이 타임라인·이벤트·스냅샷이 모두 같은 길을 탄다.
// 원칙: 남기는 글은 사람이 쓴 「무엇을 하는지」 설명(서브에이전트 description·세션 제목·Bash description)뿐이고,
//   그 글 안에 섞여 든 식별 정보는 자리표시([파일]·[명령]·[코드]·[문서]·[커밋]·[이메일]·[이름]·[주소]·[브랜치])로 바꾼다.
//   도구 입력·결과 원문은 이 필터를 거치지 않는다 — 아예 내보내지 않고 도구별 일반 동작 문장(toolAction)으로 갈음한다.
import { redact } from './redact.mjs';

const PH_KO = { file: '[파일]', cmd: '[명령]', code: '[코드]', doc: '[문서]', commit: '[커밋]', email: '[이메일]', name: '[이름]', url: '[주소]', branch: '[브랜치]' };
const PH_EN = { file: '[file]', cmd: '[command]', code: '[code]', doc: '[doc]', commit: '[commit]', email: '[email]', name: '[name]', url: '[url]', branch: '[branch]' };
const phOf = (lang) => (lang === 'en' ? PH_EN : PH_KO);
const PH_ALL = [...Object.values(PH_KO), ...Object.values(PH_EN)];
const PH_RE = new RegExp(PH_ALL.map((p) => p.replace(/[[\]]/g, '\\$&')).join('|'), 'g');
const isPh = (t) => PH_ALL.includes(t);

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
const CTRL = new RegExp('[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\ufeff]+', 'g');

// 파일 확장자(한 글자 확장자는 문장 속 낱말과 헷갈려 뺀다)
const EXT = 'py|pyw|pyi|ipynb|sh|bash|zsh|fish|ps1|psm1|psd1|bat|cmd|md|mdx|markdown|txt|rst|adoc|json|jsonl|ndjson|json5|yaml|yml|toml|ini|cfg|conf|env|lock|log|csv|tsv|xml|html?|css|scss|sass|less|js|mjs|cjs|ts|mts|cts|tsx|jsx|vue|svelte|go|rs|java|kt|kts|scala|cc|cpp|cxx|hpp|hh|cs|fs|rb|php|pl|pm|lua|sql|db|sqlite3?|parquet|feather|pkl|pickle|npy|npz|h5|onnx|pt|ckpt|safetensors|gguf|bin|exe|msi|dll|so|dylib|wasm|zip|gz|tgz|bz2|xz|tar|7z|rar|hwp|hwpx|pdf|docx?|xlsx?|xlsm|pptx?|odt|ods|rtf|png|jpe?g|gif|svg|webp|ico|bmp|tiff?|mp3|wav|flac|ogg|mp4|webm|mov|avi|mkv|ttf|otf|woff2?|output|patch|diff|tmp|bak|orig|swp|map|pem|key|crt|cer|p12|pfx|plist|gradle|sln|csproj|dockerfile|tf|tfvars|proto|graphql|gql|ejs|hbs|j2|tpl|srt|vtt|eml|msg|ics|vcf|kml|geojson|shp|dwg|dxf|ifc|rvt'
  ;
// 뒤에 한글 조사가 붙어도(RULES.md를 · .env에) 잡는다 — 끝 경계는 ASCII 낱말 글자만
const FILE_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_.\-])[\p{L}\p{N}_.\-*]*[\p{L}\p{N}_\-*]\.(?:${EXT})(?![A-Za-z0-9_])`, 'giu');
const DOTFILE_RE = /(?<![\p{L}\p{N}_.\-])\.[A-Za-z][\w-]{0,40}(?![A-Za-z0-9_])/gu;
// 코드 식별자(snake_case · 앞 밑줄) — 함수·모듈 이름. 공유 범위 프로젝트 이름(project_acme)은 o.keep 으로 둔다
const SNAKE_RE = /(?<![\p{L}\p{N}_])(?:_+[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*|[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)(?![\p{L}\p{N}_])/gu;
// 흔한 제품 이름 — 확장자 꼴이지만 파일이 아님
const NAME_OK = /^(?:node|next|vue|nuxt|three|d3|express|react|angular|ember|backbone|chart|deno|bun)\.js$/i;

// 명령 첫 낱말: STRONG = 다음 낱말이 한글이 아니면 명령, WEAK = 다음 낱말이 인자 꼴(-x · 경로 · = · 따옴표 …)일 때만
const STRONG = new Set(('git npm npx pnpm yarn node python python3 py pip pip3 pipx uv uvx conda mamba poetry curl wget grep egrep rg sed awk gawk ssh scp sftp rsync docker podman kubectl helm gh '
  + 'cd ls rm mkdir rmdir cat bash sh zsh pwsh powershell taskkill tasklist jq yq tar unzip gzip gunzip mongosh mongo mongod mongodump mongorestore psql mysql sqlite3 redis-cli '
  + 'claude agent4d ccviz wsl robocopy xcopy chmod chown chgrp nohup sudo apt apt-get yum dnf brew winget choco scoop ffmpeg ffprobe cargo rustc rustup go javac java dotnet msbuild '
  + 'cmake make gcc g++ clang deno bun tsc tsx eslint prettier pytest vitest jest mocha playwright cloudflared wrangler gws cf az aws gcloud terraform ansible systemctl journalctl '
  + 'netstat netsh icacls reg schtasks wmic sc ping tracert nslookup dig ipconfig ifconfig hwp pandoc libreoffice soffice magick convert ollama vllm hf huggingface-cli kp ks ka').split(' '));
const WEAK = new Set('find sort head tail cut echo printf kill set export source test timeout sleep wc diff cp mv touch env tee xargs uniq start type dir del copy move ren where which open less more ps top tr date stat file du df ln'.split(' '));
const PS_VERB = /^(?:Get|Set|New|Remove|Start|Stop|Invoke|Test|Select|Where|ForEach|Out|Write|Read|Copy|Move|Rename|Add|Clear|Import|Export|ConvertTo|ConvertFrom|Measure|Sort|Format|Wait|Restart|Expand|Compress|Resolve|Split|Join|Register|Unregister|Enable|Disable)-[A-Z]\w+$/;
const SHELL_OPS = /&&|\|\||\s\|\s|2>&1|>\s*\/dev\/null|\$\(|`|\bfor\s+\w+\s+in\b|;\s*(?:do|done|then|fi)\b|<<\s*['"]?EOF/;
const stripLead = (t) => t.replace(/^[("'\[{<「『【]+/, '');
// WEAK 명령 낱말 뒤 인자: 옵션·자리표시·셸 기호, 또는 영문이 든 경로 꼴(「0/1」·「(names」 같은 글은 아님)
const weakArg = (t) => /^-{1,2}\w/.test(t) || isPh(stripLead(t).replace(/[;,.)]+$/, '')) || /[=$*~|<>&;]/.test(t) || (/[\\/.]/.test(t) && /[A-Za-z]/.test(t) && !/[.,]$/.test(t));
// 명령 토막을 먹다가 멈출 영어 낱말(설명 문장으로 돌아옴)
const STOP = new Set('and then to for with via in of from on after before plus or but so while into onto using without'.split(' '));
const hasHangulWord = (t) => HANGUL.test(String(t).replace(PH_RE, ''));

// 한국 사람 이름(성 + 두 글자) 뒤에 호칭 — 세 글자 이름만(두 글자 낱말 「이번」·「전체」 같은 오탐을 줄임)
const SURNAME = '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부';
const TITLE = '(?:님|씨|박사|위원(?!회)|주임|연구원|선임|책임|팀장|본부장|교수|대표|과장|부장|차장|대리|원장|실장|소장|장관|의원|선생|기자|변호사|회장|사장|이사)';
const KNAME_RE = new RegExp(`(?<![가-힣])[${SURNAME}][가-힣]{2}(?=\\s?${TITLE})`, 'g');

/** 한 줄로(제어 문자·줄바꿈·연속 공백) */
const oneLine = (s) => String(s ?? '').replace(CTRL, ' ').replace(/\s+/g, ' ').trim();

// 흔한 영어 낱말 짝(경로가 아님)
const WORD_PAIR = /^(?:pass\/fail|fail\/pass|and\/or|read\/write|on\/off|yes\/no|true\/false|input\/output|start\/stop|open\/close|success\/failure|before\/after|in\/out|up\/down|ok\/fail|add\/remove|get\/set|min\/max|x\/y)$/i;

/** 경로 조각(구분자 / 또는 \ 가 든 ASCII·한글 토막) 가리기 — 숫자 분수·날짜, 한글만의 「읽기/쓰기」, 짧은 대문자 짝(I/O)은 둔다 */
function scrubPathRuns(s, P) {
  return s.replace(/[\p{L}\p{N}_.~*@%+=$#:\-]*(?:[\\/][\p{L}\p{N}_.~*@%+=$#:\-]*)+/gu, (m) => {
    if (!/[\\/]/.test(m) || !/[\p{L}\p{N}]/u.test(m)) return m;
    if (!m.includes('\\') && !/[A-Za-z]/.test(m)) return m;           // 1/3 · 2026/11/05 · 읽기/쓰기
    if (/^[A-Z]{1,4}\/[A-Z]{1,4}$/.test(m)) return m;                 // I/O · TCP/IP · A/B
    if (WORD_PAIR.test(m)) return m;                                   // pass/fail · and/or · read/write
    if (/^\/[a-z][\w-]{0,30}$/.test(m)) return m;                     // /done 같은 슬래시 명령(스킬 이름)
    const tail = /[\x21-\x7e]([가-힣]{1,3})$/.exec(m);                // 뒤에 붙은 조사(GLOSSARY.md를)는 남김
    return P.file + (tail ? tail[1] : '');
  });
}

/** 셸 명령 토막 가리기(낱말 단위) */
function scrubCommands(s, P) {
  const toks = s.split(' ');
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = stripLead(toks[i]);
    const next = toks[i + 1];
    const start = (STRONG.has(t) && next != null && !hasHangulWord(next) && !STOP.has(next))
      || (WEAK.has(t) && next != null && !hasHangulWord(next) && weakArg(next))
      || PS_VERB.test(t)
      || (/^(?:\.{0,2}[\\/])?[\w.-]+\.(?:sh|ps1|py|bat|cmd|mjs|js)$/i.test(t) && i === 0 && next != null && /^[-A-Za-z0-9"'$]/.test(next) && !hasHangulWord(next)); // 스크립트 직접 실행
    if (!start) { out.push(toks[i]); continue; }
    let j = i + 1;
    while (j < toks.length && !hasHangulWord(toks[j]) && !STOP.has(toks[j])) j++;
    out.push(P.cmd);
    i = j - 1;
  }
  return out.join(' ');
}

/**
 * 설명 글 하나를 공유용으로 정리. 비밀(redact) → 주소·이메일 → 코드 → 경로 → 명령 → 파일 이름 → 문서 번호 → 커밋 → 브랜치 → 사람 이름 순.
 * @param {string} input
 * @param {{lang?:'ko'|'en', max?:number}} [o]
 * @returns {string} 정리된 한 줄(빈 문자열 가능)
 */
export function scrubText(input, o = {}) {
  if (input == null) return '';
  const P = phOf(o.lang);
  let s = oneLine(redact(String(input)));
  if (!s) return '';
  if (/^\$\s/.test(s)) return P.cmd;                                   // 패널 머리줄 꼴 '$ 명령'
  if (SHELL_OPS.test(s) && !HANGUL.test(s)) return P.cmd;              // 한글 없는 셸 줄 전체
  s = s.replace(/\b(?:https?|ftp|file|ssh|git|wss?|mongodb(?:\+srv)?|postgres(?:ql)?|redis|smtp):\/\/\S+/gi, P.url)
    .replace(/\bwww\.[\w-]+(?:\.[\w-]+)+\S*/gi, P.url);
  s = s.replace(/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, P.email).replace(/\*{3}@[\w.-]+/g, P.email);
  s = s.replace(/`[^`]*`?/g, P.code);                                  // 인라인 코드(닫는 ` 가 잘렸어도)
  s = s.replace(/(["'])[A-Za-z]:[\\/][^"']*\1/g, P.file)               // 따옴표로 감싼 드라이브 경로(공백 포함)
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'`,;)\]}>]*/g, P.file) // 드라이브 경로
    .replace(/\\\\[^\s"'`,;)\]}>]+/g, P.file)                          // UNC
    .replace(/(?<![\p{L}\p{N}_])~[\\/][^\s"'`,;)\]}>]*/gu, P.file);    // 홈 경로
  // 셸 변수·환경 변수 대입(S=$P · NODE_ENV=prod · ${HOME})
  s = s.replace(/(?<![\p{L}\p{N}_])[A-Za-z_][A-Za-z0-9_]*=\S*/gu, P.cmd).replace(/\$\{?[A-Za-z_]\w*\}?/g, P.cmd);
  s = s.replace(/(?<![\p{L}\p{N}_])(branch|브랜치)\s+(?![[])(?!(?:and|or|to|of|for|in|on|is|the|name|names)\b)[\w./\-]+/giu, `$1 ${P.branch}`);
  s = scrubCommands(s, P);
  s = scrubPathRuns(s, P);
  s = s.replace(FILE_RE, (m) => (NAME_OK.test(m) ? m : P.file));
  s = s.replace(DOTFILE_RE, P.file);
  s = s.replace(/\bADR[\s#_-]*\d+\b/gi, P.doc)                         // ADR-0042 · ADR 42
    .replace(/§\s*\d+(?:[.\-]\d+)*/g, P.doc)
    .replace(/(?<![\p{L}\p{N}])[A-Z]{1,6}-\d{2,6}(?![\p{L}\p{N}])/gu, P.doc) // ISSUE-12 · RFC-0001
    .replace(/(?<![\p{L}\p{N}])[A-Z]\d{2,5}(?![\p{L}\p{N}])/gu, P.doc) // Q132
    .replace(/(?<![\w&])#\d{2,6}\b/g, P.doc);                           // #123
  s = s.replace(/(?<![\p{L}\p{N}_-])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![\p{L}\p{N}_])/gu, P.commit);
  const keep = new Set((o.keep || []).map((x) => String(x).toLowerCase()));
  s = s.replace(SNAKE_RE, (m) => (keep.has(m.toLowerCase()) ? m : P.code));
  // 점으로 이은 모듈·속성 이름(cli.probe.walk · os.path) — 도메인 꼴은 주소, 제품 이름(Node.js)은 둠
  s = s.replace(/(?<![\p{L}\p{N}_.\-/])[a-z_][a-z0-9_]+(?:\.[a-z_][a-z0-9_]*)+(?![\p{L}\p{N}_])/gu,
    (m) => (NAME_OK.test(m) ? m : /\.(?:com|net|org|io|kr|dev|app|ai|co|gov|edu|me|xyz)$/.test(m) ? P.url : P.code));
  // 자리표시 앞에 남은 옵션 낱말(-m [코드])은 뗀다
  s = s.replace(new RegExp(String.raw`(?<![\p{L}\p{N}])-{1,2}[A-Za-z][\w-]*\s+(?=${PH_RE.source})`, 'gu'), '');
  s = s.replace(KNAME_RE, P.name)
    .replace(/\bDr\.?\s?[A-Z][a-z]+(?:,?\s[A-Z][a-z]+)?/g, P.name)
    .replace(/(?<![\w.])@[A-Za-z0-9_-]{2,39}\b/g, P.name);
  // 같은 자리표시가 잇달면 하나로
  s = s.replace(new RegExp(`(${PH_RE.source})(?:[\\s,·/+&.:;-]*\\1)+`, 'g'), '$1').replace(/\s+/g, ' ').trim();
  const max = o.max || 120;
  if (s.length > max) s = s.slice(0, max - 1).replace(/\[[^\]]*$/, '').trimEnd() + '…';
  return s;
}

/** 자리표시·기호·숫자를 빼고도 낱말이 남는가(남지 않으면 일반 이름표·문장으로 갈음) */
export function meaningful(s) {
  const rest = String(s || '').replace(PH_RE, '').replace(/[\s\p{P}\p{S}\p{N}]/gu, '');
  return [...rest].length >= 2;
}

/** 설명 글 → 정리본(의미 있을 때만, 아니면 '') */
export function scrubDesc(input, o = {}) {
  const s = scrubText(input, o);
  return meaningful(s) ? s : '';
}

// ───────────── 도구 호출 → 일반 동작 한 줄 ─────────────
const ACT = {
  ko: { read: '파일 읽는 중', write: '파일 쓰는 중', edit: '파일 고치는 중', grep: '코드 검색', glob: '파일 찾기', shell: '명령 실행', monitor: '출력 감시',
    websearch: '웹 검색', webfetch: '웹 페이지 읽는 중', agent: '서브에이전트에 맡김', skill: '스킬 실행', workflow: '워크플로 실행', todo: '할 일 목록 정리',
    stop: '작업 멈춤', output: '작업 결과 확인', send: '메시지 보냄', ask: '사용자에게 질문', plan: '계획 승인 요청', toolsearch: '도구 찾기', mcp: '외부 도구 호출(MCP)',
    schedule: '예약', artifact: '결과물 게시', notify: '알림 보냄', other: '도구 실행', done: '완료', fail: '실패' },
  en: { read: 'Reading a file', write: 'Writing a file', edit: 'Editing a file', grep: 'Searching code', glob: 'Finding files', shell: 'Running a command', monitor: 'Watching output',
    websearch: 'Web search', webfetch: 'Reading a web page', agent: 'Delegating to a subagent', skill: 'Running a skill', workflow: 'Running a workflow', todo: 'Updating the to-do list',
    stop: 'Stopping a task', output: 'Checking task output', send: 'Sending a message', ask: 'Asking the user', plan: 'Asking to approve a plan', toolsearch: 'Finding tools', mcp: 'Calling an external tool (MCP)',
    schedule: 'Scheduling', artifact: 'Publishing a result', notify: 'Sending a notification', other: 'Using a tool', done: 'Done', fail: 'Failed' },
};
const KEY_OF = {
  Read: 'read', NotebookRead: 'read', Write: 'write', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Grep: 'grep', Glob: 'glob',
  Bash: 'shell', PowerShell: 'shell', Monitor: 'monitor', WebSearch: 'websearch', WebFetch: 'webfetch', Agent: 'agent', Task: 'agent', Skill: 'skill',
  Workflow: 'workflow', TodoWrite: 'todo', TaskStop: 'stop', KillShell: 'stop', TaskOutput: 'output', SendMessage: 'send', AskUserQuestion: 'ask',
  ExitPlanMode: 'plan', ToolSearch: 'toolsearch', CronCreate: 'schedule', ScheduleWakeup: 'schedule', Artifact: 'artifact', PushNotification: 'notify',
};
const SKILL_RE = /^[\p{L}\p{N}_.:\-]{1,64}$/u;
/** 스킬 이름(형식만 통과하면 그대로) */
export const safeSkill = (v) => (typeof v === 'string' && SKILL_RE.test(v) ? v : undefined);
const stripBg = (d) => String(d || '').replace(/(?:\s*·\s*)?(?:백그라운드|background)\s*$/i, '').trim();

/**
 * 도구 호출 기록(tool-start 이벤트·스냅샷 openTools 항목) → 공유용 '지금 하는 일' 한 줄.
 * 설명이 있는 도구(Bash·Monitor description, Agent description, WebSearch 질의, Workflow 이름, 스킬 이름)는 그 글을 scrubDesc 로 정리해 붙이고,
 * 나머지는 도구별 일반 문장만. 원문 입력(명령·경로·패턴·URL)은 쓰지 않는다.
 */
export function toolAction(rec, lang = 'ko', keep = []) {
  const A = ACT[lang] || ACT.ko;
  const tool = String(rec?.tool || '');
  const key = tool.startsWith('mcp__') || tool === 'mcp' ? 'mcp' : KEY_OF[tool] || 'other';
  const o = { lang, max: 90, keep };
  const join = (head, d) => (d ? `${head}: ${d}` : head);
  switch (key) {
    case 'shell': case 'monitor': {
      // 시작 이벤트: detail = description(명령과 다를 때) — detail 이 비면 description 이 없던 호출(text = 명령)이라 일반 문장.
      // 스냅샷 openTools 는 detail 이 없고 text = description || 명령, brief = 첫 명령 줄
      const desc = 'detail' in rec ? stripBg(rec.detail) : (looksLikeCommandEcho(rec) ? '' : String(rec.text || ''));
      const d = scrubDesc(desc, o);
      return d ? (key === 'monitor' ? join(A.monitor, d) : d) : A[key];
    }
    case 'agent': return join(A.agent, scrubDesc(rec.text || rec.brief, o));
    case 'websearch': return join(A.websearch, scrubDesc(rec.text || rec.brief, o));
    case 'workflow': return join(A.workflow, scrubDesc(rec.text || rec.brief, o));
    case 'skill': { const sk = safeSkill(rec.skill) || safeSkill(String(rec.text || '').split(' ')[0]); return sk ? `${lang === 'en' ? 'Skill' : '스킬'}: ${sk}` : A.skill; }
    default: return A[key] || A.other;
  }
}
/** text 가 명령 원문인가(설명이 없던 Bash: text = 명령 앞부분, brief = 첫 명령 줄) */
function looksLikeCommandEcho(rec) {
  const t = oneLine(rec.text), b = oneLine(rec.brief).replace(/\s*…$/, '');
  if (!t) return true;
  if (b && (t.startsWith(b.slice(0, 24)) || b.startsWith(t.slice(0, 24)))) return true;
  return SHELL_OPS.test(t) || /^\$\s/.test(t);
}
/** 도구 끝 한 줄(성공·실패만) */
export const toolEndText = (ok, lang = 'ko') => (ACT[lang] || ACT.ko)[ok === false ? 'fail' : 'done'];
