// 홀로그램 패널 안의 실제 글 — 서버가 보낸 panel(제목·줄·줄 표시)을 캔버스에 그려 패널 위에 겹친다.
// 패널 틀(실루엣·머리 띠·글리프·테두리)은 holo.js 의 인스턴스 셰이더가, 글은 여기 풀(PANEL.TEXT_MAX 개)의 평면이 맡는다.
// 원칙: 캔버스는 내용(패널 판 pv)·보일 줄 수·테마·결과가 바뀔 때만 다시 그리고 올린다(프레임마다 다시 그리지 않음).
//       프레임마다 하는 일은 자리·크기·투명도 uniform 갱신뿐. 꼬리 갱신의 '위로 흐름'도 uniform 하나(uScroll)로.
import * as THREE from 'three';
import { PANEL, shapeLayout, panelRows, fallbackPanel, markStyle, textRows, jobRowHits, jobLinesKey, jobLineStyle } from './holo-core.mjs';
import { t as tr } from './i18n.mjs';
import { runRing } from './run-core.mjs'; // 셸 머리줄 진행 링

const REDUCED = () => { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const RUN_STALE_INK = ['#fb923c', '#c2410c']; // 정체 주황(작업 줄 표시 정체 색과 같음)

/**
 * 머리줄 오른쪽 경과 꼬리표: [진행 링] 3:42. 장시간(30초↑)이면 링이 이번 1분 안의 진행을 채운다(초마다 한 칸 — 움직임 줄이기면 가득 찬 정적 링).
 * 반환 = 차지한 폭(px)
 */
export function drawRunTag(ctx, xRight, yc, fs, e, ink, light) {
  if (!e.runHead) return 0;
  const col = e.runStale ? RUN_STALE_INK[light ? 1 : 0] : ink;
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.font = `700 ${fs}px ${MONO}`;
  const tw = ctx.measureText(e.runHead).width;
  const r = fs * 0.36, gap = fs * 0.35;
  ctx.fillStyle = col; ctx.textAlign = 'right';
  ctx.fillText(e.runHead, xRight, yc);
  if (e.runLong) {
    const cx = xRight - tw - gap - r, lw = Math.max(1.5, fs * 0.13);
    ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.arc(cx, yc, r, 0, Math.PI * 2); ctx.stroke();
    const k = REDUCED() ? 1 : runRing(e.runMs);
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(cx, yc, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.04, k)); ctx.stroke();
  }
  ctx.restore();
  return tw + (e.runLong ? gap + r * 2 : 0) + fs * 0.6;
}

const MONO = '"D2Coding", "Cascadia Mono", Consolas, "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans Mono CJK KR", monospace';

const VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * c;
}`;
const FS = `
uniform sampler2D uMap; uniform float uAlpha; uniform float uSwap; uniform vec4 uBody; uniform float uScroll; uniform float uLight;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  if (uv.y < uSwap) discard;                   // 이어받기 갈림 띠 아래는 아직 앞 내용(틀만)
  bool inBody = uv.x >= uBody.x && uv.x <= uBody.z && uv.y >= uBody.y && uv.y <= uBody.w;
  if (inBody && uScroll > 0.0) { uv.y += uScroll; if (uv.y > uBody.w) discard; } // 꼬리: 새 줄이 아래에서 밀고 올라옴
  vec4 t = texture2D(uMap, uv);
  float sl = uLight > 0.5 ? 0.975 + 0.025 * sin(vUv.y * 230.0) : 0.9 + 0.1 * sin(vUv.y * 230.0);
  gl_FragColor = vec4(t.rgb * (uLight > 0.5 ? 1.0 : sl), t.a * uAlpha);
}`;

/** 글자 폭에 맞춰 자르기(넘치면 …) */
function fit(ctx, s, maxW) {
  if (!s || maxW <= 0) return '';
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
  return s.slice(0, lo) + '…';
}
/** 폭에 맞춰 줄 바꿈(말 패널): 빈칸에서 끊을 수 있으면 거기서 */
function wrap(ctx, s, maxW) {
  const out = [];
  let rest = s;
  while (rest.length) {
    if (ctx.measureText(rest).width <= maxW) { out.push(rest); break; }
    let n = 1;
    while (n < rest.length && ctx.measureText(rest.slice(0, n + 1)).width <= maxW) n++;
    const sp = rest.lastIndexOf(' ', n);
    if (sp > n * 0.55) n = sp + 1;
    out.push(rest.slice(0, n).trimEnd());
    rest = rest.slice(n).trimStart();
    if (out.length > 40) break;
  }
  return out;
}
/** 꼬리 작은 상태: 마지막(비지 않은) 줄 하나 → [{text, mark}] */
export function lastRow(p) {
  for (let i = p.lines.length - 1; i >= 0; i--) if (String(p.lines[i]).trim()) return [{ text: p.lines[i], mark: p.marks[i] || 'o' }];
  return [];
}
function lock(ctx, cx, cy, s, color) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = Math.max(2, s * 0.11); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy - s * 0.12, s * 0.26, Math.PI, 0); ctx.lineTo(cx + s * 0.26, cy + s * 0.05); ctx.moveTo(cx - s * 0.26, cy - s * 0.12); ctx.lineTo(cx - s * 0.26, cy + s * 0.05); ctx.stroke();
  const w = s * 0.74, h = s * 0.52, x = cx - w / 2, y = cy;
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, s * 0.08); else ctx.rect(x, y, w, h); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(cx, y + h * 0.42, s * 0.07, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(cx - s * 0.03, y + h * 0.42, s * 0.06, h * 0.32);
  ctx.restore();
}

/**
 * 패널 하나를 캔버스에 그린다. rows = 보일 줄 수(0 이면 제목만 크게). ink = 도구 종류 잉크 색(CSS)
 * jobs = [{line, code}] — 이 꼬리를 낸 노드 아래 작업들. 작업을 만든 줄은 왼쪽 상태색 띠 + 옅은 바탕
 */
export function drawPanel(ctx, W, H, e, rows, light, ink, jobs = null) {
  ctx.clearRect(0, 0, W, H);
  const L = shapeLayout(e.shape ?? 0, e.asp || 1.5);
  const p = e.panel || fallbackPanel(e);
  const secret = p.hidden === 'secret';
  const X = (u) => u * W, Y = (v) => (1 - v) * H;
  const [tx0, tx1, ty0, ty1] = L.title, [bx0, bx1, by0, by1] = L.body;
  const bw = X(bx1) - X(bx0), bh = (by1 - by0) * H;
  const glow = (c, k) => { if (!light) { ctx.shadowColor = c; ctx.shadowBlur = k; } else ctx.shadowBlur = 0; };
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const dimC = markStyle('d', light).color;
  const title = secret ? (e.label && e.label.tool) || '' : p.title || (e.label && e.label.tool) || '';
  if (secret) {
    // 비공개: 자물쇠 + '비공개 내용'만(제목도 도구 이름만)
    if (rows > 0) { const fs = Math.min((ty1 - ty0) * H * 0.56, 26); ctx.font = `700 ${fs}px ${MONO}`; ctx.fillStyle = ink; glow(ink, 6); ctx.fillText(fit(ctx, title, X(tx1) - X(tx0)), X(tx0), Y((ty0 + ty1) / 2)); }
    const s = Math.min(bh * 0.42, bw * 0.3);
    const cx = X(bx0) + bw / 2, cy = Y(by1) + bh * 0.42;
    glow(dimC, 4); lock(ctx, cx, cy - s * 0.3, s, ink);
    const fs = Math.min(bh * 0.16, 30); ctx.font = `600 ${fs}px ${MONO}`; ctx.fillStyle = dimC; ctx.textAlign = 'center';
    ctx.fillText(tr('cards.holo.secret'), cx, cy + s * 0.55);
    ctx.shadowBlur = 0;
    return;
  }
  if (rows <= 0) {
    // 먼 거리: 제목만 크게(두 줄까지) — 셸 경과는 제목 뒤에
    const fs = Math.min(bh * 0.36, 60);
    ctx.font = `700 ${fs}px ${MONO}`; ctx.fillStyle = ink; glow(ink, 8);
    let tl = wrap(ctx, title, bw);
    if (e.runHead) tl = [fit(ctx, tl.join(' '), bw), e.runHead]; // 경과는 둘째 줄(잘리지 않게)
    else if (tl.length > 2) tl = [tl[0], fit(ctx, tl.slice(1).join(' '), bw)];
    const y0 = Y(by1) + bh / 2 - (tl.length - 1) * fs * 0.6;
    tl.forEach((t, i) => ctx.fillText(t, X(bx0), y0 + i * fs * 1.2));
    ctx.shadowBlur = 0;
    return;
  }
  // 머리줄: 제목 · (간략)
  const th = (ty1 - ty0) * H;
  const tfs = Math.min(th * 0.56, 26);
  let tagW = 0;
  if (p.thin) {
    ctx.font = `600 ${tfs * 0.72}px ${MONO}`;
    tagW = ctx.measureText(tr('cards.holo.brief')).width + tfs * 0.8;
    ctx.fillStyle = dimC; ctx.shadowBlur = 0;
    ctx.fillText(tr('cards.holo.brief'), X(tx1) - tagW + tfs * 0.4, Y((ty0 + ty1) / 2));
  }
  tagW += drawRunTag(ctx, X(tx1) - tagW, Y((ty0 + ty1) / 2), tfs * 0.86, e, ink, light); // 셸 경과(진행 링)
  ctx.font = `700 ${tfs}px ${MONO}`; ctx.fillStyle = ink; glow(ink, 6);
  ctx.fillText(fit(ctx, title, X(tx1) - X(tx0) - tagW), X(tx0), Y((ty0 + ty1) / 2));
  // 줄 — 꼬리 작은 상태(mini)는 마지막 줄 하나만
  const R = e.mini ? 1 : p.fallback ? Math.min(rows, 4) : rows;
  const rh = bh / R, fs = Math.min(rh * 0.78, 34);
  ctx.font = `500 ${fs}px ${MONO}`;
  let list;
  if (p.mode === 'say') {
    const all = [];
    p.lines.forEach((t, i) => { for (const w of wrap(ctx, t, bw)) all.push({ text: w, mark: p.marks[i] || 'o' }); });
    list = all.length > R ? [{ text: '…', mark: 'm' }, ...all.slice(all.length - R + 1)] : all;
  } else if (e.mini) list = lastRow(p);
  else list = panelRows(p, R);
  const hits = jobs && jobs.length && p.mode !== 'say' ? jobRowHits(list, jobs) : null;
  list.forEach((r, i) => {
    const st = markStyle(r.mark, light);
    const yc = Y(by1) + rh * (i + 0.5);
    if (st.bg) { ctx.shadowBlur = 0; ctx.fillStyle = st.bg; ctx.fillRect(X(bx0) - 3, yc - rh / 2, bw + 6, rh); }
    if (hits && hits[i] >= 0) { // 작업을 만든 줄: 왼쪽 상태색 띠 + 옅은 바탕
      const js = jobLineStyle(hits[i], light), bw2 = Math.max(3, fs * 0.2);
      ctx.shadowBlur = 0; ctx.fillStyle = js.bg; ctx.fillRect(X(bx0) - 3, yc - rh / 2, bw + 6, rh);
      ctx.fillStyle = js.bar; ctx.fillRect(X(bx0) - 4 - bw2, yc - rh * 0.42, bw2, rh * 0.84);
    }
    let x = X(bx0), maxW = bw;
    if (r.mark === '$') {
      ctx.font = `700 ${fs}px ${MONO}`; ctx.fillStyle = dimC; ctx.shadowBlur = 0;
      ctx.fillText('$ ', x, yc); const w = ctx.measureText('$ ').width; x += w; maxW -= w;
    }
    const c = st.color || ink;
    ctx.font = `${r.mark === 'm' ? 'italic ' : ''}${st.bold ? 700 : 500} ${fs}px ${MONO}`;
    ctx.fillStyle = c; glow(c, st.dim ? 0 : fs * 0.3);
    ctx.fillText(fit(ctx, r.text, maxW), x, yc);
  });
  ctx.shadowBlur = 0;
}

export class HoloText {
  constructor(scene) {
    this.scene = scene;
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.slots = [];
    this.frame = 0;
    this.light = false;
    this._pick = [];
    for (let i = 0; i < PANEL.TEXT_MAX; i++) {
      const cv = document.createElement('canvas');
      cv.width = Math.round(PANEL.CH * 1.5); cv.height = PANEL.CH;
      const tex = this._tex(cv);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: tex }, uAlpha: { value: 1 }, uSwap: { value: 0 }, uBody: { value: new THREE.Vector4(0, 0, 1, 1) }, uScroll: { value: 0 }, uLight: { value: 0 } },
        vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.visible = false;
      scene.add(mesh);
      this.slots.push({ mesh, mat, cv, ctx: cv.getContext('2d'), tex, e: null, eid: null, pv: -1, rows: -1, light: null, res: '', result: '', target: '', jk: '', used: -1, draws: 0 });
    }
    this.stats = { drawn: 0, redraws: 0, why: {} }; // why: 다시 그린 까닭별 횟수(확인용)
  }
  _tex(cv) {
    const t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    return t;
  }
  setLight(light) { if (this.light !== light) { this.light = light; for (const s of this.slots) s.mat.uniforms.uLight.value = light ? 1 : 0; } }
  /** 장부에서 빠진 항목을 쥔 칸은 비운다(같은 id 가 다시 와도 새로 그림) */
  clear() { for (const s of this.slots) { s.mesh.visible = false; s.e = null; s.eid = null; s.used = -1; } }

  /**
   * 매 프레임: cand = [{e, x,y,z, W,H(세계 크기), px(패널 화면 높이), alpha, swap(0..1), score, ink}] (n 개 앞부분만 유효)
   * 점수 높은 순 TEXT_MAX 개에 칸을 준다(이미 칸이 있던 항목은 그 칸 그대로 → 다시 그리지 않음). 글을 받은 항목은 e._txf = 이번 프레임
   */
  update(cand, n, now) {
    const f = ++this.frame;
    const pick = this._pick; pick.length = 0;
    for (let i = 0; i < n; i++) {
      const c = cand[i];
      c.slot = null;
      for (const s of this.slots) if (s.e === c.e) { c.slot = s; break; }
      pick.push(c);
    }
    if (pick.length > this.slots.length) {
      // 이미 칸을 가진 항목에 덤(최근 활동 상위 노드가 0.25초마다 바뀌며 칸이 오가고 다시 그리는 일 방지 — 상위 가산 1e5 보다 크게,
      // 포커스·카메라 대상(5e5 이상)은 여전히 먼저)
      pick.sort((a, b) => (b.score + (b.slot ? 1.2e5 : 0)) - (a.score + (a.slot ? 1.2e5 : 0)));
      pick.length = this.slots.length;
    }
    // 1) 이미 칸을 가진 항목(같은 패널을 다음 도구가 이어받았으면 그 칸에서 다시 그림)
    for (const c of pick) if (c.slot) c.slot.used = f;
    // 2) 새 항목: 이번 프레임에 안 쓰인 칸
    for (const c of pick) {
      if (c.slot) continue;
      let s = null;
      for (const x of this.slots) if (x.used !== f && (!s || (s.e && !x.e) || (!!s.e === !!x.e && x.used < s.used))) s = x; // 빈 칸 → 가장 오래 안 쓴 칸
      if (!s) break;
      s.used = f; s.e = c.e; s.eid = null; c.slot = s;
    }
    let drawn = 0;
    for (const c of pick) {
      const s = c.slot; if (!s) continue;
      const e = c.e;
      const rows = textRows(c.px, s.eid === e.id ? s.rows : null);
      const jk = c.jobs ? jobLinesKey(c.jobs) : '';
      // 다시 그릴 까닭: 다른 패널 · 내용 판(pv) · 줄 수 단계(거리) · 테마 · (패널 데이터가 없을 때만) 결과·대상 요약 · 작업 줄 표시
      const why = s.eid !== e.id ? (s.eid && s.e === e ? 'swap' : 'slot') : s.pv !== e.pv ? 'pv' : s.rows !== rows ? 'rows' : s.light !== this.light ? 'theme'
        : !e.panel && (s.res !== e.res || s.result !== e.result || s.target !== e.label.target) ? 'summary' : s.jk !== jk ? 'job' : null;
      if (why) {
        this.stats.why[why] = (this.stats.why[why] || 0) + 1;
        const W = Math.round(PANEL.CH * (e.asp || 1.5));
        if (s.cv.width !== W || s.cv.height !== PANEL.CH) { // 크기가 바뀌면 텍스처를 새로(변경 불가 저장소 대비)
          s.cv.width = W; s.cv.height = PANEL.CH;
          s.tex.dispose(); s.tex = this._tex(s.cv); s.mat.uniforms.uMap.value = s.tex;
        }
        drawPanel(s.ctx, s.cv.width, s.cv.height, e, rows, this.light, c.ink, c.jobs);
        s.tex.needsUpdate = true;
        s.eid = e.id; s.pv = e.pv; s.rows = rows; s.light = this.light; s.res = e.res; s.result = e.result; s.target = e.label.target; s.jk = jk;
        const b = shapeLayout(e.shape ?? 0, e.asp || 1.5).body;
        s.mat.uniforms.uBody.value.set(b[0], b[2], b[1], b[3]);
        s.draws++; this.stats.redraws++;
      }
      const u = s.mat.uniforms;
      u.uAlpha.value = c.alpha; u.uSwap.value = c.swap;
      // 꼬리 갱신: 밀려 올라간 줄 수만큼 아래에서 시작해 제자리로(ease-out)
      let sc = 0;
      if (e.scrollAt != null && rows > 0 && now - e.scrollAt < PANEL.SCROLL) {
        const k = 1 - (now - e.scrollAt) / PANEL.SCROLL;
        const b = shapeLayout(e.shape ?? 0, e.asp || 1.5).body;
        sc = ((b[3] - b[2]) / rows) * e.scrollN * k * k;
      }
      u.uScroll.value = sc;
      s.mesh.position.set(c.x, c.y, c.z);
      s.mesh.scale.set(c.W, c.H, 1);
      if (!s.mesh.visible) s.mesh.visible = true;
      e._txf = f;
      drawn++;
    }
    for (const s of this.slots) if (s.used !== f && s.mesh.visible) s.mesh.visible = false;
    this.stats.drawn = drawn;
    return f;
  }
  dispose() {
    for (const s of this.slots) { s.mesh.removeFromParent(); s.mat.dispose(); s.tex.dispose(); }
    this.slots = []; this.geo.dispose();
  }
}
