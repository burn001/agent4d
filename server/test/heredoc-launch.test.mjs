// heredoc 본문은 셸 명령이 아니다: `python - <<'EOF' … EOF`·`cat <<EOF > f`·`node --input-type=module <<'JS'` 본문 줄에 적힌
// `node …/archive.mjs`·`nohup bash x.sh &` 때문에 기동기가 잘못 떴다(실측 세션의 서브에이전트 `기동기 · archive.mjs`,
// 자율 루프 저장소 3c8e89e4 서브에이전트의 `cat > edit_skill.py <<'EOF'` → `기동기 · relaunch.sh`). 셸 인터프리터로 넘기는 본문만 명령으로 남긴다.
// 같은 해석을 쓰는 곳(claude -p· 끄는 명령· 분리 프로세스·들여다보기 경로· bg 로그·보관함 고정)도 함께. 합성 레포·transcript.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { detectLaunch, analyzeLaunch, LauncherIndex } from '../launcher.mjs';
import { blankHeredocs, detectClaudeP, isKillCommand } from '../parse.mjs';
import { detectProcLaunch, commandPathRefs, redirectLogs } from '../procs.mjs';
import { collectExtras } from '../../bin/archive.mjs';

const M = 'e4e4e4e4-4444-4444-8444-444444444444';
const C1 = 'f4f4f4f4-0000-4000-8000-000000000004';
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
let root, projects, index, repo;
const write = (dir, sid, recs) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };

// 실측 꼴: 문서를 고치는 python heredoc 본문에 사슬 스크립트 이름·`node bin/archive.mjs` 가 적혀 있음(명령 줄은 cd·python 뿐)
const DOC_EDIT = [
  'cd REPO && python - <<\'EOF\'',
  "p='CONTRACT.md'",
  "s=open(p,encoding='utf8').read()",
  "add='''",
  '- 실측: nohup bash .loop/relaunch.sh > relaunch.out 2>&1 < /dev/null &',
  '- 보관 고정: node bin/archive.mjs --pin &',
  "'''",
  "open(p,'w',encoding='utf8').write(s+add)",
  'EOF',
  'git diff --stat',
].join('\n');
const NODE_HD = "node --input-type=module <<'JS'\nimport fs from 'node:fs';\n// nohup bash .loop/relaunch.sh &\nconsole.log(1)\nJS";
const CAT_HD = 'cat > notes.sh <<EOF\nnohup bash .loop/relaunch.sh > o 2>&1 &\nEOF\necho ok';

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-heredoc-'));
  projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  repo = path.join(root, 'repo');
  for (const d of [path.join(repo, '.loop'), path.join(repo, 'bin'), path.join(repo, 'scripts')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), '#!/usr/bin/env bash\nnohup bash scripts/loop.sh >> runner.out 2>&1 < /dev/null &\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'loop.sh'), '#!/usr/bin/env bash\nwhile :; do printf x | claude -p --output-format json > o.json; done\n');
  // claude -p 를 '문자열로만' 담은 노드 프로그램이 아니라 실제로 부르는 꼴(본문 판정이 틀리면 기동기로 잡힘)
  fs.writeFileSync(path.join(repo, 'bin', 'archive.mjs'), "import { spawn } from 'node:child_process';\nspawn('sh', ['-c', 'x']); // claude -p\nconst run = () => exec(`claude -p hi`);\n");
  // 셸 스크립트 안 heredoc: 다른 스크립트를 '쓰기만' 하는 본문(claude -p 포함) — 기동 사슬 아님
  fs.writeFileSync(path.join(repo, 'scripts', 'gen.sh'), '#!/usr/bin/env bash\ncat > .loop/next.sh <<EOF\nwhile :; do claude -p --output-format json; done\nEOF\nchmod +x .loop/next.sh\n');
  // 셸 스크립트 안 heredoc 이 셸로 들어감 — 본문이 곧 명령
  fs.writeFileSync(path.join(repo, 'scripts', 'feed.sh'), "#!/usr/bin/env bash\nbash <<'EOF'\nwhile :; do printf x | claude -p --output-format json > o.json; done\nEOF\n");

  const now = Date.now();
  const T = (sec) => new Date(now - 3000_000 + sec * 1000).toISOString();
  const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd: repo, version: '2.1.309', entrypoint: ep });
  const A = (sec, block) => ({ type: 'assistant', timestamp: T(sec), ...base(M), message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (sec, id, text) => ({ type: 'user', timestamp: T(sec), ...base(M), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: { stdout: text, stderr: '' } });
  const pdir = path.join(projects, enc(repo));
  const R2 = repo.replace(/\\/g, '/');
  write(pdir, M, [
    { type: 'user', timestamp: T(1), ...base(M), message: { role: 'user', content: '문서 고치고 루프 재개' } },
    A(5, { type: 'tool_use', id: 'toolu_doc', name: 'Bash', input: { description: 'CONTRACT 고치기', command: DOC_EDIT.replace('REPO', R2) } }),
    R(6, 'toolu_doc', ' CONTRACT.md | 2 ++'),
    A(7, { type: 'tool_use', id: 'toolu_nodehd', name: 'Bash', input: { description: '노드 heredoc', command: NODE_HD } }),
    R(8, 'toolu_nodehd', '1'),
    A(9, { type: 'tool_use', id: 'toolu_cathd', name: 'Bash', input: { description: '스크립트 쓰기', command: CAT_HD } }),
    R(9.5, 'toolu_cathd', 'ok'),
    A(10, { type: 'tool_use', id: 'toolu_real', name: 'Bash', input: { description: '루프 재개', command: `python - <<'EOF'\nprint('nohup bash scripts/loop.sh &')\nEOF\ncd ${R2} && nohup bash .loop/relaunch.sh > relaunch.out 2>&1 < /dev/null & disown` } }),
    R(12, 'toolu_real', ''),
    A(300, { type: 'text', text: '대기' }),
  ]);
  write(pdir, C1, [
    { type: 'user', timestamp: T(60), ...base(C1, 'sdk-cli'), promptSource: 'sdk', message: { role: 'user', content: '자율 사이클이다.\n첫 회차' } },
    { type: 'assistant', timestamp: T(200), ...base(C1, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '사이클 끝' }] } },
  ]);
  const touch = (sid, sec) => fs.utimesSync(path.join(pdir, `${sid}.jsonl`), new Date(Date.parse(T(sec))), new Date(Date.parse(T(sec))));
  touch(C1, 200); touch(M, 300);
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('blankHeredocs: 본문·끝 표지만 같은 길이 공백(줄바꿈 남김) · <<- · 따옴표 표지 · 여러 개 · <<< 아님 · 덜 닫힘은 그대로', () => {
  const B = (c, o) => blankHeredocs(c, o);
  const a = "python - <<'EOF'\nnohup bash x.sh &\nEOF\necho done";
  assert.equal(B(a).length, a.length);
  assert.equal(B(a), "python - <<'EOF'\n" + ' '.repeat(17) + '\n   \necho done');
  assert.equal(B('cat <<-X\n\tb\n\tX\nnext'), 'cat <<-X\n  \n  \nnext', '<<- 는 앞 탭 무시');
  assert.equal(B('cat <<"E" > f\nnode a.mjs\nE\nls'), 'cat <<"E" > f\n          \n \nls');
  assert.equal(B('a <<A <<\'B\'\n1\nA\n2\nB\ntail'), "a <<A <<'B'\n \n \n \n \ntail", '한 줄 두 heredoc — 본문이 차례로');
  assert.equal(B('cat <<EOF\nx\nEOF\ncat <<EOF\ny\nEOF\nz'), 'cat <<EOF\n \n   \ncat <<EOF\n \n   \nz', '여러 줄의 heredoc');
  const hs = 'cat <<< "$x" ; nohup bash y.sh &';
  assert.equal(B(hs), hs, '<<< here-string 은 heredoc 아님');
  assert.equal(B('x=$((1<<3)); echo hi'), 'x=$((1<<3)); echo hi', '산술 시프트');
  assert.equal(B("echo '<<EOF'\nnohup bash y.sh &"), "echo '<<EOF'\nnohup bash y.sh &", '따옴표 안 << 는 연산자 아님');
  assert.equal(B('# cat <<EOF\nnohup bash y.sh &'), '# cat <<EOF\nnohup bash y.sh &', '주석 안 << 는 연산자 아님');
  assert.equal(B('python - <<EOF\nnever closed'), 'python - <<EOF\nnever closed', '덜 닫힌 heredoc 은 손대지 않음');
  // 커밋 메시지 꼴 "$(cat <<'EOF' … EOF\n)" 와 표지 바로 뒤 ) 꼴
  const cm = 'git commit -m "$(cat <<\'EOF\'\nfix & node a.mjs\nEOF\n)" && nohup bash y.sh &';
  assert.equal(B(cm), 'git commit -m "$(cat <<\'EOF\'\n' + ' '.repeat(16) + '\n   \n)" && nohup bash y.sh &');
  assert.equal(B('x=$(cat <<EOF\nbody\nEOF)\nls'), 'x=$(cat <<EOF\n    \n   )\nls');
  // PowerShell here-string · 인라인 코드 인자
  assert.equal(B("$s = @'\nnode a.mjs\n'@\nwrite-host x", { tool: 'PowerShell' }), "$s = @'\n          \n'@\nwrite-host x");
  assert.equal(B('node -e "spawn(\'nohup bash x.sh &\')" && ls'), 'node -e "' + ' '.repeat(26) + '" && ls');
  assert.equal(B("python3 -c 'import os; os.system(\"bash x.sh &\")'"), "python3 -c '" + ' '.repeat('import os; os.system("bash x.sh &")'.length) + "'");
  assert.equal(B('bash -c "nohup bash x.sh &"'), 'bash -c "nohup bash x.sh &"', 'bash -c 문자열은 셸 명령 — 그대로');
});

test('blankHeredocs: 셸 인터프리터로 들어가는 본문은 명령으로 남김(끝 표지만 지움) · ssh·python·bash -c·bash 파일 은 지움', () => {
  const B = (c) => blankHeredocs(c);
  assert.equal(B('bash <<EOF\nnohup bash x.sh &\nEOF'), 'bash <<EOF\nnohup bash x.sh &\n   ');
  assert.equal(B('sudo -E bash -x <<\'EOF\'\nrun\nEOF'), "sudo -E bash -x <<'EOF'\nrun\n   ");
  assert.equal(B('timeout 60 sh -s -- a b <<EOF\nrun\nEOF'), 'timeout 60 sh -s -- a b <<EOF\nrun\n   ');
  assert.equal(B('cat <<EOF | bash\nrun\nEOF'), 'cat <<EOF | bash\nrun\n   ', 'cat <<EOF | bash');
  assert.equal(B('ssh h bash <<EOF\nrun\nEOF'), 'ssh h bash <<EOF\n   \n   ', 'ssh 원격 — 이 PC 명령 아님');
  assert.equal(B('bash x.sh <<EOF\nrun\nEOF'), 'bash x.sh <<EOF\n   \n   ', '스크립트의 표준 입력은 자료');
  assert.equal(B('bash -c "read a" <<EOF\nrun\nEOF'), 'bash -c "read a" <<EOF\n   \n   ');
  assert.equal(B('cat <<EOF | python\nrun\nEOF'), 'cat <<EOF | python\n   \n   ');
});

test('detectLaunch: heredoc 본문의 스크립트·분리 표지는 기동 후보 아님 · heredoc 밖 진짜 기동은 그대로 · bash <<EOF 본문은 명령', () => {
  const R2 = repo.replace(/\\/g, '/');
  assert.equal(detectLaunch(DOC_EDIT.replace('REPO', R2), { fg: true }), null, '문서 고치는 python heredoc');
  assert.equal(detectLaunch(NODE_HD, { fg: true }), null, 'node --input-type=module heredoc');
  assert.equal(detectLaunch(CAT_HD, { fg: true }), null, 'cat > f <<EOF');
  assert.equal(detectLaunch('node -e "require(\'child_process\').exec(\'nohup bash .loop/relaunch.sh &\')"', { fg: true }), null, 'node -e 코드');
  const real = detectLaunch(`python - <<'EOF'\nprint(1)\nEOF\ncd ${R2} && nohup bash .loop/relaunch.sh > o 2>&1 < /dev/null & disown`, { fg: true });
  assert.deepEqual(real?.tokens, ['.loop/relaunch.sh']);
  assert.equal(real.cdGuess, R2, 'cd 위치 계산이 원문과 같음(같은 길이)');
  assert.equal(analyzeLaunch(real, R2)?.script, 'relaunch.sh');
  const fed = detectLaunch(`cd ${R2} && bash <<'EOF'\nnohup bash .loop/relaunch.sh > o 2>&1 &\nEOF`, { fg: true });
  assert.deepEqual(fed?.tokens, ['.loop/relaunch.sh'], '셸로 넘긴 본문은 명령');
  // 본문에만 claude -p 가 적혀 있으면 이 아님 → 밖의 분리 기동은 기동기로 본다(예전엔 claude -p 로 오인해 null)
  const mixed = detectLaunch(`python - <<'EOF'\ns='claude -p --output-format json'\nEOF\ncd ${R2} && nohup bash .loop/relaunch.sh > o 2>&1 &`, { fg: true });
  assert.deepEqual(mixed?.tokens, ['.loop/relaunch.sh']);
});

test('analyzeLaunch: 셸 스크립트 안 heredoc 본문(파일 쓰기)은 사슬 아님 · bash <<EOF 본문은 사슬', () => {
  assert.equal(analyzeLaunch(detectLaunch('nohup bash scripts/gen.sh > o 2>&1 &'), repo), null, 'gen.sh 는 claude -p 를 파일로 쓰기만');
  assert.equal(analyzeLaunch(detectLaunch('nohup bash scripts/feed.sh > o 2>&1 &'), repo)?.script, 'feed.sh', 'feed.sh 는 bash 로 claude -p 루프를 돌림');
});

test('같은 해석: claude -p(§4.3)·끄는 명령(§37)·분리 프로세스(§103)·경로 참조·bg 로그(§107)', () => {
  assert.equal(detectClaudeP("python - <<'EOF'\ndoc = 'claude -p --output-format json'\nEOF"), null, '본문에 적힌 claude -p 는 호출 아님');
  const d = detectClaudeP("claude -p <<'EOF'\n긴 프롬프트 본문입니다\nEOF");
  assert.ok(d, 'claude -p <<EOF 는 호출');
  assert.equal(d.promptHint, '긴 프롬프트 본문입니다', '프롬프트 후보는 원문 본문에서');
  assert.ok(detectClaudeP("cat <<'EOF' | claude -p\n프롬프트\nEOF"));
  assert.ok(detectClaudeP('bash <<EOF\nclaude -p hi\nEOF'), '셸로 넘긴 본문의 claude -p 는 호출');
  assert.equal(isKillCommand("cat > notes.md <<'EOF'\n서버는 taskkill //PID 1234 //F 로 끈다\nEOF"), false);
  assert.equal(isKillCommand('taskkill //PID 1234 //F'), true);
  assert.deepEqual(detectProcLaunch("cat > run.sh <<'EOF'\nnohup python worker.py > w.log 2>&1 &\nEOF\nchmod +x run.sh"), [], '본문은 분리 프로세스 아님');
  assert.equal(detectProcLaunch("python - <<'EOF'\nprint(1)\nEOF\nnohup python worker.py > w.log 2>&1 &", { cwd: repo }).length, 1, 'heredoc 밖 분리 실행은 그대로');
  const refs = commandPathRefs("python - <<'EOF'\nopen('logs/a.log')\nEOF\ntail -n 5 logs/b.log", { cwd: repo });
  assert.ok(refs.some((r) => r.endsWith('/logs/b.log')) && !refs.some((r) => r.includes('a.log')), JSON.stringify(refs));
  assert.deepEqual(redirectLogs("cat <<'EOF' > notes.txt\necho x > inside.log\nEOF", { cwd: repo }).map((x) => path.basename(x)), [], '본문의 > 는 리다이렉트 아님 · cat 은 짧은 명령');
});

for (const offline of [false, true]) {
  test(`${offline ? '재생' : '라이브'}: heredoc 명령들은 기동기 노드가 아니고, heredoc 뒤 진짜 기동 아래 회차`, async () => {
    await index.refresh();
    index.claimedChildren.clear();
    index.launchers = new LauncherIndex(index, { bootMs: 0 });
    const rt = new RootRuntime({ sessionId: M, index, offline });
    try {
      if (offline) await rt.loadOffline();
      else {
        await rt.start();
        for (let i = 0; i < 20 && !rt.graph.get(`s:${C1}`); i++) { await rt.scanAll(); await new Promise((r) => setTimeout(r, 50)); }
        rt.sweep();
      }
      const g = rt.graph;
      const launchers = [...g.nodes.values()].filter((n) => n.meta?.launcher).map((n) => n.id);
      assert.deepEqual(launchers, ['b:toolu_real'], '기동기는 진짜 기동 하나');
      for (const id of ['b:toolu_doc', 'b:toolu_nodehd', 'b:toolu_cathd']) assert.ok(!g.get(id), `${id} 노드 없음`);
      assert.equal(g.get('b:toolu_real').label, '기동기 · relaunch.sh');
      assert.equal(g.get(`s:${C1}`)?.meta?.link?.by, 'launcher');
    } finally { rt.close?.(); }
  });
}

test('보관함 고정 판정(pins.launches): heredoc 명령은 없고 진짜 기동만', async () => {
  index.claimedChildren.clear();
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  const ex = await collectExtras({ from: projects, sid: M, index });
  assert.deepEqual(Object.keys(ex.pins.launches), ['toolu_real']);
});
