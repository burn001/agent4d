// 추론 effort — 패널·글 쪽(사이드 패널 세션 줄 툴팁 집계 · 범례 문구 · 꼬리표 규칙) 시험. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionEffortLine } from '../projects.js';
import { effortLegendText } from '../effort-ui.mjs';
import { nodeTags } from '../batch-core.mjs';

const N = (id, kind, meta = {}, extra = {}) => ({ id, kind, status: 'active', rootSessionId: 'S', meta, ...extra });

test('세션 줄 툴팁: 그 세션의 살아 있는 하위 노드 effort 를 단계 순으로 센다(메인·끝난 노드·다른 세션 제외)', () => {
  const nodes = [
    N('s:S', 'main', { effort: 'xhigh' }, { sessionId: 'S' }),
    N('a:1', 'subagent', { effort: 'high' }),
    N('a:2', 'subagent', { effortReq: 'high' }),          // 요청값만(아직 응답 전)도 센다
    N('a:3', 'workflow-agent', { effort: 'xhigh' }),
    N('a:4', 'subagent', { effort: 'max' }, { status: 'done' }),
    N('a:5', 'claude-p', { effort: 'low' }, { rootSessionId: 'T' }),
    N('a:6', 'subagent', {}),
  ];
  assert.equal(sessionEffortLine(nodes, 'S'), 'effort high 2 · xhigh 1');
  assert.equal(sessionEffortLine(nodes, 'T'), 'effort low 1');
  assert.equal(sessionEffortLine(new Map(nodes.map((n) => [n.id, n])).values(), 'S'), 'effort high 2 · xhigh 1', 'iterable 도 받음');
  assert.equal(sessionEffortLine(nodes, 'U'), '');
  assert.equal(sessionEffortLine(null, 'S'), '');
  assert.equal(sessionEffortLine(nodes, ''), '');
});

test('범례 문구: 지금 표현 설명만, 연구소는 복셀 설명, 모르면 세 설명 모두', () => {
  assert.equal(effortLegendText('flow'), '추론 effort — 칸이 많을수록 깊게(흐름: 기둥도 높아짐)');
  assert.equal(effortLegendText('planet'), '추론 effort — 칸이 많을수록 깊게(Planet: 케이지 호)');
  assert.equal(effortLegendText('voxel'), '추론 effort — 칸이 많을수록 깊게(복셀: 차려입을수록 · 책상이 붐빌수록)');
  assert.equal(effortLegendText('lab'), '추론 effort — 칸이 많을수록 깊게(연구소: 실험복 · 고글 · 책상 소품)');
  assert.equal(effortLegendText(undefined), '추론 effort — 칸이 많을수록 깊게(흐름: 기둥도 높아짐 · Planet: 케이지 호 · 복셀: 차려입을수록 · 책상이 붐빌수록)');
});

test('꼬리표(결정 ③): 하위 노드는 무늬가 대신해 글을 빼고, 메인은 medium 이 아닐 때만', () => {
  assert.deepEqual(nodeTags(N('a:1', 'subagent', { effort: 'xhigh' })), []);
  assert.deepEqual(nodeTags(N('a:1', 'workflow-agent', { effort: 'max' })), []);
  assert.deepEqual(nodeTags(N('a:1', 'subagent', { effortReq: 'high' })), [], '요청값만이면 글도 없음');
  assert.deepEqual(nodeTags(N('a:1', 'subagent', { effort: 'turbo' })), ['effort turbo'], '알 수 없는 단계 이름은 글로');
  assert.deepEqual(nodeTags(N('s:S', 'main', { effort: 'high' })), ['effort high']);
  assert.deepEqual(nodeTags(N('s:S', 'main', { effort: 'Medium' })), []);
});
