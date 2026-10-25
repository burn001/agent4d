// 가짜 데이터(?mock=1) 문구를 영어 화면(lang=en)에서 영어로. 서버 문구 번역(i18n-server.mjs)과 별개 —
// 실제 세션 내용은 번역하지 않고, mock 생성기가 지어낸 한국어 문구만 바꾼다(데모·스크린샷용).
// 순서: 통째 일치 → 숫자 들어간 모양(정규식) → 구절 치환. 생성기 난수·순서에는 손대지 않는다(받은 뒤 바꿈).
import { lang } from './i18n.mjs';

const HANGUL = /[가-힣]/;

// 통째 일치(긴 문장)
const WHOLE = {
  '클로드 코드 세션 동작을 시각화하는 도구를 만들어줘. 에이전트 팀을 꾸려서 진행해 줘.': 'Build a tool that visualizes what Claude Code sessions are doing. Put together an agent team for it.',
  '팀을 꾸려 설계·빌드·검증 순서로 진행하겠습니다.': "I'll set up a team and go design → build → verify.",
  '계약서를 읽고 프런트엔드 구조를 잡겠습니다.': "I'll read the spec and lay out the frontend structure.",
  '노드 배치 규칙을 황금각 기준으로 구현했습니다.': 'Implemented node placement using the golden angle.',
  '서버 SSE 형식을 확인했습니다. snapshot 다음 ev 가 이어집니다.': 'Checked the server SSE format: a snapshot, then events.',
  '테스트가 모두 통과했습니다.': 'All tests pass.',
  '터널 주소를 KV 에 등록했습니다.': 'Registered the tunnel address in KV.',
  '카메라 자동 투어 점수를 계산합니다.': 'Scoring nodes for the automatic camera tour.',
  '빌드 결과를 검토하고 있습니다.': 'Reviewing the build output.',
  '이 부분은 계약과 다르므로 반환값에 적겠습니다.': "This differs from the spec, so I'll note it in the result.",
  '스크린샷으로 다크·라이트 테마를 확인했습니다.': 'Checked dark and light themes with screenshots.',
  '통합 시험을 실행하고 결과를 JSON 으로 보고하라.': 'Run the integration tests and report the result as JSON.',
  '통합 시험을 실행하고 결과를 JSON 으로 보고': 'Run the integration tests and report as JSON',
  '자율 사이클이다. 진행 중인 축 하나를 골라 계약대로 한 단계 진행하고 결과를 JSON 으로 남겨라.': 'Autonomous cycle. Pick one active track, advance it one step per the spec and record the result as JSON.',
  '자율 사이클이다. 진행 중인 축 하나를 골라 계약대로 한 단계 진행하라.': 'Autonomous cycle. Pick one active track and advance it one step per the spec.',
  '계약서를 읽고 패널 내용 형식을 확인했습니다.': 'Read the spec and checked the panel content format.',
  '가짜 화면을 걷어 내고 실제 줄을 캔버스에 그립니다.': 'Replacing the placeholder with real lines drawn on a canvas.',
  '꼬리 갱신은 줄이 위로 밀려 올라가게 했습니다.': 'Tail updates now scroll lines upward.',
  '라이트 테마에서도 글이 읽히는지 확인하겠습니다.': "I'll check that text is readable in the light theme too.",
  '홀로그램 패널 글자 크기 조금 키워 줘': 'Make the hologram panel text a bit larger',
  '패널 글자를 12px 로 키웠습니다.': 'Raised panel text to 12px.',
  '배치를 어느 쪽으로 할까요?': 'Which layout should I use?',
  '어느 쪽으로 할까요?': 'Which one?',
  '가로로 넓게': 'Wide, horizontal',
  '아, 라이트 테마도 같이 봐 줘': 'Oh, check the light theme as well',
  '검증 실패: 테스트 2건 실패': 'Verification failed: 2 tests failed',
  '독립 세션 결과: 통합 시험 통과': 'Standalone session: integration tests passed',
  '시간 초과로 중단': 'Stopped: time limit',
  '오류: 명령 실패 (exit 1)': 'Error: command failed (exit 1)',
  '실패 · 파일을 찾을 수 없음': 'Failed · file not found',
  'CSS2DRenderer 는 HTML 요소를 3D 장면 위치에 맞춰 띄운다.': 'CSS2DRenderer positions HTML elements at points in the 3D scene.',
  '렌더 루프에서 renderer.render(scene, camera) 다음에 부른다.': 'Call it right after renderer.render(scene, camera) in the render loop.',
  'pointer-events 는 기본 none 으로 두는 편이 좋다.': 'Keep pointer-events at none by default.',
  '바뀐 파일과 시험 결과를 짧게 보고하라.': 'Report changed files and test results briefly.',
  '모든 이벤트는 `seq` 순서로 온다.': 'Events always arrive in `seq` order.',
  '세션 동작을 3D 로 보여 준다.': 'Shows session activity in 3D.',
  '[비밀 경로 — 내용 생략]': '[secret path — content hidden]',
  '(인자 없음)': '(no arguments)',
  '[Monitor expired] 루프 상태 감시': '[Monitor expired] Watch loop status',
  '지난 작업 — 스킬 문서 정리': 'Earlier — tidy up skill docs',
  '표준 입력 프롬프트 시험(STDIN_MARK)': 'Stdin prompt test (STDIN_MARK)',
  '새 축 둘 세우고 루프 재기동': 'Add two tracks and restart the loop',
  '전달함 — 검증 담당이 받음': 'Delivered — received by the verifier',
  '백그라운드로 시작 — 진행은 갱신으로': 'Started in background — progress via updates',
};

// 숫자·이름이 끼는 모양
const RULES = [
  [/^(\d+)줄부터 (\d+)줄$/, (m, a, b) => `${b} lines from ${a}`],
  [/^처음부터 (\d+)줄$/, (m, a) => `first ${a} lines`],
  [/^(.+) (\d+)줄$/, (m, a, n) => `${a} ${n} lines`],
  [/^(\d+)줄 읽음$/, (m, n) => `${n} lines read`],
  [/^(\d+)줄 일치$/, (m, n) => `${n} matching lines`],
  [/^(\d+)개 파일$/, (m, n) => `${n} files`],
  [/^1～(\d+)줄 \/ (\d+)$/, (m, a, b) => `lines 1–${a} / ${b}`],
  [/^에이전트 "(.+)" (실패|완료)$/, (m, a, s) => `Agent "${en(a)}" ${s === '실패' ? 'failed' : 'finished'}`],
  [/^(.+) 완료 — 변경 파일 (\d+)개, 테스트 통과$/, (m, a, n) => `${en(a)} done — ${n} files changed, tests pass`],
  [/^워크플로 (\S+) 완료$/, (m, a) => `Workflow ${a} finished`],
  [/^백그라운드 ([bm]\d+) 시작 — 출력은 갱신으로$/, (m, a) => `Background ${a} started — output via updates`],
  [/^runId (\S+) · 시작됨$/, (m, a) => `runId ${a} · started`],
  [/^진행 · 도구 (\d+)회 · 말 (\d+)$/, (m, a, b) => `Progress · ${a} tools · ${b} messages`],
  [/^분기 (\d+)$/, (m, a) => `Branch ${a}`],
  [/^할 일 (\d+)\/(\d+)$/, (m, a, b) => `Todo ${a}/${b}`],
  [/^(.+) 보조$/, (m, a) => `${en(a)} helper`],
  [/^(.+) 작업을 맡아 계약대로 진행하고$/, (m, a) => `Take on ${en(a)} and follow the spec;`],
];

// 구절(긴 것부터 치환)
const PHRASES = Object.entries({
  '서버 파서 구현': 'Server parser', '3D 프런트엔드': '3D frontend', '배경음악 합성': 'Music synth', 'Cloudflare 워커': 'Cloudflare worker',
  '통합 검증': 'Integration check', '문서·스킬 정리': 'Docs cleanup', '계약 검토': 'Spec review', '성능 측정': 'Perf profiling',
  '보안 점검': 'Security review', '모바일 화면 확인': 'Mobile check', '서버 로그 감시': 'Watch server log', '로그 감시': 'Watch log',
  '루프 상태 감시': 'Watch loop status', '루프 재기동': 'Loop restart', '회차 하위 · 축 점검': 'Cycle helper · track check',
  'claude -p 하위 에이전트': 'claude -p subagent', '자율 루프 재기동': 'Restart autonomous loop', 'relaunch.sh 분리 실행': 'run relaunch.sh detached',
  '검증 담당에게 결과 전달': 'Send results to verifier', '빌드 단계 실행': 'Run build phase', '터널 로그 감시': 'Watch tunnel log',
  '결과 보고 페이지 게시': 'Publish report page', '작업 완료 알림': 'Notify: work done', '검증 담당': 'verifier', '검증': 'verify',
  '단위시험 실행': 'Run unit tests', '변경 파일 확인': 'List changed files', '서버 상태 확인': 'Check server health', '서버 시험': 'Server tests',
  '렌더러 설정 방법 요약': 'Summary: renderer setup', '통합 시험 실행': 'Run integration tests', '통합 시험': 'integration tests',
  '진행 상황 알려줘': 'How is it going?', '라이트 모드도 확인해 줘': 'Check light mode too', '음악 볼륨 줄여 줘': 'Turn the music down',
  '검증까지 끝내고 알림 보내 줘': 'Finish verification and notify me',
  'Claude Code 세션 시각화 개발': 'Building a Claude Code session viewer', 'Claude Code 세션 시각화 3차': 'Session viewer, round 3',
  '분기 보고서 표 검토': 'Review quarterly report tables', '보고서 초안 정리': 'Tidy report draft', 'API 평가 모듈 보강': 'Harden API scoring module',
  '법령 파서 수정': 'Fix rules parser', '스킬 카탈로그 갱신': 'Update skill catalog', '설문 응답 집계': 'Aggregate survey responses',
  '통계표 ID 정리': 'Clean up stats table IDs', 'md 변환 양식 점검': 'Check md conversion template', '지난 세션 예시': 'Earlier session (example)',
  'SKILL.md 검토': 'Review SKILL.md', '카탈로그 표 갱신': 'Update catalog table', '진행 상황 공유': 'Share progress', '전달됨': 'delivered',
  '흐름 연출': 'flow effects', '동시 분기': 'Parallel fan-out', '백그라운드로 실행': 'running in background', '백그라운드': 'background',
  '기동기': 'Launcher', '팀': 'team', '메인': 'Main', '답함': 'answered', '완료': 'done', '실패': 'failed',
  'taskId 발급': 'taskId issued', '파일을 찾을 수 없음': 'file not found', 'old_string 을 찾지 못함': 'old_string not found',
  '실패: 연결 시간 초과': 'failed: connection timed out', 'phases: 설계 → 빌드 → 검증': 'phases: design → build → verify',
  '설계:계약': 'design:spec', '빌드:서버': 'build:server', '빌드:프런트': 'build:frontend', '검증:통합': 'verify:integration',
  '계약대로': 'per the spec', '[x] 계약서 읽기': '[x] read the spec', '[x] 패널 틀만 남기기': '[x] keep only the panel frame',
  '[>] 실제 글 그리기': '[>] draw real text', '[ ] mock 패널': '[ ] mock panels', '[ ] 스크린샷 확인': '[ ] check screenshots',
  '셸 꼬리·exit': 'shell tail · exit', '마스킹(가짜 값 13가지)': 'masking (13 fake values)', '줄 표시·말줄임': 'line display · ellipsis',
  '말·꼬리 패널': 'speech · tail panels', '정리·minimal 삭제': 'tidy · minimal drop', '폭주 솎기': 'burst thinning',
  '라이브·재생 같은 패널': 'same panels live and replay', '계약': 'spec', '이벤트 형식': 'Event format', '필드': 'fields',
  '홀로그램 패널 내용': 'Hologram panel content', '실행': 'Run', '스냅샷 openTools 에도 같은 마스킹': 'same masking for snapshot openTools',
  '(백그라운드)': '(background)',
}).sort((a, b) => b[0].length - a[0].length);

/** 문구 하나 → 영어(바꿀 게 없으면 그대로) */
export function en(s) {
  if (typeof s !== 'string' || !HANGUL.test(s)) return s;
  if (WHOLE[s]) return WHOLE[s];
  for (const [re, f] of RULES) { const m = re.exec(s); if (m) return f(...m); }
  let o = s;
  for (const [k, v] of PHRASES) if (o.includes(k)) o = o.split(k).join(v);
  return o;
}

// 이름표·경로가 아닌 식별자 키는 건드리지 않는다
const SKIP = new Set(['id', 'nodeId', 'parentId', 'toolUseId', 'sessionId', 'projectId', 'rootSessionId', 'type', 'kind', 'cat', 'tool', 'status', 'ts', 'cwd', 'path', 'file', 'p', 'd', 'marks']);

// 영어 화면(README 스크린샷·데모)의 mock 프로젝트 이름은 흔한 영어 일반명으로(표시 문자열만 — id·경로 키는 그대로)
const NAMES = [['scratchpad\ccviz-probe', 'scratch\probe'], ['scratchpad/ccviz-probe', 'scratch/probe'], ['ccviz-probe', 'probe'], ['survey-dashboard', 'docs-site'],
  ['team-skills', 'design-system'], ['stats-cli', 'data-cli'], ['md2report', 'report-gen'], ['demo_api', 'api-server'], ['writing-style', 'style-guide']];
const hasName = (v) => v.includes('probe') || v.includes('survey-') || v.includes('team-skills') || v.includes('stats-cli') || v.includes('md2report') || v.includes('demo_api') || v.includes('writing-style');
export function enName(v) { if (typeof v !== 'string' || !hasName(v)) return v; let o = v; for (const [a, b] of NAMES) if (o.includes(a)) o = o.split(a).join(b); return o; }
const tr1 = (v) => enName(HANGUL.test(v) ? en(v) : v);

function walk(x, depth) {
  if (!x || typeof x !== 'object' || depth > 8) return;
  if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) { if (typeof x[i] === 'string') x[i] = tr1(x[i]); else walk(x[i], depth + 1); } return; }
  for (const k of Object.keys(x)) {
    if (SKIP.has(k)) continue;
    const v = x[k];
    if (typeof v === 'string') { const w = tr1(v); if (w !== v) x[k] = w; } else if (v && typeof v === 'object') walk(v, depth + 1);
  }
}

/** mock 이벤트·스냅샷·프로젝트 목록을 제자리에서 영어로(영어 화면일 때만). 받은 값을 그대로 돌려줌 */
export function mockEn(x) {
  if (lang() !== 'en' || !x || typeof x !== 'object') return x;
  walk(x, 0);
  return x;
}
