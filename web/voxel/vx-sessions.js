// 복셀 오피스의 여러 live 세션 연출 — VoxelView 가 하나 만든다. 규칙은 vx-sess-core.mjs(2D 평면도와 공용)
//  · 공용 라운지(정적: 깔개·소파·서류 캐비닛) + 사무실 카펫(세션 색)
//  · 같은 파일 충돌: 캐비닛 위 주황 경고등 + 말풍선(파일명), 양쪽 팀 직원이 캐비닛 앞에 선다
//  · 세션 간 메시지: 종이비행기가 사무실 사이를 난다
//  · 컨텍스트 사용률: 그 사무실 창이 뿌옇게·팀장 책상 서류 더미
import { t as _t } from '../i18n.mjs';
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildLounge, drawCabinetWarn, drawCtxWear, roomFrame, endXf } from './props.js';
import { escapeHtml } from '../html-util.mjs';
import { VxSessCore, PLANE_DUR, ease } from './vx-sess-core.mjs';

export class VxSessions extends VxSessCore {
  constructor(view) { super(view); this.cabs = []; }

  // ---------------- 정적: 라운지·카펫 ----------------
  staticSig() {
    const lay = this.view.layout;
    const L = lay && lay.lounges ? lay.lounges.map((g) => `${g.id}@${g.minX.toFixed(1)},${g.minZ.toFixed(1)}`).join(';') : '';
    let C = '';
    for (const r of this.view.rooms) if (r.type === 'office') { const i = this.sessIdx(this.view.nodes.get(r.ownerId)); if (i != null) C += r.id + ':' + i + ';'; }
    return L + '|' + C;
  }
  /** 라운지 둘레 live 사무실의 세션 색(높은 벽 윗면·문 위 띠·문 밖 깔개), 없으면 null */
  bandColor(r) {
    if (!r || !r.lounge || r.type !== 'office' || r.past) return null;
    return this.sessColor(this.view.nodes.get(r.ownerId));
  }
  buildStatic(b, fp) {
    const v = this.view, lay = v.layout, pal = v.pal;
    if (lay && lay.lounges) for (const g of lay.lounges) buildLounge(g, pal, b, { dim: !!(fp && fp !== g.projectId) });
    // 사무실 카펫(팀장 책상 둘레) = 세션 색
    for (const r0 of v.rooms) {
      if (r0.type !== 'office' || !r0.leadDesk) continue;
      const c = this.sessColor(v.nodes.get(r0.ownerId));
      if (!c) continue;
      const dim = (fp && r0.projectId && r0.projectId !== fp) || r0.past;
      const base = c.clone().lerp(pal.carpetLead || pal.mat, 0.62); // 은은하게(사원증·조끼·문 위 띠가 세션 색을 맡음)
      const col = dim ? base.multiplyScalar(pal.dimFactor) : base;
      const r = roomFrame(r0, b); // 돌린 방은 회전 전 좌표로
      b.lit.box(r.leadDesk.x, -0.025, r.leadDesk.z - 0.3, 5.2, 0.05, 3.4, col);
      endXf(b);
    }
  }

  // ---------------- 동적 그리기 ----------------
  drawDynamic(B, now) {
    const v = this.view, lay = v.layout, pal = v.pal, tok = v.tokens;
    // 캐비닛 경고등
    if (lay && lay.lounges) for (const g of lay.lounges) {
      const ps = this.pairs.filter((p) => this.loungeOf(p) === g);
      if (!ps.length) continue;
      const warn = tok.conflict || new THREE.Color('#ff9a3c');
      drawCabinetWarn(g, pal, warn, now, ps.some((p) => p.level === 'strong' && !p.fading), B);
    }
    // 컨텍스트 사용률: 창·서류 더미(팀장 = 세션 메인)
    for (const r of v.rooms) {
      if (r.type !== 'office' || r.past) continue;
      const n = v.nodes.get(r.ownerId);
      const c = n && n.meta && n.meta.ctx;
      if (c && isFinite(c.pct)) drawCtxWear(r, c.pct, pal, B);
    }
    // 종이비행기(위로 휜 길, 흰 날개 둘)
    const pa = this._pa || (this._pa = new THREE.Vector3()), pb = this._pb || (this._pb = new THREE.Vector3());
    for (const p of this.livePlanes(now)) {
      if (!v._fxPos(p.from, pa) || !v._fxPos(p.to, pb)) continue;
      const k = (now - p.t0) / PLANE_DUR, u = ease(Math.min(1, k));
      const x = pa.x + (pb.x - pa.x) * u, z = pa.z + (pb.z - pa.z) * u, y = 1.6 + Math.sin(u * Math.PI) * 3.2;
      const yaw = Math.atan2(pb.x - pa.x, pb.z - pa.z);
      const s = Math.sin(yaw), cth = Math.cos(yaw);
      for (const side of [-1, 1]) B.glow.box(x + cth * side * 0.16, y, z - s * side * 0.16, 0.26, 0.04, 0.5, pal.plane);
      B.glow.box(x, y - 0.06, z, 0.06, 0.1, 0.5, p.color);
    }
    return this.planes.length > 0;
  }

  // ---------------- 캐비닛 말풍선(CSS2D) ----------------
  updateCabLabels() {
    const v = this.view, lay = v.layout;
    const list = [];
    if (lay && lay.lounges) for (const g of lay.lounges) {
      const ps = this.pairs.filter((p) => this.loungeOf(p) === g);
      if (!ps.length || v._isDim(g.mains[0])) continue;
      const files = [...new Set(ps.flatMap((p) => p.files))];
      const strong = ps.some((p) => p.level === 'strong' && !p.fading);
      const fading = ps.every((p) => p.fading);
      list.push({ g, html: `<b>${escapeHtml(files.length > 1 ? _t('scene.cab.more', { file: files[0], n: files.length - 1 }) : files[0] || '')}</b>`, cls: 'cf-chip vx-cab' + (strong ? ' strong' : '') + (fading ? ' fading' : ''), k: Math.max(...ps.map((p) => p.k)) });
    }
    while (this.cabs.length < list.length) {
      const el = document.createElement('div');
      const o = new CSS2DObject(el);
      o.center.set(0.5, 1);
      v.scene.add(o);
      this.cabs.push({ o, el, html: '', cls: '' });
    }
    this.cabs.forEach((c, i) => {
      const it = list[i];
      if (!it) { if (c.o.visible) c.o.visible = false; return; }
      if (c.html !== it.html) { c.el.innerHTML = it.html; c.html = it.html; }
      if (c.cls !== it.cls) { c.el.className = it.cls; c.cls = it.cls; }
      c.el.style.opacity = (it.k * (v._fxA ? v._fxA(it.g.cabinet.x, it.g.cabinet.z) : 1)).toFixed(2); // 프로젝트 페이드
      c.o.position.set(it.g.cabinet.x, 2.3, it.g.cabinet.z);
      if (!c.o.visible) c.o.visible = true;
    });
  }

  dispose() { for (const c of this.cabs) { c.o.removeFromParent(); c.el.remove(); } this.cabs = []; }
}
