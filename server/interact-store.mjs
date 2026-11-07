// Interactive 상태 저장: <상태 폴더>/interact/ 아래
//   settings.json  { enabled:false }                       — 기능 켬/끔(기본 꺼짐). `agent4d interact on|off`
//   clients.json   { v:1, clients:[{ id, alias:{ix,ko,en}, jwk, status, createdAt, decidedAt, lastSeen, remote, ua }] }
//   audit.jsonl    한 줄에 하나 { ts, ev, device, alias, … }  — 보낸 글은 앞 80자 미리보기만(가림 적용)
// 쓰기는 같은 폴더 임시 파일 → rename(원자적). Windows 는 다른 프로세스가 대상 파일을 잠깐 열고 있으면 rename 이 EPERM·EACCES·EBUSY 로
// 실패하므로 짧게 쉬며 다시 시도하고, 끝내 안 되면 임시 파일을 지우고 오류를 돌려준다(서버를 죽이지 않음 — 부르는 쪽이 로그만).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ccvizHome } from './home.mjs';
import { pickAlias, aliasOf, aliasKey } from './interact-alias.mjs';

export const STATUSES = ['pending', 'allowed', 'revoked'];
export const PENDING_MAX = 16; // 승인 대기 기기 상한(넘으면 가장 오래된 대기부터 지움)
export const SEEN_WRITE_MS = 60_000; // lastSeen 은 1분에 한 번만 파일에 쓴다

export const interactDir = (home = ccvizHome()) => path.join(home, 'interact');

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };

/** 원자적 쓰기(임시 파일 → rename, Windows 잠금은 재시도). 실패하면 throw */
export function writeAtomic(file, text, { tries = 8, renameSync = fs.renameSync } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  let err = null;
  for (let i = 0; i < tries; i++) {
    try { renameSync(tmp, file); return; } catch (e) {
      err = e;
      if (!RETRY_CODES.has(e?.code)) break;
      sleepSync(15 * (i + 1));
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw err;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** 공개키(JWK P-256) → 기기 id(지문 sha256 앞 20자). 꼴이 틀리면 null */
export function deviceIdOf(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y)) return null;
  return crypto.createHash('sha256').update(`P-256.${jwk.x}.${jwk.y}`).digest('hex').slice(0, 20);
}

/** 사람이 보기 쉬운 지문(앞 8자, 4-4) */
export const shortId = (id) => String(id || '').slice(0, 8).replace(/^(.{4})(.{4})$/, '$1-$2');

export class InteractStore {
  constructor({ home = ccvizHome(), now = Date.now, log = (m) => console.error(m) } = {}) {
    this.dir = interactDir(home);
    this.files = { settings: path.join(this.dir, 'settings.json'), clients: path.join(this.dir, 'clients.json'), audit: path.join(this.dir, 'audit.jsonl') };
    this.now = now;
    this.log = log;
    this._settings = null; this._settingsM = -1;
    this._clients = null; this._clientsM = -1;
    this._seenWritten = new Map(); // id → 마지막으로 lastSeen 을 쓴 시각
  }

  _mtime(f) { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }

  // ── 설정 ──
  settings() {
    const m = this._mtime(this.files.settings);
    if (!this._settings || m !== this._settingsM) {
      const j = readJson(this.files.settings);
      this._settings = { enabled: j?.enabled === true, notice: j?.notice !== false }; // notice: 본문 앞 안내 줄(기본 켬)
      this._settingsM = m;
    }
    return this._settings;
  }
  enabled() { return this.settings().enabled; }
  setEnabled(on) {
    const s = { ...this.settings(), enabled: !!on };
    writeAtomic(this.files.settings, JSON.stringify(s, null, 2) + '\n');
    this._settings = s; this._settingsM = this._mtime(this.files.settings);
    return s;
  }

  notice() { return this.settings().notice !== false; }
  setNotice(on) {
    const s = { ...this.settings(), notice: !!on };
    writeAtomic(this.files.settings, JSON.stringify(s, null, 2) + '\n');
    this._settings = s; this._settingsM = this._mtime(this.files.settings);
    return s;
  }

  // ── 기기 ──
  clients() {
    const m = this._mtime(this.files.clients);
    if (!this._clients || m !== this._clientsM) {
      const j = readJson(this.files.clients);
      const list = Array.isArray(j?.clients) ? j.clients.filter((c) => c && typeof c.id === 'string') : [];
      // 저장된 별칭은 번호(ix)가 정본 — 문자열은 다시 계산(낱말 목록 표기를 고쳐도 같은 기기 = 같은 번호)
      for (const c of list) { const al = aliasOf(c.alias?.ix); if (al) c.alias = { ix: c.alias.ix, ...al }; }
      this._clients = list;
      this._clientsM = m;
    }
    return this._clients;
  }
  _save() {
    writeAtomic(this.files.clients, JSON.stringify({ v: 1, clients: this._clients }, null, 2) + '\n');
    this._clientsM = this._mtime(this.files.clients);
  }
  get(id) { return this.clients().find((c) => c.id === id) || null; }

  /** id·id 앞부분(4자 이상)·지문(4-4)·별칭(한·영, 공백·'-' 무시)으로 찾기 → {hit} | {ambiguous:[…]} | {none:true} */
  find(q) {
    const s = String(q || '').trim();
    if (!s) return { none: true };
    const list = this.clients();
    const k = aliasKey(s);
    const exact = list.filter((c) => c.id === s || aliasKey(c.alias?.ko) === k || aliasKey(c.alias?.en) === k);
    if (exact.length === 1) return { hit: exact[0] };
    const hex = s.replace(/-/g, '').toLowerCase();
    const pre = /^[0-9a-f]{4,20}$/.test(hex) ? list.filter((c) => c.id.startsWith(hex)) : [];
    if (pre.length === 1) return { hit: pre[0] };
    const many = exact.length > 1 ? exact : pre;
    return many.length > 1 ? { ambiguous: many } : { none: true };
  }

  /**
   * 기기 등록(처음 보는 공개키면 '승인 대기'로 추가, 아는 기기면 그대로). 별칭은 이때 한 번 뽑아 고정.
   * @returns {{client:object, created:boolean}}
   */
  register(jwk, { remote = false, ua = '' } = {}) {
    const id = deviceIdOf(jwk);
    if (!id) throw Object.assign(new Error('bad key'), { code: 'EBADKEY' });
    const list = this.clients();
    const have = list.find((c) => c.id === id);
    if (have) return { client: have, created: false };
    const taken = new Set();
    for (const c of list) if (c.alias) { taken.add((c.alias.ix || []).join('.')); taken.add(c.alias.ko); taken.add(c.alias.en); }
    const al = pickAlias(taken);
    const t = this.now();
    const client = { id, alias: al, jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, status: 'pending', createdAt: t, decidedAt: null, lastSeen: t,
      remote: !!remote, ua: String(ua || '').slice(0, 120) };
    list.push(client);
    // 승인 대기가 넘치면 가장 오래된 대기부터(승인·취소된 기록은 남김)
    const pend = list.filter((c) => c.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
    for (const c of pend.slice(0, Math.max(0, pend.length - PENDING_MAX))) list.splice(list.indexOf(c), 1);
    this._save();
    return { client, created: true };
  }

  /** 상태 바꾸기(allowed·revoked·pending) → 바뀐 기기 | null */
  setStatus(id, status) {
    if (!STATUSES.includes(status)) throw new Error('bad status');
    const c = this.get(id);
    if (!c) return null;
    c.status = status;
    c.decidedAt = this.now();
    this._save();
    return c;
  }

  /** 기록에서 지우기(다시 열면 새 별칭으로 승인 대기) */
  remove(id) {
    const list = this.clients();
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    this._save();
    return true;
  }

  /** 마지막 접속 — 메모리는 늘, 파일은 1분에 한 번 */
  touch(id, { remote } = {}) {
    const c = this.get(id);
    if (!c) return;
    const t = this.now();
    c.lastSeen = t;
    if (remote != null) c.remote = !!remote;
    const last = this._seenWritten.get(id) || 0;
    if (t - last >= SEEN_WRITE_MS) {
      this._seenWritten.set(id, t);
      try { this._save(); } catch (e) { this.log(`[interact] clients.json write failed: ${e?.code || e?.message}`); }
    }
  }

  // ── 감사 기록 ──
  audit(rec) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.files.audit, JSON.stringify({ ts: new Date(this.now()).toISOString(), ...rec }) + '\n', { mode: 0o600 });
    } catch (e) { this.log(`[interact] audit write failed: ${e?.code || e?.message}`); }
  }
  /** 감사 기록 끝 n 줄(파일 끝 256KB 안에서) */
  auditTail(n = 20) {
    let txt = '';
    try {
      const fd = fs.openSync(this.files.audit, 'r');
      try {
        const size = fs.fstatSync(fd).size, len = Math.min(size, 256 * 1024);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        txt = buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch { return []; }
    const out = [];
    for (const l of txt.split('\n').slice(-n - 1)) { try { if (l.trim()) out.push(JSON.parse(l)); } catch {} }
    return out.slice(-n);
  }
}

/** 화면·CLI 에 내보내는 기기 꼴(공개키 없음) */
export function publicClient(c) {
  if (!c) return null;
  return { id: c.id, short: shortId(c.id), alias: c.alias ? { ko: c.alias.ko, en: c.alias.en } : null, status: c.status,
    createdAt: c.createdAt, decidedAt: c.decidedAt, lastSeen: c.lastSeen, remote: !!c.remote, ua: c.ua || '' };
}
