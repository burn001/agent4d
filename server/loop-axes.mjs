// 자율 루프 판 — 축 큐 어댑터(내장, 읽기 전용). 일반 설정 파일이 아니라 한 가지 자율 루프 레이아웃 전용:
//   큐 `<프로젝트>/.autopilot/relaunch.sh` 의 `AXIS_QUEUE=(…)` → 축마다 `scripts/autopilot-axes/<축>.env`(AXIS_LABEL·DESIGN_DOC·PHASE_RE·SETTLED_RE)
//   → 설계서의 단계 상태 표식 줄(정착 = SETTLED_RE, 기본 ✅|⏸) → 지금 축 `.autopilot/status.json` 의 axis.
// 레이아웃이 없으면 null(조용히 아무것도 안 함). 파일은 mtime·크기로 캐시. 프로젝트 밖 경로는 읽지 않음.
// 일반화(다른 형식의 계획 문서를 잇는 선언·자동 발견)는 폐기했다 — 이 어댑터에 다른 형식을 더하지 말 것.
import fs from 'node:fs';
import path from 'node:path';

export const LOOP_AXES = {
  QUEUE: path.join('.autopilot', 'relaunch.sh'),
  STATUS: path.join('.autopilot', 'status.json'),
  AXES_DIR: path.join('scripts', 'autopilot-axes'),
  MAX: 400,
  FILE_MAX: 1024 * 1024,
  PHASE_RE: '^\\*\\*단계 [0-9]+ 상태\\*\\*',
  SETTLED_RE: '✅|⏸',
};

const cache = new Map(); // 절대 경로 → {mtimeMs, size, text}
function readText(file) {
  let st;
  try { st = fs.statSync(file); } catch { cache.delete(file); return null; }
  if (!st.isFile() || st.size > LOOP_AXES.FILE_MAX) return null;
  const c = cache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.text;
  let text;
  try { text = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch { return null; }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, text });
  if (cache.size > 1500) cache.delete(cache.keys().next().value);
  return text;
}
function inside(root, p) {
  const abs = path.resolve(root, p), rel = path.relative(root, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) ? abs : null;
}
const reOf = (src, flags = '') => { try { return new RegExp(src, flags); } catch { return null; } };
/** 셸 대입 `NAME="값"` · `NAME='값'` */
function shVal(text, name) {
  const m = new RegExp(`^${name}=(["'])(.*)\\1\\s*$`, 'm').exec(text || '');
  return m ? m[2] : null;
}

/** 설계서 → 단계 [{title, state}](표식 줄 = 단계, 제목은 `### 단계 N — …` 머리) */
export function axisSteps(text, phaseRe = LOOP_AXES.PHASE_RE, settledRe = LOOP_AXES.SETTLED_RE) {
  const mk = reOf(phaseRe), se = reOf(settledRe), bl = /⏸/;
  if (!mk) return [];
  const lines = String(text || '').split(/\r?\n/);
  const heads = new Map();
  for (const l of lines) {
    const h = /^#{2,5}\s*(?:\*\*)?(?:단계|phase|step|stage|조건|관문)\s*([0-9A-Za-z]{1,4})(?:\*\*)?\s*[—–\-:.·)]?\s*(.*)$/i.exec(l);
    if (h) heads.set(h[1].toLowerCase(), `${l.replace(/^#+\s*/, '').replace(/[*`]/g, '').trim()}`);
  }
  const out = [];
  for (const l of lines) {
    if (!mk.test(l)) continue;
    const n = /(?:단계|phase|step|stage|조건|관문)\s*([0-9A-Za-z]{1,4})/i.exec(l);
    const key = n ? n[1].toLowerCase() : String(out.length);
    const settled = !!(se && se.test(l));
    out.push({ title: heads.get(key) || (n ? n[0] : l.replace(/[*`]/g, '').trim().slice(0, 60)), state: settled ? (bl.test(l) ? 'blocked' : 'done') : /🔧|◐|진행 중|착수/.test(l) ? 'current' : 'pending', settled });
  }
  return out;
}

/**
 * 프로젝트 뿌리(메인 cwd) → 축 큐 계획(planFromRaw 입력 꼴) | null.
 * 축 상태: 단계가 있고 모두 정착 = done, 지금 축 = current, 그 밖 pending(설계서 없음·표식 없음은 note).
 */
export function loopAxesPlan(root) {
  if (!root) return null;
  root = path.resolve(root);
  const q = readText(path.join(root, LOOP_AXES.QUEUE));
  if (!q) return null;
  const m = /^AXIS_QUEUE=\(([^)]*)\)/m.exec(q);
  if (!m) return null;
  const ids = m[1].trim().split(/\s+/).filter((x) => /^[\w.-]+$/.test(x)).slice(0, LOOP_AXES.MAX);
  if (!ids.length) return null;
  let cur = null;
  try { const st = JSON.parse(readText(path.join(root, LOOP_AXES.STATUS)) || 'null'); if (st && typeof st.axis === 'string') cur = st.axis; } catch {}
  const items = ids.map((id) => {
    const env = readText(path.join(root, LOOP_AXES.AXES_DIR, id + '.env'));
    const it = { id, title: id, state: 'pending' };
    if (!env) { it.note = '축 파일 없음'; return it; }
    const label = shVal(env, 'AXIS_LABEL');
    if (label) it.title = label;
    const doc0 = shVal(env, 'DESIGN_DOC');
    const docAbs = doc0 ? inside(root, doc0.replace(/\$\{?REPO_DIR\}?/g, root)) : null;
    if (docAbs) it.doc = path.relative(root, docAbs).replace(/\\/g, '/');
    const text = docAbs ? readText(docAbs) : null;
    if (text == null) { it.note = '설계서 없음'; }
    else {
      const steps = axisSteps(text, shVal(env, 'PHASE_RE') || LOOP_AXES.PHASE_RE, shVal(env, 'SETTLED_RE') || LOOP_AXES.SETTLED_RE);
      it.steps = steps.map((x) => ({ title: x.title, state: x.state }));
      if (!steps.length) it.note = '단계 표식 없음';
      else if (steps.every((x) => x.settled)) it.state = 'done';
    }
    if (cur && id === cur && it.state !== 'done') it.state = 'current';
    return it;
  });
  return { src: 'axes', id: 'axes', title: '자율 루프 축', doc: LOOP_AXES.QUEUE.replace(/\\/g, '/'), current: cur, items };
}
