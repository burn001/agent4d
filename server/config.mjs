// <상태 폴더>/config.json 로드·생성. 서버는 viewToken·port·privacy·project 만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ccvizHome } from './home.mjs';
import { t } from './cli-i18n.mjs';

export function stateDir() {
  return ccvizHome();
}

export function defaultConfigPath() {
  return path.join(stateDir(), 'config.json');
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function defaultConfig() {
  return {
    viewToken: newToken(),
    adminSecret: newToken(),
    port: 7788,
    workerName: 'cc-agent-viz',
    workerUrl: null, // 첫 `ccviz deploy` 가 이 계정 workers.dev 주소로 채운다(공유 레포에 특정 계정 주소를 두지 않음)
    kvNamespaceId: null,
    cloudflaredPath: 'C:/Program Files (x86)/cloudflared/cloudflared.exe',
    privacy: 'summary',
    project: null,
  };
}

// 5차: 권장 출처는 독립 수집기(oauth)지만 비공식 엔드포인트라 기본은 꺼 둔다(옵트인: start --limits 또는 config.limits.source).
// auto·statusline(래퍼)은 비권장. 예전 키 oauthMinIntervalSec 는 무시
export const LIMITS_DEFAULT = { source: 'off', staleSec: 600, pollSec: 180, fastPollSec: 60, highPct: 80, cacheSec: 60 };

/** config.limits 정규화: source oauth|auto|statusline|off, staleSec 양수, pollSec ≥ 60, fastPollSec ≥ 30, highPct 1～100, cacheSec ≥ 0 */
export function normLimits(v) {
  const o = v && typeof v === 'object' ? v : {};
  const D = LIMITS_DEFAULT;
  const source = ['auto', 'statusline', 'oauth', 'off'].includes(o.source) ? o.source : D.source;
  const staleSec = Number(o.staleSec) > 0 ? Number(o.staleSec) : D.staleSec;
  const pollSec = Number(o.pollSec) >= 60 ? Number(o.pollSec) : D.pollSec;
  const fastPollSec = Number(o.fastPollSec) >= 30 ? Number(o.fastPollSec) : D.fastPollSec;
  const highPct = Number(o.highPct) > 0 && Number(o.highPct) <= 100 ? Number(o.highPct) : D.highPct;
  const cacheSec = Number(o.cacheSec) >= 0 && o.cacheSec != null && o.cacheSec !== '' ? Number(o.cacheSec) : D.cacheSec;
  return { source, staleSec, pollSec, fastPollSec, highPct, cacheSec };
}

/**
 * start 가 터널(원격 접속)을 켤지: --no-tunnel > --tunnel > config.remote(boolean) > config.workerUrl 있음(배포를 마친 PC).
 * 아무것도 없으면 로컬(127.0.0.1) 전용.
 */
export function wantRemote(opts = {}, cfg = {}) {
  if (opts['no-tunnel']) return false;
  if (opts.tunnel) return true;
  if (typeof cfg.remote === 'boolean') return cfg.remote;
  return !!cfg.workerUrl;
}

/** 설정을 읽는다. 없으면 만들고, 빠진 토큰만 채워 저장한다(기존 값은 유지). */
export function loadConfig(file = defaultConfigPath()) {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(t('server.configRead', { file, msg: e.message }));
  }
  let dirty = false;
  if (!cfg) { cfg = defaultConfig(); dirty = true; }
  if (!cfg.viewToken) { cfg.viewToken = newToken(); dirty = true; }
  if (!cfg.adminSecret) { cfg.adminSecret = newToken(); dirty = true; }
  if (dirty) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(path.join(path.dirname(file), 'logs'), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  return {
    viewToken: cfg.viewToken,
    adminSecret: cfg.adminSecret, // 화면 원격 조작 명령(로컬 CLI)의 Bearer — 로그·출력에 내지 않는다
    port: Number(cfg.port) || 7788,
    privacy: cfg.privacy === 'minimal' ? 'minimal' : 'summary',
    project: cfg.project || null,
    // 3차: 사용 한도·전체 보기 루트 수. 파일에 없으면 기본값(파일에는 쓰지 않음)
    limits: normLimits(cfg.limits),
    overviewMaxRoots: Number.isInteger(cfg.overviewMaxRoots) && cfg.overviewMaxRoots > 0 ? Math.min(cfg.overviewMaxRoots, 16) : 12,
    // 보관함 폴더(읽기 전용 재생 출처). 기본값 없음 — 값은 로그·출력에 내지 않는다
    archiveDir: typeof cfg.archiveDir === 'string' && cfg.archiveDir ? cfg.archiveDir : null,
    // 작업 대상: 자기 도구 스크립트 → 서비스 이름 매핑 [{ pattern, name }]. 기본 없음
    serviceScripts: Array.isArray(cfg.serviceScripts) ? cfg.serviceScripts : [],
    // 업데이트 확인(GitHub Releases latest 한 번/24시간). false 면 네트워크 호출 0
    updateCheck: cfg.updateCheck !== false,
    created: dirty,
    file,
  };
}
