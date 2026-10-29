// 특별 상호작용 분류기. 도구 호출(Bash·PowerShell 명령, MCP 도구 이름, WebFetch)과 그 출력에서
// 범주(github·db·remote·batch·tests)와 세부를 뽑아 이벤트 필드 `ix` 로 싣는다. 순수 함수 + 작은 상태(IxTracker)만 — 라이브·첫 적재·재생이
// 같은 RootRuntime 처리 코드에서 이 모듈을 부르므로 결과가 같다. 값 마스킹은 graph.emit 의 sanitizeIx 한 곳.
import { createHash } from 'node:crypto';
import { redact } from './redact.mjs';

export const IX_CATS = ['github', 'db', 'remote', 'batch', 'tests', 'user'];
export const IX_LIMITS = { cmd: 8000, str: 48, also: 3 };
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// ───────────────────────── 명령 쪼개기 ─────────────────────────
/** heredoc·PowerShell here-string 본문을 떼어 낸다 → {text(본문 뺀 명령), bodies[]} */
export function stripHeredocs(cmd) {
  const bodies = [];
  let s = String(cmd || '');
  s = s.replace(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1([^\n]*)\n([\s\S]*?)(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, (m, q, tag, rest, body) => { bodies.push(body); return '<<' + tag + rest + '\n'; });
  s = s.replace(/@(['"])\r?\n([\s\S]*?)\r?\n\1@/g, (m, q, body) => { bodies.push(body); return "''"; });
  return { text: s, bodies };
}

/** 따옴표 안 내용을 자리표(\u0001n\u0001)로 바꿔 구분자 판정에서 뺀다 → {text, strs[]} */
function maskQuotes(s) {
  const strs = [];
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && s[i + 1] !== '\n') { out += c + s[i + 1]; i += 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, body = '';
      while (j < s.length && s[j] !== c) { if (c === '"' && s[j] === '\\' && j + 1 < s.length) { body += s[j + 1]; j += 2; continue; } body += s[j]; j++; }
      strs.push(body);
      out += '\u0001' + (strs.length - 1) + '\u0001';
      i = j + 1;
      continue;
    }
    out += c; i++;
  }
  return { text: out, strs };
}
const unmask = (tok, strs) => tok.replace(/\u0001(\d+)\u0001/g, (m, k) => strs[Number(k)] ?? '');

const PREFIX = new Set(['sudo', 'time', 'nohup', 'exec', 'command', 'env', 'call', 'then', 'do', 'else', 'elif', '!', '&', '(', '{', 'xvfb-run', 'stdbuf', 'timeout', 'nice', 'ionice', 'caffeinate', 'start-process', 'start']);
const RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'dlx']);

/** 명령 → 단순 명령들 [{prog, args[], raw}] (+ 안쪽 문자열 명령도 nested 로) */
export function splitCommand(cmd) {
  const { text, bodies } = stripHeredocs(String(cmd || '').slice(0, IX_LIMITS.cmd));
  const { text: m, strs } = maskQuotes(text);
  const segs = m.split(/&&|\|\||[;\n|]|(?<![<>0-9])&(?![>&])/);
  const out = [];
  for (const seg of segs) {
    const toks0 = seg.trim().split(/\s+/).filter(Boolean);
    if (!toks0.length) continue;
    // 리다이렉션(2>&1·> 파일·< 파일)은 인자에서 뺀다
    const keep = [];
    for (let j = 0; j < toks0.length; j++) {
      const t = toks0[j];
      if (/^\d*(?:>>?|<)$/.test(t) || t === '&>' || t === '&>>') { j++; continue; }
      if (/^(?:\d*>>?|&>>?|<)\S+$/.test(t) || /^\d*>&\d$/.test(t)) continue;
      keep.push(t);
    }
    if (!keep.length) continue;
    const toks = keep.map((t) => unmask(t, strs));
    const qs = keep.map((t) => /\u0001\d+\u0001/.test(t));
    let k = 0;
    while (k < toks.length) {
      const t = toks[k], tl = t.toLowerCase();
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) && !qs[k]) { k++; continue; } // 환경 변수 앞붙이
      if (PREFIX.has(tl) || /^\$env:/i.test(t)) {
        k++;
        if (tl === 'timeout' && /^\d/.test(toks[k] || '')) k++;
        if (tl === 'sudo' || tl === 'env' || tl === 'nice' || tl === 'timeout' || tl === 'stdbuf' || tl === 'ionice') while (k < toks.length && /^-/.test(toks[k])) k += /^-(u|g|n|c|s)$/.test(toks[k]) ? 2 : 1;
        continue;
      }
      break;
    }
    if (k >= toks.length) continue;
    let prog = progName(toks[k]);
    let args = toks.slice(k + 1);
    if (RUNNERS.has(prog) || (prog === 'yarn' && args[0] === 'dlx') || ((prog === 'uv' || prog === 'poetry' || prog === 'pipenv' || prog === 'pdm' || prog === 'rye') && args[0] === 'run')) {
      if (prog === 'yarn' || prog === 'uv' || prog === 'poetry' || prog === 'pipenv' || prog === 'pdm' || prog === 'rye') args = args.slice(1);
      while (args.length && args[0].startsWith('-')) args = args.slice(1);
      if (args.length) { prog = progName(args[0]); args = args.slice(1); }
    }
    if (prog === 'conda' && args[0] === 'run') { let j = 1; while (j < args.length && args[j].startsWith('-')) j += /^-(n|p|-name|-prefix)$/.test(args[j]) ? 2 : 1; if (j < args.length) { prog = progName(args[j]); args = args.slice(j + 1); } }
    if (/^python[\d.]*w?$|^py$/.test(prog)) {
      const mi = args.findIndex((a) => a === '-m');
      if (mi >= 0 && args[mi + 1]) { prog = args[mi + 1].toLowerCase(); args = args.slice(mi + 2); }
    }
    out.push({ prog, args, raw: unmask(seg.trim(), strs) });
  }
  return { cmds: out, bodies, strs };
}
export function progName(t) {
  let s = String(t || '').replace(/^[&.]\s*/, '').replace(/^['"]|['"]$/g, '');
  s = s.split(/[\\/]/).pop() || s;
  return s.toLowerCase().replace(/\.(exe|cmd|bat|ps1|sh|com)$/, '');
}

// ───────────────────────── 이름 가리기 ─────────────────────────
const shortHash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 4);
/** 원격 호스트 별칭: 계정 버림, IP 는 해시, 도메인은 첫 조각 */
export function hostAlias(h) {
  let s = String(h || '').trim().replace(/^[^@\s]*@/, '');
  const br = /^\[([^\]]+)\]/.exec(s);
  s = br ? br[1] : s.replace(/:.*$/, '');
  if (!s) return null;
  if (/^(localhost|127\.0\.0\.1|::1)$/i.test(s)) return 'localhost';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s) || /^[0-9a-f:]+:[0-9a-f:]*$/i.test(s)) return 'ip-' + shortHash(s);
  if (s.includes('.')) {
    const first = s.split('.')[0];
    if (!first || /^\d+$/.test(first) || first.length > 24) return 'host-' + shortHash(s);
    return first.toLowerCase();
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(s)) return 'host-' + shortHash(s);
  return s;
}
/** 연결 문자열 → {engine, db} (자격증명·호스트는 버림) */
export function parseConnString(s) {
  const m = /\b(mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|rediss|mssql|sqlserver|sqlite|clickhouse|cockroachdb|neo4j(?:\+s)?|bolt)(?::\/\/)([\w$%{][^\s'"`/?]*)(?:\/([^\s'"`?;]*))?/i.exec(String(s || ''));
  if (!m) return null;
  const sch = m[1].toLowerCase();
  const engine = sch.startsWith('mongo') ? 'mongo' : sch.startsWith('postgres') || sch.startsWith('cockroach') ? 'postgres' : sch === 'mysql' || sch === 'mariadb' ? 'mysql'
    : sch.startsWith('redis') ? 'redis' : sch === 'mssql' || sch === 'sqlserver' ? 'mssql' : sch.startsWith('neo4j') || sch === 'bolt' ? 'neo4j' : sch;
  let db = (m[3] || '').split('/')[0] || null;
  if (db && (engine === 'redis' || !/^[\w.-]{1,40}$/.test(db))) db = engine === 'redis' && /^\d+$/.test(db) ? db : null;
  return { engine, db };
}

// ───────────────────────── 범주 판정 표 ─────────────────────────
const GIT_OPS = { push: 'push', pull: 'pull', fetch: 'fetch', clone: 'clone', commit: 'commit', merge: 'merge', rebase: 'rebase', tag: 'tag', 'cherry-pick': 'merge' };
const GIT_RANK = ['commit', 'tag', 'fetch', 'clone', 'pull', 'rebase', 'merge', 'push'];
const GH_RANK = ['api', 'repo', 'pr-view', 'run', 'pr-checks', 'release', 'pr-create', 'pr-merge'];
const DB_PROGS = {
  mongosh: 'mongo', mongo: 'mongo', mongodump: 'mongo', mongorestore: 'mongo', mongoexport: 'mongo', mongoimport: 'mongo',
  psql: 'postgres', pg_dump: 'postgres', pg_restore: 'postgres', pg_dumpall: 'postgres', mysql: 'mysql', mariadb: 'mysql', mysqldump: 'mysql',
  sqlite3: 'sqlite', sqlite: 'sqlite', 'redis-cli': 'redis', 'clickhouse-client': 'clickhouse', cqlsh: 'cassandra', duckdb: 'duckdb', sqlcmd: 'mssql', 'cypher-shell': 'neo4j',
};
const DB_WRITE_PROG = /^(mongorestore|mongoimport|pg_restore)$/;
const DB_READ_PROG = /^(mongodump|mongoexport|pg_dump|pg_dumpall|mysqldump)$/;
const SQL_W = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(table|index|database|collection|user|view)|drop\s+(table|index|database|collection)|alter\s+table|truncate\s+table|upsert|replace\s+into|grant|revoke)\b|\.(insert(One|Many|_one|_many)|update(One|Many|_one|_many)|delete(One|Many|_one|_many)|replace(One|_one)|bulk(Write|_write)|drop(Database|Index|_database|_index|_collection)?|create(Index|_index|Collection|_collection|User)|renameCollection|findOneAndUpdate|findOneAndDelete|find_one_and_(update|delete|replace)|remove|insert|update)\s*\(/i;
const SQL_R = /\b(select|show\s+(tables|databases|collections|dbs)|describe|explain)\b|\\dt|\.(find(One|_one)?|count(Documents|_documents)?|estimatedDocumentCount|estimated_document_count|aggregate|distinct|getCollectionNames|list_collection_names|listCollections|stats|getIndexes|index_information)\s*\(/i;
const REDIS_W = /^\s*(set|hset|del|lpush|rpush|sadd|zadd|expire|flushdb|flushall|incr|hdel|mset)\b/im;
// 약한 추정은 '실행되는' 인라인 코드의 import 줄만(코드를 고치는 heredoc 안 문자열은 제외)
const DB_LIBS = /^\s*(?:from\s+(?:pymongo|motor|sqlalchemy|psycopg2?|asyncpg|mysql|pymysql|sqlite3|redis|duckdb)\b[\w.]*\s+import\b|import\s+(?:pymongo|motor|sqlalchemy|psycopg2?|asyncpg|mysql\.connector|pymysql|sqlite3|redis|duckdb)\b)|\brequire\(\s*['"](?:mongodb|mongoose|pg|mysql2?|better-sqlite3|redis|ioredis|knex|sqlite3)['"]\s*\)|^\s*import\s+.*\bfrom\s+['"](?:mongodb|mongoose|pg|mysql2?|better-sqlite3|redis|ioredis|knex)['"]|\bMongoClient\(/m;
const DB_MCP = /(mongo|postgres|pg|mysql|maria|sqlite|redis|supabase|database|\bdb\b|_db_|_db$|^db_|d1|firestore|firebase|dynamo|neo4j|bigquery|snowflake|clickhouse|duckdb|sql)/i;
const DB_MCP_W = /(insert|update|delete|create|drop|write|put|upsert|execute_sql|exec|apply_migration|migrate|alter|set)/i;
const DB_MCP_R = /(find|query|select|list|get|count|aggregate|describe|schema|read|search|fetch|show|explain)/i;
const REMOTE_PROGS = new Set(['ssh', 'scp', 'sftp', 'rsync', 'plink', 'pscp', 'psftp', 'mosh', 'autossh', 'cloudflared', 'adb', 'mstsc', 'telnet', 'lftp', 'ftp', 'winrs',
  'enter-pssession', 'new-pssession', 'invoke-command', 'copy-item', 'docker', 'kubectl', 'gcloud', 'aws', 'az']);
const SSH_OPT_ARG = new Set(['-p', '-i', '-L', '-R', '-D', '-o', '-F', '-J', '-l', '-b', '-c', '-E', '-e', '-m', '-O', '-Q', '-S', '-W', '-w', '-B', '-P', '-pw', '-P']);
const TEST_PROG = { pytest: 'pytest', 'py.test': 'pytest', jest: 'jest', vitest: 'vitest', mocha: 'mocha', ava: 'ava', tox: 'tox', nox: 'nox', unittest: 'unittest', rspec: 'rspec', phpunit: 'phpunit', ctest: 'ctest', tap: 'tap', 'cargo-nextest': 'cargo' };
const PKG_MGR = new Set(['npm', 'pnpm', 'yarn', 'bun']);

function gitSub(args) {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '-C' || a === '-c' || a === '--git-dir' || a === '--work-tree') { i += 2; continue; }
    if (a.startsWith('-')) { i++; continue; }
    return { sub: a.toLowerCase(), rest: args.slice(i + 1) };
  }
  return { sub: null, rest: [] };
}
const firstPos = (args, skipArg = new Set()) => { for (let i = 0; i < args.length; i++) { const a = args[i]; if (skipArg.has(a)) { i++; continue; } if (a.startsWith('-')) continue; return { v: a, i }; } return null; };

/** 단순 명령 하나 → 후보 ix(범주별) 또는 null. nested: 문자열 안 명령(ssh "…"·bash -c "…") */
function classifyCmd(c, ctx) {
  const { prog, args } = c;
  const al = args.map((a) => a.toLowerCase());
  // ---- 감싼 셸: bash -c "…", powershell -Command "…", cmd /c "…" ----
  if (/^(bash|sh|zsh|dash|pwsh|powershell|cmd)$/.test(prog)) {
    const ci = al.findIndex((a) => a === '-c' || a === '-command' || a === '/c' || a === '/k' || a === '-lc');
    if (ci >= 0 && args[ci + 1]) return { nested: args.slice(ci + 1).join(' ') };
    return null;
  }
  // ---- tests ----
  if (PKG_MGR.has(prog)) {
    const x = al[0] === 'exec' || al[0] === 'dlx' ? al[1] : al[0];
    if (TEST_PROG[x]) return { cat: 'tests', op: 'run', runner: TEST_PROG[x] };
    const a0 = al[0], a1 = al[1] || '';
    if (a0 === 'test' || a0 === 't' || a0 === 'tst' || ((a0 === 'run' || a0 === 'run-script') && /^test/.test(a1)) || (prog !== 'npm' && /^test[:-]/.test(a0 || ''))) return { cat: 'tests', op: 'run', runner: prog === 'bun' && a0 === 'test' ? 'bun' : prog };
  }
  if (prog === 'node' && al.includes('--test')) return { cat: 'tests', op: 'run', runner: 'node' };
  if (prog === 'deno' && al[0] === 'test') return { cat: 'tests', op: 'run', runner: 'deno' };
  if (TEST_PROG[prog]) return { cat: 'tests', op: 'run', runner: TEST_PROG[prog] };
  if (prog === 'go' && al[0] === 'test') return { cat: 'tests', op: 'run', runner: 'go' };
  if (prog === 'cargo' && (al[0] === 'test' || al[0] === 'nextest')) return { cat: 'tests', op: 'run', runner: 'cargo' };
  if (prog === 'dotnet' && al[0] === 'test') return { cat: 'tests', op: 'run', runner: 'dotnet' };
  if ((prog === 'mvn' || prog === 'mvnw') && al.some((a) => a === 'test' || a === 'verify')) return { cat: 'tests', op: 'run', runner: 'maven' };
  if ((prog === 'gradle' || prog === 'gradlew') && al.some((a) => a === 'test' || a === 'check')) return { cat: 'tests', op: 'run', runner: 'gradle' };
  if (prog === 'playwright' && al[0] === 'test') return { cat: 'tests', op: 'run', runner: 'playwright' };
  if (prog === 'make' && al.some((a) => a === 'test' || a === 'check')) return { cat: 'tests', op: 'run', runner: 'make' };
  // ---- github ----
  if (prog === 'git') {
    const { sub, rest } = gitSub(args);
    const op = GIT_OPS[sub];
    if (!op) return null;
    if (op === 'tag' && !rest.some((a) => !a.startsWith('-'))) return null; // git tag (목록) 은 제외
    if (op === 'tag' && rest.some((a) => a === '-l' || a === '--list' || a === '-d')) return null;
    const ix = { cat: 'github', op };
    const pos = rest.filter((a) => !a.startsWith('-'));
    if (op === 'push' || op === 'pull' || op === 'fetch') {
      if (pos[0] && !/^https?:|@/.test(pos[0])) ix.remote = pos[0];
      if (pos[1]) ix.branch = pos[1].replace(/^\+/, '').replace(/^.*:/, '');
      if (rest.includes('--tags')) ix.tags = 1;
      if (rest.some((a) => a === '-f' || a === '--force' || a.startsWith('--force-with-lease'))) ix.force = 1;
    } else if (op === 'clone') {
      const url = pos[0] || '';
      const rm = /([\w.-]+?)(?:\.git)?\/?$/.exec(url.replace(/[?#].*$/, ''));
      if (rm) ix.repo = rm[1];
    } else if (op === 'merge' || op === 'rebase') { if (pos[0]) ix.branch = pos[0]; }
    else if (op === 'tag') ix.tag = pos[0];
    return ix;
  }
  if (prog === 'gh') {
    const [a0, a1] = al;
    if (a0 === 'auth' || a0 === 'secret' || a0 === 'ssh-key' || a0 === 'gpg-key') return null; // 비밀 다루는 명령은 연출하지 않음
    let op = null;
    if (a0 === 'pr') op = a1 === 'create' ? 'pr-create' : a1 === 'merge' ? 'pr-merge' : a1 === 'checks' ? 'pr-checks' : 'pr-view';
    else if (a0 === 'run' || a0 === 'workflow') op = 'run';
    else if (a0 === 'api') op = 'api';
    else if (a0 === 'repo') op = 'repo';
    else if (a0 === 'release') op = 'release';
    else if (a0 === 'issue') op = 'api';
    if (!op) return null;
    const ix = { cat: 'github', op, sub: a1 || null };
    const num = args.slice(2).find((a) => /^#?\d{1,7}$/.test(a));
    if (num) ix.pr = Number(num.replace('#', ''));
    if (op === 'pr-checks' && al.includes('--watch')) ix.watch = 1;
    if (op === 'run' && (a1 === 'watch')) ix.watch = 1;
    return ix;
  }
  // ---- remote ----
  if (REMOTE_PROGS.has(prog)) {
    const r = classifyRemote(prog, args, al);
    if (r) return r;
  }
  // ---- db ----
  if (DB_PROGS[prog]) {
    const engine = DB_PROGS[prog];
    const ix = { cat: 'db', op: DB_READ_PROG.test(prog) ? 'dump' : DB_WRITE_PROG.test(prog) ? 'restore' : 'query', engine };
    const joined = args.join(' ');
    const cs = parseConnString(joined);
    if (cs && cs.db) ix.db = cs.db;
    if (!ix.db) {
      let m;
      if (engine === 'postgres' && (m = /(?:^|\s)(?:-d|--dbname)[=\s]+([\w.-]+)/.exec(joined))) ix.db = m[1];
      else if (engine === 'mongo' && (m = /(?:--db|-d|--nsInclude)[=\s]+([\w-]+)/.exec(joined))) ix.db = m[1];
      else if (engine === 'mongo' && (m = /getSiblingDB\(\s*['"]?([\w-]+)/.exec(joined))) ix.db = m[1];
      else if (engine === 'mongo') { const p = firstPos(args, new Set(['--host', '--port', '--eval', '-u', '-p', '--username', '--password', '--authenticationDatabase', '--file', '-f', '--tlsCAFile'])); if (p && /^[A-Za-z_][\w-]{0,40}$/.test(p.v)) ix.db = p.v; }
      else if (engine === 'sqlite' && args.find((a) => !a.startsWith('-'))) ix.db = progName(args.find((a) => !a.startsWith('-'))).replace(/\.(db|sqlite3?)$/i, '');
      else if (engine === 'mysql') { const p = firstPos(args, new Set(['-u', '-p', '-h', '-P', '-e', '-D', '--user', '--host', '--port'])); const dm = /(?:^|\s)(?:-D|--database)[=\s]+([\w-]+)/.exec(joined); if (dm) ix.db = dm[1]; else if (p) ix.db = p.v; }
      else if (engine === 'redis' && (m = /(?:^|\s)-n\s+(\d+)/.exec(joined))) ix.db = m[1];
    }
    if (ix.db && !/^[\w.-]{1,40}$/.test(ix.db)) delete ix.db;
    ix.rw = DB_WRITE_PROG.test(prog) ? 'w' : DB_READ_PROG.test(prog) ? 'r' : rwOf(joined, engine);
    return ix;
  }
  // 아무 프로그램이 연결 문자열을 받는 경우(node x.mjs mongodb://…)
  const cs = /^(grep|egrep|fgrep|rg|sed|awk|echo|printf|cat|less|head|tail|findstr|select-string|write-output|write-host)$/.test(prog) ? null : parseConnString(args.join(' '));
  if (cs) return { cat: 'db', op: 'script', engine: cs.engine, ...(cs.db ? { db: cs.db } : {}), rw: rwOf(args.join(' '), cs.engine) };
  // ---- batch(병렬 도구) ----
  if (prog === 'xargs') {
    let par = null;
    for (let i = 0; i < args.length; i++) { const a = args[i]; let m; if (a === '-P' || a === '--max-procs') { par = Number(args[i + 1]); break; } if ((m = /^-P(\d+)$/.exec(a)) || (m = /^--max-procs=(\d+)$/.exec(a))) { par = Number(m[1]); break; } }
    return Number.isFinite(par) && par !== 1 && par !== null ? { cat: 'batch', op: 'xargs', ...(par > 0 ? { par } : {}) } : null;
  }
  if (prog === 'parallel') { const ji = al.findIndex((a) => a === '-j' || a === '--jobs'); return { cat: 'batch', op: 'parallel', ...(ji >= 0 && /^\d+$/.test(args[ji + 1] || '') ? { par: Number(args[ji + 1]) } : {}) }; }
  return null;
}
function rwOf(s, engine) {
  const w = SQL_W.test(String(s).replace(/sys\.path\.insert\(/g, '')) || (engine === 'redis' && REDIS_W.test(s)), r = SQL_R.test(s);
  return w && r ? 'rw' : w ? 'w' : 'r';
}

function classifyRemote(prog, args, al) {
  const A = (o) => ({ cat: 'remote', ...o });
  if (prog === 'docker') { if (al[0] === 'exec' || al[0] === 'attach') return A({ op: 'exec', host: 'docker' }); if (al[0] === 'cp') return A({ op: 'scp', host: 'docker', transfer: args.slice(1).filter((a) => !a.startsWith('-')).pop()?.includes(':') ? 'up' : 'down' }); return null; }
  if (prog === 'kubectl') { if (al[0] === 'exec' || al[0] === 'attach') return A({ op: 'exec', host: 'k8s' }); if (al[0] === 'cp') return A({ op: 'scp', host: 'k8s' }); if (al[0] === 'port-forward') return A({ op: 'tunnel', host: 'k8s' }); return null; }
  if (prog === 'gcloud') { if (al[0] === 'compute' && (al[1] === 'ssh' || al[1] === 'scp')) return A({ op: al[1], host: hostAlias(args.slice(2).find((a) => !a.startsWith('-'))) || 'gce' }); return null; }
  if (prog === 'aws') { if (al[0] === 'ssm' && al[1] === 'start-session') return A({ op: 'ssh', host: 'ssm' }); return null; }
  if (prog === 'az') { if (al[0] === 'ssh') return A({ op: 'ssh', host: 'azure' }); return null; }
  if (prog === 'cloudflared') { if (al[0] === 'tunnel' || al[0] === 'access') return A({ op: 'tunnel', host: 'cloudflare' }); return null; }
  if (prog === 'adb') { const s = al.find((a) => !a.startsWith('-')); if (!s || s === 'devices' || s === 'version' || s === 'kill-server' || s === 'start-server') return null; return A({ op: 'adb', host: 'android', ...(s === 'push' ? { transfer: 'up' } : s === 'pull' ? { transfer: 'down' } : s === 'install' ? { transfer: 'up' } : {}) }); }
  if (prog === 'mstsc') { const v = args.find((a) => /^\/v:/i.test(a)); return A({ op: 'rdp', host: v ? hostAlias(v.slice(3)) : 'rdp' }); }
  if (prog === 'enter-pssession' || prog === 'new-pssession') { const ci = al.findIndex((a) => a === '-computername' || a === '-hostname' || a === '-cn'); const h = ci >= 0 ? args[ci + 1] : args.find((a) => !a.startsWith('-')); return A({ op: 'psremote', host: hostAlias(h) || 'pssession' }); }
  if (prog === 'invoke-command') { const ci = al.findIndex((a) => a === '-computername' || a === '-hostname' || a === '-cn' || a === '-session'); if (ci < 0) return null; return A({ op: 'psremote', host: al[ci] === '-session' ? 'pssession' : hostAlias(args[ci + 1]) || 'pssession' }); }
  if (prog === 'copy-item') { if (al.includes('-tosession')) return A({ op: 'scp', host: 'pssession', transfer: 'up' }); if (al.includes('-fromsession')) return A({ op: 'scp', host: 'pssession', transfer: 'down' }); return null; }
  if (prog === 'telnet' || prog === 'winrs') { const h = args.find((a) => !a.startsWith('-') && !a.startsWith('/')); return h ? A({ op: 'ssh', host: hostAlias(h.replace(/^-r:/i, '')) }) : null; }
  if (prog === 'ftp' || prog === 'lftp') { const h = args.find((a) => !a.startsWith('-')); return h ? A({ op: 'sftp', host: hostAlias(h.replace(/^\w+:\/\//, '')) }) : null; }
  // ssh 계열
  if (prog === 'ssh' || prog === 'plink' || prog === 'mosh' || prog === 'autossh') {
    let host = null, hi = -1;
    for (let i = 0; i < args.length; i++) { const a = args[i]; if (SSH_OPT_ARG.has(a)) { i++; continue; } if (a.startsWith('-')) continue; host = a; hi = i; break; }
    if (!host) return null;
    const tunnel = args.some((a) => a === '-L' || a === '-R' || a === '-D' || /^-[A-Za-z]*N/.test(a) && !a.startsWith('--')) || prog === 'autossh';
    const ix = A({ op: tunnel ? 'tunnel' : 'ssh', host: hostAlias(host) });
    const inner = args.slice(hi + 1).join(' ').trim();
    if (inner) ix._inner = inner;
    return ix;
  }
  if (prog === 'scp' || prog === 'pscp' || prog === 'sftp' || prog === 'psftp' || prog === 'rsync') {
    const pos = []; for (let i = 0; i < args.length; i++) { const a = args[i]; if (SSH_OPT_ARG.has(a) && prog !== 'rsync') { i++; continue; } if (prog === 'rsync' && (a === '-e' || a === '--rsh')) { i++; continue; } if (a.startsWith('-')) continue; pos.push(a); }
    const isRemote = (a) => /^(?:[^/\\\s@]+@)?[A-Za-z0-9_.-]+:(?![\\/]{2})/.test(a) && !/^[A-Za-z]:[\\/]/.test(a);
    const rem = pos.find(isRemote);
    if (prog === 'sftp' || prog === 'psftp') { const h = pos[0]; return h ? A({ op: 'sftp', host: hostAlias(h) }) : null; }
    if (!rem) return null; // 로컬 rsync
    const dest = pos[pos.length - 1];
    return A({ op: prog === 'rsync' ? 'rsync' : 'scp', host: hostAlias(rem.split(':')[0]), transfer: isRemote(dest) ? 'up' : 'down', ...(pos.length > 2 ? { files: pos.length - 1 } : {}) });
  }
  return null;
}

// ───────────────────────── 반복(루프) 추정 ─────────────────────────
/** 명령 전체(따옴표 가린 것)에서 루프·병렬 표지와 총량 N 추정 */
export function loopInfo(cmd) {
  const { text } = stripHeredocs(String(cmd || '').slice(0, IX_LIMITS.cmd));
  const { text: m } = maskQuotes(text);
  let op = null, n = null, par = null;
  let r;
  if ((r = /\bfor\s+(\w+)\s+in\s+([^;\n]*?)\s*(?:;|\n)\s*do\b/.exec(m))) {
    op = 'loop';
    const list = r[2].trim();
    let q;
    if ((q = /\$\(\s*seq\s+(?:(-?\d+)\s+)?(?:(-?\d+)\s+)?(-?\d+)\s*\)/.exec(list))) { const a = q[2] != null ? Number(q[1]) : q[1] != null ? Number(q[1]) : 1; const b = Number(q[3]); const step = q[2] != null ? Number(q[2]) : 1; n = Math.floor((b - a) / (step || 1)) + 1; }
    else if ((q = /^\{(-?\d+)\.\.(-?\d+)(?:\.\.(\d+))?\}$/.exec(list))) n = Math.floor(Math.abs(Number(q[2]) - Number(q[1])) / Number(q[3] || 1)) + 1;
    else if (!/[*?$`(]/.test(list)) n = list.split(/\s+/).filter(Boolean).length;
  } else if ((r = /\bfor\s*\(\(\s*\w+\s*=\s*(\d+)\s*;\s*\w+\s*(<=?)\s*(\d+)/.exec(m))) { op = 'loop'; n = Number(r[3]) - Number(r[1]) + (r[2] === '<=' ? 1 : 0); }
  else if (/\bwhile\b[^\n]*(?:;|\n)\s*do\b/.test(m) || /\bwhile\s*\(/.test(m)) op = 'loop';
  else if ((r = /(?:^|[\s(;|])(\d+)\.\.(\d+)\s*\)?\s*\|\s*(?:%|foreach(?:-object)?)\b/i.exec(m))) { op = 'loop'; n = Math.abs(Number(r[2]) - Number(r[1])) + 1; }
  else if (/\bforeach\s*\(/i.test(m) || /\|\s*(?:%|foreach-object)\s*(?:-parallel\s*)?\{/i.test(m)) op = 'loop';
  else if (/\bfor\s+\/[lfLF]\b/.test(m)) op = 'loop';
  if (/foreach-object\s+-parallel/i.test(m)) { op = op || 'loop'; const t = /-throttlelimit\s+(\d+)/i.exec(m); par = t ? Number(t[1]) : 5; }
  if (n != null && (!Number.isFinite(n) || n <= 0)) n = null;
  return op ? { op, n, par } : null;
}
export const LOOP_MIN_N = 5; // 이보다 작은 명시 목록 루프는 batch 아님

// ───────────────────────── 도구 시작 → ix ─────────────────────────
const PRIO = { tests: 5, github: 4, remote: 3, db: 2, batch: 1 };
const rankOf = (ix) => (ix.cat === 'github' ? (ix.op.startsWith('pr-') || ix.op === 'run' || ix.op === 'api' || ix.op === 'repo' || ix.op === 'release' ? 10 + GH_RANK.indexOf(ix.op) : GIT_RANK.indexOf(ix.op)) : 0);

/** 셸 명령 → ix 또는 null(여러 범주면 우선순위 tests > github > remote > db > batch, 나머지는 also) */
export function classifyCommand(command, depth = 0) {
  const { cmds, bodies } = splitCommand(command);
  const cands = [];
  let commits = 0;
  // heredoc 본문을 그것을 받는 명령에 순서대로 붙인다
  { let bi = 0; for (const c of cmds) { const k = (c.raw.match(/<<(?!<)/g) || []).length; c.bodies = bodies.slice(bi, bi + k); bi += k; } }
  for (const c of cmds) {
    const r = classifyCmd(c, {});
    if (!r) continue;
    if (r.nested) { if (depth < 2) { const n = classifyCommand(r.nested, depth + 1); if (n) cands.push(n); } continue; }
    if (r.cat === 'github' && r.op === 'commit') commits++;
    if (r._inner) {
      const inner = r._inner; delete r._inner;
      const n = depth < 2 ? classifyCommand(inner, depth + 1) : null;
      if (n) r.also = [n.cat, ...(n.also || [])].filter((x, i, a) => x !== 'remote' && a.indexOf(x) === i).slice(0, IX_LIMITS.also);
      if (r.also && !r.also.length) delete r.also;
    }
    cands.push(r);
  }
  // ssh host <<EOF … / bash <<EOF … : heredoc 본문이 곧 명령
  if (bodies.length && depth < 2) {
    for (const c of cmds) {
      if (!c.bodies.length) continue;
      const feed = /^(bash|sh|zsh|pwsh|powershell)$/.test(c.prog) ? 'shell' : c.prog === 'ssh' || c.prog === 'plink' ? 'ssh' : null;
      if (!feed) continue;
      const n = classifyCommand(c.bodies.join('\n'), depth + 1);
      if (!n) continue;
      if (feed === 'shell') cands.push(n);
      else { const r = cands.find((x) => x.cat === 'remote'); if (r) { const a = [...new Set([...(r.also || []), n.cat, ...(n.also || [])])].filter((x) => x !== 'remote').slice(0, IX_LIMITS.also); if (a.length) r.also = a; } }
    }
  }
  // 약한 추정: heredoc·-c 안 DB 라이브러리
  const INTERP = /^(python[\d.]*w?|py|node|deno|bun|ipython)$/;
  const inline = cmds.filter((c) => INTERP.test(c.prog)).map((c) => [...c.bodies, c.args.some((a) => a === '-c' || a === '-e' || a === '--eval' || a === '-p') ? c.raw : ''].join('\n')).join('\n');
  if (!cands.some((x) => x.cat === 'db') && DB_LIBS.test(inline)) {
    const cs = parseConnString(inline);
    cands.push({ cat: 'db', op: 'script', engine: cs ? cs.engine : /mongo|motor/i.test(inline) ? 'mongo' : /psycopg|asyncpg|postgres/i.test(inline) ? 'postgres' : /sqlite/i.test(inline) ? 'sqlite' : /redis/i.test(inline) ? 'redis' : /mysql/i.test(inline) ? 'mysql' : 'sql', ...(cs && cs.db ? { db: cs.db } : {}), rw: rwOf(inline, cs ? cs.engine : null), weak: 1 });
  }
  const loop = depth === 0 ? loopInfo(command) : null;
  if (!cands.length) {
    if (loop && (loop.n == null || loop.n >= LOOP_MIN_N || loop.par)) return { cat: 'batch', op: loop.par ? 'parallel' : 'loop', ...(loop.n ? { n: loop.n } : {}), ...(loop.par ? { par: loop.par } : {}) };
    return null;
  }
  cands.sort((a, b) => (PRIO[b.cat] - PRIO[a.cat]) || (rankOf(b) - rankOf(a)));
  const top = { ...cands[0] };
  const also = new Set(top.also || []);
  for (const c of cands.slice(1)) if (c.cat !== top.cat) also.add(c.cat);
  if (loop && (loop.n == null || loop.n >= LOOP_MIN_N) && top.cat !== 'batch') { top.loop = loop.n || 1; also.add('batch'); }
  also.delete(top.cat);
  if (also.size) top.also = [...also].slice(0, IX_LIMITS.also); else delete top.also;
  if (top.cat === 'github' && commits && top.op !== 'commit') top.commitsHere = commits;
  return top;
}

/** 도구 이름·입력 → 시작 ix(phase 'start') 또는 null */
export function classifyStart(tool, input = {}) {
  const name = String(tool || '');
  let ix = null;
  if (SHELL_TOOLS.has(name) && typeof input.command === 'string') {
    ix = classifyCommand(input.command);
    if (ix && input.run_in_background) ix.bg = 1;
  } else if (name === 'Monitor' && typeof input.command === 'string') {
    ix = classifyCommand(input.command);
    if (ix) ix.bg = 1;
  } else if (name.startsWith('mcp__')) {
    const [, server = '', fn = ''] = name.split('__');
    const full = server + '__' + fn;
    if (/github|gitlab/i.test(server)) {
      const op = /merge/i.test(fn) ? 'pr-merge' : /create_pull|create_pr|pull_request_create/i.test(fn) ? 'pr-create' : /push|create_or_update_file|commit/i.test(fn) ? 'push' : /check|workflow|run/i.test(fn) ? 'run' : /pull_request|pr/i.test(fn) ? 'pr-view' : 'api';
      ix = { cat: 'github', op, mcp: 1 };
      const num = Number(input.pull_number ?? input.pullNumber ?? input.number ?? NaN);
      if (Number.isFinite(num)) ix.pr = num;
      if (typeof input.branch === 'string') ix.branch = input.branch;
      if (typeof input.repo === 'string') ix.repo = input.repo;
    } else if (/ssh|remote|sftp|winrm|kube|docker/i.test(server)) ix = { cat: 'remote', op: /sftp|upload|download|copy/i.test(fn) ? 'scp' : 'exec', host: hostAlias(input.host || input.hostname || input.server || '') || server.slice(0, 24), mcp: 1 };
    else if (DB_MCP.test(full)) {
      const q = typeof input.query === 'string' ? input.query : typeof input.sql === 'string' ? input.sql : '';
      const rw = q ? rwOf(q) : DB_MCP_W.test(fn) ? 'w' : DB_MCP_R.test(fn) ? 'r' : 'r';
      const engine = /mongo/i.test(full) ? 'mongo' : /postgres|pg|supabase/i.test(full) ? 'postgres' : /mysql|maria/i.test(full) ? 'mysql' : /sqlite|d1/i.test(full) ? 'sqlite' : /redis/i.test(full) ? 'redis' : 'db';
      ix = { cat: 'db', op: 'mcp', engine, rw, mcp: 1 };
      const db = input.database || input.db || input.dbName || input.database_name;
      if (typeof db === 'string' && /^[\w.-]{1,40}$/.test(db)) ix.db = db;
    }
  } else if (name === 'WebFetch' && typeof input.url === 'string') {
    if (/^https?:\/\/(?:api\.)?github\.com\//i.test(input.url)) { ix = { cat: 'github', op: 'api', web: 1 }; const m = /\/pull\/(\d+)/.exec(input.url); if (m) { ix.op = 'pr-view'; ix.pr = Number(m[1]); } }
  } else if (name === 'Workflow') ix = { cat: 'batch', op: 'workflow' };
  else if (name === 'AskUserQuestion') { // 메인이 사용자에게 묻기: 질문 수·첫 질문 선택지 수
    const qs = Array.isArray(input.questions) ? input.questions : [];
    const q0 = qs[0] || {};
    ix = { cat: 'user', op: 'ask', q: qs.length || 1, opts: Array.isArray(q0.options) ? q0.options.length : 0, ...(q0.multiSelect ? { multi: 1 } : {}), text: snip(q0.question || q0.header || ''),
      _opts: Array.isArray(q0.options) ? q0.options.slice(0, 12).map((o) => String((o && (o.label ?? o)) || '').slice(0, 80)) : [] }; // _opts 는 서버 안에서만(정리 때 빠짐)
  }
  if (!ix) return null;
  return { v: 1, ...ix, phase: 'start' };
}

// ───────────────────────── 출력 파싱 ─────────────────────────
const num = (s) => Number(String(s).replace(/[,_]/g, ''));
/** 테스트 출력 → {pass, fail, skip, total, suites, ms, runner?} (본 것만). 진행 줄(✔/ok/PASSED)도 셈 */
export function parseTests(text) {
  const s = String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); // 색 코드(vitest·jest) 제거
  const r = {};
  let m;
  const last = (re) => { let x, out = null; re.lastIndex = 0; while ((x = re.exec(s))) out = x; return out; };
  // node --test (TAP · spec): "# tests 238" "ℹ pass 237" — grep 으로 tests 줄이 빠져도 pass 줄만으로
  if ((m = last(/^[#ℹ]\s*tests\s+(\d+)/gm)) || (m = last(/^[#ℹ]\s*pass\s+(\d+)/gm))) {
    r.runner = 'node';
    if (/tests/.test(m[0])) r.total = num(m[1]);
    const g = (k) => { const x = last(new RegExp(String.raw`^[#ℹ]\s*${k}\s+(\d+)`, 'gm')); return x ? num(x[1]) : null; };
    r.pass = g('pass'); r.fail = g('fail'); const sk = (g('skipped') || 0) + (g('todo') || 0) + (g('cancelled') || 0); r.skip = sk; if (r.total == null) r.total = (r.pass || 0) + (r.fail || 0) + sk; r.suites = g('suites'); const d = last(/^[#ℹ]\s*duration_ms\s+([\d.]+)/gm); if (d) r.ms = Math.round(Number(d[1]));
    return clean(r);
  }
  // pytest: "== 120 passed, 2 failed, 3 skipped in 4.56s ==" · -q 는 '=' 없이 "11304 passed, 10 skipped, 8 warnings in 358.63s (0:05:58)"
  if ((m = last(/^=+ (.*?\b(?:passed|failed|error|errors|skipped|deselected|xfailed|xpassed|no tests ran)\b.*?) in ([\d.]+)s(?: \([^)]*\))? =+\s*$/gm))
    || (m = last(/^((?:\d+ (?:passed|failed|errors?|skipped|deselected|xfailed|xpassed|warnings?|rerun)(?:, )?)+) in ([\d.]+)s\b.*$/gm))) {
    r.runner = 'pytest';
    const part = m[1];
    const g = (k) => { const x = new RegExp(String.raw`(\d+) ${k}\b`).exec(part); return x ? num(x[1]) : 0; };
    r.pass = g('passed') + g('xpassed'); r.fail = g('failed') + g('errors?'); r.skip = g('skipped') + g('xfailed') + g('deselected');
    r.total = r.pass + r.fail + r.skip; r.ms = Math.round(Number(m[2]) * 1000);
    return clean(r);
  }
  // jest: "Tests:       1 failed, 237 passed, 238 total"
  if ((m = last(/^Tests:\s+(.*?)(\d+) total/gm))) {
    r.runner = 'jest';
    const part = m[1]; const g = (k) => { const x = new RegExp(String.raw`(\d+) ${k}`).exec(part); return x ? num(x[1]) : 0; };
    r.pass = g('passed'); r.fail = g('failed'); r.skip = g('skipped') + g('todo') + g('pending'); r.total = num(m[2]);
    const su = last(/^Test Suites:\s+.*?(\d+) total/gm); if (su) r.suites = num(su[1]);
    const t = last(/^Time:\s+([\d.]+)\s*(ms|s)/gm); if (t) r.ms = Math.round(Number(t[1]) * (t[2] === 's' ? 1000 : 1));
    return clean(r);
  }
  // vitest: "      Tests  1 failed | 237 passed (238)"
  if ((m = last(/^\s*Tests\s+(.*?)\((\d+)\)\s*$/gm)) && /passed|failed|skipped/.test(m[1])) {
    r.runner = 'vitest';
    const part = m[1]; const g = (k) => { const x = new RegExp(String.raw`(\d+) ${k}`).exec(part); return x ? num(x[1]) : 0; };
    r.pass = g('passed'); r.fail = g('failed'); r.skip = g('skipped') + g('todo'); r.total = num(m[2]);
    const su = last(/^\s*Test Files\s+.*?\((\d+)\)/gm); if (su) r.suites = num(su[1]);
    const t = last(/^\s*Duration\s+([\d.]+)(ms|s)/gm); if (t) r.ms = Math.round(Number(t[1]) * (t[2] === 's' ? 1000 : 1));
    return clean(r);
  }
  // cargo: "test result: ok. 12 passed; 0 failed; 1 ignored; …; finished in 0.01s" (여럿이면 합)
  { const re = /^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;.*?finished in ([\d.]+)s/gm; let x, k = 0; r.pass = 0; r.fail = 0; r.skip = 0; r.ms = 0;
    while ((x = re.exec(s))) { k++; r.pass += num(x[1]); r.fail += num(x[2]); r.skip += num(x[3]); r.ms += Math.round(Number(x[4]) * 1000); }
    if (k) { r.runner = 'cargo'; r.suites = k; r.total = r.pass + r.fail + r.skip; return clean(r); } }
  // dotnet: "Passed!  - Failed:     0, Passed:    12, Skipped:     0, Total:    12, Duration: 1 s"
  if ((m = last(/(?:Passed!|Failed!)\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+(\d+),\s+Total:\s+(\d+)(?:,\s+Duration:\s+([\d.]+)\s*(ms|s|m))?/g))) {
    return clean({ runner: 'dotnet', fail: num(m[1]), pass: num(m[2]), skip: num(m[3]), total: num(m[4]), ...(m[5] ? { ms: Math.round(Number(m[5]) * (m[6] === 'ms' ? 1 : m[6] === 'm' ? 60000 : 1000)) } : {}) });
  }
  // maven/gradle surefire: "Tests run: 12, Failures: 1, Errors: 0, Skipped: 0"
  if ((m = last(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/g))) {
    const total = num(m[1]), fail = num(m[2]) + num(m[3]), skip = num(m[4]);
    return clean({ runner: 'maven', total, fail, skip, pass: total - fail - skip });
  }
  // mocha: "  12 passing (34ms)" "  1 failing" "  2 pending"
  if ((m = last(/^\s+(\d+) passing \((\d+)(ms|s)\)/gm))) {
    const f = last(/^\s+(\d+) failing/gm), p = last(/^\s+(\d+) pending/gm);
    r.runner = 'mocha'; r.pass = num(m[1]); r.fail = f ? num(f[1]) : 0; r.skip = p ? num(p[1]) : 0; r.total = r.pass + r.fail + r.skip; r.ms = Number(m[2]) * (m[3] === 's' ? 1000 : 1);
    return clean(r);
  }
  // go: "ok  	pkg	0.012s" / "FAIL	pkg	0.1s" / "--- FAIL: TestX" / "--- PASS:"
  { const okp = (s.match(/^ok\s+\S+\s+[\d.]+s/gm) || []).length, fp = (s.match(/^FAIL\s+\S+\s+[\d.]+s/gm) || []).length;
    if (okp + fp) {
      const tp = (s.match(/^\s*--- PASS:/gm) || []).length, tf = (s.match(/^\s*--- FAIL:/gm) || []).length, ts = (s.match(/^\s*--- SKIP:/gm) || []).length;
      return clean(tp + tf ? { runner: 'go', pass: tp, fail: tf, skip: ts, total: tp + tf + ts, suites: okp + fp } : { runner: 'go', pass: okp, fail: fp, skip: 0, total: okp + fp, suites: okp + fp, unit: 'pkg' });
    } }
  // 진행만(요약 없음): TAP "ok 12 - name" / "not ok", spec "✔ name" / "✖ name", pytest "PASSED"/"FAILED"
  return progressTests(s);
}
function progressTests(s) {
  s = String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  let pass = (s.match(/^\s*ok \d+\b(?!.*# SKIP)/gm) || []).length, fail = (s.match(/^\s*not ok \d+\b/gm) || []).length;
  let skip = (s.match(/^\s*ok \d+\b.*# SKIP/gm) || []).length;
  pass += (s.match(/^\s*[✔✓√]\s/gm) || []).length; fail += (s.match(/^\s*[✖✗×]\s/gm) || []).length;
  pass += (s.match(/ PASSED(?:\s|$)/g) || []).length; fail += (s.match(/ FAILED(?:\s|$)/g) || []).length;
  const pc = /\[\s*(\d{1,3})%\]\s*$/m.exec(s.split(/\n/).filter((l) => /\[\s*\d{1,3}%\]\s*$/.test(l)).pop() || '');
  if (!(pass + fail + skip) && !pc) return null;
  return clean({ ...(pass + fail + skip ? { pass, fail, skip } : {}), partial: 1, ...(pc ? { pct: Number(pc[1]) } : {}) });
}
function clean(r) { const o = {}; for (const [k, v] of Object.entries(r)) if (v != null && !(typeof v === 'number' && !Number.isFinite(v))) o[k] = v; return o; }

/** 진행률 줄 → {i, n} 또는 {pct} (마지막 것) */
export function parseProgress(text) {
  const s = String(text || '').slice(-4000);
  let m, best = null;
  const re = /(?:^|[\s\[(])(\d{1,7})\s*(?:\/|of|중)\s*(\d{1,7})(?=[\s\]):,]|$)/gm;
  while ((m = re.exec(s))) { const i = Number(m[1]), n = Number(m[2]); if (n >= 2 && i <= n) best = { i, n }; }
  const pm = /(\d{1,3}(?:\.\d)?)%\s*\|[█▉▊▋▌▍▎▏#= ]*\|?\s*(\d+)\/(\d+)/.exec(s.split('\n').filter((l) => /%\s*\|/.test(l)).pop() || ''); // tqdm
  if (pm) best = { i: Number(pm[2]), n: Number(pm[3]) };
  if (best) return best;
  const pc = /(?:^|\s)(\d{1,3})%(?:\s|$)/.exec(s.split('\n').filter((l) => /\d%(\s|$)/.test(l)).pop() || '');
  if (pc && Number(pc[1]) <= 100) return { pct: Number(pc[1]) };
  return null;
}

/** git push·pull·fetch 등 출력 → 세부 */
function parseGit(ix, body) {
  const s = String(body || '');
  const out = {};
  if (ix.op === 'push') {
    const lines = s.split('\n').filter((l) => /\s->\s/.test(l));
    for (const l of lines) {
      const m = /^\s*([+*!= -])?\s*(?:\[([^\]]+)\]|([0-9a-f]{6,}\.{2,3}[0-9a-f]{6,}))?\s+(\S+)\s+->\s+(\S+)/.exec(l);
      if (!m) continue;
      if (m[2] && /new branch/.test(m[2])) out.newBranch = 1;
      if (m[2] && /new tag/.test(m[2])) out.tag = out.tag || m[5];
      if (m[2] && /rejected/.test(m[2]) || m[1] === '!') out.rejected = 1;
      if (m[3]) out.range = 1;
      if (!out.branch && !/^refs\/tags|^v\d/.test(m[5])) out.branch = m[5].replace(/^refs\/heads\//, '');
    }
    if (/Everything up-to-date/.test(s)) out.upToDate = 1;
    const to = /^To\s+(\S+)/m.exec(s); if (to) { const rm = /([\w.-]+?)(?:\.git)?\/?$/.exec(to[1]); if (rm) out.repo = rm[1]; }
    const pr = /\/pull\/new\/|create a pull request/i.test(s); if (pr) out.prHint = 1;
  } else if (ix.op === 'pull' || ix.op === 'fetch') {
    if (/Already up[ -]to[ -]date/i.test(s)) out.upToDate = 1;
    const fc = /(\d+) files? changed/.exec(s); if (fc) out.files = num(fc[1]);
    const refs = s.split('\n').filter((l) => /\s->\s/.test(l)).length; if (refs) out.refs = refs;
    if (/CONFLICT/.test(s)) out.conflicts = (s.match(/^CONFLICT/gm) || []).length;
  } else if (ix.op === 'commit') {
    const m = /^\[([^\s\]]+)(?: \(root-commit\))? ([0-9a-f]{7,})\]/m.exec(s); if (m) out.branch = m[1];
    const fc = /(\d+) files? changed/.exec(s); if (fc) out.files = num(fc[1]);
    if (/nothing to commit|no changes added/i.test(s)) out.empty = 1;
  } else if (ix.op === 'merge' || ix.op === 'rebase') {
    if (/CONFLICT/.test(s)) out.conflicts = (s.match(/^CONFLICT/gm) || []).length;
    const fc = /(\d+) files? changed/.exec(s); if (fc) out.files = num(fc[1]);
  } else if (ix.op === 'clone') {
    const m = /Receiving objects:\s+100% \((\d+)\/(\d+)\)/.exec(s); if (m) out.objects = num(m[2]);
  } else if (ix.op === 'pr-create') {
    const m = /\/pull\/(\d+)/.exec(s); if (m) out.pr = Number(m[1]);
  } else if (ix.op === 'pr-merge') {
    const m = /#(\d+)/.exec(s); if (m && !ix.pr) out.pr = Number(m[1]);
    if (/Merged|merged/.test(s)) out.merged = 1;
  } else if (ix.op === 'pr-checks' || ix.op === 'run') {
    const ci = parseChecks(s); if (ci) out.ci = ci;
    const m = /\/pull\/(\d+)|#(\d+)/.exec(s); if (m && !ix.pr && ix.op === 'pr-checks') out.pr = Number(m[1] || m[2]);
  }
  return out;
}
/** gh pr checks · gh run view/watch/list 출력 → {pass, fail, pending, skip} */
export function parseChecks(s) {
  const c = { pass: 0, fail: 0, pending: 0, skip: 0 };
  for (const l of String(s || '').split('\n')) {
    let m;
    if ((m = /\t(pass|fail|pending|skipping|cancel(?:led)?|success|failure|neutral|in_progress|queued)\b/i.exec(l))) bump(c, m[1]);
    else if ((m = /^\s*(✓|✔|X|✗|×|\*|-|●)\s+\S/.exec(l))) bump(c, m[1]);
    else if ((m = /^(completed)\s+(success|failure|cancelled|skipped)\b/i.exec(l)) || (m = /^(in_progress|queued|waiting)\b/i.exec(l))) bump(c, m[2] || m[1]);
  }
  return c.pass + c.fail + c.pending + c.skip ? c : null;
}
function bump(c, w) {
  w = String(w).toLowerCase();
  if (/^(pass|success|✓|✔)$/.test(w)) c.pass++;
  else if (/^(fail|failure|x|✗|×|cancel|cancelled)$/.test(w)) c.fail++;
  else if (/^(pending|in_progress|queued|waiting|\*|●)$/.test(w)) c.pending++;
  else c.skip++;
}
function parseDb(ix, body, cmd) {
  const s = String(body || '');
  let m, rows = null;
  if ((m = /\((\d[\d,]*) rows?\)/.exec(s))) rows = num(m[1]);
  else if ((m = /(\d[\d,]*) rows? in set/.exec(s))) rows = num(m[1]);
  else if ((m = /Query OK, (\d[\d,]*) rows? affected/.exec(s))) rows = num(m[1]);
  else {
    let k = 0, any = false;
    for (const key of ['insertedCount', 'modifiedCount', 'deletedCount', 'upsertedCount', 'nInserted', 'nModified', 'nRemoved']) {
      const re = new RegExp(String.raw`${key}['"]?\s*:\s*(\d+)`, 'g'); let x; while ((x = re.exec(s))) { k += Number(x[1]); any = true; }
    }
    if (any) rows = k;
    else if ((m = /(\d[\d,]*) document\(s\) restored/.exec(s)) || (m = /imported (\d[\d,]*) documents?/.exec(s)) || (m = /done dumping .*?\((\d[\d,]*) documents?\)/.exec(s))) rows = num(m[1]);
    else if ((m = /(?:^|\s)(\d[\d,]*) (?:rows|documents|docs|records|건)\b/.exec(s))) rows = num(m[1]);
    else if (/count|countDocuments|estimatedDocumentCount|dbsize/i.test(cmd || '') &&(m = /^\s*(\d[\d,]*)\s*$/m.exec(s))) rows = num(m[1]);
  }
  return rows != null ? { rows } : {};
}
function parseRemote(ix, body) {
  const s = String(body || '');
  const out = {};
  let m;
  if ((m = /sent ([\d,]+) bytes\s+received ([\d,]+) bytes/.exec(s))) out.bytes = num(m[1]) + num(m[2]);
  if ((m = /total size is ([\d,]+)/.exec(s))) out.size = num(m[1]);
  if ((m = /Number of (?:regular )?files transferred: ([\d,]+)/.exec(s))) out.files = num(m[1]);
  if (!out.bytes && (m = /100%\s+([\d.]+)\s*([KMGT]?B)\b/.exec(s))) out.bytes = Math.round(Number(m[1]) * ({ B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }[m[2]] || 1));
  if (/Connection (?:refused|timed out|closed by)|Could not resolve hostname|Permission denied \(|Host key verification failed|No route to host/i.test(s)) out.connFail = 1;
  return out;
}

/**
 * 도구 끝 → 끝 ix. start = 시작 ix, res = {ok, stdout, stderr, body, bg(백그라운드 id 있음)}
 * 백그라운드로 띄운 것은 phase 'progress'(아직 도는 중 — 끝은 출력·노드 상태로)
 */
export function classifyEnd(start, res = {}) {
  if (!start) return null;
  const body = [res.stdout, res.stderr, res.body].filter(Boolean).join('\n').slice(-20000);
  const ix = { ...start, phase: res.bg ? 'progress' : 'end' };
  if (!res.bg) ix.ok = res.ok !== false;
  if (start.cat === 'user' && start.op === 'ask') Object.assign(ix, parseAnswer(start, res));
  else if (start.cat === 'tests') { const t = parseTests(body); if (t) Object.assign(ix, t); if (!res.bg && t && t.fail > 0) ix.ok = false; }
  else if (start.cat === 'github') Object.assign(ix, parseGit(start, body));
  else if (start.cat === 'db') Object.assign(ix, parseDb(start, body, res.cmd));
  else if (start.cat === 'remote') { Object.assign(ix, parseRemote(start, body)); if (ix.connFail) ix.ok = false; }
  else if (start.cat === 'batch') { const p = parseProgress(body); if (p && p.n) { ix.i = p.i; ix.n = Math.max(ix.n || 0, p.n); } }
  if (ix.cat === 'github' && ix.rejected) ix.ok = false;
  if (ix.cat === 'github' && ix.conflicts) ix.ok = false;
  return ix;
}

/** 백그라운드 출력 조각 → 진행 ix(없으면 null). acc = 노드별 누적 상태(줄 경계 보관) */
export function outputProgress(start, chunk, acc) {
  const text = (acc.partial || '') + String(chunk || '');
  const cut = text.lastIndexOf('\n');
  const done = cut >= 0 ? text.slice(0, cut + 1) : '';
  acc.partial = cut >= 0 ? text.slice(cut + 1).slice(-2000) : text.slice(-2000);
  if (!done) return null;
  acc.tail = ((acc.tail || '') + done).slice(-12000);
  if (start && start.cat === 'tests') {
    const p = progressTests(done);
    if (p) { acc.pass = (acc.pass || 0) + p.pass; acc.fail = (acc.fail || 0) + p.fail; acc.skip = (acc.skip || 0) + p.skip; if (p.pct != null) acc.pct = p.pct; }
    const full = parseTests(acc.tail);
    if (full && !full.partial) return { ...start, phase: 'end', ok: !(full.fail > 0), ...full };
    if (!p) return null;
    return { ...start, phase: 'progress', pass: acc.pass, fail: acc.fail, skip: acc.skip, partial: 1, ...(acc.pct != null ? { pct: acc.pct } : {}) };
  }
  const pr = parseProgress(done);
  if (!pr) return null;
  if (start && start.cat === 'github' && start.op === 'clone' && pr.n) return { ...start, phase: 'progress', i: pr.i, n: pr.n };
  if (start && start.cat !== 'batch') return null;
  if (!start && !(pr.n >= LOOP_MIN_N)) return null; // 분류 안 된 명령은 i/N(N≥5) 진행 줄만
  const base = start || { v: 1, cat: 'batch', op: 'progress' };
  return { ...base, phase: 'progress', ...(pr.n ? { i: pr.i, n: Math.max(base.n || 0, pr.n) } : { pct: pr.pct }) };
}

// ───────────────────────── 사용자 ↔ 메인 ─────────────────────────
const snip = (s, n = 40) => { const t = String(s || '').replace(/<[^>]{1,80}>/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
export { snip as ixSnip };
export const USER_DENY_RE = /The user doesn't want to proceed with this tool use|tool use was rejected|User rejected|Permission to use \S+ (?:has been|was) denied|user denied/i;
export const INTERRUPT_RE = /^\s*\[Request interrupted by user/;
/**
 * 사용자 쪽 메시지 한 건 → ix(cat 'user'). raw = 원문(태그 포함), origin = 'human'|'task-notification'|'system'.
 * 사람이 아닌 것(자동 알림·시스템 주입·로컬 명령 출력)은 op 'auto' — 연출은 회색 작은 점만.
 */
export function classifyUserMessage(raw, { origin = 'human', turnOpen = false, queued = false, waitMs = null, images = 0 } = {}) {
  const s = String(raw || '');
  if (origin === 'task-notification' || /<task-notification>/.test(s)) return { v: 1, cat: 'user', op: 'auto', src: 'notify', phase: 'end' };
  if (origin !== 'human') return { v: 1, cat: 'user', op: 'auto', src: 'system', phase: 'end' };
  if (/^\s*This session is being continued from a previous conversation/.test(s)) return { v: 1, cat: 'user', op: 'auto', src: 'compact', phase: 'end' }; // 압축 요약 주입
  if (INTERRUPT_RE.test(s)) return { v: 1, cat: 'user', op: 'interrupt', phase: 'end', ok: false };
  const cmd = /<command-name>\s*\/?([\w:.-]{1,40})\s*<\/command-name>/.exec(s);
  if (cmd) return { v: 1, cat: 'user', op: 'command', cmd: '/' + cmd[1], text: snip((/<command-args>([\s\S]*?)<\/command-args>/.exec(s) || [])[1] || ''), phase: 'end' };
  const stripped = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!stripped || /^<(local-command-stdout|local-command-caveat|bash-stdout|bash-input|user-memory-input)>/.test(stripped)) return { v: 1, cat: 'user', op: 'auto', src: 'local', phase: 'end' };
  const img = images + (stripped.match(/\[(?:이미지|Image[^\]]*)\]/g) || []).length;
  return { v: 1, cat: 'user', op: queued || turnOpen ? 'midturn' : 'prompt', text: snip(stripped.replace(/\[(?:이미지|Image[^\]]*)\]/g, '')), chars: stripped.length,
    ...(img ? { images: img } : {}), ...(Number.isFinite(waitMs) && waitMs >= 0 ? { waitMs } : {}), phase: 'end' };
}
/** AskUserQuestion 결과 → 고른 선택지(0부터)·답 앞부분 */
function parseAnswer(start, res) {
  const out = {};
  const tur = res.tur || {};
  let ans = null;
  if (tur.answers && typeof tur.answers === 'object') ans = Object.values(tur.answers)[0];
  if (ans == null) { const m = /"[^"]*"\s*=\s*"([^"]*)"/.exec(String(res.body || res.stdout || '')); if (m) ans = m[1]; }
  if (ans != null) {
    out.answer = snip(Array.isArray(ans) ? ans.join(', ') : ans);
    const opts = Array.isArray(start._opts) ? start._opts : [];
    const i = opts.findIndex((o) => String(o).trim() === String(Array.isArray(ans) ? ans[0] : ans).trim());
    if (i >= 0) out.pick = i;
  }
  if (res.ok === false || USER_DENY_RE.test(String(res.body || ''))) { out.ok = false; out.declined = 1; }
  return out;
}

// ───────────────────────── 연속·동시 분기 (상태) ─────────────────────────
export const STREAK = { MIN: 12, GAP_MS: 8_000 }; // 실측 30일: 10회·30초면 1,519묶음(Bash 대부분, 잡음) → 12회·8초 229묶음
export const FAN = { MIN: 4, WINDOW_MS: 20_000 };
/** 노드별 같은 도구 연속 호출·동시 서브에이전트 분기·로컬 커밋 수를 센다(라이브·재생 같은 순서로 불림) */
export class IxTracker {
  constructor() { this.streak = new Map(); this.fan = new Map(); this.commits = 0; }
  /** tool-start 하나. 범주가 이미 있으면(ix) 그대로, 없으면 연속·분기 batch ix(또는 null) */
  onStart(nodeId, tool, tsMs, ix) {
    const isAgent = tool === 'Agent' || tool === 'Task';
    let st = this.streak.get(nodeId);
    if (!st || st.tool !== tool || !(tsMs - st.last <= STREAK.GAP_MS)) st = { tool, n: 0, last: tsMs, first: tsMs };
    st.n++; st.last = tsMs;
    this.streak.set(nodeId, st);
    if (this.streak.size > 4000) this.streak.clear();
    if (ix) return ix;
    if (isAgent) {
      const f = (this.fan.get(nodeId) || []).filter((t) => tsMs - t <= FAN.WINDOW_MS && tsMs >= t);
      f.push(tsMs);
      this.fan.set(nodeId, f);
      if (f.length >= FAN.MIN) return { v: 1, cat: 'batch', op: 'fan', i: f.length, phase: 'progress' };
      return null;
    }
    if (st.n >= STREAK.MIN && tool !== 'TodoWrite') return { v: 1, cat: 'batch', op: 'streak', tool, i: st.n, phase: 'progress', ...(st.n > STREAK.MIN ? {} : { first: 1 }) };
    return null;
  }
  /** 끝 ix 를 받아 로컬 커밋 수를 갱신하고 push 에 커밋 수를 붙인다 */
  onEnd(ix) {
    if (!ix || ix.cat !== 'github') return ix;
    if (ix.op === 'commit' && ix.ok && !ix.empty) this.commits++;
    if (ix.commitsHere && ix.ok) { this.commits += ix.commitsHere; }
    if (ix.op === 'push' && ix.phase === 'end') {
      if (ix.ok && !ix.upToDate) { ix.commits = Math.max(1, this.commits); this.commits = 0; }
      else if (ix.upToDate) ix.commits = 0;
    }
    delete ix.commitsHere;
    return ix;
  }
}

// ───────────────────────── 마스킹 (graph.emit) ─────────────────────────
const IX_ENUM = new Set(['cat', 'op', 'phase', 'engine', 'runner', 'transfer', 'rw', 'unit', 'sub', 'src', 'st']);
const IX_STR = new Set(['remote', 'branch', 'repo', 'db', 'host', 'tag', 'tool', 'text', 'answer', 'cmd']);
/** 이벤트의 ix 필드 정리: 문자열은 redact·48자, 수는 유한·정수, 알 수 없는 키 버림. minimal 이면 이름(문자열) 버림 */
export function sanitizeIx(ix, privacy = 'summary') {
  if (!ix || typeof ix !== 'object' || !IX_CATS.includes(ix.cat)) return null;
  const out = { v: 1 };
  for (const [k, v] of Object.entries(ix)) {
    if (k === 'v' || v == null) continue;
    if (IX_ENUM.has(k)) { if (typeof v === 'string' && /^[\w.-]{1,24}$/.test(v)) out[k] = v; continue; }
    if (IX_STR.has(k)) {
      if (privacy === 'minimal' && k !== 'tool') continue;
      if (typeof v !== 'string') continue;
      const s = redact(v).replace(/[\u0000-\u001f]/g, '').slice(0, IX_LIMITS.str);
      if (!s || /\*\*\*/.test(s)) continue; // 가려진 값은 아예 뺀다
      out[k] = s; continue;
    }
    if (k === 'also') { if (Array.isArray(v)) { const a = v.filter((x) => IX_CATS.includes(x)).slice(0, IX_LIMITS.also); if (a.length) out.also = a; } continue; }
    if (k === 'ci') { if (v && typeof v === 'object') { const c = {}; for (const kk of ['pass', 'fail', 'pending', 'skip']) if (Number.isFinite(v[kk])) c[kk] = Math.max(0, Math.round(v[kk])); out.ci = c; } continue; }
    if (k === 'ok') { out.ok = !!v; continue; }
    if (k === 'ref') { if (typeof v === 'string' && /^[\w-]{1,80}$/.test(v)) out.ref = v; continue; }
    if (k === 'from') { if (typeof v === 'string' && /^[a-z]{1,3}:[\w:.-]{1,120}$/.test(v)) out.from = v; continue; } // 자동 턴의 출처 노드 id
    if (typeof v === 'number' && Number.isFinite(v)) { out[k] = Math.max(0, Math.round(v)); continue; }
    if (v === true) out[k] = 1;
  }
  return out;
}
