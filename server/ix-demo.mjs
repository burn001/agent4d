// --demo 의 특별 상호작용 시나리오. 실제 분류기(classifyStart·classifyEnd·outputProgress)에 가짜 명령·출력을 넣어
// 같은 모양의 ix 를 낸다 — 웹 연출 개발·헤드리스 확인용. 호스트·저장소 이름은 모두 가짜.
import { classifyStart, classifyEnd, outputProgress, IxTracker } from './interactions.mjs';
import { toolCategory } from './parse.mjs';
import { toolBrief } from './brief.mjs';

const nodeTests = (n, fail) => {
  const lines = [];
  for (let i = 1; i <= n; i++) lines.push(`${i === n - 1 && fail ? '✖' : '✔'} 시험 ${i} (${(i * 1.3).toFixed(1)}ms)`);
  return lines;
};

/** [도구, 입력, 결과({stdout,stderr,ok}), 걸리는 ms, 백그라운드 출력 조각들?] */
export const IX_DEMO = [
  ['Bash', { command: 'git add -A && git commit -qm "흐름 연출 수리" && git push origin main', description: '커밋·푸시' }, { ok: true, stdout: '[main 3c4d5e6] 흐름 연출 수리\n 3 files changed', stderr: 'To github.com:demo/viz.git\n   1a2b3c4..3c4d5e6  main -> main' }, 1800],
  ['Bash', { command: 'npm test 2>&1 | tail -8', description: '단위 시험' }, { ok: true, stdout: 'ℹ tests 238\nℹ suites 41\nℹ pass 238\nℹ fail 0\nℹ duration_ms 5210' }, 2600],
  ['Bash', { command: 'ssh demo-server "uptime && df -h /srv"', description: '원격 서버 상태' }, { ok: true, stdout: ' 10:12:01 up 12 days\n/dev/sda1  80G  41G  39G  52% /srv' }, 2200],
  ['Bash', { command: 'mongosh "mongodb://localhost:27017/demo" --quiet --eval "db.cases.countDocuments()"', description: '문서 수' }, { ok: true, stdout: '4821\n' }, 1400],
  ['Bash', { command: 'gh pr create --title "흐름 연출" --body "요약"', description: 'PR 만들기' }, { ok: true, stdout: 'https://github.com/demo/viz/pull/58\n' }, 1600],
  ['Bash', { command: 'C:/Python312/python.exe -m pytest -q tests', description: 'pytest' }, { ok: false, stdout: '....F....\n=========== 120 passed, 2 failed, 3 skipped in 4.56s ===========' }, 3000],
  ['Bash', { command: 'for i in $(seq 1 40); do node build.mjs --page $i; done', description: '페이지 40개 생성' }, { ok: true, stdout: '[40/40] 완료' }, 6000],
  ['Bash', { command: 'gh pr checks 58 --watch', description: 'CI 대기' }, { ok: false, stdout: 'build\tpass\t1m2s\thttps://x\nunit\tpass\t40s\thttps://x\ne2e\tfail\t3m\thttps://x\nlint\tpass\t12s\thttps://x\ndeploy\tpending\t0\thttps://x' }, 4200],
  ['Bash', { command: 'scp -q dist.zip demo-server:/srv/www/', description: '배포 묶음 올리기' }, { ok: true, stdout: '' }, 2400],
  ['Bash', { command: 'psql -d survey -c "UPDATE resp SET checked = true WHERE id < 100"', description: '응답 표시' }, { ok: true, stdout: 'UPDATE 99\n(99 rows)' }, 1200],
  ['Bash', { command: 'node --test', run_in_background: true, description: '시험(백그라운드)' }, { ok: true, stdout: '', bg: true }, 600, nodeTests(24, true)],
  ['Bash', { command: 'git pull --ff-only origin main', description: '최신 받기' }, { ok: true, stdout: 'Updating a..b\nFast-forward\n 5 files changed, 40 insertions(+)' }, 1500],
  ['Bash', { command: 'gh pr merge 58 --squash', description: 'PR 병합' }, { ok: true, stdout: '✓ Squashed and merged pull request #58' }, 1500],
  ['Bash', { command: 'ls src/*.js | xargs -P 6 -n1 node lint.mjs', description: '병렬 검사' }, { ok: true, stdout: '[12/12] ok' }, 3200],
];

/** DemoRuntime 한 걸음에서 시나리오 하나를 시작한다(끝·진행은 타이머로). nodeId = 그 걸음이 고른 에이전트 */
export function ixDemoStep(rt, nodeId, k) {
  const g = rt.graph;
  const tr = rt._ixDemoT || (rt._ixDemoT = new IxTracker());
  const [name, input, res, dur, chunks] = IX_DEMO[(rt._ixDemoI = (rt._ixDemoI || 0) + 1) % IX_DEMO.length];
  const toolUseId = `toolu_demo_ix_${k}`;
  const ts = new Date().toISOString();
  const cat = toolCategory(name);
  const ix = tr.onStart(nodeId, name, Date.now(), classifyStart(name, input));
  g.emit({ ts, type: 'tool-start', nodeId, toolUseId, tool: name, cat, skill: null, text: input.description || name, ...toolBrief(name, input), ...(ix ? { ix } : {}) });
  const t = setTimeout(() => {
    const end = ix ? tr.onEnd(classifyEnd(ix, { ...res, bg: !!res.bg, cmd: input.command })) : null;
    g.emit({ ts: new Date().toISOString(), type: 'tool-end', nodeId, toolUseId, tool: name, cat, ok: res.ok !== false || !!res.bg, durationMs: dur,
      text: res.bg ? '백그라운드' : 'exit ' + (res.ok === false ? 1 : 0), brief: res.bg ? '백그라운드 bdemo01' : 'exit ' + (res.ok === false ? 1 : 0), ...(end ? { ix: end } : {}) });
    if (chunks && ix) {
      // 백그라운드 출력: 조각마다 진행 ix(ref = 띄운 호출), 마지막에 요약 줄 → 끝
      const acc = {};
      const target = rt.N ? rt.N('b:bdemo01') : 'b:bdemo01';
      const parts = [];
      for (let i = 0; i < chunks.length; i += 3) parts.push(chunks.slice(i, i + 3).join('\n') + '\n');
      const fail = chunks.filter((l) => l.startsWith('✖')).length;
      parts.push(`ℹ tests ${chunks.length}\nℹ pass ${chunks.length - fail}\nℹ fail ${fail}\nℹ duration_ms 3120\n`);
      parts.forEach((p, i) => {
        const tt = setTimeout(() => {
          const px = outputProgress(ix, p, acc);
          g.emit({ ts: new Date().toISOString(), type: 'output', nodeId: target, text: p, ...(px ? { ix: { ...px, ref: toolUseId } } : {}) });
        }, 500 + i * 450);
        tt.unref?.();
      });
    }
  }, dur);
  t.unref?.();
  return true;
}
