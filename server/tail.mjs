// 바이트 오프셋 기반 폴링 tail. 읽기 전용으로만 연다.
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

const SKIP_PREFIX = Buffer.from('{"type":"api-request');
const CHUNK = 1 << 20; // 1MB
const NL = 10;

export class FileTail {
  /**
   * @param {string} file
   * @param {{mode?:'lines'|'text', onLine?:(obj:any, info:{backlog:boolean})=>void,
   *          onText?:(s:string, info:{backlog:boolean})=>void, maxInitialText?:number, onBadLine?:(err:any)=>void}} opts
   */
  constructor(file, opts = {}) {
    this.file = file;
    this.mode = opts.mode || 'lines';
    this.onLine = opts.onLine || (() => {});
    this.onText = opts.onText || (() => {});
    this.onBadLine = opts.onBadLine || (() => {});
    this.maxInitialText = opts.maxInitialText ?? 64 * 1024;
    this.offset = 0;
    this.rest = null; // 미완성 줄 버퍼
    this.skipping = false; // api-request 줄을 버리는 중
    this.decoder = new StringDecoder('utf8');
    this.size = 0;
    this.mtimeMs = 0;
    this.polls = 0; // 데이터를 읽은 poll 횟수
    this.exists = false;
    this.busy = false;
    this.closed = false;
  }

  get backlogDone() { return this.polls > 0; }

  /** 한 번 확인해 늘어난 만큼 읽는다. 읽은 바이트 수를 돌려준다. */
  async poll() {
    if (this.busy || this.closed) return 0;
    this.busy = true;
    try {
      let st;
      let big;
      try { big = await fs.promises.stat(this.file, { bigint: true }); } catch { this.exists = false; return 0; }
      // bigint 로 받는다: Windows 파일 ID(ino)는 위쪽 비트에 순번이 들어 2^53 을 넘어 Number 로는 끝자리가 뭉개지고,
      // NTFS 는 지운 이름으로 15초 안에 다시 만들면 생성 시각을 되살린다(tunneling) → 같은 크기 교체를 놓쳤다
      st = { size: Number(big.size), mtimeMs: Number(big.mtimeMs) };
      this.exists = true;
      this.mtimeMs = st.mtimeMs;
      // 파일 정체성(ino·생성 시각 ns). 크기가 줄지 않는 교체(더 큰·같은 크기 새 파일로 회전)도 감지한다
      const fid = `${big.ino}:${big.birthtimeNs}`;
      const replaced = this.fid != null && this.fid !== fid;
      this.fid = fid;
      if (st.size < this.offset || replaced) { // truncate/회전
        this.offset = 0; this.rest = null; this.skipping = false; this.decoder = new StringDecoder('utf8');
      }
      if (st.size === this.offset) {
        if (this.polls === 0) this.polls = 1; // 빈 파일도 backlog 끝으로 본다
        return 0;
      }
      const backlog = this.polls === 0;
      if (backlog && this.mode === 'text' && st.size - this.offset > this.maxInitialText) {
        this.offset = st.size - this.maxInitialText;
      }
      const target = st.size;
      let fh;
      try { fh = await fs.promises.open(this.file, 'r'); } catch { return 0; }
      let total = 0;
      try {
        while (this.offset < target && !this.closed) {
          const len = Math.min(CHUNK, target - this.offset);
          const buf = Buffer.allocUnsafe(len);
          const { bytesRead } = await fh.read(buf, 0, len, this.offset);
          if (bytesRead <= 0) break;
          this.offset += bytesRead;
          total += bytesRead;
          const chunk = bytesRead === len ? buf : buf.subarray(0, bytesRead);
          if (this.mode === 'lines') this._lines(chunk, backlog);
          else {
            const s = this.decoder.write(chunk);
            if (s) this.onText(s, { backlog });
          }
        }
      } finally {
        await fh.close().catch(() => {});
      }
      this.size = this.offset;
      this.polls++;
      return total;
    } finally {
      this.busy = false;
    }
  }

  /** backlog 를 끝까지 읽는다 (초기 로드용) */
  async drain() {
    for (let i = 0; i < 1000; i++) {
      const n = await this.poll();
      if (n === 0) break;
    }
  }

  _lines(chunk, backlog) {
    let start = 0;
    while (start < chunk.length) {
      const nl = chunk.indexOf(NL, start);
      if (this.skipping) {
        if (nl === -1) return; // 이 청크 전부 버림
        this.skipping = false;
        start = nl + 1;
        continue;
      }
      if (nl === -1) {
        const piece = chunk.subarray(start);
        this.rest = this.rest ? Buffer.concat([this.rest, piece]) : Buffer.from(piece);
        if (this.rest.length >= SKIP_PREFIX.length && this.rest.subarray(0, SKIP_PREFIX.length).equals(SKIP_PREFIX)) {
          this.rest = null; this.skipping = true;
        }
        return;
      }
      let line = chunk.subarray(start, nl);
      if (this.rest) { line = Buffer.concat([this.rest, line]); this.rest = null; }
      start = nl + 1;
      this._emit(line, backlog);
    }
  }

  _emit(line, backlog) {
    let end = line.length;
    if (end > 0 && line[end - 1] === 13) end--;
    if (end === 0) return;
    if (end >= SKIP_PREFIX.length && line.subarray(0, SKIP_PREFIX.length).equals(SKIP_PREFIX)) return;
    const s = line.toString('utf8', 0, end);
    let obj;
    try { obj = JSON.parse(s); } catch (e) { this.onBadLine(e); return; }
    try { this.onLine(obj, { backlog }); } catch (e) { this.onBadLine(e); }
  }

  close() { this.closed = true; }
}
