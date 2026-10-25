// --demo 의 작업 대상 시나리오. 실제 추출기(artStart·artEnd)·분류기(classifyStart·classifyEnd)에 가짜 도구 호출을 넣어
// 같은 모양의 art 를 낸다 — 생성·수정·삭제·DB 쓰기·push·파괴적 작업(rm -rf·DROP·force push·덮어쓰기)·산출물·서비스. 이름은 모두 가짜.
import { artStart, artEnd } from './artifacts.mjs';
import { classifyStart, classifyEnd } from './interactions.mjs';
import { toolCategory } from './parse.mjs';
import { toolBrief } from './brief.mjs';

/** [도구, 입력, 결과 {ok, tur, stdout}, 걸리는 ms] — 상대 경로는 데모 cwd 기준 */
export const ART_DEMO = [
  ['Write', { file_path: 'src/flow/layer.mjs', content: 'export const A = 1;\n'.repeat(40) }, { ok: true, tur: { type: 'create' } }, 900],
  ['Edit', { file_path: 'src/app.js', old_string: 'a', new_string: 'b' }, { ok: true, tur: { structuredPatch: [{ lines: ['-a', '+b', '+c', '+d'] }] } }, 700],
  ['Bash', { command: 'mongosh "mongodb://localhost:27017/demo" --quiet --eval "db.cases.insertMany(docs)"', description: '문서 넣기' }, { ok: true, stdout: '{ acknowledged: true, insertedCount: 120 }' }, 1300],
  ['Edit', { file_path: 'web/theme.css', old_string: 'x', new_string: 'y' }, { ok: true, tur: { structuredPatch: [{ lines: ['-x', '+y'] }] } }, 600],
  ['Bash', { command: 'git add -A && git commit -qm "작업 대상 층" && git push origin main', description: '커밋·푸시' }, { ok: true, stdout: '[main 9f8e7d6] 작업 대상 층', stderr: 'To github.com:demo/viz.git\n   3c4d5e6..9f8e7d6  main -> main' }, 1700],
  ['Write', { file_path: 'out/최종보고서.pdf', content: '%PDF' }, { ok: true, tur: { type: 'create' } }, 800],
  ['Bash', { command: 'rm -rf build/cache', description: '빌드 캐시 지우기' }, { ok: true, stdout: '' }, 500],
  ['Write', { file_path: 'docs/notes.md', content: '# 메모\n' }, { ok: true, tur: { type: 'update' } }, 600],
  ['Bash', { command: 'psql -d survey -c "UPDATE resp SET checked = true WHERE id < 100"', description: '응답 표시' }, { ok: true, stdout: 'UPDATE 99\n(99 rows)' }, 1100],
  ['Bash', { command: 'npx wrangler deploy', description: 'Worker 배포' }, { ok: true, stdout: 'Deployed demo-worker' }, 1500],
  ['Edit', { file_path: '.env', old_string: 'A=1', new_string: 'A=2' }, { ok: true, tur: { structuredPatch: [{ lines: ['-A=1', '+A=2'] }] } }, 500],
  ['Bash', { command: 'scp -q dist.zip demo-server:/srv/www/', description: '배포 묶음 올리기' }, { ok: true, stdout: '' }, 2000],
  ['Bash', { command: 'mongosh demo --eval "db.tmp_import.drop()"', description: '임시 컬렉션 삭제' }, { ok: true, stdout: 'true' }, 900],
  ['Write', { file_path: 'src/flow/geometry.mjs', content: 'export function g() {}\n'.repeat(12) }, { ok: true, tur: { type: 'create' } }, 800],
  ['Bash', { command: 'git push --force origin feat-x', description: '강제 푸시' }, { ok: true, stderr: 'To github.com:demo/viz.git\n + 1a2b3c4...5d6e7f8 feat-x -> feat-x (forced update)' }, 1400],
  ['Read', { file_path: 'src/app.js' }, { ok: true }, 300],
  ['Bash', { command: 'node shot.mjs --out screenshots/flow-after.png', description: '스크린샷' }, { ok: true, stdout: 'saved' }, 1200],
  ['Bash', { command: 'gws gmail +send --to team@example.com --subject 보고', description: '메일 발송' }, { ok: true, stdout: 'sent' }, 900],
  ['Edit', { file_path: 'src/flow/layer.mjs', old_string: 'A = 1', new_string: 'A = 2' }, { ok: true, tur: { structuredPatch: [{ lines: ['-A = 1', '+A = 2'] }] } }, 600],
  ['Bash', { command: 'rm src/old/legacy.js', description: '옛 파일 삭제' }, { ok: true, stdout: '' }, 400],
];

/** DemoRuntime 한 걸음에서 시나리오 하나(시작 → 끝은 타이머). 처리했으면 true */
export function artDemoStep(rt, nodeId, k) {
  const g = rt.graph;
  const [name, input, res, dur] = ART_DEMO[(rt._artDemoI = (rt._artDemoI ?? -1) + 1) % ART_DEMO.length];
  const toolUseId = `toolu_demo_art_${rt.px || ''}${k}`;
  const ts = new Date().toISOString();
  const cat = toolCategory(name);
  const ix = classifyStart(name, input);
  const root = rt.cwd || 'D:\\demo';
  const art = artStart(name, input, { cwd: root, root, ix });
  g.emit({ ts, type: 'tool-start', nodeId, toolUseId, tool: name, cat, skill: null, text: input.description || input.file_path || name, ...toolBrief(name, input), ...(ix ? { ix: { v: 1, ...ix } } : {}), ...(art.length ? { art } : {}) });
  const t = setTimeout(() => {
    const ixEnd = ix ? classifyEnd(ix, { ok: res.ok, stdout: res.stdout, stderr: res.stderr, cmd: input.command }) : null;
    const artE = art.length ? artEnd(art, { ok: res.ok, tur: res.tur || null, ixEnd }) : null;
    g.emit({ ts: new Date().toISOString(), type: 'tool-end', nodeId, toolUseId, tool: name, cat, ok: res.ok !== false, durationMs: dur,
      text: 'exit 0', brief: 'exit 0', ...(ixEnd ? { ix: ixEnd } : {}), ...(artE ? { art: artE } : {}) });
  }, dur);
  t.unref?.();
  return true;
}

export { artHistorySample as artDemoHistory } from '../web/artifact-core.mjs'; // 지난 며칠 대상(서버 데모·웹 mock 공용, 결정적)
