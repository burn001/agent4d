// 상태·비밀 폴더 결정: CCVIZ_HOME → 예전 기본 ~/.cc-session-viz(이미 있으면 계속 사용, 하위 호환) → 새 기본 ~/.cc-agent-viz
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOME_NAME = '.cc-agent-viz';
export const LEGACY_HOME_NAME = '.cc-session-viz';

export function ccvizHome(env = process.env, homedir = os.homedir()) {
  if (env.CCVIZ_HOME) return env.CCVIZ_HOME;
  const legacy = path.join(homedir, LEGACY_HOME_NAME);
  try { if (fs.statSync(legacy).isDirectory()) return legacy; } catch {}
  return path.join(homedir, HOME_NAME);
}
