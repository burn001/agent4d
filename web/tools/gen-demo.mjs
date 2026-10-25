// demo-events.jsonl 재생성: node web/tools/gen-demo.mjs [초=150]
// mock.js 의 결정적 시뮬레이터(seed 2026)를 가상 시각으로 돌려 이벤트를 한 줄씩 기록한다.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MockGenerator } from '../mock.js';

const seconds = Number(process.argv[2] || 150);
const gen = new MockGenerator({ seed: 2026, startMs: Date.parse('2026-10-23T01:00:00.000Z') });
const lines = [];
while (true) {
  const nextAt = Math.min(...gen.q.map((x) => x.at));
  if (nextAt > seconds * 1000) break;
  for (const ev of gen.next().events) lines.push(JSON.stringify(ev));
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo-events.jsonl');
writeFileSync(out, lines.join('\n') + '\n');
const types = {}, cats = new Set(), kinds = new Set(), status = new Set();
for (const l of lines) {
  const e = JSON.parse(l); types[e.type] = (types[e.type] || 0) + 1;
  if (e.cat) cats.add(e.cat); if (e.node) kinds.add(e.node.kind); if (e.patch && e.patch.status) status.add(e.patch.status);
}
console.log(JSON.stringify({ out, events: lines.length, types, cats: [...cats].sort(), kinds: [...kinds].sort(), status: [...status].sort() }, null, 1));
