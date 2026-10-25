// --demo 계획 보드 시나리오: 실제 PlanTracker·planStart 를 거쳐 메인 할 일(TodoWrite)과 워크플로 단계를 낸다.
import { PlanTracker, planStart } from './plans.mjs';

export const PLAN_DEMO_TODOS = ['계획 출처 조사', '서버 모델 정규화', '보드 그리기', '상세 팝업 목록', '시험·fps 측정', '계약·스킬 갱신'];
const WF_PHASES = ['Design', 'Build', 'Verify', 'Package'];

/** 데모 런타임(DemoRuntime)에 계획 장부를 붙이고 첫 상태를 낸다 */
export function planDemoSeed(rt, ts = new Date().toISOString()) {
  const pt = new PlanTracker({ graph: rt.graph });
  rt._plan = pt; rt._todoK = 0;
  const wid = rt.N('w:wf_demo-001');
  if (rt.graph.has(wid)) {
    pt.end(planStart('Workflow', { script: `export const meta = { phases: [${WF_PHASES.map((p) => `{ title: '${p}' }`).join(', ')}] }` }), { ok: true, nodeId: wid, ts }); // 서술자만 확인
    pt.workflowDefine(wid, WF_PHASES, ts);
    pt.workflowPhase(wid, 'Design', ts);
    pt.workflowPhase(wid, 'Build', ts);
  }
  planDemoStep(rt, ts);
}

/** 한 걸음: 메인 할 일 목록을 TodoWrite 로 한 칸씩 진행(끝나면 처음부터) */
export function planDemoStep(rt, ts = new Date().toISOString()) {
  if (!rt._plan) return false;
  const n = PLAN_DEMO_TODOS.length;
  const k = rt._todoK++ % (n * 2 + 1);
  const todos = PLAN_DEMO_TODOS.map((content, i) => ({ content, activeForm: content + ' 중', status: k >= i * 2 + 2 ? 'completed' : k >= i * 2 + 1 ? 'in_progress' : 'pending' }));
  rt._plan.end(planStart('TodoWrite', { todos }), { ok: true, tur: {}, nodeId: `s:${rt.sessionId}`, ts });
  return true;
}
