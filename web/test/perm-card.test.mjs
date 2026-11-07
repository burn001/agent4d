// 계획 승인·도구 권한 확인 창 카드(web/perm-card.mjs): 허용/거부·사유 칸, 위험 경고와 두 번 누르기, 계획 본문(Markdown)·피드백, 보낸 상태,
// 앱 링크 꼴 검사, '항상 허용' 없음, XSS, 피드 배선(계획 카드 자리 바꿈), 문구 ko/en
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPermCard, permOpenHtml, allowStep, dangerHtml, ARM_MS } from '../perm-card.mjs';
import { rowHtml } from '../interact-view.mjs';
import { MD_TAGS } from '../markdown.mjs';
import ix from '../i18n/ix.mjs';

const T = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const LINK = 'https://claude.ai/code/' + 'session_TESTxyz789';
const BASH = { kind: 'perm', toolUseId: 'toolu_bash00001', tool: 'Bash', danger: [], cmd: 'node -p 6*7', desc: 'Print 6 times 7' };
const RM = { kind: 'perm', toolUseId: 'toolu_rm0000001', tool: 'Bash', danger: ['delete', 'force_push'], cmd: 'rm -rf build && git push -f' };
const WRITE = { kind: 'perm', toolUseId: 'toolu_write0001', tool: 'Write', danger: [], path: 'D:/x/a.txt', preview: 'hello', size: 5 };
const PLAN = { kind: 'plan', toolUseId: 'toolu_plan00001', tool: 'ExitPlanMode', md: '# Test plan\n- Step A' };
const TAGS = new Set([...MD_TAGS, 'b', 'button', 'small', 'label', 'input', 'textarea', 'a', 'span', 'code']);
const ATTR_OK = /^(class|data-pu|data-kind|role|type|disabled|href|target|rel|maxlength|placeholder|rows|align|start)$/;
function assertSafe(html, label = '') {
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    assert.ok(TAGS.has(m[1].toLowerCase()), `${label} 태그 <${m[1]}>`);
    const rest = m[2].replace(/\s([a-zA-Z-]+)(?:="[^"]*")?/g, (all, name) => { assert.match(name, ATTR_OK, `${label} 속성 ${name} in ${m[0]}`); return ''; });
    assert.equal(rest.trim(), '', `${label} 속성 꼴 이상: ${m[0]}`);
  }
  assert.doesNotMatch(html, /<script|<img|<svg|<iframe/i, label);
}

test('권한 카드: 도구 이름·명령 코드 블록·설명 · 사유 칸 · 허용/거부 단추 · 앱 링크 · 규칙 저장(항상 허용) 없음', () => {
  const h = renderPermCard(BASH, { canSend: true, link: LINK, t: T });
  assert.match(h, /data-pu="toolu_bash00001" data-kind="perm"/);
  assert.match(h, /<code class="perm-tool">Bash<\/code>/);
  assert.match(h, /node -p 6\*7/); assert.match(h, /Print 6 times 7/);
  assert.match(h, /class="perm-allow ask-answer">ix\.perm\.allow</);
  assert.match(h, /class="perm-deny">ix\.perm\.deny</);
  assert.match(h, /input type="text" class="perm-msg"/);
  assert.match(h, /ix\.perm\.only/); assert.match(h, /ix\.perm\.note/);
  assert.match(h, new RegExp(`href="${LINK}" target="_blank" rel="noopener noreferrer"`));
  assert.doesNotMatch(h, /always|항상|updatedPermissions/i);
  assert.doesNotMatch(h, /perm-danger|perm-risky/);
  assertSafe(h, 'bash');
  const w = renderPermCard(WRITE, { canSend: true, t: T });
  assert.match(w, /<code>D:\/x\/a\.txt<\/code>/); assert.match(w, /ix\.perm\.size:\{&quot;n&quot;:5\}/); assert.match(w, /hello/);
  // 보낼 수 없으면(승인 전) 단추 없이 링크만
  const ro = renderPermCard(BASH, { canSend: false, link: LINK, t: T });
  assert.doesNotMatch(ro, /perm-allow|perm-deny|perm-msg/); assert.match(ro, /ask-app/);
  // 링크 꼴이 아니면 링크 없음
  assert.doesNotMatch(renderPermCard(BASH, { canSend: true, link: 'javascript:alert(1)', t: T }), /ask-app/);
  assert.doesNotMatch(renderPermCard(BASH, { canSend: true, link: 'https://evil.example/code/session_x', t: T }), /ask-app/);
});

test('위험 명령: 경고 줄(이유 목록) · 허용 단추 강조 · 첫 누름 = 확인 대기(문구 바뀜) · 8초 안 두 번째 = 보냄', () => {
  const h = renderPermCard(RM, { canSend: true, t: T });
  assert.match(h, /perm-card s-pending perm-hot/);
  assert.match(h, /<p class="perm-danger" role="alert">⚠ ix\.perm\.danger:/);
  assert.match(dangerHtml(RM, T), /ix\.perm\.d\.delete, ix\.perm\.d\.force_push/);
  assert.match(h, /perm-allow ask-answer perm-risky">ix\.perm\.allow</);
  const armed = renderPermCard(RM, { canSend: true, armed: true, t: T });
  assert.match(armed, /perm-risky armed">ix\.perm\.allowConfirm</);
  assert.equal(allowStep(RM, null, 1000), 'arm');
  assert.equal(allowStep(RM, 1000, 1000 + ARM_MS - 1), 'send');
  assert.equal(allowStep(RM, 1000, 1000 + ARM_MS + 1), 'arm', '시간이 지나면 다시 처음부터');
  assert.equal(allowStep(BASH, null), 'send', '평범한 명령은 한 번');
  assert.equal(allowStep(PLAN, null), 'send');
  assert.equal(dangerHtml(BASH, T), '');
});

test('계획 카드: 본문 Markdown · 피드백 칸 · 승인/거부(피드백) · 본문이 비면 transcript 계획 · 보낸 상태(승인함·거부함·실패 이유)', () => {
  const h = renderPermCard(PLAN, { canSend: true, link: LINK, t: T });
  assert.match(h, /plan-card perm-card s-planPending" data-pu="toolu_plan00001" data-kind="plan"/);
  assert.match(h, /<h3 class="md-h">Test plan<\/h3>/);
  assert.match(h, /<textarea class="perm-msg"/);
  assert.match(h, /perm-allow ask-answer">ix\.perm\.approve</); assert.match(h, /perm-deny">ix\.perm\.reject</);
  assert.match(h, /ix\.perm\.planNote/);
  assertSafe(h, 'plan');
  assert.match(renderPermCard({ ...PLAN, md: '' }, { canSend: true, t: T, fallbackMd: '## From transcript' }), /From transcript/);
  const sending = renderPermCard(PLAN, { canSend: true, st: { state: 'sending' }, t: T });
  assert.match(sending, /ix\.st\.sending/); assert.match(sending, /perm-allow ask-answer" disabled/); assert.doesNotMatch(sending, /perm-msg/);
  assert.match(renderPermCard(PLAN, { canSend: true, st: { state: 'answered', decision: 'allow' }, t: T }), /ix\.perm\.st\.approved/);
  assert.match(renderPermCard(PLAN, { canSend: true, st: { state: 'answered', decision: 'deny' }, t: T }), /ix\.perm\.st\.rejected/);
  assert.match(renderPermCard(BASH, { canSend: false, st: { state: 'answered', decision: 'deny' }, t: T }), /st-denied" role="status">ix\.perm\.st\.denied/);
  assert.match(renderPermCard(BASH, { canSend: true, st: { state: 'failed', why: 'not_pending' }, t: T }), /ix\.st\.failed:\{&quot;why&quot;:&quot;ix\.why\.not_pending&quot;\}/);
  assert.match(permOpenHtml(LINK, T), /ix\.perm\.open/);
  assert.equal(renderPermCard({ kind: 'x', toolUseId: 'a' }, { t: T }), '');
});

test('XSS: 명령·경로·도구 이름·계획 본문·toolUseId 의 태그는 글자로', () => {
  const evil = '<img src=x onerror=alert(1)>"\'`';
  const h = renderPermCard({ kind: 'perm', toolUseId: 'a"b<c', tool: evil, danger: [], cmd: evil + '\n```\n' + evil, path: evil, preview: evil, url: evil, json: evil }, { canSend: true, t: T });
  assertSafe(h, 'evil');
  assert.doesNotMatch(h, /<img/);
  const p = renderPermCard({ kind: 'plan', toolUseId: 'x1', md: `# ${evil}\n<script>alert(1)</script>` }, { canSend: true, t: T });
  assertSafe(p, 'evil plan');
  assert.match(renderPermCard({ kind: 'perm', toolUseId: 'm1', tool: 'Bash', danger: [], minimal: 1 }, { canSend: true, t: T }), /ix\.perm\.hidden/);
});

test('피드 배선: 열린 계획 창이면 transcript 계획 카드 자리를 승인 카드로 · 답이 오면 평소 카드 · 문구 ko/en 짝', () => {
  const row = { k: 'ask', id: 'toolu_plan00001', card: { t: 'plan', md: '' } };
  const shown = new Set();
  const h = rowHtml(row, { t: T, pend: new Map([['toolu_plan00001', PLAN]]), permSt: new Map(), shown, canSend: true, link: LINK, cards: new Map() });
  assert.match(h, /perm-allow/); assert.ok(shown.has('toolu_plan00001'));
  const done = rowHtml({ ...row, res: { st: 'approved' } }, { t: T, pend: new Map([['toolu_plan00001', PLAN]]), permSt: new Map(), shown: new Set(), canSend: true, cards: new Map() });
  assert.doesNotMatch(done, /perm-allow/);
  const keys = (o) => Object.keys(o).filter((k) => k.startsWith('ix.perm.') || k === 'ix.why.confirm' || k === 'ix.why.kind').sort();
  assert.deepEqual(keys(ix.en), keys(ix.ko));
  for (const c of ['delete', 'force_push', 'git_reset', 'git_clean', 'disk', 'system', 'kill', 'perm', 'sudo', 'remote_exec', 'db_drop', 'sensitive_path', 'publish']) assert.ok(ix.en['ix.perm.d.' + c] && ix.ko['ix.perm.d.' + c], c);
  const js = readFileSync(new URL('../interact.js', import.meta.url), 'utf8');
  assert.match(js, /_post\('pending'/); assert.match(js, /_post\('perm'/); assert.match(js, /confirm: true/);
  assert.match(js, /'confirm', 'kind'/);
});

test('답한 카드: 머리 표지가 결과(허용함·거부함·승인함)로 · 대기 안내·위험 경고·앱 링크 없음', () => {
  const d = renderPermCard(RM, { canSend: false, link: LINK, st: { state: 'answered', decision: 'deny' }, t: T });
  assert.match(d, /perm-card s-declined"/); assert.match(d, /ask-badge s-declined">ix\.perm\.st\.denied</);
  assert.doesNotMatch(d, /ix\.perm\.only|perm-danger|ask-app|⏳/);
  const a = renderPermCard(PLAN, { canSend: true, link: LINK, st: { state: 'answered', decision: 'allow' }, t: T });
  assert.match(a, /plan-card perm-card s-answered"/); assert.match(a, /ask-badge s-answered">ix\.perm\.st\.approved</);
  assert.doesNotMatch(a, /ix\.perm\.planOnly|ask-app|perm-msg/);
});
