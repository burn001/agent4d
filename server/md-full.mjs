// 잘린 응답 '전체 보기' — 실황(md 3000자)·Interactive(6000자)에서 잘린 Claude 응답의 원문을 요청할 때만 읽는다.
// 실황: 이벤트의 mdRef {s: 그 기록을 읽은 세션(transcript) id, u: 기록 uuid, b: 내용 블록 번호} → 그 세션 나무(메인 + <sid>/subagents/**.jsonl)에서
//       uuid 줄을 찾아 그 블록 글. Interactive: 그 줄의 바이트 위치(o)로 바로. 둘 다 보기 토큰 뒤(Interactive 는 승인 기기 서명 뒤),
//       비밀 가림(redact) · privacy minimal 이면 거절 · config.project 밖 세션 거절. 상한 FULL.MAX 자(넘으면 앞부분 + cut).
import fs from 'node:fs';
import path from 'node:path';
import { redact } from './redact.mjs';
import { stripTags } from './parse.mjs';

export const FULL = { MAX: 100_000, SCAN_BYTES: 64 * 1024 * 1024, LINE_MAX: 16 * 1024 * 1024, CHUNK: 1 << 20, DEPTH: 4 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 원문 정리: system-reminder 등 뗌, CRLF → LF, 앞뒤 공백 — 실황 md와 같은 처리 + 가림 + 상한 */
export function fullText(raw) {
  const s = redact(stripTags(String(raw ?? '')).replace(/\r\n?/g, '\n').trim());
  return s.length > FULL.MAX ? { md: s.slice(0, FULL.MAX), cut: 1 } : { md: s };
}

/** 세션 나무의 transcript 파일들(메인 먼저, 서브에이전트 깊이 DEPTH 까지) */
export function treeFiles(entry) {
  const out = [entry.file];
  const walk = (dir, d) => {
    if (d > FULL.DEPTH) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, d + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  if (entry.projectPath && entry.sessionId) walk(path.join(entry.projectPath, entry.sessionId, 'subagents'), 0);
  return out;
}

/** 파일에서 needle(바이트)이 든 줄 하나 → 문자열 | null. budget = {left} 바이트 예산 */
export function findLine(file, needle, budget = { left: FULL.SCAN_BYTES }) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    const nb = Buffer.from(needle, 'utf8');
    let pos = 0, carry = Buffer.alloc(0);
    while (pos < size && budget.left > 0) {
      const len = Math.min(FULL.CHUNK, size - pos);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      budget.left -= len;
      const hay = carry.length ? Buffer.concat([carry, buf]) : buf;
      const base = pos - carry.length;
      const i = hay.indexOf(nb);
      if (i >= 0) {
        const at = base + i;
        let s = hay.lastIndexOf(0x0a, i); s = s < 0 ? (base === 0 ? 0 : -1) : s + 1;
        if (s < 0) return readLineAt(fd, size, lineStartBefore(fd, at)); // 줄 머리가 이 조각보다 앞
        return readLineAt(fd, size, base + s);
      }
      carry = hay.subarray(Math.max(0, hay.length - nb.length + 1));
      pos += len;
    }
    return null;
  } catch { return null; } finally { try { fs.closeSync(fd); } catch {} }
}
function lineStartBefore(fd, at) {
  let p = at;
  const buf = Buffer.alloc(64 * 1024);
  while (p > 0) {
    const from = Math.max(0, p - buf.length), len = p - from;
    fs.readSync(fd, buf, 0, len, from);
    const j = buf.subarray(0, len).lastIndexOf(0x0a);
    if (j >= 0) return from + j + 1;
    p = from;
    if (at - p > FULL.LINE_MAX) return null;
  }
  return 0;
}
/** 바이트 위치 o 에서 시작하는 줄(끝 \n 전까지, LINE_MAX 상한) → 문자열 | null */
function readLineAt(fd, size, o) {
  if (o == null || o < 0 || o >= size) return null;
  const parts = [];
  let p = o, total = 0;
  while (p < size && total < FULL.LINE_MAX) {
    const len = Math.min(FULL.CHUNK, size - p);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, p);
    const j = buf.indexOf(0x0a);
    if (j >= 0) { parts.push(buf.subarray(0, j)); total += j; return Buffer.concat(parts).toString('utf8'); }
    parts.push(buf); total += len; p += len;
  }
  return p >= size ? Buffer.concat(parts).toString('utf8') : null;
}
export function lineAt(file, o) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try { return readLineAt(fd, fs.fstatSync(fd).size, o); } catch { return null; } finally { try { fs.closeSync(fd); } catch {} }
}

/** 실황 mdRef → {md, cut?} | {error, status} */
export function liveFull({ entry, uuid, block }) {
  if (!entry || !entry.file) return { status: 404, error: 'not_found' };
  if (!UUID_RE.test(String(uuid || ''))) return { status: 400, error: 'bad_ref' };
  const b = Number(block);
  if (!Number.isInteger(b) || b < 0 || b > 500) return { status: 400, error: 'bad_ref' };
  const budget = { left: FULL.SCAN_BYTES };
  for (const f of treeFiles(entry)) {
    const line = findLine(f, `"uuid":"${uuid}"`, budget);
    if (line == null) { if (budget.left <= 0) break; continue; }
    let j; try { j = JSON.parse(line); } catch { return { status: 404, error: 'not_found' }; }
    if (j.type !== 'assistant' || j.uuid !== uuid) continue;
    const blk = Array.isArray(j.message?.content) ? j.message.content[b] : null;
    if (!blk || blk.type !== 'text' || typeof blk.text !== 'string') return { status: 404, error: 'not_found' };
    return fullText(blk.text);
  }
  return { status: 404, error: 'not_found' };
}

/** Interactive: 그 줄(바이트 위치 o)의 assistant 글 전체(글 블록 이어 붙임 — feed 와 같은 모양) → {md, cut?} | {error, status} */
export function feedFull(file, o) {
  const n = Number(o);
  if (!Number.isInteger(n) || n < 0) return { status: 400, error: 'bad_ref' };
  const line = lineAt(file, n);
  if (line == null) return { status: 404, error: 'not_found' };
  let j; try { j = JSON.parse(line); } catch { return { status: 404, error: 'not_found' }; }
  if (j.type !== 'assistant' || j.isSidechain || !Array.isArray(j.message?.content)) return { status: 404, error: 'not_found' };
  const t = j.message.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  if (!t.trim()) return { status: 404, error: 'not_found' };
  return fullText(t);
}
