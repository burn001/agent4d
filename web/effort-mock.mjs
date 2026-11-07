// 추론 effort 사다리 가짜 시나리오(`?mock=1&effort=ladder`, 켤 때만) — 난수 없음(다른 시나리오 순서 그대로).
// 메인 아래 서브에이전트 8(low·medium·high·xhigh·max·미상·요청만 high(계속)·요청→확정) + 워크플로 1(에이전트 high·xhigh·max)
// + claude -p 2(xhigh·max). 상태는 대기·생각·도구·완료가 섞이게(무늬가 상태와 독립임을 확인).
// xhigh 와 max 는 같은 시각 단계(effort-core EFFORT_TIER) — 서브에이전트·워크플로 에이전트·claude -p 마다 둘을 나란히 두어 같은 모습인지 본다
// (서브에이전트 xhigh·max 는 상태도 같게 '생각 중' — 도구 호박색은 max 쪽에만 잠깐 들어온다).
// 되풀이(16초): '요청→확정' 노드는 요청 high 로 비웠다가 4초 뒤 확정 high, '보간' 노드는 6초마다 medium ↔ xhigh.
// 메인은 meta.effort 'high'(꼬리표 글이 남는지 — 결정 ③ 메인은 medium 이 아닐 때만).
export const EFFORT_LADDER = [
  // [id 꼬리, kind, label, meta.effort, meta.effortReq, status]
  ['low', 'subagent', 'effort low', 'low', null, 'idle'],
  ['medium', 'subagent', 'effort medium', 'medium', null, 'active'],
  ['high', 'subagent', 'effort high', 'high', 'high', 'active'],
  ['xhigh', 'subagent', 'effort xhigh', 'xhigh', 'xhigh', 'active'],
  ['max', 'subagent', 'effort max', 'max', 'max', 'active'],
  ['unknown', 'subagent', 'effort 미상', null, null, 'active'],
  ['req', 'subagent', '요청만 high(응답 전)', null, 'high', 'active'],
  ['confirm', 'subagent', '요청 → 확정 high', null, 'high', 'active'],
  ['tween', 'subagent', '보간 medium ↔ xhigh', 'medium', null, 'active'],
  ['done', 'subagent', 'effort xhigh · 완료', 'xhigh', null, 'done'],
];
const LOOP = 16_000;

export function effortMockScript(gen) {
  const M = gen.root;
  const id = (k) => 'a:demo-eff-' + k;
  const busy = (o, nid, text, ms) => gen.tool(o, nid, ['Read', 'read', [text]], { durMs: ms, ok: true });
  gen.at(1500, (o) => {
    if (gen.nodes.has(M)) gen.emit(o, { type: 'node-update', nodeId: M, patch: { meta: { effort: 'high' } } });
    for (const [k, kind, label, effort, effortReq, status] of EFFORT_LADDER) {
      gen.addNode(o, { id: id(k), parentId: M, kind, label, meta: { agentType: 'general-purpose', background: false,
        ...(effort ? { effort } : {}), ...(effortReq ? { effortReq } : {}) } });
      if (status !== 'active') gen.setStatus(o, id(k), status);
    }
    // 워크플로 에이전트(요청값 출처 없음 → 확정값만)
    const W = 'w:demo-eff-wf';
    gen.addNode(o, { id: W, parentId: M, kind: 'workflow', label: 'effort 사다리 워크플로', meta: { background: true } });
    gen.addNode(o, { id: 'a:demo-eff-wf-high', parentId: W, kind: 'workflow-agent', label: 'wf effort high', meta: { phase: 'Build', agentType: 'workflow-subagent', effort: 'high' } });
    gen.addNode(o, { id: 'a:demo-eff-wf-xhigh', parentId: W, kind: 'workflow-agent', label: 'wf effort xhigh', meta: { phase: 'Verify', agentType: 'workflow-subagent', effort: 'xhigh' } });
    gen.addNode(o, { id: 'a:demo-eff-wf-max', parentId: W, kind: 'workflow-agent', label: 'wf effort max', meta: { phase: 'Verify', agentType: 'workflow-subagent', effort: 'max' } });
    // claude -p(명령 줄 --effort → 요청값, 자식 transcript → 적용값)
    for (const v of ['xhigh', 'max']) {
      gen.addNode(o, { id: 's:demo-eff-cp-' + v, parentId: M, kind: 'claude-p', label: 'claude -p · effort ' + v,
        meta: { title: `claude -p --effort ${v}`, cwd: 'C:\\tmp\\effort', effortReq: v, effort: v } });
    }
    round(o);
  });
  const round = (o) => {
    // 요청 → 확정
    gen.emit(o, { type: 'node-update', nodeId: id('confirm'), patch: { meta: { effort: null, effortReq: 'high' } } });
    gen.at(4000, (o2) => gen.emit(o2, { type: 'node-update', nodeId: id('confirm'), patch: { meta: { effort: 'high' } } }));
    // 보간 medium ↔ xhigh
    gen.at(6000, (o2) => gen.emit(o2, { type: 'node-update', nodeId: id('tween'), patch: { meta: { effort: 'xhigh' } } }));
    gen.at(12_000, (o2) => gen.emit(o2, { type: 'node-update', nodeId: id('tween'), patch: { meta: { effort: 'medium' } } }));
    // 상태 섞기: 도구 쓰는 노드(호박) · 생각(active) · 대기(idle)
    busy(o, id('high'), 'CONTRACT.md', 5000);
    busy(o, id('max'), 'scene.js', 9000);
    gen.at(3000, (o2) => busy(o2, 'a:demo-eff-wf-max', 'journal.jsonl', 6000));
    gen.at(LOOP, round);
  };
}
