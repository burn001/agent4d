// 셸 명령 쓰기 대상 추정: 추출 규칙·제외 규칙, tool-start 의 est file, 충돌 강도 하향
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { shellWriteTargets as T, shellFileRefs, toolFileRefs, ConflictTracker, conflictEvent, pairLevel, SHELL_TARGET_MAX } from '../../web/conflict-core.mjs';

const B = (c) => T(c, 'Bash');
const P = (c) => T(c, 'PowerShell');

test('Bash: sed -i (-i.bak·--in-place·-e·BSD -i \'\')', () => {
  assert.deepEqual(B(`sed -i "s/a/b/" src/app.js`), ['src/app.js']);
  assert.deepEqual(B(`sed -i.bak -e s/x/y/ -e s/z/w/ a.c b.c`), ['a.c', 'b.c']);
  assert.deepEqual(B(`sed --in-place=.orig 's/a/b/' x.txt`), ['x.txt']);
  assert.deepEqual(B(`sed -i '' -e 's/a/b/' mac.txt`), ['mac.txt']);
  assert.deepEqual(B(`sed -Ei 's/a+/b/' e.txt`), ['e.txt']);
  assert.deepEqual(B(`sed 's/a/b/' read-only.txt`), []); // -i 없으면 읽기
  assert.deepEqual(B(`sed -n 1,20p server/x.mjs`), []);
});

test('Bash: perl -pi / -i, tee [-a], > · >> 리다이렉트', () => {
  assert.deepEqual(B(`perl -pi -e 's/a/b/' p1.pl p2.pl`), ['p1.pl', 'p2.pl']);
  assert.deepEqual(B(`perl -i.bak -pe 's/a/b/' q.txt`), ['q.txt']);
  assert.deepEqual(B(`perl -ne 'print' r.txt`), []);
  assert.deepEqual(B(`echo x | tee -a log/a.log log/b.log`), ['log/a.log', 'log/b.log']);
  assert.deepEqual(B(`echo hi > out.txt; echo again >> 'my notes.md'`), ['out.txt', 'my notes.md']);
  assert.deepEqual(B(`node gen.mjs >| gen.json 2>err.log`), ['gen.json', 'err.log']);
  assert.deepEqual(B(`build &> build.log`), ['build.log']);
  assert.deepEqual(B(`echo a>b.txt`), ['b.txt']);
});

test('Bash: cp/mv 대상(마지막·-t·디렉토리면 원본 이름), mv 는 원본도', () => {
  assert.deepEqual(B(`cp a.js b.js`), ['b.js']);
  assert.deepEqual(B(`cp -r a.js b.js lib/`), ['lib/a.js', 'lib/b.js']);
  assert.deepEqual(B(`cp x.css web/`), ['web/x.css']);
  assert.deepEqual(B(`mv -t dest x.js y.js`), ['dest/x.js', 'dest/y.js', 'x.js', 'y.js']);
  assert.deepEqual(B(`mv old.js new.js`), ['new.js', 'old.js']);
  assert.deepEqual(B(`cp --target-directory=out a.txt`), ['out/a.txt']);
  assert.deepEqual(B(`cp onlyone`), []);
});

test('Bash: git checkout -- · git restore [--staged] · git -C', () => {
  assert.deepEqual(B(`git checkout -- web/a.js web/b.js`), ['web/a.js', 'web/b.js']);
  assert.deepEqual(B(`git checkout HEAD~1 -- c.js`), ['c.js']);
  assert.deepEqual(B(`git checkout main`), []); // 브랜치 전환(파일 모름)
  assert.deepEqual(B(`git restore --staged d.js && git restore -s HEAD e.js`), ['d.js', 'e.js']);
  assert.deepEqual(B(`git -C sub restore f.js`), ['sub/f.js']);
  assert.deepEqual(B(`git status && git diff -- g.js`), []);
});

test('Bash: && ; | || 로 이은 명령 각각, cd 반영, 따옴표 경로, 상한', () => {
  assert.deepEqual(B(`cd web && sed -i 's/a/b/' app.js || echo fail > ../fail.txt; cat x | tee y.txt`), ['web/app.js', 'web/../fail.txt', 'web/y.txt']);
  assert.deepEqual(B(`cd /d/repo && sed -i s/a/b/ "dir with space/z.js"`), ['/d/repo/dir with space/z.js']);
  assert.deepEqual(B(`cd "$X" && echo a > rel.txt; echo b > /abs/ok.txt`), ['/abs/ok.txt']); // cd 위치 모르면 상대 경로 버림
  const many = Array.from({ length: 12 }, (_, i) => `echo ${i} > f${i}.txt`).join('; ');
  assert.equal(B(many).length, SHELL_TARGET_MAX);
  assert.deepEqual(B(`echo a > d.txt; echo b > d.txt`), ['d.txt']); // 중복 없음
  assert.deepEqual(B(`FOO=1 sudo -E sed -i s/a/b/ w.txt`), ['w.txt']);
});

test('Bash 제외: /dev/null·fd 복제·임시 경로·변수·치환·와일드카드·heredoc 본문', () => {
  assert.deepEqual(B(`cmd > /dev/null 2>&1`), []);
  assert.deepEqual(B(`cmd >&2; cmd 1>&- ; cmd > NUL`), []);
  assert.deepEqual(B(`echo x > /tmp/a.txt; echo y > /var/tmp/b; echo z > "C:/Users/dev/AppData/Local/Temp/c.txt"`), []);
  assert.deepEqual(B(`echo z > 'C:\\Users\\dev\\AppData\\Local\\Temp\\claude\\x.txt'; echo t > %TEMP%\\y.txt`), []);
  assert.deepEqual(B(`echo $x > "$OUT"; echo a > $TMPDIR/q; echo b > $(pwd)/f; echo c > \`mktemp\`; sed -i s/a/b/ "$F"`), []);
  assert.deepEqual(B(`sed -i s/a/b/ src/*.js; cp a.js "\${DEST}/"`), []);
  assert.deepEqual(B(`python - <<'PY'\nopen("x.txt","w").write("1")\nwith open('y.txt','w') as f: pass\nPY\necho done >> log.txt`), ['log.txt']);
  assert.deepEqual(B(`cat <<EOF > config.yml\nkey: > not-a-file.txt\nEOF`), ['config.yml']); // 리다이렉트 대상은 잡음
  assert.deepEqual(B(`cat <<-EOF | tee t.txt\n\tbody > z\n\tEOF`), ['t.txt']);
  assert.deepEqual(B(`diff <(sort a) <(sort b) > d.out`), ['d.out']);
  assert.deepEqual(B(`# echo x > commented.txt\nls`), []);
  assert.deepEqual(B(''), []);
  assert.deepEqual(T(null, 'Bash'), []);
});

test('PowerShell: Set-Content·Add-Content·Out-File(-Path·-FilePath·-LiteralPath·첫 위치 인자)·> 리다이렉트·Copy/Move-Item·[IO.File]', () => {
  assert.deepEqual(P(`Set-Content -Path a.txt -Value 'x'`), ['a.txt']);
  assert.deepEqual(P(`'x' | Set-Content b.txt -Encoding utf8`), ['b.txt']);
  assert.deepEqual(P(`Add-Content -LiteralPath 'c d.txt' -Value 1; Out-File -FilePath e.log -InputObject 1`), ['c d.txt', 'e.log']);
  assert.deepEqual(P(`Get-Process | Out-File procs.txt -Append`), ['procs.txt']);
  assert.deepEqual(P(`Set-Content -Path:"q.txt" -Value 1`), ['q.txt']);
  assert.deepEqual(P(`Set-Content -Value 1 -Path r.txt -NoNewline`), ['r.txt']);
  assert.deepEqual(P(`dir > list.txt; Write-Output 1 >> list2.txt 2>&1`), ['list.txt', 'list2.txt']);
  assert.deepEqual(P(`Copy-Item a.js -Destination lib\\ ; Move-Item -Path m.js -Destination n.js`), ['lib/a.js', 'n.js', 'm.js']);
  assert.deepEqual(P(`[IO.File]::WriteAllText('D:\\r\\w.txt', 'x'); [System.IO.File]::AppendAllLines("D:\\r\\v.txt", $l)`), ['D:\\r\\w.txt', 'D:\\r\\v.txt']);
  assert.deepEqual(P(`Set-Location D:\\repo; Set-Content s.txt 1`), ['D:\\repo/s.txt']);
  assert.deepEqual(P(`git checkout -- p.js`), ['p.js']);
});

test('PowerShell 제외: $null·변수·$env:TEMP·부분식·here-string 본문·Get-Content', () => {
  assert.deepEqual(P(`Get-Item x > $null; $y | Out-Null`), []);
  assert.deepEqual(P(`Set-Content -Path "$env:TEMP\\x.txt" 1; Set-Content $p 1; Out-File (Join-Path $d 'a.txt')`), []);
  assert.deepEqual(P(`Set-Content -Path 'C:\\Users\\dev\\AppData\\Local\\Temp\\z.txt' 1`), []);
  assert.deepEqual(P(`$s = @'\nSet-Content inner.txt 1\n'@\nGet-Content r.txt`), []);
  assert.deepEqual(P(`<# Set-Content c.txt 1 #> Get-ChildItem`), []);
});

test('shellFileRefs·toolFileRefs: cwd 기준 열쇠, Windows Bash /d/… → d:/…, 파일 도구는 그대로', () => {
  assert.deepEqual(shellFileRefs('Bash', { command: 'cd /d/repo && sed -i s/a/b/ web/x.js' }, 'D:\\other'), [{ k: 'd:/repo/web/x.js', n: 'x.js', w: 1, est: 1 }]);
  assert.deepEqual(shellFileRefs('PowerShell', { command: 'Set-Content a.txt 1' }, 'D:\\R'), [{ k: 'd:/r/a.txt', n: 'a.txt', w: 1, est: 1 }]);
  assert.deepEqual(shellFileRefs('Bash', { command: 'echo > /d/x' }, '/home/u'), [{ k: '/d/x', n: 'x', w: 1, est: 1 }]); // 리눅스 cwd 면 그대로
  assert.deepEqual(shellFileRefs('Read', { command: 'x > y' }), []);
  assert.deepEqual(toolFileRefs('Edit', { file_path: 'a.js' }, 'D:\\r'), [{ k: 'd:/r/a.js', n: 'a.js', w: 1 }]);
  assert.deepEqual(toolFileRefs('Grep', { pattern: 'x' }), []);
});

test('충돌 강도: 쓰기-추정쓰기·추정-추정 = weak est, 읽기-추정쓰기 = 없음, 확정 조합이 있으면 그쪽', () => {
  const X = -Infinity;
  assert.deepEqual(pairLevel({ w: 1, r: X, we: X }, { w: 2, r: X, we: X }), { level: 'strong', est: false });
  assert.deepEqual(pairLevel({ w: 1, r: X, we: X }, { w: X, r: X, we: 2 }), { level: 'weak', est: true });
  assert.deepEqual(pairLevel({ w: X, r: X, we: 1 }, { w: X, r: X, we: 2 }), { level: 'weak', est: true });
  assert.equal(pairLevel({ w: X, r: 1, we: X }, { w: X, r: X, we: 2 }), null);
  assert.deepEqual(pairLevel({ w: 1, r: X, we: X }, { w: X, r: 3, we: 2 }), { level: 'weak', est: false });

  const t = new ConflictTracker();
  const t0 = Date.parse('2026-10-24T00:00:00Z');
  const W = { k: 'd:/r/app.js', n: 'app.js', w: 1 }, E = { ...W, est: 1 }, R = { ...W, w: 0 };
  assert.equal(t.touch('A', R, t0).on.length, 0);
  assert.equal(t.touch('B', E, t0 + 1000).on.length, 0); // 읽기-추정쓰기 = 없음
  let r = t.touch('A', W, t0 + 2000, 'a:a1'); // 확정 쓰기-추정 쓰기
  assert.equal(r.on.length, 1);
  assert.equal(r.on[0].level, 'weak');
  assert.equal(r.on[0].est, true);
  assert.equal(r.on[0].wB, 1);
  const ev = conflictEvent(r.on[0], 'on', 't');
  assert.equal(ev.est, true);
  assert.equal(ev.level, 'weak');
  r = t.touch('B', W, t0 + 3000); // B 도 확정 쓰기 → strong, est 없음
  assert.equal(r.on[0].level, 'strong');
  assert.equal(r.on[0].est, false);
  assert.equal('est' in conflictEvent(r.on[0], 'on', 't'), false);
});

// ── 서버: Bash·PowerShell tool-start 에 est file ──
const M = 'dddddddd-6612-4612-8612-661266126612';
let root, index;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-shw-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const cwd = 'D:\\work\\shw';
  const now = Date.now();
  const Ts = (sec) => new Date(now - 300_000 + sec * 1000).toISOString();
  const base = { sessionId: M, cwd, version: '2.1.309', entrypoint: 'cli' };
  const tu = (sec, id, name, input) => ({ type: 'assistant', timestamp: Ts(sec), ...base, message: { id: 'm' + id, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] } });
  const recs = [
    { type: 'user', timestamp: Ts(1), ...base, message: { role: 'user', content: '시작' } },
    tu(2, 'toolu_sh1', 'Bash', { command: `sed -i 's/a/b/' web/app.js && echo ok > /dev/null` }),
    tu(3, 'toolu_sh2', 'PowerShell', { command: `Set-Content -Path a.txt -Value 1; Add-Content b.txt 2` }),
    tu(4, 'toolu_sh3', 'Bash', { command: 'ls -la' }),
    tu(5, 'toolu_ed', 'Edit', { file_path: 'D:\\work\\shw\\web\\app.js', old_string: 'a', new_string: 'b' }),
  ];
  const dir = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(path.join(dir, M, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, `${M}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

for (const privacy of ['summary', 'minimal']) {
  test(`서버 tool-start(${privacy}): Bash·PowerShell 추정 쓰기 → file{est:1}·files[], 파일 도구와 같은 열쇠`, async () => {
    await index.refresh();
    const rt = new RootRuntime({ sessionId: M, index, privacy, offline: true });
    try {
      await rt.loadOffline();
      const st = (id) => rt.graph.ring.find((e) => e.type === 'tool-start' && e.toolUseId === id);
      const sh1 = st('toolu_sh1'), sh2 = st('toolu_sh2'), sh3 = st('toolu_sh3'), ed = st('toolu_ed');
      assert.equal(sh1.file.est, 1);
      assert.equal(sh1.file.w, 1);
      assert.equal(sh1.files, undefined); // 하나면 file 만
      assert.equal(sh1.file.k, ed.file.k); // sed 와 Edit 이 같은 열쇠
      assert.equal(ed.file.est, undefined);
      assert.equal(sh2.files.length, 2);
      assert.deepEqual(sh2.file, sh2.files[0]);
      assert.equal(sh3.file, undefined);
      if (privacy === 'minimal') { assert.match(sh1.file.k, /^[0-9a-f]{16}$/); assert.equal(sh1.file.n, ''); }
      else { assert.equal(sh1.file.k, 'd:/work/shw/web/app.js'); assert.equal(sh1.file.n, 'app.js'); assert.deepEqual(sh2.files.map((f) => f.n), ['a.txt', 'b.txt']); }
    } finally { rt.close(); }
  });
}
