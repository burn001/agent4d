#!/usr/bin/env node
// 5차: 토큰 한도 독립 수집기 단독 실행
//   node bin/limits.mjs --once [--force] [--text]   지금 값 한 번(JSON, 60초 캐시 적중이면 HTTP 없음)
//   node bin/limits.mjs --watch [--text]            주기 수집(평소 180초, 80%↑ 60초)하며 값이 바뀔 때마다 한 줄
// 출력은 서버 /limits 와 같은 모양(Limits). 토큰·자격증명 내용은 절대 출력하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LimitsCollector, limitsHome } from '../server/limits.mjs';
import { normLimits } from '../server/config.mjs';
import { t, cliLang } from '../server/cli-i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readCfgLimits() {
  // config.json 은 limits 키만 읽는다(비밀 값은 건드리지도 출력하지도 않음)
  try { return normLimits(JSON.parse(fs.readFileSync(path.join(limitsHome(), 'config.json'), 'utf8')).limits); } catch { return normLimits(null); }
}

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || '0.1.0'; } catch { return '0.1.0'; }
}

const remain = (sec) => {
  if (sec == null) return '';
  const ko = cliLang() === 'ko';
  return sec >= 86400
    ? `${Math.floor(sec / 86400)}${ko ? '일 ' : 'd '}${Math.floor((sec % 86400) / 3600)}${ko ? '시간' : 'h'}`
    : `${Math.floor(sec / 3600)}${ko ? '시간 ' : 'h '}${Math.floor((sec % 3600) / 60)}${ko ? '분' : 'm'}`;
};
const kst = (iso) => (iso ? new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') + ' KST' : '?');

/** 사람용 한 줄 */
export function textLine(L) {
  const w = (name, x) => (x ? t('lim.textWin', { name, pct: x.pct, at: kst(x.resetsAt), est: x.estimated ? t('lim.textEst') : '', left: x.resetsInSec != null ? t('lim.textLeft', { remain: remain(x.resetsInSec) }) : '' }) : `${name} —`);
  const tail = [L.stale ? t('lim.textStale') : '', L.error ? t('lim.textErr', { kind: `${L.error.kind}${L.error.status ? ` ${L.error.status}` : ''}`, msg: L.error.message || '' }) : ''].filter(Boolean).join(' · ');
  return `${w('5h', L.five_hour)} · ${w('7d', L.seven_day)}${tail ? ' · ' + tail : ''}`;
}

export async function main(argv = process.argv.slice(2), { out = (s) => process.stdout.write(s + '\n'), collectorOpts = {} } = {}) {
  const has = (f) => argv.includes(f);
  if (has('--help') || has('-h')) {
    out(t('lim.usage'));
    return 0;
  }
  const cfg = readCfgLimits();
  const logger = has('--verbose') ? (m) => process.stderr.write('[limits] ' + m + '\n') : () => {};
  const c = new LimitsCollector({ ...cfg, source: 'oauth', logger, version: version(), ...collectorOpts });
  const show = (L) => out(has('--text') ? textLine(L) : JSON.stringify(L, null, has('--watch') ? 0 : 2));
  if (has('--watch')) {
    c.onChange(show);
    c.start();
    c.poller.timer?.ref?.(); // 단독 실행에서는 프로세스를 붙잡아 둔다
    const keep = setInterval(() => {}, 1 << 30);
    await new Promise((resolve) => {
      const done = () => { clearInterval(keep); c.stop(); resolve(); };
      process.once('SIGINT', done); process.once('SIGTERM', done);
    });
    return 0;
  }
  await c.poller.refresh({ force: has('--force') });
  const L = c.current();
  show(L);
  return L.five_hour || L.seven_day ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`limits: ${e?.message || e}\n`); process.exitCode = 2; });
}
