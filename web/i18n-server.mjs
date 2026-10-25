// 서버 문구 번역기. 서버는 여러 클라이언트에 같은 스트림을 보내고 재생 데이터도 캐시하므로 언어별로 만들 수 없다 →
// 클라이언트가 받는 자리에서 서버가 템플릿으로 조합한 한국어 문구(도구 요약 '12줄 읽음'·패널 줄·노드 라벨 '메인 · x'·계획 제목 '할 일' …)를
// 지금 언어로 바꾼다. 한국어면 아무것도 하지 않는다(바로 반환). transcript 원문(프롬프트·할 일 글·출력)은 건드리지 않는다 —
// 규칙은 서버 템플릿 모양에 꼭 맞을 때만(문자열 전체 또는 ' · ' 로 나뉜 조각 전체) 바꾸고, 모르는 문구는 그대로 둔다.
// 영어 결과에는 한글이 없으므로 두 번 돌려도 같다(앱 수신 + 재생 엔진이 겹쳐 불러도 됨).
//   localizeServerText(s) · localizeLine(s) · localizePanel(p) · localizeNode(n) · localizePlans(plans) · localizeArt(refs)
//   localizeEvent(ev) · localizeSnapshot(snap) · localizeTimeline(tl) · localizeArtifacts(body) · localizeProjects(body)
// 모두 제자리에서 고치고 같은 객체를 돌려준다.
import { t, isKo } from './i18n.mjs';

const HANGUL = /[가-힣]/;
const SEP = ' · ';

// 문자열 전체가 이 모양이면(데이터 줄에도 적용 — 서버가 통째로 만드는 줄)
const WHOLE = [
  [/^\[바이너리 줄 생략\]$/, () => t('server.binaryLine')],
  [/^\[이미지 — 내용 생략\]$/, () => t('server.imageHidden')],
  [/^\[바이너리 — 내용 생략\]$/, () => t('server.binaryHidden')],
  [/^\[비밀 경로 — 내용 생략\]$/, () => t('server.secretHidden')],
  [/^\[비밀 경로 — 출력 생략\]$/, () => t('server.secretOut')],
  [/^백그라운드 (\S+) 시작 — 출력은 갱신으로$/, (m) => t('server.bgTail', { id: m[1] })],
  [/^백그라운드로 시작 — 진행은 갱신으로$/, () => t('server.bgAgent')],
  [/^백그라운드로 실행$/, () => t('server.bgRun')],
  [/^(\d+)～(\d+)줄(?: \/ (\d+))?$/, (m) => t('server.lineRange', { a: m[1], b: m[2], total: m[3] || '' })],
  [/^완료$/, () => t('server.done')],
  [/^실패$/, () => t('server.failed')],
];

// ' · ' 로 나뉜 조각 하나 전체가 이 모양이면(요약·제목·라벨·장식 줄)
const SEG = [
  [/^백그라운드$/, () => t('server.bg')],
  [/^백그라운드 시작$/, () => t('server.bgStarted')],
  [/^백그라운드 (\S+)$/, (m) => t('server.bgId', { id: m[1] })],
  [/^중단됨$/, () => t('server.interrupted')],
  [/^중지함$/, () => t('server.stopped')],
  [/^(\d+)줄 일치$/, (m) => t('server.matchLines', { n: m[1] })],
  [/^(\d+)건$/, (m) => t('server.matches', { n: m[1] })],
  [/^(\d+)개 파일(\+?)$/, (m) => t('server.files', { n: m[1], more: m[2] })],
  [/^(\d+)줄 읽음(?: \/ (\d+))?$/, (m) => t('server.readLines', { n: m[1], total: m[2] || '' })],
  [/^새 파일 \+(\d+) −(\d+)$/, (m) => t('server.newFile', { a: m[1], r: m[2] })],
  [/^결과 (\d+)묶음$/, (m) => t('server.results', { n: m[1] })],
  [/^도구 (\d+)회$/, (m) => t('server.toolCalls', { n: m[1] })],
  [/^(\d+)초$/, (m) => t('server.secs', { n: m[1] })],
  [/^(\S+) 불러옴$/, (m) => t('server.loaded', { name: m[1] })],
  [/^할 일 (\d+)개$/, (m) => t('server.todos', { n: m[1] })],
  [/^완료 (\d+)\/(\d+)$/, (m) => t('server.doneOf', { a: m[1], b: m[2] })],
  [/^할 일 (\d+)\/(\d+)$/, (m) => t('server.todoTitle', { a: m[1], b: m[2] })],
  [/^(\d+)곳$/, (m) => t('server.edits', { n: m[1] })],
  [/^(\d+)줄부터(?: (\d+)줄)?$/, (m) => t('server.fromLine', { n: m[1], lim: m[2] || '' })],
  [/^처음부터 (\d+)줄$/, (m) => t('server.fromStart', { lim: m[1] })],
  [/^처음부터$/, () => t('server.fromStartAll')],
  [/^([\d\s,\-–]+)쪽$/, (m) => t('server.pages', { p: m[1] })],
  [/^진행$/, () => t('server.progress')],
  [/^말 (\d+)$/, (m) => t('server.msgs', { n: m[1] })],
  [/^메인$/, () => t('server.main')],
  [/^기동기$/, () => t('server.launcher')],
  [/^러너$/, () => t('server.runner')],
  [/^이벤트: ([\s\S]*)$/, (m) => t('server.event', { x: m[1] })],
  [/^완료$/, () => t('server.done')],
  [/^실패$/, () => t('server.failed')],
];

// 조각 안 어디서나(접두·접미 꼴)
const INLINE = [
  [/\(임시\) /g, () => t('server.temp')],
  [/\[이미지\]/g, () => t('server.image')],
  [/ \(전체\)$/, () => ' ' + t('server.all')],             // Edit 요약·패널 제목 '<파일> (전체)'
  [/ (\d+)줄$/, (m, n) => ' ' + t('server.nLines', { n })], // Write 요약 '<파일> N줄'
];

const off = () => isKo();

function whole(s) {
  for (const [re, f] of WHOLE) { const m = re.exec(s); if (m) return f(m); }
  return null;
}
function seg(s) {
  for (const [re, f] of SEG) { const m = re.exec(s); if (m) return f(m); }
  return s;
}

/** 서버 템플릿 문구 하나(요약·제목·라벨) → 지금 언어. 모르는 문구는 그대로 */
export function localizeServerText(s) {
  if (typeof s !== 'string' || !s || off() || !HANGUL.test(s)) return s;
  const w = whole(s);
  if (w != null) return w;
  let out = s.split(SEP).map(seg).join(SEP);
  if (!HANGUL.test(out)) return out;
  for (const [re, f] of INLINE) out = out.replace(re, f);
  return out;
}

/** 데이터일 수 있는 줄(출력·내용): 서버가 통째로 만드는 줄 모양만 바꾼다 */
export function localizeLine(s) {
  if (typeof s !== 'string' || !s || off() || !HANGUL.test(s)) return s;
  const w = whole(s);
  return w != null ? w : s;
}

/** 패널: 제목 + 장식 줄('d')은 전체 규칙, 나머지 줄은 통째 줄 모양만 */
export function localizePanel(p) {
  if (!p || typeof p !== 'object' || off()) return p;
  if (p.title) p.title = localizeServerText(p.title);
  if (Array.isArray(p.lines)) {
    const marks = typeof p.marks === 'string' ? p.marks : '';
    for (let i = 0; i < p.lines.length; i++) p.lines[i] = marks[i] === 'd' ? localizeServerText(p.lines[i]) : localizeLine(p.lines[i]);
  }
  return p;
}

const PLAN_TITLE = { '할 일': 'server.plan.todo', '작업 목록': 'server.plan.tasks', '계획': 'server.plan.plan', '워크플로': 'server.plan.workflow' };
/** 계획 보드 meta.plans: 기본 제목·'작업 N'·'단계 N — 이름'. 할 일 글·문서 제목(doc)은 데이터 */
export function localizePlans(plans) {
  if (!Array.isArray(plans) || off()) return plans;
  for (const p of plans) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p.title === 'string' && PLAN_TITLE[p.title]) p.title = t(PLAN_TITLE[p.title]);
    for (const it of Array.isArray(p.items) ? p.items : []) {
      if (!it || typeof it.t !== 'string' || !HANGUL.test(it.t)) continue;
      let m;
      if ((m = /^작업 (\d+)$/.exec(it.t))) it.t = t('server.plan.task', { n: m[1] });
      else if ((m = /^단계 (\d+)( — [\s\S]*)?$/.exec(it.t))) it.t = t('server.plan.phase', { n: m[1] }) + (m[2] || '');
    }
  }
  return plans;
}

/** 작업 대상 참조 배열: d '산출물', 서비스 이름 '사내 규정' */
export function localizeArt(refs) {
  if (!Array.isArray(refs) || off()) return refs;
  for (const r of refs) {
    if (!r || typeof r !== 'object') continue;
    if (r.d === '산출물') r.d = t('server.art.output');
    if (r.n === '사내 규정') r.n = t('server.art.rules');
  }
  return refs;
}

function localizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return;
  if (Array.isArray(meta.plans)) localizePlans(meta.plans);
}

/** 노드(스냅샷 nodes·node-add.node): label, 열린 도구 요약·패널, 계획 */
export function localizeNode(n) {
  if (!n || typeof n !== 'object' || off()) return n;
  if (typeof n.label === 'string') n.label = localizeServerText(n.label);
  for (const o of Array.isArray(n.openTools) ? n.openTools : []) {
    if (!o) continue;
    if (o.brief) o.brief = localizeServerText(o.brief);
    if (o.panel) localizePanel(o.panel);
  }
  localizeMeta(n.meta);
  return n;
}

/** 스트림 이벤트 하나(ev): brief·detail·panel·parentPanel·노드·patch·art·user 글의 서버 꼬리표 */
export function localizeEvent(ev) {
  if (!ev || typeof ev !== 'object' || off()) return ev;
  if (ev.brief) ev.brief = localizeServerText(ev.brief);
  if (ev.detail) ev.detail = localizeServerText(ev.detail);
  if (ev.panel) localizePanel(ev.panel);
  if (ev.parentPanel) localizePanel(ev.parentPanel);
  if (ev.node) localizeNode(ev.node);
  if (ev.patch && typeof ev.patch === 'object') {
    if (typeof ev.patch.label === 'string') ev.patch.label = localizeServerText(ev.patch.label);
    localizeMeta(ev.patch.meta);
  }
  if (Array.isArray(ev.art)) localizeArt(ev.art);
  if (typeof ev.text === 'string' && ev.text) {
    if (ev.type === 'tool-end' || ev.type === 'tool-start') ev.text = localizeServerText(ev.text);
    else if (ev.type === 'user' && ev.origin === 'task-notification') ev.text = localizeServerText(ev.text);
    else if (ev.type === 'user' && ev.text.includes('[이미지]')) ev.text = ev.text.replace(/\[이미지\]/g, t('server.image'));
  }
  return ev;
}

/** 스냅샷(전체 보기): nodes·recent·projects */
export function localizeSnapshot(snap) {
  if (!snap || typeof snap !== 'object' || off()) return snap;
  for (const n of Array.isArray(snap.nodes) ? snap.nodes : []) localizeNode(n);
  for (const e of Array.isArray(snap.recent) ? snap.recent : []) localizeEvent(e);
  if (Array.isArray(snap.projects)) localizeProjects(snap.projects);
  return snap;
}

/** 재생 타임라인: nodes[].label (볼거리 라벨은 web/replay/highlights.mjs highlightLabel 이 kind·n 으로 다시 만든다) */
export function localizeTimeline(tl) {
  if (!tl || typeof tl !== 'object' || off()) return tl;
  for (const n of Array.isArray(tl.nodes) ? tl.nodes : []) if (n && typeof n.label === 'string') n.label = localizeServerText(n.label);
  return tl;
}

/** /artifacts 응답: items[] 참조·nodes{id: 라벨} */
export function localizeArtifacts(body) {
  if (!body || typeof body !== 'object' || off()) return body;
  if (Array.isArray(body.items)) localizeArt(body.items);
  if (body.nodes && typeof body.nodes === 'object') for (const k of Object.keys(body.nodes)) body.nodes[k] = localizeServerText(body.nodes[k]);
  return body;
}

/** 프로젝트 목록(/projects 응답·전체 보기 'projects' 이벤트·보관함 projects): name 의 '(임시) ' 꼬리표. 배열 또는 {projects:[…]} */
export function localizeProjects(body) {
  if (!body || off()) return body;
  const list = Array.isArray(body) ? body : Array.isArray(body.projects) ? body.projects : null;
  for (const p of list || []) if (p && typeof p.name === 'string') p.name = localizeServerText(p.name);
  return body;
}
