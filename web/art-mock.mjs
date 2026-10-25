// ?mock=1 의 작업 대상 시나리오. 서버 추출기(server/artifacts.mjs)가 같은 도구 호출에 내는 art 를 그대로 옮겨 적었다
// (server/art-demo.mjs ART_DEMO 와 같은 순서). 생성·수정·삭제·DB 쓰기·push·파괴적 작업(rm -rf·DROP·force push·덮어쓰기)·산출물·서비스.
// 결정적: 자기 난수열(시드 7979)로 노드를 고르고, 첫 시나리오 2.5초 뒤 2.4～3.6초 간격. 기본 장부(지난 며칠)는 artHistorySample.
import { ArtBook, artHistorySample } from './artifact-core.mjs';

const F = (id, v, o = {}) => { const i = id.lastIndexOf('/'); return { k: /\.(pdf|png|hwpx|docx)$/.test(id) ? 'output' : 'file', id: id.toLowerCase(), p: id, d: i < 0 ? '' : id.slice(0, i), n: i < 0 ? id : id.slice(i + 1), v, ...o }; };
/** [도구, 요약, 시작 art, 끝 art, ms] */
export const ART_MOCK = [
  ['Write', 'src/flow/layer.mjs', [F('src/flow/layer.mjs', 'write', { sz: 40 })], [F('src/flow/layer.mjs', 'create', { sz: 40 })], 900],
  ['Edit', 'src/app.js', [F('src/app.js', 'modify', { sz: 1 })], [F('src/app.js', 'modify', { sz: 4 })], 700],
  ['Bash', 'mongosh … insertMany', [{ k: 'db', id: 'db:mongo/demo', n: 'demo', v: 'write', coll: ['cases'], imp: 'db' }], [{ k: 'db', id: 'db:mongo/demo', n: 'demo', v: 'write', coll: ['cases'], imp: 'db', rows: 120 }], 1300],
  ['Edit', 'web/theme.css', [F('web/theme.css', 'modify', { sz: 1 })], [F('web/theme.css', 'modify', { sz: 2 })], 600],
  ['Bash', 'git commit && git push origin main', [{ k: 'repo', id: 'repo:viz', n: 'viz', v: 'push' }], [{ k: 'repo', id: 'repo:viz', n: 'viz', v: 'push', c: 3 }], 1700],
  ['Write', 'out/final-report.pdf', [F('out/final-report.pdf', 'write', { sz: 1, imp: 'final' })], [F('out/final-report.pdf', 'create', { sz: 1, imp: 'final' })], 800],
  ['Bash', 'rm -rf build/cache', [F('build/cache', 'delete', { est: 1, x: 'rm' })], [F('build/cache', 'delete', { est: 1, x: 'rm' })], 500],
  ['Write', 'docs/notes.md', [F('docs/notes.md', 'write', { sz: 1 })], [F('docs/notes.md', 'modify', { sz: 1, x: 'overwrite' })], 600],
  ['Bash', 'psql … UPDATE resp', [{ k: 'db', id: 'db:postgres/survey', n: 'survey', v: 'write', coll: ['resp'], imp: 'db' }], [{ k: 'db', id: 'db:postgres/survey', n: 'survey', v: 'write', coll: ['resp'], imp: 'db', rows: 99 }], 1100],
  ['Bash', 'npx wrangler deploy', [{ k: 'service', id: 'svc:cloudflare', n: 'Cloudflare', v: 'write' }], [{ k: 'service', id: 'svc:cloudflare', n: 'Cloudflare', v: 'write' }], 1500],
  ['Edit', '.env', [F('.env', 'modify', { sz: 1, imp: 'secret' })], [F('.env', 'modify', { sz: 2, imp: 'secret' })], 500],
  ['Bash', 'scp dist.zip demo-server:/srv/www/', [{ k: 'remote', id: 'remote:demo-server', n: 'demo-server', v: 'write', imp: 'prod' }], [{ k: 'remote', id: 'remote:demo-server', n: 'demo-server', v: 'write', imp: 'prod' }], 2000],
  ['Bash', 'mongosh … drop()', [{ k: 'db', id: 'db:mongo/demo', n: 'demo', v: 'write', coll: ['tmp_import'], x: 'drop', imp: 'db' }], [{ k: 'db', id: 'db:mongo/demo', n: 'demo', v: 'write', coll: ['tmp_import'], x: 'drop', imp: 'db' }], 900],
  ['Write', 'src/flow/geometry.mjs', [F('src/flow/geometry.mjs', 'write', { sz: 12 })], [F('src/flow/geometry.mjs', 'create', { sz: 12 })], 800],
  ['Bash', 'git push --force origin feat-x', [{ k: 'repo', id: 'repo:viz', n: 'viz', v: 'push', x: 'force' }], [{ k: 'repo', id: 'repo:viz', n: 'viz', v: 'push', x: 'force', c: 1 }], 1400],
  ['Read', 'src/app.js', [F('src/app.js', 'read')], [F('src/app.js', 'read')], 300],
  ['Bash', 'node shot.mjs --out screenshots/flow-after.png', [F('screenshots/flow-after.png', 'create', { est: 1 })], [F('screenshots/flow-after.png', 'create', { est: 1 })], 1200],
  ['Bash', 'gws gmail +send', [{ k: 'service', id: 'svc:google workspace', n: 'Google Workspace', v: 'write' }], [{ k: 'service', id: 'svc:google workspace', n: 'Google Workspace', v: 'write' }], 900],
  ['Edit', 'src/flow/layer.mjs', [F('src/flow/layer.mjs', 'modify', { sz: 1 })], [F('src/flow/layer.mjs', 'modify', { sz: 2 })], 600],
  ['Bash', 'rm src/old/legacy.js', [F('src/old/legacy.js', 'delete', { est: 1 })], [F('src/old/legacy.js', 'delete', { est: 1 })], 400],
];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** mock 기본 장부(서버 /artifacts 대신): 프로젝트마다 지난 며칠 대상 */
export function artMockPayload(pid, nowMs = Date.now(), mainNode = null, n = 36) {
  const b = new ArtBook();
  for (const r of artHistorySample(pid, nowMs, { mainNode: mainNode || 's:mock', n })) for (const ref of r.art) b.touch(pid, ref, r.t, r.node, r.tu);
  return { projectId: pid, until: nowMs, building: false, items: b.snapshot(pid), nodes: {} };
}

/**
 * 가짜 이벤트 드라이버: nodes() 로 지금 노드들을 받아(살아 있는 에이전트) 시나리오를 차례로 낸다.
 * emit(ev) 로 tool-start(art) → ms 뒤 tool-end(ok, art). projectOf(node) 가 있으면 ev.projectId 를 단다(전체 보기 mock).
 */
export class ArtMockDriver {
  constructor({ nodes, emit, projectOf = null, seed = 7979, first = 2500 } = {}) {
    this.nodes = nodes; this.emit = emit; this.projectOf = projectOf;
    this.r = rng(seed); this.k = 0; this.first = first; this.timers = new Set(); this.on = false;
  }
  _at(ms, fn) { const t = setTimeout(() => { this.timers.delete(t); if (this.on) fn(); }, ms); this.timers.add(t); }
  start() { if (this.on) return; this.on = true; this._at(this.first, () => this._tick()); }
  stop() { this.on = false; for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
  _tick() {
    const live = [...this.nodes()].filter((n) => (n.kind === 'main' || n.kind === 'subagent' || n.kind === 'workflow-agent') && (n.status === 'active' || n.status === 'idle'));
    if (live.length) {
      const n = live[Math.floor(this.r() * live.length)];
      const [tool, text, a0, a1, ms] = ART_MOCK[this.k % ART_MOCK.length];
      const toolUseId = `tu_art_mock_${this.k++}`;
      const pid = this.projectOf ? this.projectOf(n) : null;
      const P = pid ? { projectId: pid } : {};
      const cat = tool === 'Bash' ? 'shell' : tool === 'Read' ? 'read' : 'edit';
      this.emit({ type: 'tool-start', ts: new Date().toISOString(), nodeId: n.id, toolUseId, tool, cat, text, brief: text, art: a0.map((x) => ({ ...x })), ...P });
      this._at(ms, () => this.emit({ type: 'tool-end', ts: new Date().toISOString(), nodeId: n.id, toolUseId, tool, cat, ok: true, durationMs: ms, text: '완료', brief: '완료', art: a1.map((x) => ({ ...x })), ...P }));
    }
    this._at(2400 + this.r() * 1200, () => this._tick());
  }
}
