// 흐름(Flow) 3D·2D 추론 effort 다이얼 눈금 · 기둥 높이 — 소스 연결과 자리 계산(헤드리스 렌더링 없이)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effortAttr, effortHeightK, effortGlyph, EFFORT, EFFORT_MAX } from '../effort-core.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const chips = read('../flowview/chips.js'), flat = read('../flat/flow2d.js'), fv = read('../flowview/flow-view.js');

test('3D: 비어 있던 iC.y·iC.z 칸에 단계·확정을 싣고 인스턴스 속성 수는 그대로(그리기 호출 0 추가)', () => {
  assert.match(chips, /const ATTRS = \[\['iColor', 3\], \['iKind', 3\], \['iA', 4\], \['iB', 4\], \['iC', 4\], \['iD', 4\]\];/, '속성 6개 그대로(14/16)');
  assert.match(chips, /D\[1\] = ef\.lv; D\[2\] = ef\.conf \+ \(lod === 1 \? 2 : 0\); D\[3\] = px;/);
  assert.match(chips, /if \(flag < 0\.5 && vC\.y > 0\.01\)/, '보통 노드(fl 0)만 — 배치 장치·작업 칩·분리 프로세스는 iC 를 따로 씀');
  assert.match(chips, /vec4 effTicks\(/);
  assert.doesNotMatch(chips.slice(chips.indexOf('vec4 effTicks('), chips.indexOf('float icon(')), /pow\(/, '음수 밑 pow 없음');
  // 잉크는 effort-core 표(theme.css 와 같은 값)에서
  assert.match(chips, /effortInk\(this\.isLight\)/);
  for (const u of ['uEffInk', 'uEffDim', 'uEffGlint']) assert.match(chips, new RegExp(`uniform vec4 ${u};`));
  // 새 InstancedMesh 없음(실루엣 묶음 + 그림자만)
  assert.equal((chips.match(/new THREE\.InstancedMesh\(/g) || []).length, 2);
});

test('3D: 기둥 높이 배가 두께(iD.z)·빔 끝점에 같이 들어감', () => {
  assert.match(chips, /sil \? SIL_DIM\[sil\]\.h \* v\._effH/);
  assert.match(fv, /\* \(v\._effH \|\| 1\)/);
  // 표: medium = 지금 높이, 맨 위 기둥(0.62 × 1.48 ≈ 0.92R)이 높이 계층 간격(칩 반지름 2배↑)보다 작음
  assert.equal(effortHeightK({ kind: 'subagent', meta: { effort: 'medium' } }), 1);
  assert.ok(0.62 * EFFORT.HEIGHT_K[EFFORT_MAX] < 1);
  assert.equal(effortHeightK({ kind: 'subagent', meta: { effort: 'xhigh' } }), effortHeightK({ kind: 'subagent', meta: { effort: 'max' } }), 'xhigh = max');
  assert.equal(effortHeightK({ kind: 'subagent', meta: { effortReq: 'max' } }), 1, '요청 상태는 지금 높이(확정 때 보간)');
});

test('3D: 눈금 자리 — 컨텍스트 고리(1.55) 바깥, 윗면 사각(반폭 1.9) 안', () => {
  const r0 = 1.66, ctxOuter = 1.55 + 0.035;
  for (const px of [10, 18, 30, 80]) {
    const pk = 1 / px, len = Math.min(0.19, Math.max(0.18, 3 * pk)), hw = Math.max(0.0225, Math.min(0.65 * pk, 0.045));
    const r1 = r0 + len;
    if (px >= 18) assert.ok(r0 - hw - pk / 2 > ctxOuter, `안쪽 끝이 고리 밖 px=${px}`);
    for (const deg of [-60, -20, 20, 60]) {
      const a = (deg * Math.PI) / 180, x = Math.sin(a) * (r1 + hw), y = Math.cos(a) * (r1 + hw);
      assert.ok(Math.abs(x) < 1.9 && Math.abs(y) < 1.9, `사각 안 px=${px} ${deg}°`);
    }
  }
});

test('셰이더 값: 하위 노드만 무늬, 메인·미상은 0 · 네 칸 자리(40° 간격)와 맨 위 닫힘 문턱', () => {
  assert.deepEqual(effortAttr({ kind: 'subagent', meta: { effort: 'xhigh' } }), [4, 1]);
  assert.deepEqual(effortAttr({ kind: 'subagent', meta: { effort: 'max' } }), [4, 1]);
  const tk = chips.slice(chips.indexOf('vec4 effTicks('), chips.indexOf('float icon('));
  assert.match(tk, /clamp\(floor\(\(th \+ 1\.3962634\) \/ 0\.6981317\), 0\.0, 3\.0\)/, '칸 번호 0～3');
  assert.match(tk, /float a = -1\.0471976 \+ 0\.6981317 \* k;/, '−60° + 40°·k');
  assert.match(tk, /lv > 3\.0\)/); assert.match(tk, /lv > 3\.5\)/);
  assert.doesNotMatch(tk, /lv > 4\./, '예전 다섯 칸 문턱 없음');
  assert.deepEqual(effortAttr({ kind: 'claude-p', meta: { effortReq: 'high' } }), [3, 0.5]);
  assert.deepEqual(effortAttr({ kind: 'main', meta: { effort: 'max' } }), [0, 0]);
  assert.equal(effortGlyph({ kind: 'workflow-agent', meta: { effort: 'ultra' } }), null);
  // chips 는 표시 종류(v.kind — 독립 claude -p 루트도 claude-p)로 판정
  assert.match(chips, /const n = \{ kind: v\.kind, meta: m \}, g = effortGlyph\(n\)/);
  assert.match(flat, /effortGlyph\(\{ kind: v\.kind, meta: m \}\)/);
});

test('2D: 같은 어휘(네 칸 · 속 빈 칸 · 맨 위 호와 외곽선 +0.5px) · LOD · 보간 중 다시 그리기', () => {
  assert.match(flat, /from '\.\.\/effort-core\.mjs'/);
  assert.match(flat, /const EFF_ANG = \[-60, -20, 20, 60\]/);
  assert.match(flat, /o\.closed = e\.closed && lv > EFFORT_MAX - 0\.5;/);
  assert.doesNotMatch(flat, /i < 5;/, '칸 수는 EFF_ANG 길이로');
  assert.match(flat, /if \(ef && ef\.closed\) lw \+= 0\.5;/);
  assert.match(flat, /effortLod\(R, \{ phone: effortPhone\(this\.W, this\.H\) \}\)/);
  assert.match(flat, /level = Math\.max\(level, this\._effLevel\(now\)\);/);
  // 2D 눈금은 컨텍스트 고리(1.3R) 바깥
  assert.match(flat, /R0: 1\.44/);
});
