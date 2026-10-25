// 버전: package.json 의 version 하나가 근거 — 서버 /healthz·`ccviz --version`·`ccviz status`·웹 ⚙ 메뉴가 모두 이 값을 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
let cached = null;
export function readVersion(file = PKG) {
  if (cached && file === PKG) return cached;
  let v = '0.0.0';
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (typeof j.version === 'string' && /^\d+\.\d+\.\d+/.test(j.version)) v = j.version; } catch {}
  if (file === PKG) cached = v;
  return v;
}
