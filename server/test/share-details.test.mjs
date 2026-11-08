// 공유 링크 잠금 등급 details(설명 공개): 필터(경로·명령·ADR·커밋·이메일·이름) · shareClean · CLI 등급 표기 (합성 데이터만)
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubText, scrubDesc, meaningful, toolAction, toolEndText } from '../share-scrub.mjs';
import { shareClean, shareLevel, sha256hex, newShareToken } from '../share.mjs';
import { parseLevel, lockText, mdOf } from '../../bin/share.mjs';

const ko = (s, o = {}) => scrubText(s, { lang: 'ko', ...o });

test('필터: 경로(드라이브·유닉스·상대·UNC·홈·한글 조사 붙은 파일 이름)', () => {
  const cases = [
    ['D:\\WORK_REPOS\\project_acme\\docs\\GLOSSARY.md 확인', '[파일] 확인'],
    ['C:/Users/alice/AppData/Local/Temp/x 정리', '[파일] 정리'],
    ['"D:\\CLOUD\\폴더 이름 공백\\a.hwpx" 열기', '[파일] 열기'],
    ['docs/GLOSSARY.md를 읽기', '[파일]를 읽기'],
    ['scripts/autopilot-axes/ 목록', '[파일] 목록'],
    ['배치 .env에 키 확인', '배치 [파일]에 키 확인'],
    ['RULES.md 33줄', '[파일] 33줄'],
    ['\\\\fileserver\\share\\x 복사', '[파일] 복사'],
    ['~/.claude/projects 정리', '[파일] 정리'],
    ['run.py · build.sh · notes.json · data.jsonl · a.ps1 · b.mjs', '[파일]'],
  ];
  for (const [i, o] of cases) assert.equal(ko(i), o, i);
  // 경로가 아닌 것은 둔다: 분수·날짜·한글 짝·I/O·슬래시 명령·제품 이름
  for (const keep of ['팔 교체 — research 1/3', '2026/11/05 회의', '읽기/쓰기 나눔', 'I/O 대기', '/done 으로 마무리', 'Node.js 판 올림', 'suite completion (pass/fail summary)']) assert.equal(ko(keep), keep, keep);
});

test('필터: 셸 명령·스크립트 호출·인라인 코드·코드 식별자', () => {
  assert.equal(ko('ls "D:/x/" 2>/dev/null; ls | head -40'), '[명령]');
  assert.equal(ko('$ npm test'), '[명령]');
  assert.equal(ko('git status 보고 커밋'), '[명령] 보고 커밋');
  assert.equal(ko('npm test 실행'), '[명령] 실행');
  assert.equal(ko('bash scripts/loop-resume.sh; echo "rc=$?"'), '[명령]');
  assert.equal(ko('python -X utf8 fix.py 로 고침'), '[명령] 로 고침');
  assert.equal(ko('Get-ChildItem -Recurse 결과'), '[명령] 결과');
  assert.equal(ko('`grep -rn foo` 로 찾기'), '[코드] 로 찾기');
  assert.equal(ko('Check measure_env loader'), 'Check [코드] loader');
  assert.equal(ko('project_acme 범위', { keep: ['project_acme'] }), 'project_acme 범위');
  assert.equal(ko('분리 실행 · -m cli.probe.walk'), '분리 실행 · [코드]');
  assert.equal(scrubDesc('[파일]; S=$P'), '');
  assert.equal(ko('NODE_ENV=prod 로 실행'), '[명령] 로 실행');
  // 영어 설명의 흔한 낱말은 명령으로 보지 않는다
  for (const keep of ['Find and delete temp files', 'Check status and count occurrences', 'Tunnel status and fetch batch env 0/1 lines', 'Sort results by size', 'git 커밋 정리']) assert.equal(ko(keep), keep, keep);
});

test('필터: ADR·문서 번호·커밋 해시·브랜치·이메일·사람 이름·주소', () => {
  assert.equal(ko('ADR-0042 와 ADR 490 갱신'), '[문서] 와 [문서] 갱신');
  assert.equal(ko('설계 §9 · §150.3 반영'), '설계 [문서] 반영');
  assert.equal(ko('Q132 축 점검'), '[문서] 축 점검');
  assert.equal(ko('커밋 d1b2e040f 되돌림'), '커밋 [커밋] 되돌림');
  assert.equal(ko('46232707a chore: bump'), '[커밋] chore: bump');
  assert.equal(ko('branch feat/share-details 정리'), 'branch [브랜치] 정리');
  assert.equal(ko('alice@example.com 에게 회신'), '[이메일] 에게 회신');
  assert.equal(ko('김민수 박사 지시 반영'), '[이름] 박사 지시 반영');
  assert.equal(ko('박사님 지시 반영'), '박사님 지시 반영');
  assert.equal(ko('Dr. Cho 검토'), '[이름] 검토');
  assert.equal(ko('https://acme.example.net:8443/x?t=1 열기'), '[주소] 열기');
  assert.equal(ko('sk-ant-api03-abcdefghijklmnopqrstuvwxyz 키'), 'sk-ant-*** 키'); // redact 먼저
  assert.equal(scrubText('ADR-7 [x] D:\\a', { lang: 'en' }), '[doc] [x] [file]');
  // 결과에 남지 않아야 할 꼴
  const mix = ko('D:\\a\\b.py 와 ADR-12 와 0490ab1c 와 x@y.kr 와 src/a.ts 와 run.sh');
  for (const re of [/[A-Za-z]:[\\/]/, /\.(py|sh|ts)\b/, /ADR-?\d/, /\b[0-9a-f]{7,40}\b/, /@/]) assert.ok(!re.test(mix), re + ' ' + mix);
});

test('필터: 의미 있는 낱말이 없으면 빈 값(이름표는 일반 이름으로)', () => {
  assert.equal(meaningful('[명령]'), false);
  assert.equal(meaningful('[파일] · [커밋]'), false);
  assert.equal(meaningful('팔 교체'), true);
  assert.equal(scrubDesc('claude -p · f7c5e3b1'), '');
  assert.equal(scrubDesc('bash scripts/session-monitor.sh'), '');
  assert.equal(scrubDesc('재부팅 후 인계 지시 파일 집행'), '재부팅 후 인계 지시 파일 집행');
  assert.ok(ko('가'.repeat(300), { max: 80 }).length <= 80);
});

test('도구 동작 한 줄: 원문 입력 대신 도구별 일반 문장 + 정리한 설명', () => {
  assert.equal(toolAction({ tool: 'Read', text: 'secret.py', brief: 'x/secret.py' }), '파일 읽는 중');
  assert.equal(toolAction({ tool: 'Edit', text: 'a.ts', brief: 'a.ts +3 −1' }), '파일 고치는 중');
  assert.equal(toolAction({ tool: 'Grep', text: 'password', brief: '"password"' }), '코드 검색');
  // Bash: description(detail) 이 있으면 그 글, 없으면(명령 원문) 일반 문장
  assert.equal(toolAction({ tool: 'Bash', text: '테스트 실행', brief: 'npm test', detail: '테스트 실행' }), '테스트 실행');
  assert.equal(toolAction({ tool: 'Bash', text: 'ls D:/x', brief: 'ls D:/x', detail: '' }), '명령 실행');
  assert.equal(toolAction({ tool: 'Bash', text: 'cd "C:/a" && py x.py', brief: 'py x.py', detail: '백그라운드' }), '명령 실행');
  assert.equal(toolAction({ tool: 'Bash', text: 'D:/x/run.sh 결과 확인', brief: 'bash D:/x/run.sh', detail: 'D:/x/run.sh 결과 확인' }), '[파일] 결과 확인');
  // 스냅샷 openTools(detail 없음)
  assert.equal(toolAction({ tool: 'Bash', text: 'git log -3', brief: 'git log -3' }), '명령 실행');
  assert.equal(toolAction({ tool: 'Bash', text: '작업트리 상태 확인', brief: 'git status' }), '작업트리 상태 확인');
  assert.equal(toolAction({ tool: 'Agent', text: '팔 교체 — research 1/3' }), '서브에이전트에 맡김: 팔 교체 — research 1/3');
  assert.equal(toolAction({ tool: 'WebSearch', text: '건축법 개정 2026' }), '웹 검색: 건축법 개정 2026');
  assert.equal(toolAction({ tool: 'WebFetch', text: 'acme.example.net' }), '웹 페이지 읽는 중');
  assert.equal(toolAction({ tool: 'Skill', skill: 'office-tools', text: 'office-tools' }), '스킬: office-tools');
  assert.equal(toolAction({ tool: 'mcp__rea__open_binary', text: 'rea.open_binary' }), '외부 도구 호출(MCP)');
  assert.equal(toolAction({ tool: 'Read' }, 'en'), 'Reading a file');
  assert.equal(toolEndText(true), '완료'); assert.equal(toolEndText(false, 'en'), 'Failed');
});

const P = 'D--WORK-REPOS-proj-x';
const mkShare = (extra = {}) => { const token = newShareToken(); return { id: 'ab12cd34', alias: 't', token, hash: sha256hex(token), project: P, cwd: 'D:\\WORK_REPOS\\proj_x', name: '프로젝트',
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600e3).toISOString(), redact: 'details', ...extra }; };
const SID = '11111111-2222-3333-4444-555555555555';

test('shareClean details: 이름표·제목·설명·종류·스킬·프로젝트 이름은 보이고 원문·패널·파일·작업 대상은 빠진다', () => {
  const sh = mkShare();
  assert.equal(shareLevel(sh), 'details');
  assert.equal(shareLevel({ redact: true }), 'full');
  assert.equal(shareLevel({ redact: 'full' }), 'full');
  const snap = {
    nodes: [
      { id: 's:' + SID, kind: 'main', label: '메인 · proj_x', status: 'active', projectId: P, meta: { cwd: 'D:\\WORK_REPOS\\proj_x', title: 'ADR-0042 보고서 D:\\x\\a.md 정리', skill: 'office-tools', git: 'feat/x' },
        openTools: [{ toolUseId: 'toolu_01ABCDEFGHijk', tool: 'Bash', cat: 'shell', text: 'git push origin main', brief: 'git push origin main', panel: { lines: ['x'] } }] },
      { id: 'a:a01311015957b6209', parentId: 's:' + SID, kind: 'subagent', label: '팔 교체 — docs/plans 묶음 (김민수 박사 지시)', status: 'active', projectId: P, meta: { agentType: 'acme-sweeper', toolUseId: 'toolu_01XYZabcdefgh' } },
      { id: 'b:toolu_013AYzKXa3H98k3H8t5maeP4', parentId: 's:' + SID, kind: 'bash-bg', label: 'bash scripts/loop-resume.sh; echo "rc=$?"', status: 'active', projectId: P, meta: { command: 'bash scripts/loop-resume.sh' } },
    ],
    recent: [
      { type: 'tool-start', nodeId: 's:' + SID, toolUseId: 'toolu_01AAAAAAAAAAAA', tool: 'Bash', cat: 'shell', skill: null, text: '테스트 실행', brief: 'npm test -- --grep share', detail: '테스트 실행',
        panel: { title: '$ npm test', lines: ['secret line'] }, file: { k: 'd:/x/a.py', n: 'a.py' }, art: [{ p: 'src/a.py' }], projectId: P },
      { type: 'tool-end', nodeId: 's:' + SID, toolUseId: 'toolu_01AAAAAAAAAAAA', tool: 'Bash', cat: 'shell', ok: true, durationMs: 1200, text: 'PASS 12 tests in D:\\x', brief: 'exit 0 · 12 passed', panel: { lines: ['ok'] } },
      { type: 'tool-start', nodeId: 's:' + SID, toolUseId: 'toolu_01BBBBBBBBBBBB', tool: 'Skill', cat: 'skill', skill: 'office-tools', text: 'office-tools', brief: 'office-tools list --box inbox', detail: 'list --box inbox' },
      { type: 'text', nodeId: 's:' + SID, role: 'assistant', text: '커밋 d1b2e040f 했습니다', brief: '커밋 d1b2e040f 했습니다', md: '# x', panel: { mode: 'say', lines: ['말'] } },
      { type: 'user', nodeId: 's:' + SID, origin: 'human', text: '프롬프트 원문 D:\\x', ix: { cat: 'user', op: 'prompt', text: '프롬프트 원문' } },
    ],
    projects: [{ projectId: P, name: 'proj_x', path: 'D:\\WORK_REPOS\\proj_x', liveList: [{ sessionId: SID, title: '발표자료 준비 alice@example.com' }] }],
  };
  const out = shareClean(snap, { share: sh, lang: 'ko', level: 'details' });
  const s = JSON.stringify(out);
  for (const bad of ['D:', 'd:/', '.py', '.md', 'ADR-0042', '0042', 'scripts/', 'loop-resume', 'npm test', 'git push', 'secret line', 'd1b2e040f', '김민수', 'example.com', '프롬프트 원문', 'feat/x', 'exit 0', 'PASS'])
    assert.ok(!s.includes(bad), bad + ' 가 남음: ' + s);
  const [m, a, b] = out.nodes;
  assert.equal(m.label, '메인 · proj_x');
  assert.equal(m.meta.title, '[문서] 보고서 [파일] 정리');
  assert.equal(m.meta.skill, 'office-tools');
  assert.equal(m.meta.cwd, undefined);
  assert.equal(m.openTools[0].brief, '명령 실행');
  assert.equal(m.openTools[0].panel, undefined);
  assert.equal(a.label, '팔 교체 — [파일] 묶음 ([이름] 박사 지시)');
  assert.equal(a.meta.agentType, 'acme-sweeper');
  assert.equal(b.label, '백그라운드 작업'); // 명령뿐인 이름표 → 일반 이름
  const [ts, te, sk, tx, us] = out.recent;
  assert.equal(ts.brief, '테스트 실행'); assert.equal(ts.text, '테스트 실행'); assert.equal(ts.detail, '');
  assert.equal(ts.panel, undefined); assert.equal(ts.file, undefined); assert.equal(ts.art, undefined);
  assert.equal(te.brief, '완료'); assert.equal(te.text, ''); assert.equal(te.ok, true);
  assert.equal(sk.brief, '스킬: office-tools'); assert.equal(sk.skill, 'office-tools');
  assert.equal(tx.text, ''); assert.equal(tx.brief, ''); assert.equal(tx.md, undefined); assert.equal(tx.panel, undefined);
  assert.equal(us.text, ''); assert.equal(us.ix.op, 'prompt'); assert.equal(us.ix.text, '');
  assert.equal(out.projects[0].projectId, 'share-ab12cd34');
  assert.equal(out.projects[0].name, 'proj_x');
  assert.equal(out.projects[0].liveList[0].title, '발표자료 준비 [이메일]');
  // 같은 데이터를 full 로 정리하면 예전처럼 일반 이름표·빈 글
  const full = shareClean(snap, { share: { ...sh, redact: true }, lang: 'ko', level: 'full' });
  assert.equal(full.nodes[1].label, '서브에이전트');
  assert.equal(full.nodes[1].meta.agentType, undefined);
  assert.equal(full.recent[0].brief, '');
  assert.equal(full.projects[0].name, '프로젝트');
});

test('CLI 잠금 등급: --redact 값 읽기·목록 표기', () => {
  assert.equal(parseLevel(true), 'full');
  assert.equal(parseLevel('details'), 'details');
  assert.equal(parseLevel('FULL'), 'full');
  assert.equal(parseLevel('none'), null);
  const sh = mkShare();
  assert.match(lockText(sh), /설명 공개/);
  assert.match(lockText({ ...sh, redact: true }), /텍스트 제거/);
  const md = mdOf([sh]);
  assert.ok(md.includes('설명 공개') && !md.includes(sh.token));
});
