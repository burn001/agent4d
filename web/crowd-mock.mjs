// 겹침 확인용 가짜 시나리오(`?mock=1&crowd=1`, 켤 때만) — 서브에이전트 여섯이 한꺼번에 쉬고(탕비실 커피 자리 6) ·
// 같은 시설(도구 상자 skill → 외부 단말 mcp)로 동시에 몰렸다가 돌아오기를 40초마다 되풀이한다. 난수 없음(다른 시나리오 순서 그대로)
const N = 6, LOOP = 40_000;

export function crowdMockScript(gen) {
  const M = gen.root;
  const ids = Array.from({ length: N }, (_, i) => 'a:demo-crowd-' + (i + 1));
  const tool = (o, id, name, cat, text, ms) => {
    const tu = gen.tuid();
    gen.emit(o, { type: 'tool-start', nodeId: id, toolUseId: tu, tool: name, cat, skill: cat === 'skill' ? text : null, text, brief: text, detail: text });
    gen.at(ms, (o2) => gen.emit(o2, { type: 'tool-end', nodeId: id, toolUseId: tu, tool: name, cat, ok: true, durationMs: ms, text: '완료', brief: '완료' }));
  };
  const round = (o) => {
    ids.forEach((id, i) => {
      if (!gen.nodes.has(id)) gen.addNode(o, { id, parentId: M, kind: 'subagent', label: '동시 작업 ' + (i + 1), meta: { agentType: 'general-purpose', background: false } });
      gen.setStatus(o, id, 'idle'); // 다 같이 입력 대기 → 4초 뒤 탕비실
    });
    gen.at(14_000, (o2) => ids.forEach((id) => { gen.setStatus(o2, id, 'active'); tool(o2, id, 'Skill', 'skill', 'agent4d', 7000); }));
    gen.at(22_000, (o3) => ids.forEach((id) => tool(o3, id, 'mcp__github__search_issues', 'mcp', 'github · search_issues', 6000)));
    gen.at(LOOP, round);
  };
  gen.at(3000, round);
}
